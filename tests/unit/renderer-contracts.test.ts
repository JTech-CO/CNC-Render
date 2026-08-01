import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RENDER_SCENE_UNITS,
  SCENE_LAYERS,
  SCENE_PRESENTATION,
  domainBoundsToSceneBounds,
  domainMmToScene,
  maximumProjectedBoundsDelta,
  projectAxisAlignedBounds,
  resourcesAreStable,
  selectRendererBackend,
  type AxisAlignedBounds,
} from "@cnc-render/renderer";

interface MachineSceneFixture {
  fixtureVersion: number;
  units: "mm";
  camera: {
    preset: "isometric";
    fieldOfViewDegrees: number;
    nearMm: number;
    farMm: number;
    viewportPx: readonly [number, number];
  };
  projectionMatrices: {
    webgpu: readonly number[];
    webgl2: readonly number[];
  };
  approvedProjectionTolerancePx: number;
  majorObjects: readonly {
    id: string;
    bounds: AxisAlignedBounds;
  }[];
}

const fixturePath = fileURLToPath(
  new URL("../fixtures/m3/machine-scene.fixture.json", import.meta.url),
);
const fixture = JSON.parse(
  readFileSync(fixturePath, "utf8"),
) as MachineSceneFixture;

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);

  if (!channels || channels.length !== 3) {
    throw new RangeError(`Invalid RGB hex color: ${hex}`);
  }

  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort(
    (left, right) => right - left,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("M3 renderer contracts", () => {
  it("selects WebGPU first and documents the WebGL 2 fallback", () => {
    const webgpu = selectRendererBackend({
      webgpu: true,
      webgl2: true,
      crossOriginIsolated: true,
      maxTextureDimension2d: 8192,
    });
    const fallback = selectRendererBackend({
      webgpu: false,
      webgl2: true,
      crossOriginIsolated: false,
      maxTextureDimension2d: 4096,
    });

    expect(webgpu.mode).toBe("webgpu");
    expect(webgpu.reason).toBe("webgpu-available");
    expect(webgpu.limits.every((limit) => limit.value.length > 0)).toBe(true);
    expect(fallback.mode).toBe("webgl2");
    expect(fallback.reason).toBe("webgl2-fallback");
    expect(fallback.limits).toContainEqual(
      expect.objectContaining({
        id: "material-update",
        value: "CPU/WASM 부분 메시 update",
      }),
    );
    expect(webgpu.limits).toContainEqual(
      expect.objectContaining({
        id: "material-update",
        value: "GPU 부분 buffer update",
      }),
    );
  });

  it("refuses to invent a backend when neither API is available", () => {
    expect(
      selectRendererBackend({
        webgpu: false,
        webgl2: false,
        crossOriginIsolated: false,
        maxTextureDimension2d: null,
      }),
    ).toMatchObject({
      mode: null,
      reason: "no-supported-backend",
      limits: [],
    });
  });

  it("keeps every semantic object in an independent collision layer", () => {
    expect(SCENE_LAYERS.map((layer) => layer.id)).toEqual([
      "machine",
      "stock",
      "cutter",
      "holder",
      "fixture",
      "toolpath",
    ]);
    expect(new Set(SCENE_LAYERS.map((layer) => layer.collisionGroupId)).size).toBe(
      SCENE_LAYERS.length,
    );
    expect(new Set(SCENE_LAYERS.map((layer) => layer.collisionMask)).size).toBe(
      SCENE_LAYERS.length,
    );
    expect(
      SCENE_LAYERS.every(
        (layer) =>
          Number.isInteger(layer.collisionMask) &&
          layer.collisionMask > 0 &&
          (layer.collisionMask & (layer.collisionMask - 1)) === 0,
      ),
    ).toBe(true);
  });

  it("keeps the white stock legible on the documented viewport background", () => {
    expect(SCENE_PRESENTATION).toEqual({
      viewportBackground: "#e9edf1",
      stockSurface: "#fdfdfb",
      stockEdge: "#4d5966",
    });
    expect(SCENE_PRESENTATION.stockSurface).not.toBe(
      SCENE_PRESENTATION.viewportBackground,
    );
    expect(
      contrastRatio(
        SCENE_PRESENTATION.stockEdge,
        SCENE_PRESENTATION.viewportBackground,
      ),
    ).toBeGreaterThanOrEqual(3);
  });

  it("uses one documented millimetre render boundary", () => {
    expect(RENDER_SCENE_UNITS).toEqual({
      length: "millimetre",
      unitsPerMillimetre: 1,
    });
    expect(domainMmToScene([12, 34, 56])).toEqual([12, 56, -34]);
    expect(
      domainBoundsToSceneBounds({
        min: [-10, -20, 0],
        max: [30, 40, 50],
      }),
    ).toEqual({
      min: [-10, 0, -40],
      max: [30, 50, 20],
    });
  });

  it("keeps WebGPU and WebGL 2 camera projections within the approved tolerance", () => {
    expect(fixture.fixtureVersion).toBe(1);
    expect(fixture.units).toBe("mm");
    expect(fixture.projectionMatrices.webgpu).toHaveLength(16);
    expect(fixture.projectionMatrices.webgl2).toHaveLength(16);
    const [width, height] = fixture.camera.viewportPx;

    for (const object of fixture.majorObjects) {
      const sceneBounds = domainBoundsToSceneBounds(object.bounds);
      const webgpuBounds = projectAxisAlignedBounds(
        fixture.projectionMatrices.webgpu,
        sceneBounds,
        width,
        height,
      );
      const webgl2Bounds = projectAxisAlignedBounds(
        fixture.projectionMatrices.webgl2,
        sceneBounds,
        width,
        height,
      );

      expect(
        maximumProjectedBoundsDelta(webgpuBounds, webgl2Bounds),
        object.id,
      ).toBeLessThanOrEqual(fixture.approvedProjectionTolerancePx);
      expect(webgpuBounds.maxX).toBeGreaterThan(webgpuBounds.minX);
      expect(webgpuBounds.maxY).toBeGreaterThan(webgpuBounds.minY);
    }
  });

  it("detects monotonic resource growth without accepting transient churn", () => {
    const baseline = { geometries: 18, textures: 1, programs: 7 };
    expect(
      resourcesAreStable(baseline, [
        { geometries: 18, textures: 1, programs: 7 },
        { geometries: 17, textures: 1, programs: 7 },
      ]),
    ).toBe(true);
    expect(
      resourcesAreStable(baseline, [
        { geometries: 18, textures: 1, programs: 7 },
        { geometries: 19, textures: 1, programs: 7 },
      ]),
    ).toBe(false);
  });
});

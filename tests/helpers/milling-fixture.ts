import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Stock, ToolAssembly, Vec3Mm } from "@cnc-render/contracts";
import {
  SparseDexelMillingEngine,
  type MillingQualityPreset,
  type MillingSweep,
} from "@cnc-render/simulation";

export interface MillingGoldenItem {
  readonly id: string;
  readonly operation:
    | "face-milling"
    | "slot"
    | "pocket"
    | "outer-contour";
  readonly tool: {
    readonly diameterMm: number;
    readonly cuttingLengthMm: number;
  };
  readonly analyticModel: string;
  readonly expectedRemovedVolumeMm3: number;
  readonly measurement:
    | {
        readonly kind: "depth";
        readonly pointMm: Vec3Mm;
        readonly expectedMm: number;
      }
    | {
        readonly kind: "wall-thickness";
        readonly axis: "x" | "y";
        readonly pointMm: Vec3Mm;
        readonly expectedMm: number;
      };
  readonly sweeps: readonly MillingSweep[];
}

export interface MillingGoldenFixture {
  readonly fixtureVersion: number;
  readonly units: "mm";
  readonly seed: number;
  readonly brickSizeDexels: number;
  readonly stock: {
    readonly sizeMm: Vec3Mm;
    readonly positionMm: Vec3Mm;
    readonly baseResolutionMm: number;
  };
  readonly presetRelativeVolumeErrorLimits: Readonly<
    Record<MillingQualityPreset, number>
  >;
  readonly fixtures: readonly MillingGoldenItem[];
}

const fixturePath = fileURLToPath(
  new URL(
    "../fixtures/material-removal/milling/milling-golden.json",
    import.meta.url,
  ),
);

export function loadMillingGoldenFixture(): MillingGoldenFixture {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as MillingGoldenFixture;
}

export function createMillingStock(
  fixture: MillingGoldenFixture,
  resolutionMm = fixture.stock.baseResolutionMm,
): Stock {
  return {
    schemaVersion: 1,
    id: "25000000-0000-4000-8000-000000000001",
    name: "M5 Golden box stock",
    geometry: {
      primitiveType: "box",
      sizeMm: fixture.stock.sizeMm,
    },
    transform: {
      positionMm: fixture.stock.positionMm,
      rotationRad: { xRad: 0, yRad: 0, zRad: 0 },
    },
    materialId: "25000000-0000-4000-8000-000000000002",
    representationType: "dexel",
    resolutionMm,
    sourceModelResourceId: null,
  };
}

export function createMillingTool(item: MillingGoldenItem): ToolAssembly {
  return {
    schemaVersion: 1,
    id: "25000000-0000-4000-8000-000000000003",
    name: `${item.tool.diameterMm} mm M5 flat end mill`,
    toolType: "milling-cutter",
    cutterGeometry: {
      geometryType: "flat-end-mill",
      diameterMm: item.tool.diameterMm,
      cornerRadiusMm: 0,
      fluteCount: 4,
      cuttingLengthMm: item.tool.cuttingLengthMm,
      overallLengthMm: 60,
    },
    holderGeometry: {
      diameterMm: 32,
      lengthMm: 45,
    },
    gaugeLengthMm: 70,
    stickoutLengthMm: 30,
    maxSpindleSpeedRpm: 12_000,
    wearRatio: 0,
    materialCompatibilityIds: [
      "25000000-0000-4000-8000-000000000002",
    ],
  };
}

export function runMillingGoldenItem(
  fixture: MillingGoldenFixture,
  item: MillingGoldenItem,
  preset: MillingQualityPreset,
): SparseDexelMillingEngine {
  const engine = new SparseDexelMillingEngine({
    stock: createMillingStock(fixture),
    tool: createMillingTool(item),
    preset,
    seed: fixture.seed,
    brickSizeDexels: fixture.brickSizeDexels,
  });
  for (const sweep of item.sweeps) {
    engine.applySweep(sweep);
  }
  return engine;
}

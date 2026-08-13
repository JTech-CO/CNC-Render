import type { Stock, ToolAssembly } from "@cnc-render/contracts";
import {
  SparseDexelMillingEngine,
  createM7FaceMillingTarget,
  createM7MillingToolpathPoints,
  createM7PipelineFixture,
  measureMillingStockAgainstTarget,
  type M7MillingConfiguration,
  type MillingStockSurfaceDescriptor,
} from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";

const RUN_ID = "7a000000-0000-4000-8000-000000000001";
const MATERIAL_ID = "7a000000-0000-4000-8000-000000000002";

function actualSurface(
  configuration: M7MillingConfiguration = {
    stockPreset: "standard",
    cutDirection: "x",
  },
): MillingStockSurfaceDescriptor {
  const run = createM7PipelineFixture("milling", RUN_ID, configuration);
  if (run.process.processType !== "milling") {
    throw new Error("Expected the representative milling process.");
  }
  const stock: Stock = {
    schemaVersion: 1,
    id: "7a000000-0000-4000-8000-000000000003",
    name: "M10 actual face-milling Stock",
    geometry: {
      primitiveType: "box",
      sizeMm: run.process.stock.sizeMm,
    },
    transform: {
      positionMm: run.process.stock.positionMm,
      rotationRad: { xRad: 0, yRad: 0, zRad: 0 },
    },
    materialId: MATERIAL_ID,
    representationType: "dexel",
    resolutionMm: run.process.stock.baseResolutionMm,
    sourceModelResourceId: null,
  };
  const tool: ToolAssembly = {
    schemaVersion: 1,
    id: "7a000000-0000-4000-8000-000000000004",
    name: "M10 20 mm flat end mill",
    toolType: "milling-cutter",
    cutterGeometry: {
      geometryType: "flat-end-mill",
      diameterMm: run.process.tool.diameterMm,
      cornerRadiusMm: 0,
      fluteCount: 4,
      cuttingLengthMm: run.process.tool.cuttingLengthMm,
      overallLengthMm: 80,
    },
    holderGeometry: { diameterMm: 42, lengthMm: 50 },
    gaugeLengthMm: 80,
    stickoutLengthMm: 48,
    maxSpindleSpeedRpm: 12_000,
    wearRatio: 0,
    materialCompatibilityIds: [MATERIAL_ID],
  };
  const engine = new SparseDexelMillingEngine({
    stock,
    tool,
    preset: run.process.preset,
    seed: run.process.seed,
    brickSizeDexels: run.process.brickSizeDexels,
  });
  const points = createM7MillingToolpathPoints(configuration);
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    engine.applySweep({
      startMm: { xMm: start[0], yMm: start[1], zMm: start[2] },
      endMm: { xMm: end[0], yMm: end[1], zMm: end[2] },
    });
  }
  return engine.createFullSurfaceSnapshot();
}

describe("M10 actual Stock-to-target measurement", () => {
  it("matches the representative five-pass target without retaining a target array", () => {
    const surface = actualSurface();
    const measurement = measureMillingStockAgainstTarget(
      surface,
      createM7FaceMillingTarget(),
    );

    expect(measurement).toEqual({
      targetId: "m7.face-milling.standard.x",
      comparedCells: 1_125,
      targetCutCells: 699,
      representationResolutionMm: 8,
      numericToleranceMm: 0.000001,
      maxDeviationMm: 0,
      meanAbsoluteDeviationMm: 0,
      overcutVolumeMm3: 0,
      undercutVolumeMm3: 0,
      actualRemovedVolumeMm3: 357_888,
      targetRemovedVolumeMm3: 357_888,
    });
    expect(Object.values(measurement)).not.toContainEqual(expect.any(Float32Array));
  });

  it("reports overcut and undercut direction with edge-aware cell volume", () => {
    const surface = actualSurface();
    const changedTopZMm = surface.topZMm.slice();
    const centerColumn = 22;
    changedTopZMm[12 * surface.columns + centerColumn] = 342;
    changedTopZMm[7 * surface.columns + centerColumn] = 326;

    const measurement = measureMillingStockAgainstTarget(
      { ...surface, topZMm: changedTopZMm },
      createM7FaceMillingTarget(),
    );

    expect(measurement.maxDeviationMm).toBe(8);
    expect(measurement.overcutVolumeMm3).toBe(512);
    expect(measurement.undercutVolumeMm3).toBe(512);
    expect(measurement.actualRemovedVolumeMm3).toBe(357_888);
  });

  it("rejects non-finite surfaces and a target authored for another Stock", () => {
    const surface = actualSurface();
    const invalidTopZMm = surface.topZMm.slice();
    invalidTopZMm[0] = Number.NaN;
    expect(() =>
      measureMillingStockAgainstTarget(
        { ...surface, topZMm: invalidTopZMm },
        createM7FaceMillingTarget(),
      ),
    ).toThrowError("must be a finite millimetre value");

    expect(() =>
      measureMillingStockAgainstTarget(
        surface,
        createM7FaceMillingTarget({
          stockPreset: "compact",
          cutDirection: "x",
        }),
      ),
    ).toThrowError("actual Stock bounds do not match");
  });

  it.each([
    { stockPreset: "standard", cutDirection: "y" },
    { stockPreset: "compact", cutDirection: "x" },
    { stockPreset: "compact", cutDirection: "y" },
  ] as const)(
    "measures the $stockPreset/$cutDirection target deterministically",
    (configuration) => {
      const surface = actualSurface(configuration);
      const target = createM7FaceMillingTarget(configuration);
      const first = measureMillingStockAgainstTarget(surface, target);
      const second = measureMillingStockAgainstTarget(surface, target);

      expect(first).toEqual(second);
      expect(first.maxDeviationMm).toBe(0);
      expect(first.overcutVolumeMm3).toBe(0);
      expect(first.undercutVolumeMm3).toBe(0);
      expect(first.actualRemovedVolumeMm3).toBe(
        first.targetRemovedVolumeMm3,
      );
    },
  );
});

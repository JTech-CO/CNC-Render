import type { Stock, ToolAssembly } from "@cnc-render/contracts";
import {
  LatheRadiusFieldEngine,
  createM7DrillingTarget,
  createM7OdTurningTarget,
  createM7PipelineFixture,
  measureTurningStockAgainstTarget,
  type M7PipelineFixture,
  type TurningProfileSurfaceDescriptor,
  type TurningRadiusFieldTarget,
} from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";

const RUN_ID = "7b000000-0000-4000-8000-000000000001";
const MATERIAL_ID = "7b000000-0000-4000-8000-000000000002";

function actualSurface(
  fixture: Extract<M7PipelineFixture, "drilling" | "turning">,
): {
  readonly surface: TurningProfileSurfaceDescriptor;
  readonly target: TurningRadiusFieldTarget;
} {
  const run = createM7PipelineFixture(fixture, RUN_ID);
  if (run.process.processType !== "turning") {
    throw new Error("Expected a representative radius-field process.");
  }
  const drilling = fixture === "drilling";
  const stock: Stock = {
    schemaVersion: 1,
    id: "7b000000-0000-4000-8000-000000000003",
    name: "M10 actual rotational Stock",
    geometry: {
      primitiveType: "cylinder",
      diameterMm: run.process.stock.diameterMm,
      lengthMm: run.process.stock.lengthMm,
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
    id: "7b000000-0000-4000-8000-000000000004",
    name: drilling ? "M10 16 mm drill" : "M10 OD turning insert",
    toolType: drilling ? "drill" : "turning-tool",
    cutterGeometry: {
      geometryType: drilling ? "drill" : "turning-insert",
      diameterMm: drilling ? 16 : 12,
      cornerRadiusMm: drilling ? 0 : 0.4,
      fluteCount: drilling ? 2 : 1,
      cuttingLengthMm: drilling ? 90 : 20,
      overallLengthMm: drilling ? 120 : 80,
    },
    holderGeometry: { diameterMm: 25, lengthMm: 80 },
    gaugeLengthMm: 100,
    stickoutLengthMm: 45,
    maxSpindleSpeedRpm: 6_000,
    wearRatio: 0,
    materialCompatibilityIds: [MATERIAL_ID],
  };
  const engine = new LatheRadiusFieldEngine({
    stock,
    tool,
    preset: run.process.preset,
    seed: run.process.seed,
    machineMaxSpindleSpeedRpm: run.process.machineMaxSpindleSpeedRpm,
    chuckGripLengthMm: run.process.chuckGripLengthMm,
  });
  const target = drilling
    ? createM7DrillingTarget()
    : createM7OdTurningTarget();
  for (const cut of target.cuts) {
    engine.applyCut(cut);
  }
  return {
    surface: engine.createFullSurfaceSnapshot(run.process.radialSegments),
    target,
  };
}

describe("M10 turning Stock-to-target measurement", () => {
  it("measures the authored OD profile and finished diameter", () => {
    const { surface, target } = actualSurface("turning");
    const measurement = measureTurningStockAgainstTarget(surface, target);

    expect(measurement).toMatchObject({
      targetId: "m7.od-turning.balanced",
      process: "od-turning",
      comparedCells: 120,
      targetCutCells: 101,
      representationResolutionMm: 1,
      numericToleranceMm: 0.000001,
      maxDeviationMm: 0,
      meanAbsoluteDeviationMm: 0,
      overcutVolumeMm3: 0,
      undercutVolumeMm3: 0,
      feature: {
        kind: "outer-diameter",
        sampleZMm: 300,
        actualDiameterMm: 64,
        targetDiameterMm: 64,
      },
    });
    expect(measurement.actualRemovedVolumeMm3).toBeCloseTo(
      measurement.targetRemovedVolumeMm3,
      8,
    );
    expect(JSON.stringify(measurement)).not.toContain("outerRadiusMm");
  });

  it("measures a 16 mm coaxial hole and represented 80 mm depth", () => {
    const { surface, target } = actualSurface("drilling");
    const measurement = measureTurningStockAgainstTarget(surface, target);

    expect(measurement).toMatchObject({
      targetId: "m7.drilling-16x80.balanced",
      process: "drilling",
      comparedCells: 120,
      targetCutCells: 80,
      representationResolutionMm: 1,
      numericToleranceMm: 0.000001,
      maxDeviationMm: 0,
      meanAbsoluteDeviationMm: 0,
      overcutVolumeMm3: 0,
      undercutVolumeMm3: 0,
      feature: {
        kind: "drilled-hole",
        sampleZMm: 320,
        actualDiameterMm: 16,
        targetDiameterMm: 16,
        actualDepthMm: 80,
        targetDepthMm: 80,
        freeEnd: "positive-z",
      },
    });
    expect(measurement.actualRemovedVolumeMm3).toBeCloseTo(
      Math.PI * 8 ** 2 * 80,
      8,
    );
    expect(measurement.actualRemovedVolumeMm3).toBeCloseTo(
      measurement.targetRemovedVolumeMm3,
      8,
    );
    expect(JSON.stringify(measurement)).not.toContain("innerRadiusMm");
  });

  it.each(["turning", "drilling"] as const)(
    "reports both overcut and undercut for a perturbed %s radius field",
    (fixture) => {
      const { surface, target } = actualSurface(fixture);
      const changedInner = surface.innerRadiusMm.slice();
      const changedOuter = surface.outerRadiusMm.slice();
      if (fixture === "turning") {
        changedOuter[60] -= 1;
        changedOuter[61] += 1;
      } else {
        changedInner[70] += 1;
        changedInner[71] -= 1;
      }

      const measurement = measureTurningStockAgainstTarget(
        {
          ...surface,
          innerRadiusMm: changedInner,
          outerRadiusMm: changedOuter,
        },
        target,
      );

      expect(measurement.maxDeviationMm).toBe(1);
      expect(measurement.overcutVolumeMm3).toBeGreaterThan(0);
      expect(measurement.undercutVolumeMm3).toBeGreaterThan(0);
    },
  );

  it("rejects non-finite profiles and a target for another Stock axis", () => {
    const { surface, target } = actualSurface("turning");
    const invalidOuter = surface.outerRadiusMm.slice();
    invalidOuter[0] = Number.NaN;
    expect(() =>
      measureTurningStockAgainstTarget(
        { ...surface, outerRadiusMm: invalidOuter },
        target,
      ),
    ).toThrowError("must be a finite millimetre value");

    expect(() =>
      measureTurningStockAgainstTarget(surface, {
        ...target,
        axisCenterMm: { xMm: 2, yMm: 0 },
      }),
    ).toThrowError("actual Stock axis or Z bounds do not match");
  });

  it.each(["turning", "drilling"] as const)(
    "is deterministic for repeated %s measurements",
    (fixture) => {
      const { surface, target } = actualSurface(fixture);
      expect(
        measureTurningStockAgainstTarget(surface, target),
      ).toEqual(measureTurningStockAgainstTarget(surface, target));
    },
  );
});

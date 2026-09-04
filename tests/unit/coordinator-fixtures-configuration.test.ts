import {
  createM7FaceMillingTarget,
  createM7DrillingTarget,
  createM7OdTurningTarget,
  createM7MillingToolpathPoints,
  createM7PipelineFixture,
} from "../../packages/simulation/src/coordinator-fixtures";
import { describe, expect, it } from "vitest";

const RUN_ID = "79000000-0000-4000-8000-000000000001";

describe("M7 configurable milling fixture", () => {
  it("preserves the default representative program", () => {
    const run = createM7PipelineFixture("milling", RUN_ID);

    expect(run.source).toBe(`G21 G90
G0 X-170 Y-80 Z370
G1 Z338 F1200
G1 X170 F2400
G1 Y-40 F1200
G1 X-170 F2400
G1 Y0 F1200
G1 X170 F2400
G1 Y40 F1200
G1 X-170 F2400
G1 Y80 F1200
G1 X170 F2400
G0 Z370
M30
`);
  });

  it("changes both Stock dimensions and the deterministic raster direction", () => {
    const configuration = { stockPreset: "compact", cutDirection: "y" } as const;
    const run = createM7PipelineFixture("milling", RUN_ID, configuration);
    const points = createM7MillingToolpathPoints(configuration);

    expect(run.initialPositionMm).toEqual({ xMm: -130, yMm: -60, zMm: 354 });
    expect(points.slice(0, 4)).toEqual([
      [-130, -60, 354],
      [-130, -60, 322],
      [-130, 60, 322],
      [-65, 60, 322],
    ]);
    expect(points.at(-1)).toEqual([130, 60, 354]);
    expect(run.source).toContain("G1 Y60 F2400");
    expect(run.source).toContain("G1 X-65 F1200");
    expect(run.process.processType).toBe("milling");
    if (run.process.processType !== "milling") {
      throw new Error("Expected a milling process.");
    }
    expect(run.process.stock).toMatchObject({
      sizeMm: { xMm: 280, yMm: 160, zMm: 72 },
      positionMm: { xMm: 0, yMm: 0, zMm: 290 },
    });

    const collision = createM7PipelineFixture(
      "collision-stop",
      RUN_ID,
      configuration,
    );
    expect(collision.source).toContain("G1 X170 F2400");
    expect(collision.source).not.toContain("G1 Y60 F2400");
  });

  it("maps custom feed, spindle speed, and depth into the deterministic run", () => {
    const configuration = { stockPreset: "compact", cutDirection: "y" } as const;
    const operation = {
      cuttingFeedMmPerMin: 1_800,
      spindleSpeedRpm: 7_200,
      depthOfCutMm: 2.5,
    } as const;
    const run = createM7PipelineFixture(
      "milling",
      RUN_ID,
      configuration,
      operation,
    );
    const points = createM7MillingToolpathPoints(configuration, operation);
    const target = createM7FaceMillingTarget(configuration, operation);

    expect(points[1]).toEqual([-130, -60, 323.5]);
    expect(run.source).toContain("S7200 M3");
    expect(run.source).toContain("G1 Y60 F1800");
    expect(target.commandedCutDepthMm).toBe(2.5);
    expect(() =>
      createM7PipelineFixture("milling", RUN_ID, configuration, {
        ...operation,
        cuttingFeedMmPerMin: Number.POSITIVE_INFINITY,
      }),
    ).toThrowError("cuttingFeedMmPerMin must be a finite positive number");
  });
});

describe("M10 turning and drilling fixture targets", () => {
  it("pairs the OD turning run with an independently authored radius target", () => {
    const run = createM7PipelineFixture("turning", RUN_ID);
    const target = createM7OdTurningTarget();

    expect(run.fixtureId).toBe("m7-turning");
    expect(run.process.processType).toBe("turning");
    if (run.process.processType !== "turning") {
      throw new Error("Expected a turning process.");
    }
    expect(run.process.toolKind).toBe("turning");
    expect(target).toMatchObject({
      process: "od-turning",
      accuracyGrade: "E2",
      commandedCutDepthMm: 8,
      initialOuterRadiusMm: 40,
      measurementZMm: 300,
    });
    expect(target.cuts).toHaveLength(2);
  });

  it("uses four deterministic drilling passes and an 80 mm hole target", () => {
    const run = createM7PipelineFixture("drilling", RUN_ID);
    const target = createM7DrillingTarget();

    expect(run.fixtureId).toBe("m7-drilling");
    expect(run.initialPositionMm).toEqual({ xMm: 16, yMm: 0, zMm: 370 });
    expect(run.process.processType).toBe("turning");
    if (run.process.processType !== "turning") {
      throw new Error("Expected a turning process.");
    }
    expect(run.process.toolKind).toBe("drill");
    expect(
      run.source
        .split("\n")
        .filter((line) => line.startsWith("G1 Z")),
    ).toEqual([
      "G1 Z340 F900",
      "G1 Z320 F900",
      "G1 Z300 F900",
      "G1 Z280 F900",
    ]);
    expect(target).toMatchObject({
      process: "drilling",
      accuracyGrade: "E2",
      commandedCutDepthMm: 80,
      toolDiameterMm: 16,
      measurementZMm: 320,
      freeEnd: "positive-z",
    });
    expect(target.cuts).toEqual([
      {
        operation: "drilling",
        startZMm: 280,
        endZMm: 360,
        startInnerRadiusMm: 8,
        endInnerRadiusMm: 8,
      },
    ]);
  });
});

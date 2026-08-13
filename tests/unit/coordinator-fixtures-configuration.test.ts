import {
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
});

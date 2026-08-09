import type { CoordinatorRunRequest } from "@cnc-render/contracts";

export type M7PipelineFixture = "milling" | "turning" | "collision-stop";

const MILLING_SOURCE = `G21 G90
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
`;

const TURNING_SOURCE = `G21 G90 G18
G0 X40 Z20
G1 X30 F6000
G1 Z60 F6000
M30
`;

function millingRun(
  runId: string,
  collision: boolean,
): CoordinatorRunRequest {
  return {
    schemaVersion: 1,
    runId,
    fixtureId: collision ? "m7-collision-stop" : "m7-milling",
    source: MILLING_SOURCE,
    initialPositionMm: { xMm: -170, yMm: -80, zMm: 370 },
    process: {
      processType: "milling",
      stock: {
        sizeMm: { xMm: 360, yMm: 200, zMm: 88 },
        positionMm: { xMm: 0, yMm: 0, zMm: 298 },
        baseResolutionMm: 8,
      },
      tool: { diameterMm: 20, cuttingLengthMm: 44 },
      preset: "balanced",
      seed: 7,
      brickSizeDexels: 16,
      rapidRateMmPerMin: 12_000,
      axisLimitMm: 500,
      toolCollisionRadiusMm: 10,
      collisionBoxes: collision
        ? [
            {
              objectId: "70000000-0000-4000-8000-000000000099",
              minimumMm: { xMm: 169, yMm: -66, zMm: 335 },
              maximumMm: { xMm: 171, yMm: -64, zMm: 341 },
            },
          ]
        : [],
    },
  };
}

function turningRun(runId: string): CoordinatorRunRequest {
  return {
    schemaVersion: 1,
    runId,
    fixtureId: "m7-turning",
    source: TURNING_SOURCE,
    initialPositionMm: { xMm: 40, yMm: 0, zMm: 20 },
    process: {
      processType: "turning",
      stock: {
        diameterMm: 40,
        lengthMm: 60,
        positionMm: { xMm: 0, yMm: 0, zMm: 40 },
        baseResolutionMm: 1,
      },
      toolKind: "turning",
      preset: "balanced",
      seed: 7,
      machineMaxSpindleSpeedRpm: 4_500,
      chuckGripLengthMm: 5,
      rapidRateMmPerMin: 12_000,
      radialSegments: 24,
    },
  };
}

export function createM7PipelineFixture(
  fixture: M7PipelineFixture,
  runId: string,
): CoordinatorRunRequest {
  switch (fixture) {
    case "milling":
      return millingRun(runId, false);
    case "turning":
      return turningRun(runId);
    case "collision-stop":
      return millingRun(runId, true);
  }
}

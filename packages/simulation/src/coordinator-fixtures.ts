import type { CoordinatorRunRequest } from "@cnc-render/contracts";

import type { MillingFlatEndSweepTarget } from "./milling-target-measurement";

export type M7PipelineFixture = "milling" | "turning" | "collision-stop";
export type M7MillingStockPreset = "standard" | "compact";
export type M7MillingCutDirection = "x" | "y";

export interface M7MillingConfiguration {
  readonly stockPreset: M7MillingStockPreset;
  readonly cutDirection: M7MillingCutDirection;
}

export interface M7FaceMillingTarget extends MillingFlatEndSweepTarget {
  readonly accuracyGrade: "E2";
  readonly commandedCutDepthMm: number;
}

export type M7MillingConfigurationInput = Partial<M7MillingConfiguration>;

export const DEFAULT_M7_MILLING_CONFIGURATION: M7MillingConfiguration = {
  stockPreset: "standard",
  cutDirection: "x",
};

interface MillingStockProfile {
  readonly sizeMm: { readonly xMm: number; readonly yMm: number; readonly zMm: number };
  readonly positionMm: { readonly xMm: number; readonly yMm: number; readonly zMm: number };
  readonly halfPathXmm: number;
  readonly halfPathYmm: number;
  readonly cutZMm: number;
  readonly safeZMm: number;
}

const MILLING_STOCK_PROFILES: Record<M7MillingStockPreset, MillingStockProfile> = {
  standard: {
    sizeMm: { xMm: 360, yMm: 200, zMm: 88 },
    positionMm: { xMm: 0, yMm: 0, zMm: 298 },
    halfPathXmm: 170,
    halfPathYmm: 80,
    cutZMm: 338,
    safeZMm: 370,
  },
  compact: {
    sizeMm: { xMm: 280, yMm: 160, zMm: 72 },
    positionMm: { xMm: 0, yMm: 0, zMm: 290 },
    halfPathXmm: 130,
    halfPathYmm: 60,
    cutZMm: 322,
    safeZMm: 354,
  },
};

export function resolveM7MillingConfiguration(
  configuration: M7MillingConfigurationInput = {},
): M7MillingConfiguration {
  return {
    stockPreset: configuration.stockPreset ?? DEFAULT_M7_MILLING_CONFIGURATION.stockPreset,
    cutDirection:
      configuration.cutDirection ?? DEFAULT_M7_MILLING_CONFIGURATION.cutDirection,
  };
}

export function createM7MillingToolpathPoints(
  configuration: M7MillingConfigurationInput = {},
): readonly (readonly [number, number, number])[] {
  const resolved = resolveM7MillingConfiguration(configuration);
  const profile = MILLING_STOCK_PROFILES[resolved.stockPreset];
  const points: Array<readonly [number, number, number]> = [
    [-profile.halfPathXmm, -profile.halfPathYmm, profile.safeZMm],
    [-profile.halfPathXmm, -profile.halfPathYmm, profile.cutZMm],
  ];

  for (let pass = 0; pass < 5; pass += 1) {
    const laneRatio = pass / 4;
    if (resolved.cutDirection === "x") {
      const yMm = -profile.halfPathYmm + profile.halfPathYmm * 2 * laneRatio;
      const targetXmm = pass % 2 === 0 ? profile.halfPathXmm : -profile.halfPathXmm;
      points.push([targetXmm, yMm, profile.cutZMm]);
      if (pass < 4) {
        const nextYmm =
          -profile.halfPathYmm + profile.halfPathYmm * 2 * ((pass + 1) / 4);
        points.push([targetXmm, nextYmm, profile.cutZMm]);
      }
    } else {
      const xMm = -profile.halfPathXmm + profile.halfPathXmm * 2 * laneRatio;
      const targetYmm = pass % 2 === 0 ? profile.halfPathYmm : -profile.halfPathYmm;
      points.push([xMm, targetYmm, profile.cutZMm]);
      if (pass < 4) {
        const nextXmm =
          -profile.halfPathXmm + profile.halfPathXmm * 2 * ((pass + 1) / 4);
        points.push([nextXmm, targetYmm, profile.cutZMm]);
      }
    }
  }

  const finalPoint = points.at(-1)!;
  points.push([finalPoint[0], finalPoint[1], profile.safeZMm]);
  return points;
}

export function createM7FaceMillingTarget(
  configuration: M7MillingConfigurationInput = {},
): M7FaceMillingTarget {
  const resolved = resolveM7MillingConfiguration(configuration);
  const profile = MILLING_STOCK_PROFILES[resolved.stockPreset];
  const halfStock = {
    xMm: profile.sizeMm.xMm / 2,
    yMm: profile.sizeMm.yMm / 2,
    zMm: profile.sizeMm.zMm / 2,
  };
  const points = createM7MillingToolpathPoints(resolved);
  return {
    targetId: `m7.face-milling.${resolved.stockPreset}.${resolved.cutDirection}`,
    kind: "flat-end-sweep",
    accuracyGrade: "E2",
    commandedCutDepthMm:
      profile.positionMm.zMm + halfStock.zMm - profile.cutZMm,
    stockBoundsMm: {
      minimum: {
        xMm: profile.positionMm.xMm - halfStock.xMm,
        yMm: profile.positionMm.yMm - halfStock.yMm,
        zMm: profile.positionMm.zMm - halfStock.zMm,
      },
      maximum: {
        xMm: profile.positionMm.xMm + halfStock.xMm,
        yMm: profile.positionMm.yMm + halfStock.yMm,
        zMm: profile.positionMm.zMm + halfStock.zMm,
      },
    },
    cutterDiameterMm: 20,
    sweeps: points.slice(1).map((end, index) => {
      const start = points[index];
      return {
        startMm: { xMm: start[0], yMm: start[1], zMm: start[2] },
        endMm: { xMm: end[0], yMm: end[1], zMm: end[2] },
      };
    }),
  };
}

function coordinate(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}

function millingSource(configuration: M7MillingConfiguration): string {
  const points = createM7MillingToolpathPoints(configuration);
  const first = points[0];
  const lines = [
    "G21 G90",
    `G0 X${coordinate(first[0])} Y${coordinate(first[1])} Z${coordinate(first[2])}`,
    `G1 Z${coordinate(points[1][2])} F1200`,
  ];

  for (let index = 2; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const words: string[] = [];
    if (current[0] !== previous[0]) {
      words.push(`X${coordinate(current[0])}`);
    }
    if (current[1] !== previous[1]) {
      words.push(`Y${coordinate(current[1])}`);
    }
    const cuttingMove =
      configuration.cutDirection === "x"
        ? current[0] !== previous[0]
        : current[1] !== previous[1];
    lines.push(`G1 ${words.join(" ")} F${cuttingMove ? 2400 : 1200}`);
  }

  lines.push(`G0 Z${coordinate(points.at(-1)![2])}`, "M30");
  return `${lines.join("\n")}\n`;
}

const TURNING_SOURCE = `G21 G90 G18
G0 X90 Z350
G1 X76 F900
G1 Z250 F1800
G0 X90
G0 Z350
G1 X72 F900
G1 Z250 F1800
G0 X90
G0 Z350
G1 X68 F900
G1 Z250 F1800
G0 X90
G0 Z350
G1 X64 F900
G1 Z250 F1800
G0 X90
G0 Z370
M30
`;

function millingRun(
  runId: string,
  collision: boolean,
  configurationInput: M7MillingConfigurationInput,
): CoordinatorRunRequest {
  const configuration = resolveM7MillingConfiguration(
    collision ? DEFAULT_M7_MILLING_CONFIGURATION : configurationInput,
  );
  const profile = MILLING_STOCK_PROFILES[configuration.stockPreset];
  const firstPoint = createM7MillingToolpathPoints(configuration)[0];
  return {
    schemaVersion: 1,
    runId,
    fixtureId: collision ? "m7-collision-stop" : "m7-milling",
    source: millingSource(configuration),
    initialPositionMm: {
      xMm: firstPoint[0],
      yMm: firstPoint[1],
      zMm: firstPoint[2],
    },
    process: {
      processType: "milling",
      stock: {
        sizeMm: profile.sizeMm,
        positionMm: profile.positionMm,
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
    initialPositionMm: { xMm: 90, yMm: 0, zMm: 370 },
    process: {
      processType: "turning",
      stock: {
        diameterMm: 80,
        lengthMm: 120,
        positionMm: { xMm: 0, yMm: 0, zMm: 300 },
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
  configuration: M7MillingConfigurationInput = {},
): CoordinatorRunRequest {
  switch (fixture) {
    case "milling":
      return millingRun(runId, false, configuration);
    case "turning":
      return turningRun(runId);
    case "collision-stop":
      return millingRun(runId, true, DEFAULT_M7_MILLING_CONFIGURATION);
  }
}

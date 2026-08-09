import type { Stock, ToolAssembly } from "@cnc-render/contracts";
import {
  LatheRadiusFieldEngine,
  type TurningCut,
} from "./material-removal-turning";

export type M6TurningDemoOperation = "facing" | "od-turning" | "taper";

export interface M6TurningDemoSession {
  readonly engine: LatheRadiusFieldEngine;
  readonly cuts: readonly TurningCut[];
}

const DEMO_SEED = 0x6a09_e667;

function demoStock(): Stock {
  return {
    schemaVersion: 1,
    id: "26000000-0000-4000-8000-000000000011",
    name: "M6 browser cylinder Stock",
    geometry: { primitiveType: "cylinder", diameterMm: 120, lengthMm: 300 },
    transform: {
      positionMm: { xMm: 0, yMm: 0, zMm: 300 },
      rotationRad: { xRad: 0, yRad: 0, zRad: 0 },
    },
    materialId: "26000000-0000-4000-8000-000000000012",
    representationType: "dexel",
    resolutionMm: 2,
    sourceModelResourceId: null,
  };
}

function demoTool(): ToolAssembly {
  return {
    schemaVersion: 1,
    id: "26000000-0000-4000-8000-000000000013",
    name: "M6 browser turning insert",
    toolType: "turning-tool",
    cutterGeometry: {
      geometryType: "turning-insert",
      diameterMm: 12,
      cornerRadiusMm: 0.4,
      fluteCount: 1,
      cuttingLengthMm: 20,
      overallLengthMm: 80,
    },
    holderGeometry: { diameterMm: 25, lengthMm: 80 },
    gaugeLengthMm: 100,
    stickoutLengthMm: 45,
    maxSpindleSpeedRpm: 6_000,
    wearRatio: 0,
    materialCompatibilityIds: [
      "26000000-0000-4000-8000-000000000012",
    ],
  };
}

function cutFor(operation: M6TurningDemoOperation): TurningCut {
  if (operation === "facing") {
    return { operation, faceZMm: 430, freeEnd: "positive-z" };
  }
  if (operation === "od-turning") {
    return {
      operation,
      startZMm: 200,
      endZMm: 430,
      startOuterRadiusMm: 45,
      endOuterRadiusMm: 45,
    };
  }
  return {
    operation,
    startZMm: 200,
    endZMm: 430,
    startOuterRadiusMm: 55,
    endOuterRadiusMm: 30,
  };
}

export function createM6TurningDemoSession(
  operation: M6TurningDemoOperation,
): M6TurningDemoSession {
  if (
    operation !== "facing" &&
    operation !== "od-turning" &&
    operation !== "taper"
  ) {
    throw new RangeError(`Unknown M6 turning demo operation: ${operation}`);
  }
  return {
    engine: new LatheRadiusFieldEngine({
      stock: demoStock(),
      tool: demoTool(),
      preset: "balanced",
      seed: DEMO_SEED,
      machineMaxSpindleSpeedRpm: 4_500,
      chuckGripLengthMm: 50,
    }),
    cuts: [cutFor(operation)],
  };
}

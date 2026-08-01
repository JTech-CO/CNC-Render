import type { Stock, ToolAssembly } from "@cnc-render/contracts";
import {
  SparseDexelMillingEngine,
  type MillingSweep,
} from "./material-removal-milling";

export type M5MillingDemoOperation = "face-milling" | "slot" | "pocket";

export interface M5MillingDemoSession {
  readonly engine: SparseDexelMillingEngine;
  readonly sweeps: readonly MillingSweep[];
}

const DEMO_SEED = 0x5f37_59df;

function demoStock(): Stock {
  return {
    schemaVersion: 1,
    id: "25000000-0000-4000-8000-000000000101",
    name: "M5 browser milling stock",
    geometry: {
      primitiveType: "box",
      sizeMm: { xMm: 360, yMm: 200, zMm: 88 },
    },
    transform: {
      positionMm: { xMm: 0, yMm: 0, zMm: 298 },
      rotationRad: { xRad: 0, yRad: 0, zRad: 0 },
    },
    materialId: "25000000-0000-4000-8000-000000000102",
    representationType: "dexel",
    resolutionMm: 4,
    sourceModelResourceId: null,
  };
}

function demoTool(diameterMm: number): ToolAssembly {
  return {
    schemaVersion: 1,
    id: "25000000-0000-4000-8000-000000000103",
    name: `${diameterMm} mm browser flat end mill`,
    toolType: "milling-cutter",
    cutterGeometry: {
      geometryType: "flat-end-mill",
      diameterMm,
      cornerRadiusMm: 0,
      fluteCount: 4,
      cuttingLengthMm: 44,
      overallLengthMm: 80,
    },
    holderGeometry: { diameterMm: 42, lengthMm: 50 },
    gaugeLengthMm: 80,
    stickoutLengthMm: 48,
    maxSpindleSpeedRpm: 12_000,
    wearRatio: 0,
    materialCompatibilityIds: [
      "25000000-0000-4000-8000-000000000102",
    ],
  };
}

function sweepsFor(operation: M5MillingDemoOperation): readonly MillingSweep[] {
  if (operation === "face-milling") {
    return Array.from({ length: 11 }, (_, index) => {
      const yMm = -100 + index * 20;
      const forwards = index % 2 === 0;
      return {
        startMm: {
          xMm: forwards ? -180 : 180,
          yMm,
          zMm: 338,
        },
        endMm: {
          xMm: forwards ? 180 : -180,
          yMm,
          zMm: 338,
        },
      };
    });
  }
  if (operation === "slot") {
    return [
      {
        startMm: { xMm: -145, yMm: 0, zMm: 330 },
        endMm: { xMm: 145, yMm: 0, zMm: 330 },
      },
    ];
  }
  return [
    {
      startMm: { xMm: -80, yMm: 0, zMm: 326 },
      endMm: { xMm: 80, yMm: 0, zMm: 326 },
    },
  ];
}

export function createM5MillingDemoSession(
  operation: M5MillingDemoOperation,
): M5MillingDemoSession {
  if (
    operation !== "face-milling" &&
    operation !== "slot" &&
    operation !== "pocket"
  ) {
    throw new RangeError("Unknown M5 milling demo operation.");
  }
  const diameterMm = operation === "pocket" ? 40 : 20;
  return {
    engine: new SparseDexelMillingEngine({
      stock: demoStock(),
      tool: demoTool(diameterMm),
      preset: "balanced",
      seed: DEMO_SEED,
    }),
    sweeps: sweepsFor(operation),
  };
}

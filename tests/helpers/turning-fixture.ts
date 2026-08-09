import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Stock, ToolAssembly } from "@cnc-render/contracts";
import {
  LatheRadiusFieldEngine,
  type TurningCut,
  type TurningMaterialRemovalOptions,
  type TurningQualityPreset,
} from "../../packages/simulation/src/material-removal-turning";

export interface TurningGoldenItem {
  readonly id: string;
  readonly operation: TurningCut["operation"];
  readonly toolKind: "boring" | "drill" | "turning";
  readonly analyticModel: string;
  readonly cut: TurningCut;
}

export interface TurningSpindleGoldenCase {
  readonly id: string;
  readonly mode: "rpm" | "surface-speed";
  readonly commandedValue: number;
  readonly diameterMm: number;
  readonly expectedRequestedRpm: number;
  readonly expectedEffectiveRpm: number;
  readonly expectedClamped: boolean;
}

export interface TurningGoldenFixture {
  readonly fixtureVersion: number;
  readonly units: "mm";
  readonly seed: number;
  readonly stock: {
    readonly diameterMm: number;
    readonly lengthMm: number;
    readonly positionMm: { readonly xMm: number; readonly yMm: number; readonly zMm: number };
    readonly baseResolutionMm: number;
  };
  readonly machine: {
    readonly maxSpindleSpeedRpm: number;
    readonly chuckGripLengthMm: number;
  };
  readonly fixtures: readonly TurningGoldenItem[];
  readonly spindleCases: readonly TurningSpindleGoldenCase[];
}

const fixturePath = fileURLToPath(
  new URL(
    "../fixtures/material-removal/turning/turning-golden.json",
    import.meta.url,
  ),
);

export function loadTurningGoldenFixture(): TurningGoldenFixture {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as TurningGoldenFixture;
}

export function createTurningStock(fixture: TurningGoldenFixture): Stock {
  return {
    schemaVersion: 1,
    id: "26000000-0000-4000-8000-000000000001",
    name: "M6 Golden cylinder Stock",
    geometry: {
      primitiveType: "cylinder",
      diameterMm: fixture.stock.diameterMm,
      lengthMm: fixture.stock.lengthMm,
    },
    transform: {
      positionMm: fixture.stock.positionMm,
      rotationRad: { xRad: 0, yRad: 0, zRad: 0 },
    },
    materialId: "26000000-0000-4000-8000-000000000002",
    representationType: "dexel",
    resolutionMm: fixture.stock.baseResolutionMm,
    sourceModelResourceId: null,
  };
}

export function createTurningTool(item: TurningGoldenItem): ToolAssembly {
  const isDrill = item.toolKind === "drill";
  return {
    schemaVersion: 1,
    id: "26000000-0000-4000-8000-000000000003",
    name: `M6 ${item.toolKind} tool`,
    toolType:
      item.toolKind === "boring"
        ? "boring-bar"
        : isDrill
          ? "drill"
          : "turning-tool",
    cutterGeometry: {
      geometryType: isDrill ? "drill" : "turning-insert",
      diameterMm: isDrill ? 16 : 12,
      cornerRadiusMm: isDrill ? 0 : 0.4,
      fluteCount: isDrill ? 2 : 1,
      cuttingLengthMm: isDrill ? 70 : 20,
      overallLengthMm: isDrill ? 110 : 80,
    },
    holderGeometry: { diameterMm: 25, lengthMm: 80 },
    gaugeLengthMm: 100,
    stickoutLengthMm: 45,
    maxSpindleSpeedRpm: 6_000,
    wearRatio: 0,
    materialCompatibilityIds: [
      "26000000-0000-4000-8000-000000000002",
    ],
  };
}

export function createTurningOptions(
  fixture: TurningGoldenFixture,
  item: TurningGoldenItem,
  preset: TurningQualityPreset,
): TurningMaterialRemovalOptions {
  return {
    stock: createTurningStock(fixture),
    tool: createTurningTool(item),
    preset,
    seed: fixture.seed,
    machineMaxSpindleSpeedRpm: fixture.machine.maxSpindleSpeedRpm,
    chuckGripLengthMm: fixture.machine.chuckGripLengthMm,
  };
}

export function runTurningGoldenItem(
  fixture: TurningGoldenFixture,
  item: TurningGoldenItem,
  preset: TurningQualityPreset,
): LatheRadiusFieldEngine {
  const engine = new LatheRadiusFieldEngine(
    createTurningOptions(fixture, item, preset),
  );
  engine.applyCut(item.cut);
  return engine;
}

export function expectedTurningProfile(
  fixture: TurningGoldenFixture,
  item: TurningGoldenItem,
  zMm: number,
): { innerRadiusMm: number; outerRadiusMm: number } {
  const initialRadiusMm = fixture.stock.diameterMm / 2;
  let innerRadiusMm = 0;
  let outerRadiusMm = initialRadiusMm;
  const cut = item.cut;
  if (cut.operation === "facing") {
    const removed =
      cut.freeEnd === "positive-z"
        ? zMm >= cut.faceZMm
        : zMm <= cut.faceZMm;
    return removed
      ? { innerRadiusMm: 0, outerRadiusMm: 0 }
      : { innerRadiusMm, outerRadiusMm };
  }
  if (zMm < cut.startZMm || zMm > cut.endZMm) {
    return { innerRadiusMm, outerRadiusMm };
  }
  const ratio =
    cut.startZMm === cut.endZMm
      ? 0
      : (zMm - cut.startZMm) / (cut.endZMm - cut.startZMm);
  if ("startInnerRadiusMm" in cut) {
    innerRadiusMm =
      cut.startInnerRadiusMm +
      (cut.endInnerRadiusMm - cut.startInnerRadiusMm) * ratio;
  } else {
    outerRadiusMm =
      cut.startOuterRadiusMm +
      (cut.endOuterRadiusMm - cut.startOuterRadiusMm) * ratio;
  }
  return { innerRadiusMm, outerRadiusMm };
}

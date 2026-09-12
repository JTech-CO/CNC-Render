import { ResultReportSchema, type ResultReport } from "../../contracts/src/result-report";
import type { MillingStockSurfaceDescriptor } from "./material-removal-milling";
import type { TurningProfileSurfaceDescriptor } from "./material-removal-turning";
import { measureMillingStockAgainstTarget, representedTargetTopZMm, type MillingFlatEndSweepTarget } from "./milling-target-measurement";
import { measureTurningStockAgainstTarget, representedTargetRadii, type TurningRadiusFieldTarget } from "./turning-target-measurement";

export interface ResultProvenance {
  readonly runId: string;
  readonly fixtureId: string;
  readonly stateHash: string;
  readonly stockHash: string;
  readonly logicalTimeS: number;
  readonly outcome: "completed" | "stopped";
  readonly collisionCount: number;
  readonly warningCount: number;
  readonly diagnosticCount: number;
}
export type ResultComparisonInput = {
  readonly surface: MillingStockSurfaceDescriptor;
  readonly target: MillingFlatEndSweepTarget;
  readonly provenance: ResultProvenance;
} | {
  readonly surface: TurningProfileSurfaceDescriptor;
  readonly target: TurningRadiusFieldTarget;
  readonly provenance: ResultProvenance;
};

/** Owned by Worker / imperative result renderer, never React or Zustand. */
export interface ResultDeviationField {
  readonly kind: "milling" | "turning";
  readonly columns: number;
  readonly rows: number;
  readonly coordinatesMm: Float64Array;
  readonly actualMm: Float64Array;
  readonly targetMm: Float64Array;
  /** Positive = material left, negative = material removed beyond target. */
  readonly signedDeviationMm: Float64Array;
}
export interface ResultComparison {
  readonly report: ResultReport;
  readonly field: ResultDeviationField;
}

export function compareStockResult(input: ResultComparisonInput): ResultComparison {
  const cellCount = "columns" in input.surface ? input.surface.columns * input.surface.rows : input.surface.axialCells;
  if (!Number.isSafeInteger(cellCount) || cellCount < 1 || cellCount > 4_194_304) {
    throw new RangeError("비교 Stock 셀 수가 지원 범위를 벗어났습니다.");
  }
  const milling = input.target.kind === "flat-end-sweep";
  if (milling !== ("columns" in input.surface)) throw new RangeError("Stock과 목표 형상 표현이 다릅니다.");
  const sampleCount = cellCount * (milling ? 1 : 2);
  const actualMm = new Float64Array(sampleCount);
  const targetMm = new Float64Array(sampleCount);
  const signedDeviationMm = new Float64Array(sampleCount);
  const coordinatesMm = new Float64Array(sampleCount * 3);
  const absoluteCells = new Float64Array(cellCount);
  let summary: ReturnType<typeof measureMillingStockAgainstTarget>;
  let process: ResultReport["process"];
  let columns: number;
  let rows: number;
  if (input.target.kind === "flat-end-sweep" && "columns" in input.surface) {
    const surface = input.surface; const target = input.target;
    summary = measureMillingStockAgainstTarget(surface, target);
    process = "milling"; columns = surface.columns; rows = surface.rows;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const left = surface.boundsMm.minimum.xMm + column * surface.resolutionMm;
        const bottom = surface.boundsMm.minimum.yMm + row * surface.resolutionMm;
        const x = (left + Math.min(left + surface.resolutionMm, surface.boundsMm.maximum.xMm)) / 2;
        const y = (bottom + Math.min(bottom + surface.resolutionMm, surface.boundsMm.maximum.yMm)) / 2;
        actualMm[index] = Math.min(surface.boundsMm.maximum.zMm, Math.max(surface.boundsMm.minimum.zMm, surface.topZMm[index]));
        targetMm[index] = representedTargetTopZMm(surface, target, x, y);
        const difference = actualMm[index] - targetMm[index];
        signedDeviationMm[index] = Math.abs(difference) <= summary.numericToleranceMm ? 0 : difference;
        absoluteCells[index] = Math.abs(signedDeviationMm[index]);
        coordinatesMm.set([x, y, actualMm[index]], index * 3);
      }
    }
  } else if (input.target.kind === "turning-radius-profile" && "axialCells" in input.surface) {
    const surface = input.surface; const target = input.target;
    summary = measureTurningStockAgainstTarget(surface, target);
    process = target.process; columns = surface.axialCells; rows = 2;
    let overcutVolumeMm3 = 0; let undercutVolumeMm3 = 0;
    for (let index = 0; index < cellCount; index += 1) {
      const start = surface.minimumZMm + index * surface.resolutionMm;
      const end = Math.min(start + surface.resolutionMm, surface.maximumZMm);
      const z = (start + end) / 2;
      const targetRadii = representedTargetRadii(target, surface.resolutionMm, z);
      actualMm[cellCount + index] = Math.max(0, surface.innerRadiusMm[index]);
      actualMm[index] = Math.min(target.initialOuterRadiusMm, Math.max(actualMm[cellCount + index], surface.outerRadiusMm[index]));
      targetMm[index] = targetRadii.outerRadiusMm;
      targetMm[cellCount + index] = targetRadii.innerRadiusMm;
      for (const offset of [0, cellCount]) {
        const sample = offset + index;
        const delta = (actualMm[sample] - targetMm[sample]) * (offset === 0 ? 1 : -1);
        signedDeviationMm[sample] = Math.abs(delta) <= summary.numericToleranceMm ? 0 : delta;
        coordinatesMm.set([surface.axisCenterMm.xMm + actualMm[sample], surface.axisCenterMm.yMm, z], sample * 3);
      }
      absoluteCells[index] = Math.max(Math.abs(signedDeviationMm[index]), Math.abs(signedDeviationMm[cellCount + index]));
      // Compare material-set intersection; opposite inner/outer errors must not cancel.
      const overlapOuter = Math.min(actualMm[index], targetMm[index]);
      const overlapInner = Math.max(actualMm[cellCount + index], targetMm[cellCount + index]);
      const overlap = Math.PI * Math.max(0, overlapOuter ** 2 - overlapInner ** 2);
      const actualArea = Math.PI * (actualMm[index] ** 2 - actualMm[cellCount + index] ** 2);
      const targetArea = Math.PI * (targetMm[index] ** 2 - targetMm[cellCount + index] ** 2);
      overcutVolumeMm3 += Math.max(0, targetArea - overlap) * (end - start);
      undercutVolumeMm3 += Math.max(0, actualArea - overlap) * (end - start);
    }
    summary = { ...summary, overcutVolumeMm3, undercutVolumeMm3 };
  } else {
    throw new RangeError("Stock과 목표 형상 표현이 다릅니다.");
  }
  absoluteCells.sort();
  const report = ResultReportSchema.parse({
    schemaVersion: 1, accuracyGrade: "E2", ...input.provenance,
    targetId: summary.targetId, process, comparedCells: cellCount,
    representationResolutionMm: summary.representationResolutionMm,
    numericToleranceMm: summary.numericToleranceMm,
    maxDeviationMm: summary.maxDeviationMm,
    meanAbsoluteDeviationMm: summary.meanAbsoluteDeviationMm,
    p95AbsoluteDeviationMm: absoluteCells[Math.ceil(cellCount * 0.95) - 1],
    quantileMethod: "nearest-rank-cell-absolute",
    overcutVolumeMm3: summary.overcutVolumeMm3, undercutVolumeMm3: summary.undercutVolumeMm3,
    actualRemovedVolumeMm3: summary.actualRemovedVolumeMm3, targetRemovedVolumeMm3: summary.targetRemovedVolumeMm3,
    measurements: [],
  });
  return { report, field: { kind: milling ? "milling" : "turning", columns, rows, coordinatesMm, actualMm, targetMm, signedDeviationMm } };
}

import type { Vec3Mm } from "@cnc-render/contracts";

import type {
  MillingStockSurfaceDescriptor,
  MillingSweep,
} from "./material-removal-milling";
import { minimumSweptFlatEndTipZMm } from "./milling-sweep-geometry";

const NUMERIC_EPSILON = 1e-9;
const BOUNDS_TOLERANCE_MM = 1e-6;

export interface MillingFlatEndSweepTarget {
  readonly targetId: string;
  readonly kind: "flat-end-sweep";
  readonly stockBoundsMm: MillingStockSurfaceDescriptor["boundsMm"];
  readonly cutterDiameterMm: number;
  readonly sweeps: readonly MillingSweep[];
}

export interface MillingTargetMeasurement {
  readonly targetId: string;
  readonly comparedCells: number;
  readonly targetCutCells: number;
  readonly representationResolutionMm: number;
  readonly numericToleranceMm: number;
  readonly maxDeviationMm: number;
  readonly meanAbsoluteDeviationMm: number;
  readonly overcutVolumeMm3: number;
  readonly undercutVolumeMm3: number;
  readonly actualRemovedVolumeMm3: number;
  readonly targetRemovedVolumeMm3: number;
}

export type MillingTargetMeasurementErrorCode =
  | "milling-measurement.surface.invalid"
  | "milling-measurement.target.invalid"
  | "milling-measurement.target.stock-mismatch";

export class MillingTargetMeasurementError extends Error {
  readonly code: MillingTargetMeasurementErrorCode;

  constructor(code: MillingTargetMeasurementErrorCode, message: string) {
    super(message);
    this.name = "MillingTargetMeasurementError";
    this.code = code;
  }
}

function finite(
  value: number,
  label: string,
  code: MillingTargetMeasurementErrorCode,
): number {
  if (!Number.isFinite(value)) {
    throw new MillingTargetMeasurementError(
      code,
      `${label} must be a finite millimetre value.`,
    );
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MillingTargetMeasurementError(
      "milling-measurement.surface.invalid",
      `${label} must be a positive safe integer.`,
    );
  }
  return value;
}

function validatePoint(
  point: Vec3Mm,
  label: string,
  code: MillingTargetMeasurementErrorCode,
): void {
  finite(point.xMm, `${label}.xMm`, code);
  finite(point.yMm, `${label}.yMm`, code);
  finite(point.zMm, `${label}.zMm`, code);
}

function validateBounds(
  bounds: MillingStockSurfaceDescriptor["boundsMm"],
  label: string,
  code: MillingTargetMeasurementErrorCode,
): void {
  validatePoint(bounds.minimum, `${label}.minimum`, code);
  validatePoint(bounds.maximum, `${label}.maximum`, code);
  if (
    bounds.maximum.xMm <= bounds.minimum.xMm ||
    bounds.maximum.yMm <= bounds.minimum.yMm ||
    bounds.maximum.zMm <= bounds.minimum.zMm
  ) {
    throw new MillingTargetMeasurementError(
      code,
      `${label} maximum coordinates must exceed minimum coordinates.`,
    );
  }
}

function sameBounds(
  left: MillingStockSurfaceDescriptor["boundsMm"],
  right: MillingStockSurfaceDescriptor["boundsMm"],
): boolean {
  return (
    Math.abs(left.minimum.xMm - right.minimum.xMm) <= BOUNDS_TOLERANCE_MM &&
    Math.abs(left.minimum.yMm - right.minimum.yMm) <= BOUNDS_TOLERANCE_MM &&
    Math.abs(left.minimum.zMm - right.minimum.zMm) <= BOUNDS_TOLERANCE_MM &&
    Math.abs(left.maximum.xMm - right.maximum.xMm) <= BOUNDS_TOLERANCE_MM &&
    Math.abs(left.maximum.yMm - right.maximum.yMm) <= BOUNDS_TOLERANCE_MM &&
    Math.abs(left.maximum.zMm - right.maximum.zMm) <= BOUNDS_TOLERANCE_MM
  );
}

function validateSurface(surface: MillingStockSurfaceDescriptor): void {
  validateBounds(
    surface.boundsMm,
    "surface.boundsMm",
    "milling-measurement.surface.invalid",
  );
  positiveInteger(surface.columns, "surface.columns");
  positiveInteger(surface.rows, "surface.rows");
  const resolutionMm = finite(
    surface.resolutionMm,
    "surface.resolutionMm",
    "milling-measurement.surface.invalid",
  );
  if (resolutionMm <= 0) {
    throw new MillingTargetMeasurementError(
      "milling-measurement.surface.invalid",
      "surface.resolutionMm must be greater than zero.",
    );
  }
  const cellCount = surface.columns * surface.rows;
  if (!Number.isSafeInteger(cellCount) || surface.topZMm.length !== cellCount) {
    throw new MillingTargetMeasurementError(
      "milling-measurement.surface.invalid",
      "surface.topZMm length must equal columns multiplied by rows.",
    );
  }
  const expectedColumns = Math.ceil(
    (surface.boundsMm.maximum.xMm - surface.boundsMm.minimum.xMm) /
      resolutionMm,
  );
  const expectedRows = Math.ceil(
    (surface.boundsMm.maximum.yMm - surface.boundsMm.minimum.yMm) /
      resolutionMm,
  );
  if (
    surface.columns !== expectedColumns ||
    surface.rows !== expectedRows
  ) {
    throw new MillingTargetMeasurementError(
      "milling-measurement.surface.invalid",
      "surface grid dimensions do not match its bounds and resolution.",
    );
  }
}

function validateTarget(target: MillingFlatEndSweepTarget): void {
  if (target.kind !== "flat-end-sweep" || target.targetId.length === 0) {
    throw new MillingTargetMeasurementError(
      "milling-measurement.target.invalid",
      "target must declare a non-empty flat-end sweep identity.",
    );
  }
  validateBounds(
    target.stockBoundsMm,
    "target.stockBoundsMm",
    "milling-measurement.target.invalid",
  );
  const cutterDiameterMm = finite(
    target.cutterDiameterMm,
    "target.cutterDiameterMm",
    "milling-measurement.target.invalid",
  );
  if (cutterDiameterMm <= 0 || target.sweeps.length === 0) {
    throw new MillingTargetMeasurementError(
      "milling-measurement.target.invalid",
      "target requires a positive cutter diameter and at least one sweep.",
    );
  }
  target.sweeps.forEach((sweep, index) => {
    validatePoint(
      sweep.startMm,
      `target.sweeps[${index}].startMm`,
      "milling-measurement.target.invalid",
    );
    validatePoint(
      sweep.endMm,
      `target.sweeps[${index}].endMm`,
      "milling-measurement.target.invalid",
    );
  });
}

function cellExtent(
  minimumMm: number,
  maximumMm: number,
  resolutionMm: number,
  index: number,
): { readonly centerMm: number; readonly sizeMm: number } {
  const startMm = minimumMm + index * resolutionMm;
  const endMm = Math.min(maximumMm, startMm + resolutionMm);
  return {
    centerMm: (startMm + endMm) / 2,
    sizeMm: endMm - startMm,
  };
}

function representedTargetTopZMm(
  surface: MillingStockSurfaceDescriptor,
  target: MillingFlatEndSweepTarget,
  xMm: number,
  yMm: number,
): number {
  const stockTopZMm = surface.boundsMm.maximum.zMm;
  let minimumTipZMm = stockTopZMm;
  const cutterRadiusMm = target.cutterDiameterMm / 2;
  for (const sweep of target.sweeps) {
    const sweptTipZMm = minimumSweptFlatEndTipZMm(
      sweep,
      cutterRadiusMm,
      xMm,
      yMm,
    );
    if (sweptTipZMm !== null && sweptTipZMm < minimumTipZMm) {
      minimumTipZMm = sweptTipZMm;
    }
  }
  if (minimumTipZMm >= stockTopZMm) {
    return stockTopZMm;
  }
  const stockHeightMm = stockTopZMm - surface.boundsMm.minimum.zMm;
  const maximumDepthLayers = Math.ceil(
    stockHeightMm / surface.resolutionMm,
  );
  const requestedLayers = Math.min(
    maximumDepthLayers,
    Math.max(
      0,
      Math.round(
        (stockTopZMm - minimumTipZMm) / surface.resolutionMm,
      ),
    ),
  );
  const representedDepthMm = Math.min(
    stockHeightMm,
    requestedLayers * surface.resolutionMm,
  );
  return stockTopZMm - representedDepthMm;
}

function normalized(value: number, tolerance: number): number {
  return Math.abs(value) <= tolerance ? 0 : value;
}

/**
 * Compares a complete actual dexel Stock surface against an independently
 * authored flat-end sweep target. Only the scalar result is intended to cross
 * into lesson/UI state; callers should release the full surface afterwards.
 */
export function measureMillingStockAgainstTarget(
  surface: MillingStockSurfaceDescriptor,
  target: MillingFlatEndSweepTarget,
): MillingTargetMeasurement {
  validateSurface(surface);
  validateTarget(target);
  if (!sameBounds(surface.boundsMm, target.stockBoundsMm)) {
    throw new MillingTargetMeasurementError(
      "milling-measurement.target.stock-mismatch",
      "actual Stock bounds do not match the target Stock bounds.",
    );
  }

  const stockTopZMm = surface.boundsMm.maximum.zMm;
  const stockBottomZMm = surface.boundsMm.minimum.zMm;
  const numericToleranceMm = Math.max(
    BOUNDS_TOLERANCE_MM,
    surface.resolutionMm * 1e-7,
  );
  let targetCutCells = 0;
  let maximumDeviationMm = 0;
  let weightedAbsoluteDeviationMm3 = 0;
  let totalAreaMm2 = 0;
  let overcutVolumeMm3 = 0;
  let undercutVolumeMm3 = 0;
  let actualRemovedVolumeMm3 = 0;
  let targetRemovedVolumeMm3 = 0;

  for (let row = 0; row < surface.rows; row += 1) {
    const y = cellExtent(
      surface.boundsMm.minimum.yMm,
      surface.boundsMm.maximum.yMm,
      surface.resolutionMm,
      row,
    );
    for (let column = 0; column < surface.columns; column += 1) {
      const x = cellExtent(
        surface.boundsMm.minimum.xMm,
        surface.boundsMm.maximum.xMm,
        surface.resolutionMm,
        column,
      );
      const index = row * surface.columns + column;
      const actualTopZMm = finite(
        surface.topZMm[index],
        `surface.topZMm[${index}]`,
        "milling-measurement.surface.invalid",
      );
      if (
        actualTopZMm < stockBottomZMm - numericToleranceMm ||
        actualTopZMm > stockTopZMm + numericToleranceMm
      ) {
        throw new MillingTargetMeasurementError(
          "milling-measurement.surface.invalid",
          `surface.topZMm[${index}] lies outside the Stock Z bounds.`,
        );
      }
      const clampedActualTopZMm = Math.min(
        stockTopZMm,
        Math.max(stockBottomZMm, actualTopZMm),
      );
      const targetTopZMm = representedTargetTopZMm(
        surface,
        target,
        x.centerMm,
        y.centerMm,
      );
      if (targetTopZMm < stockTopZMm - numericToleranceMm) {
        targetCutCells += 1;
      }
      const areaMm2 = x.sizeMm * y.sizeMm;
      const deviationMm = normalized(
        clampedActualTopZMm - targetTopZMm,
        numericToleranceMm,
      );
      const absoluteDeviationMm = Math.abs(deviationMm);
      maximumDeviationMm = Math.max(
        maximumDeviationMm,
        absoluteDeviationMm,
      );
      weightedAbsoluteDeviationMm3 += absoluteDeviationMm * areaMm2;
      totalAreaMm2 += areaMm2;
      if (deviationMm < 0) {
        overcutVolumeMm3 += -deviationMm * areaMm2;
      } else if (deviationMm > 0) {
        undercutVolumeMm3 += deviationMm * areaMm2;
      }
      actualRemovedVolumeMm3 +=
        (stockTopZMm - clampedActualTopZMm) * areaMm2;
      targetRemovedVolumeMm3 +=
        (stockTopZMm - targetTopZMm) * areaMm2;
    }
  }

  return {
    targetId: target.targetId,
    comparedCells: surface.columns * surface.rows,
    targetCutCells,
    representationResolutionMm: surface.resolutionMm,
    numericToleranceMm,
    maxDeviationMm: normalized(maximumDeviationMm, numericToleranceMm),
    meanAbsoluteDeviationMm: normalized(
      weightedAbsoluteDeviationMm3 / totalAreaMm2,
      numericToleranceMm,
    ),
    overcutVolumeMm3: normalized(overcutVolumeMm3, NUMERIC_EPSILON),
    undercutVolumeMm3: normalized(undercutVolumeMm3, NUMERIC_EPSILON),
    actualRemovedVolumeMm3: normalized(
      actualRemovedVolumeMm3,
      NUMERIC_EPSILON,
    ),
    targetRemovedVolumeMm3: normalized(
      targetRemovedVolumeMm3,
      NUMERIC_EPSILON,
    ),
  };
}

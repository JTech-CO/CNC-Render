import type {
  TurningInnerCut,
  TurningOuterCut,
  TurningProfileSurfaceDescriptor,
} from "./material-removal-turning";

const NUMERIC_EPSILON = 1e-9;
const BOUNDS_TOLERANCE_MM = 1e-6;

type OdTurningTargetCut = TurningOuterCut & {
  readonly operation: "groove" | "od-turning";
};
type DrillingTargetCut = TurningInnerCut & {
  readonly operation: "drilling";
};

interface TurningRadiusFieldTargetBase {
  readonly targetId: string;
  readonly kind: "turning-radius-profile";
  readonly axisCenterMm: {
    readonly xMm: number;
    readonly yMm: number;
  };
  readonly minimumZMm: number;
  readonly maximumZMm: number;
  readonly initialOuterRadiusMm: number;
  readonly measurementZMm: number;
}

export interface OdTurningRadiusFieldTarget
  extends TurningRadiusFieldTargetBase {
  readonly process: "od-turning";
  readonly cuts: readonly OdTurningTargetCut[];
}

export interface DrillingRadiusFieldTarget
  extends TurningRadiusFieldTargetBase {
  readonly process: "drilling";
  readonly freeEnd: "negative-z" | "positive-z";
  readonly cuts: readonly DrillingTargetCut[];
}

export type TurningRadiusFieldTarget =
  | DrillingRadiusFieldTarget
  | OdTurningRadiusFieldTarget;

interface TurningTargetMeasurementBase {
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

export interface OdTurningTargetMeasurement
  extends TurningTargetMeasurementBase {
  readonly process: "od-turning";
  readonly feature: {
    readonly kind: "outer-diameter";
    readonly sampleZMm: number;
    readonly actualDiameterMm: number;
    readonly targetDiameterMm: number;
  };
}

export interface DrillingTargetMeasurement
  extends TurningTargetMeasurementBase {
  readonly process: "drilling";
  readonly feature: {
    readonly kind: "drilled-hole";
    readonly sampleZMm: number;
    readonly actualDiameterMm: number;
    readonly targetDiameterMm: number;
    readonly actualDepthMm: number;
    readonly targetDepthMm: number;
    readonly freeEnd: DrillingRadiusFieldTarget["freeEnd"];
  };
}

export type TurningTargetMeasurement =
  | DrillingTargetMeasurement
  | OdTurningTargetMeasurement;

export type TurningTargetMeasurementErrorCode =
  | "turning-measurement.surface.invalid"
  | "turning-measurement.target.invalid"
  | "turning-measurement.target.stock-mismatch";

export class TurningTargetMeasurementError extends Error {
  readonly code: TurningTargetMeasurementErrorCode;

  constructor(code: TurningTargetMeasurementErrorCode, message: string) {
    super(message);
    this.name = "TurningTargetMeasurementError";
    this.code = code;
  }
}

function finite(
  value: number,
  label: string,
  code: TurningTargetMeasurementErrorCode,
): number {
  if (!Number.isFinite(value)) {
    throw new TurningTargetMeasurementError(
      code,
      label + " must be a finite millimetre value.",
    );
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TurningTargetMeasurementError(
      "turning-measurement.surface.invalid",
      label + " must be a positive safe integer.",
    );
  }
  return value;
}

function validateSurface(surface: TurningProfileSurfaceDescriptor): void {
  finite(
    surface.axisCenterMm.xMm,
    "surface.axisCenterMm.xMm",
    "turning-measurement.surface.invalid",
  );
  finite(
    surface.axisCenterMm.yMm,
    "surface.axisCenterMm.yMm",
    "turning-measurement.surface.invalid",
  );
  const minimumZMm = finite(
    surface.minimumZMm,
    "surface.minimumZMm",
    "turning-measurement.surface.invalid",
  );
  const maximumZMm = finite(
    surface.maximumZMm,
    "surface.maximumZMm",
    "turning-measurement.surface.invalid",
  );
  const resolutionMm = finite(
    surface.resolutionMm,
    "surface.resolutionMm",
    "turning-measurement.surface.invalid",
  );
  if (maximumZMm <= minimumZMm || resolutionMm <= 0) {
    throw new TurningTargetMeasurementError(
      "turning-measurement.surface.invalid",
      "surface bounds and resolution must define a positive axial field.",
    );
  }
  positiveInteger(surface.axialCells, "surface.axialCells");
  if (
    !Number.isSafeInteger(surface.radialSegments) ||
    surface.radialSegments < 8 ||
    surface.radialSegments > 256
  ) {
    throw new TurningTargetMeasurementError(
      "turning-measurement.surface.invalid",
      "surface.radialSegments must be an integer in 8..256.",
    );
  }
  const expectedCells = Math.ceil(
    (maximumZMm - minimumZMm) / resolutionMm,
  );
  if (
    surface.axialCells !== expectedCells ||
    surface.innerRadiusMm.length !== surface.axialCells ||
    surface.outerRadiusMm.length !== surface.axialCells
  ) {
    throw new TurningTargetMeasurementError(
      "turning-measurement.surface.invalid",
      "surface arrays and axial cell count must match its bounds and resolution.",
    );
  }
}

function validateTargetBase(target: TurningRadiusFieldTarget): void {
  if (
    target.kind !== "turning-radius-profile" ||
    target.targetId.length === 0
  ) {
    throw new TurningTargetMeasurementError(
      "turning-measurement.target.invalid",
      "target must declare a non-empty turning profile identity.",
    );
  }
  finite(
    target.axisCenterMm.xMm,
    "target.axisCenterMm.xMm",
    "turning-measurement.target.invalid",
  );
  finite(
    target.axisCenterMm.yMm,
    "target.axisCenterMm.yMm",
    "turning-measurement.target.invalid",
  );
  const minimumZMm = finite(
    target.minimumZMm,
    "target.minimumZMm",
    "turning-measurement.target.invalid",
  );
  const maximumZMm = finite(
    target.maximumZMm,
    "target.maximumZMm",
    "turning-measurement.target.invalid",
  );
  const initialRadiusMm = finite(
    target.initialOuterRadiusMm,
    "target.initialOuterRadiusMm",
    "turning-measurement.target.invalid",
  );
  const measurementZMm = finite(
    target.measurementZMm,
    "target.measurementZMm",
    "turning-measurement.target.invalid",
  );
  if (
    maximumZMm <= minimumZMm ||
    initialRadiusMm <= 0 ||
    measurementZMm < minimumZMm ||
    measurementZMm > maximumZMm ||
    target.cuts.length === 0
  ) {
    throw new TurningTargetMeasurementError(
      "turning-measurement.target.invalid",
      "target bounds, initial radius, measurement point, and cuts must be valid.",
    );
  }
}

function validateCutRange(
  target: TurningRadiusFieldTarget,
  startZMm: number,
  endZMm: number,
  index: number,
): boolean {
  const start = finite(
    startZMm,
    "target.cuts[" + index + "].startZMm",
    "turning-measurement.target.invalid",
  );
  const end = finite(
    endZMm,
    "target.cuts[" + index + "].endZMm",
    "turning-measurement.target.invalid",
  );
  if (
    start > end ||
    start < target.minimumZMm - BOUNDS_TOLERANCE_MM ||
    end > target.maximumZMm + BOUNDS_TOLERANCE_MM
  ) {
    throw new TurningTargetMeasurementError(
      "turning-measurement.target.invalid",
      "target cut must stay inside ordered Stock Z bounds.",
    );
  }
  return (
    target.measurementZMm >= start - BOUNDS_TOLERANCE_MM &&
    target.measurementZMm <= end + BOUNDS_TOLERANCE_MM
  );
}

function validateRadius(
  target: TurningRadiusFieldTarget,
  value: number,
  label: string,
): void {
  const radiusMm = finite(
    value,
    label,
    "turning-measurement.target.invalid",
  );
  if (radiusMm < 0 || radiusMm > target.initialOuterRadiusMm) {
    throw new TurningTargetMeasurementError(
      "turning-measurement.target.invalid",
      label + " must stay inside the initial radius.",
    );
  }
}

function validateTarget(target: TurningRadiusFieldTarget): void {
  validateTargetBase(target);
  let measurementCovered = false;
  if (target.process === "od-turning") {
    target.cuts.forEach((cut, index) => {
      measurementCovered =
        validateCutRange(target, cut.startZMm, cut.endZMm, index) ||
        measurementCovered;
      validateRadius(
        target,
        cut.startOuterRadiusMm,
        "target.cuts[" + index + "].startOuterRadiusMm",
      );
      validateRadius(
        target,
        cut.endOuterRadiusMm,
        "target.cuts[" + index + "].endOuterRadiusMm",
      );
    });
  } else {
    target.cuts.forEach((cut, index) => {
      measurementCovered =
        validateCutRange(target, cut.startZMm, cut.endZMm, index) ||
        measurementCovered;
      validateRadius(
        target,
        cut.startInnerRadiusMm,
        "target.cuts[" + index + "].startInnerRadiusMm",
      );
      validateRadius(
        target,
        cut.endInnerRadiusMm,
        "target.cuts[" + index + "].endInnerRadiusMm",
      );
    });
  }
  if (!measurementCovered) {
    throw new TurningTargetMeasurementError(
      "turning-measurement.target.invalid",
      "target.measurementZMm must lie on an authored cut.",
    );
  }
}

function sameStock(
  surface: TurningProfileSurfaceDescriptor,
  target: TurningRadiusFieldTarget,
): boolean {
  return (
    Math.abs(surface.axisCenterMm.xMm - target.axisCenterMm.xMm) <=
      BOUNDS_TOLERANCE_MM &&
    Math.abs(surface.axisCenterMm.yMm - target.axisCenterMm.yMm) <=
      BOUNDS_TOLERANCE_MM &&
    Math.abs(surface.minimumZMm - target.minimumZMm) <=
      BOUNDS_TOLERANCE_MM &&
    Math.abs(surface.maximumZMm - target.maximumZMm) <=
      BOUNDS_TOLERANCE_MM
  );
}

function cellExtent(
  surface: TurningProfileSurfaceDescriptor,
  index: number,
): {
  readonly centerZMm: number;
  readonly widthMm: number;
} {
  const startZMm = surface.minimumZMm + index * surface.resolutionMm;
  const endZMm = Math.min(
    surface.maximumZMm,
    startZMm + surface.resolutionMm,
  );
  return {
    centerZMm: (startZMm + endZMm) / 2,
    widthMm: endZMm - startZMm,
  };
}

function representedTargetRadii(
  target: TurningRadiusFieldTarget,
  resolutionMm: number,
  centerZMm: number,
): { readonly innerRadiusMm: number; readonly outerRadiusMm: number } {
  let innerRadiusMm = 0;
  let outerRadiusMm = target.initialOuterRadiusMm;

  if (target.process === "od-turning") {
    for (const cut of target.cuts) {
      if (
        centerZMm < cut.startZMm - NUMERIC_EPSILON ||
        centerZMm > cut.endZMm + NUMERIC_EPSILON
      ) {
        continue;
      }
      const ratio =
        Math.abs(cut.endZMm - cut.startZMm) <= NUMERIC_EPSILON
          ? 0
          : (centerZMm - cut.startZMm) /
            (cut.endZMm - cut.startZMm);
      const requestedRadiusMm =
        cut.startOuterRadiusMm +
        (cut.endOuterRadiusMm - cut.startOuterRadiusMm) * ratio;
      const representedRadiusMm = Math.min(
        target.initialOuterRadiusMm,
        Math.floor(
          requestedRadiusMm / resolutionMm + NUMERIC_EPSILON,
        ) * resolutionMm,
      );
      outerRadiusMm = Math.min(outerRadiusMm, representedRadiusMm);
      innerRadiusMm = Math.min(innerRadiusMm, outerRadiusMm);
    }
  } else {
    for (const cut of target.cuts) {
      if (
        centerZMm < cut.startZMm - NUMERIC_EPSILON ||
        centerZMm > cut.endZMm + NUMERIC_EPSILON
      ) {
        continue;
      }
      const ratio =
        Math.abs(cut.endZMm - cut.startZMm) <= NUMERIC_EPSILON
          ? 0
          : (centerZMm - cut.startZMm) /
            (cut.endZMm - cut.startZMm);
      const requestedRadiusMm =
        cut.startInnerRadiusMm +
        (cut.endInnerRadiusMm - cut.startInnerRadiusMm) * ratio;
      const representedRadiusMm = Math.min(
        outerRadiusMm,
        Math.ceil(
          requestedRadiusMm / resolutionMm - NUMERIC_EPSILON,
        ) * resolutionMm,
      );
      innerRadiusMm = Math.max(innerRadiusMm, representedRadiusMm);
    }
  }

  return { innerRadiusMm, outerRadiusMm };
}

function normalized(value: number, tolerance: number): number {
  return Math.abs(value) <= tolerance ? 0 : value;
}

function materialAreaMm2(innerRadiusMm: number, outerRadiusMm: number): number {
  return Math.PI * (outerRadiusMm ** 2 - innerRadiusMm ** 2);
}

function cellIndexAt(
  surface: TurningProfileSurfaceDescriptor,
  zMm: number,
): number {
  return Math.min(
    surface.axialCells - 1,
    Math.floor((zMm - surface.minimumZMm) / surface.resolutionMm),
  );
}

function contiguousHoleDepthMm(
  surface: TurningProfileSurfaceDescriptor,
  innerRadiusMm: Float32Array | Float64Array,
  freeEnd: DrillingRadiusFieldTarget["freeEnd"],
  toleranceMm: number,
): number {
  let depthMm = 0;
  if (freeEnd === "positive-z") {
    for (let index = surface.axialCells - 1; index >= 0; index -= 1) {
      if (innerRadiusMm[index] <= toleranceMm) {
        break;
      }
      depthMm += cellExtent(surface, index).widthMm;
    }
    return depthMm;
  }
  for (let index = 0; index < surface.axialCells; index += 1) {
    if (innerRadiusMm[index] <= toleranceMm) {
      break;
    }
    depthMm += cellExtent(surface, index).widthMm;
  }
  return depthMm;
}

/**
 * Compares a full actual lathe radius field with an independently authored
 * OD or drilling target. Only the scalar summary should cross into UI state.
 */
export function measureTurningStockAgainstTarget(
  surface: TurningProfileSurfaceDescriptor,
  target: TurningRadiusFieldTarget,
): TurningTargetMeasurement {
  validateSurface(surface);
  validateTarget(target);
  if (!sameStock(surface, target)) {
    throw new TurningTargetMeasurementError(
      "turning-measurement.target.stock-mismatch",
      "actual Stock axis or Z bounds do not match the target Stock.",
    );
  }

  const toleranceMm = Math.max(
    BOUNDS_TOLERANCE_MM,
    surface.resolutionMm * 1e-7,
  );
  const initialAreaMm2 = Math.PI * target.initialOuterRadiusMm ** 2;
  const targetInnerRadiusMm = new Float64Array(surface.axialCells);
  const targetOuterRadiusMm = new Float64Array(surface.axialCells);
  let targetCutCells = 0;
  let maxDeviationMm = 0;
  let weightedDeviationMm2 = 0;
  let totalWidthMm = 0;
  let overcutVolumeMm3 = 0;
  let undercutVolumeMm3 = 0;
  let actualRemovedVolumeMm3 = 0;
  let targetRemovedVolumeMm3 = 0;

  for (let index = 0; index < surface.axialCells; index += 1) {
    const extent = cellExtent(surface, index);
    const actualInnerValue = finite(
      surface.innerRadiusMm[index],
      "surface.innerRadiusMm[" + index + "]",
      "turning-measurement.surface.invalid",
    );
    const actualOuterValue = finite(
      surface.outerRadiusMm[index],
      "surface.outerRadiusMm[" + index + "]",
      "turning-measurement.surface.invalid",
    );
    if (
      actualInnerValue < -toleranceMm ||
      actualOuterValue < -toleranceMm ||
      actualInnerValue > actualOuterValue + toleranceMm ||
      actualOuterValue > target.initialOuterRadiusMm + toleranceMm
    ) {
      throw new TurningTargetMeasurementError(
        "turning-measurement.surface.invalid",
        "surface radii must satisfy 0 <= inner <= outer <= initial.",
      );
    }

    const actualInnerRadiusMm = Math.max(0, actualInnerValue);
    const actualOuterRadiusMm = Math.min(
      target.initialOuterRadiusMm,
      Math.max(actualInnerRadiusMm, actualOuterValue),
    );
    const represented = representedTargetRadii(
      target,
      surface.resolutionMm,
      extent.centerZMm,
    );
    targetInnerRadiusMm[index] = represented.innerRadiusMm;
    targetOuterRadiusMm[index] = represented.outerRadiusMm;

    const actualAreaMm2 = materialAreaMm2(
      actualInnerRadiusMm,
      actualOuterRadiusMm,
    );
    const targetAreaMm2 = materialAreaMm2(
      represented.innerRadiusMm,
      represented.outerRadiusMm,
    );
    if (initialAreaMm2 - targetAreaMm2 > NUMERIC_EPSILON) {
      targetCutCells += 1;
    }

    const deviationMm = Math.max(
      Math.abs(actualInnerRadiusMm - represented.innerRadiusMm),
      Math.abs(actualOuterRadiusMm - represented.outerRadiusMm),
    );
    maxDeviationMm = Math.max(maxDeviationMm, deviationMm);
    weightedDeviationMm2 += deviationMm * extent.widthMm;
    totalWidthMm += extent.widthMm;

    const areaDifferenceMm2 = targetAreaMm2 - actualAreaMm2;
    if (areaDifferenceMm2 > NUMERIC_EPSILON) {
      overcutVolumeMm3 += areaDifferenceMm2 * extent.widthMm;
    } else if (areaDifferenceMm2 < -NUMERIC_EPSILON) {
      undercutVolumeMm3 += -areaDifferenceMm2 * extent.widthMm;
    }
    actualRemovedVolumeMm3 +=
      (initialAreaMm2 - actualAreaMm2) * extent.widthMm;
    targetRemovedVolumeMm3 +=
      (initialAreaMm2 - targetAreaMm2) * extent.widthMm;
  }

  const base = {
    targetId: target.targetId,
    comparedCells: surface.axialCells,
    targetCutCells,
    representationResolutionMm: surface.resolutionMm,
    numericToleranceMm: toleranceMm,
    maxDeviationMm: normalized(maxDeviationMm, toleranceMm),
    meanAbsoluteDeviationMm: normalized(
      weightedDeviationMm2 / totalWidthMm,
      toleranceMm,
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
  const sampleIndex = cellIndexAt(surface, target.measurementZMm);

  if (target.process === "od-turning") {
    return {
      ...base,
      process: "od-turning",
      feature: {
        kind: "outer-diameter",
        sampleZMm: target.measurementZMm,
        actualDiameterMm: normalized(
          surface.outerRadiusMm[sampleIndex] * 2,
          toleranceMm,
        ),
        targetDiameterMm: normalized(
          targetOuterRadiusMm[sampleIndex] * 2,
          toleranceMm,
        ),
      },
    };
  }

  return {
    ...base,
    process: "drilling",
    feature: {
      kind: "drilled-hole",
      sampleZMm: target.measurementZMm,
      actualDiameterMm: normalized(
        surface.innerRadiusMm[sampleIndex] * 2,
        toleranceMm,
      ),
      targetDiameterMm: normalized(
        targetInnerRadiusMm[sampleIndex] * 2,
        toleranceMm,
      ),
      actualDepthMm: normalized(
        contiguousHoleDepthMm(
          surface,
          surface.innerRadiusMm,
          target.freeEnd,
          toleranceMm,
        ),
        toleranceMm,
      ),
      targetDepthMm: normalized(
        contiguousHoleDepthMm(
          surface,
          targetInnerRadiusMm,
          target.freeEnd,
          toleranceMm,
        ),
        toleranceMm,
      ),
      freeEnd: target.freeEnd,
    },
  };
}

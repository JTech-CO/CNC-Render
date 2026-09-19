import type { Vec3Mm } from "@cnc-render/contracts";

const NUMERIC_EPSILON = 1e-9;

export interface FlatEndMillingSweepGeometry {
  readonly startMm: Vec3Mm;
  readonly endMm: Vec3Mm;
}

/**
 * Returns the lowest flat-end cutter tip height that can touch an XY sample
 * while the cutter centre follows the supplied 3D sweep.
 *
 * Inputs are validated by the material-removal or measurement boundary before
 * this hot-path helper is called.
 */
export function minimumSweptFlatEndTipZMm(
  sweep: FlatEndMillingSweepGeometry,
  cutterRadiusMm: number,
  xMm: number,
  yMm: number,
): number | null {
  const deltaX = sweep.endMm.xMm - sweep.startMm.xMm;
  const deltaY = sweep.endMm.yMm - sweep.startMm.yMm;
  const deltaZ = sweep.endMm.zMm - sweep.startMm.zMm;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const radiusSquared = cutterRadiusMm * cutterRadiusMm;

  if (lengthSquared <= NUMERIC_EPSILON) {
    const distanceSquared =
      (xMm - sweep.startMm.xMm) ** 2 +
      (yMm - sweep.startMm.yMm) ** 2;
    return distanceSquared <= radiusSquared + NUMERIC_EPSILON
      ? Math.min(sweep.startMm.zMm, sweep.endMm.zMm)
      : null;
  }

  const projection =
    ((xMm - sweep.startMm.xMm) * deltaX +
      (yMm - sweep.startMm.yMm) * deltaY) /
    lengthSquared;
  const closestX = sweep.startMm.xMm + projection * deltaX;
  const closestY = sweep.startMm.yMm + projection * deltaY;
  const perpendicularDistanceSquared =
    (xMm - closestX) ** 2 + (yMm - closestY) ** 2;
  if (perpendicularDistanceSquared > radiusSquared + NUMERIC_EPSILON) {
    return null;
  }

  const extent = Math.sqrt(
    Math.max(
      0,
      (radiusSquared - perpendicularDistanceSquared) / lengthSquared,
    ),
  );
  const minimumT = Math.max(0, projection - extent);
  const maximumT = Math.min(1, projection + extent);
  if (minimumT > maximumT + NUMERIC_EPSILON) {
    return null;
  }
  const selectedT = deltaZ >= 0 ? minimumT : maximumT;
  return sweep.startMm.zMm + selectedT * deltaZ;
}

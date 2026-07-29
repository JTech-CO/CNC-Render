import type { Vector3Tuple } from "./contracts";

export interface AxisAlignedBounds {
  readonly min: Vector3Tuple;
  readonly max: Vector3Tuple;
}

export interface ProjectedBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function corners(bounds: AxisAlignedBounds): readonly Vector3Tuple[] {
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;

  return [
    [minX, minY, minZ],
    [minX, minY, maxZ],
    [minX, maxY, minZ],
    [minX, maxY, maxZ],
    [maxX, minY, minZ],
    [maxX, minY, maxZ],
    [maxX, maxY, minZ],
    [maxX, maxY, maxZ],
  ];
}

function projectPoint(
  matrix: readonly number[],
  point: Vector3Tuple,
  viewportWidth: number,
  viewportHeight: number,
): readonly [number, number] {
  const [x, y, z] = point;
  const clipX =
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY =
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipW =
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];

  if (!Number.isFinite(clipW) || Math.abs(clipW) < Number.EPSILON) {
    throw new RangeError("Projection produced an invalid homogeneous W.");
  }

  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;

  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) {
    throw new RangeError("Projection produced a non-finite coordinate.");
  }

  return [
    ((ndcX + 1) / 2) * viewportWidth,
    ((1 - ndcY) / 2) * viewportHeight,
  ];
}

export function projectAxisAlignedBounds(
  matrix: readonly number[],
  bounds: AxisAlignedBounds,
  viewportWidth: number,
  viewportHeight: number,
): ProjectedBounds {
  if (matrix.length !== 16) {
    throw new RangeError("Projection matrix must contain exactly 16 values.");
  }

  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    throw new RangeError("Viewport dimensions must be positive finite values.");
  }

  const projected = corners(bounds).map((point) =>
    projectPoint(matrix, point, viewportWidth, viewportHeight),
  );

  return {
    minX: Math.min(...projected.map(([x]) => x)),
    minY: Math.min(...projected.map(([, y]) => y)),
    maxX: Math.max(...projected.map(([x]) => x)),
    maxY: Math.max(...projected.map(([, y]) => y)),
  };
}

export function maximumProjectedBoundsDelta(
  first: ProjectedBounds,
  second: ProjectedBounds,
): number {
  return Math.max(
    Math.abs(first.minX - second.minX),
    Math.abs(first.minY - second.minY),
    Math.abs(first.maxX - second.maxX),
    Math.abs(first.maxY - second.maxY),
  );
}

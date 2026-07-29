import type { Vector3Tuple } from "./contracts";
import type { AxisAlignedBounds } from "./projection";

/**
 * CNC domain coordinates use Z-up. Three.js uses Y-up, so the renderer boundary
 * maps [X, Y, Z] millimetres to [X, Z, -Y] scene units.
 */
export function domainMmToScene(
  [x, y, z]: Vector3Tuple,
): Vector3Tuple {
  return [x, z, -y];
}

export function domainBoundsToSceneBounds(
  bounds: AxisAlignedBounds,
): AxisAlignedBounds {
  const first = domainMmToScene(bounds.min);
  const second = domainMmToScene(bounds.max);

  return {
    min: [
      Math.min(first[0], second[0]),
      Math.min(first[1], second[1]),
      Math.min(first[2], second[2]),
    ],
    max: [
      Math.max(first[0], second[0]),
      Math.max(first[1], second[1]),
      Math.max(first[2], second[2]),
    ],
  };
}

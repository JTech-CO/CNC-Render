import { GeometricMeasurementSchema, type GeometricMeasurement } from "../../contracts/src/result-report";
import type { Vec3Mm } from "@cnc-render/contracts";

export type MeasurementKind = GeometricMeasurement["kind"];
export interface MeasurementInput {
  readonly kind: MeasurementKind;
  readonly points: readonly Vec3Mm[];
  /** Required for projected depth / parallel-plane thickness, not normalized. */
  readonly normal?: Vec3Mm;
}

function vector(point: Vec3Mm): readonly [number, number, number] {
  const result = [point.xMm, point.yMm, point.zMm] as const;
  if (result.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e9)) {
    throw new RangeError("좌표는 ±1,000,000,000 mm 이내 유한값이어야 합니다.");
  }
  return result;
}
function difference(a: Vec3Mm, b: Vec3Mm): readonly [number, number, number] {
  const left = vector(a); const right = vector(b);
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}
function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Float64 canonical geometry. Display strings never feed this calculation. */
export function measureGeometry(input: MeasurementInput): GeometricMeasurement {
  const expected = input.kind === "angle" ? 3 : 2;
  if (input.points.length !== expected) throw new RangeError(`측정에 ${expected}개의 점이 필요합니다.`);
  const delta = difference(input.points[1], input.points[0]);
  let value = Math.hypot(...delta);
  if (input.kind === "angle") {
    const a = difference(input.points[0], input.points[1]);
    const b = difference(input.points[2], input.points[1]);
    const lengthA = Math.hypot(...a); const lengthB = Math.hypot(...b);
    if (lengthA === 0 || lengthB === 0) throw new RangeError("각도의 두 선분은 길이가 0일 수 없습니다.");
    const normalizedA = a.map((entry) => entry / lengthA);
    const normalizedB = b.map((entry) => entry / lengthB);
    const cross = [normalizedA[1] * normalizedB[2] - normalizedA[2] * normalizedB[1],
      normalizedA[2] * normalizedB[0] - normalizedA[0] * normalizedB[2],
      normalizedA[0] * normalizedB[1] - normalizedA[1] * normalizedB[0]];
    value = Math.atan2(Math.hypot(...cross), dot(normalizedA, normalizedB));
  } else if (input.kind === "diameter") {
    value *= 2;
  } else if (input.kind === "depth" || input.kind === "wall-thickness") {
    if (!input.normal) throw new RangeError("깊이·벽 두께에는 기준 평면의 법선이 필요합니다.");
    const normal = vector(input.normal);
    const length = Math.hypot(...normal);
    if (length === 0) throw new RangeError("법선 벡터의 길이는 0일 수 없습니다.");
    value = Math.abs(dot(delta, normal.map((entry) => entry / length)));
  }
  return GeometricMeasurementSchema.parse({ kind: input.kind, canonicalValue: value,
    canonicalUnit: input.kind === "angle" ? "rad" : "mm" });
}

export function displayMeasurement(measurement: GeometricMeasurement, lengthUnit: "mm" | "in", angleUnit: "rad" | "deg") {
  const valid = GeometricMeasurementSchema.parse(measurement);
  const unit = valid.canonicalUnit === "rad" ? angleUnit : lengthUnit;
  const value = valid.canonicalValue / (unit === "in" ? 25.4 : unit === "deg" ? Math.PI / 180 : 1);
  return { value, unit, text: `${value.toFixed(6)} ${unit}` } as const;
}

const MILLIMETERS_PER_INCH = 25.4;
const SECONDS_PER_MINUTE = 60;
const RADIANS_PER_DEGREE = Math.PI / 180;

declare const quantityBrand: unique symbol;

export type Quantity<Unit extends string> = number & {
  readonly [quantityBrand]: Unit;
};

export type Millimeters = Quantity<"mm">;
export type Inches = Quantity<"in">;
export type Radians = Quantity<"rad">;
export type Degrees = Quantity<"deg">;
export type RevolutionsPerMinute = Quantity<"rpm">;
export type RevolutionsPerSecond = Quantity<"rev/s">;
export type MillimetersPerMinute = Quantity<"mm/min">;
export type MillimetersPerRevolution = Quantity<"mm/rev">;
export type MillimetersPerTooth = Quantity<"mm/tooth">;

export function assertFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || Object.is(value, -0)) {
    throw new RangeError(`${label} must be finite and must not be negative zero`);
  }
  return value;
}

export function assertPositiveNumber(value: number, label: string): number {
  assertFiniteNumber(value, label);
  if (value <= 0) {
    throw new RangeError(`${label} must be greater than zero`);
  }
  return value;
}

export function millimeters(value: number): Millimeters {
  return assertFiniteNumber(value, "millimeters") as Millimeters;
}

export function inches(value: number): Inches {
  return assertFiniteNumber(value, "inches") as Inches;
}

export function radians(value: number): Radians {
  return assertFiniteNumber(value, "radians") as Radians;
}

export function degrees(value: number): Degrees {
  return assertFiniteNumber(value, "degrees") as Degrees;
}

export function revolutionsPerMinute(value: number): RevolutionsPerMinute {
  return assertPositiveNumber(value, "spindle speed rpm") as RevolutionsPerMinute;
}

export function revolutionsPerSecond(value: number): RevolutionsPerSecond {
  return assertPositiveNumber(value, "spindle speed rev/s") as RevolutionsPerSecond;
}

export function millimetersPerMinute(value: number): MillimetersPerMinute {
  return assertPositiveNumber(value, "feed mm/min") as MillimetersPerMinute;
}

export function millimetersPerRevolution(
  value: number,
): MillimetersPerRevolution {
  return assertPositiveNumber(value, "feed mm/rev") as MillimetersPerRevolution;
}

export function millimetersPerTooth(value: number): MillimetersPerTooth {
  return assertPositiveNumber(value, "feed mm/tooth") as MillimetersPerTooth;
}

export function millimetersToInches(value: Millimeters): Inches {
  return inches(value / MILLIMETERS_PER_INCH);
}

export function inchesToMillimeters(value: Inches): Millimeters {
  return millimeters(value * MILLIMETERS_PER_INCH);
}

export function degreesToRadians(value: Degrees): Radians {
  return radians(value * RADIANS_PER_DEGREE);
}

export function radiansToDegrees(value: Radians): Degrees {
  return degrees(value / RADIANS_PER_DEGREE);
}

export function revolutionsPerMinuteToRevolutionsPerSecond(
  value: RevolutionsPerMinute,
): RevolutionsPerSecond {
  return revolutionsPerSecond(value / SECONDS_PER_MINUTE);
}

export function revolutionsPerSecondToRevolutionsPerMinute(
  value: RevolutionsPerSecond,
): RevolutionsPerMinute {
  return revolutionsPerMinute(value * SECONDS_PER_MINUTE);
}

export function millimetersPerMinuteToInchesPerMinute(
  value: MillimetersPerMinute,
): number {
  return assertPositiveNumber(value / MILLIMETERS_PER_INCH, "feed in/min");
}

export function inchesPerMinuteToMillimetersPerMinute(
  value: number,
): MillimetersPerMinute {
  return millimetersPerMinute(
    assertPositiveNumber(value, "feed in/min") * MILLIMETERS_PER_INCH,
  );
}

export function millimetersPerRevolutionToInchesPerRevolution(
  value: MillimetersPerRevolution,
): number {
  return assertPositiveNumber(value / MILLIMETERS_PER_INCH, "feed in/rev");
}

export function inchesPerRevolutionToMillimetersPerRevolution(
  value: number,
): MillimetersPerRevolution {
  return millimetersPerRevolution(
    assertPositiveNumber(value, "feed in/rev") * MILLIMETERS_PER_INCH,
  );
}

export function millimetersPerToothToInchesPerTooth(
  value: MillimetersPerTooth,
): number {
  return assertPositiveNumber(value / MILLIMETERS_PER_INCH, "feed in/tooth");
}

export function inchesPerToothToMillimetersPerTooth(
  value: number,
): MillimetersPerTooth {
  return millimetersPerTooth(
    assertPositiveNumber(value, "feed in/tooth") * MILLIMETERS_PER_INCH,
  );
}

export function roundForDisplay(
  canonicalValue: number,
  decimalPlaces: number,
): string {
  assertFiniteNumber(canonicalValue, "canonical display value");
  if (
    !Number.isSafeInteger(decimalPlaces) ||
    decimalPlaces < 0 ||
    decimalPlaces > 12
  ) {
    throw new RangeError("decimalPlaces must be an integer from 0 through 12");
  }
  return canonicalValue.toFixed(decimalPlaces);
}

export function quantitiesApproximatelyEqual(
  left: number,
  right: number,
  absoluteTolerance = 1e-12,
  relativeTolerance = 1e-12,
): boolean {
  assertFiniteNumber(left, "left quantity");
  assertFiniteNumber(right, "right quantity");
  const absoluteError = Math.abs(left - right);
  const relativeError =
    absoluteError / Math.max(Math.abs(left), Math.abs(right), 1);
  return (
    absoluteError <= absoluteTolerance || relativeError <= relativeTolerance
  );
}

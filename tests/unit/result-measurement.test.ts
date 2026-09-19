import { describe, expect, it } from "vitest";
import { displayMeasurement, measureGeometry, type MeasurementKind } from "../../packages/simulation/src/result-measurement";

const origin = { xMm: 0, yMm: 0, zMm: 0 };
describe("M11 geometric measurement precision", () => {
  it.each<[MeasurementKind, number]>([["distance", 5], ["radius", 5], ["diameter", 10]])("calculates %s from user coordinates", (kind, expected) => {
    expect(measureGeometry({ kind, points: [origin, { xMm: 3, yMm: 4, zMm: 0 }] })).toEqual({ kind, canonicalValue: expected, canonicalUnit: "mm" });
  });
  it("measures the included angle at B in radians, preserving small angles", () => {
    const result = measureGeometry({ kind: "angle", points: [{ xMm: 1, yMm: 0, zMm: 0 }, origin, { xMm: 1, yMm: 1e-10, zMm: 0 }] });
    expect(result.canonicalValue).toBeCloseTo(1e-10, 20);
    expect(result.canonicalUnit).toBe("rad");
  });
  it.each<MeasurementKind>(["depth", "wall-thickness"])("projects %s onto a normalized plane normal", (kind) => {
    expect(measureGeometry({ kind, points: [origin, { xMm: 100, yMm: 20, zMm: -8.125 }], normal: { xMm: 0, yMm: 0, zMm: 12 } }).canonicalValue).toBe(8.125);
  });
  it("never feeds rounded inch / degree strings back into canonical values", () => {
    const result = measureGeometry({ kind: "distance", points: [origin, { xMm: 25.412345678901, yMm: 0, zMm: 0 }] });
    const before = JSON.stringify(result);
    for (let index = 0; index < 1000; index += 1) { displayMeasurement(result, "in", "deg"); displayMeasurement(result, "mm", "rad"); }
    expect(JSON.stringify(result)).toBe(before);
    expect(displayMeasurement(result, "in", "deg").value * 25.4).toBeCloseTo(result.canonicalValue, 12);
    const angle = measureGeometry({ kind: "angle", points: [{ xMm: 1, yMm: 0, zMm: 0 }, origin, { xMm: 0, yMm: 1, zMm: 0 }] });
    expect(displayMeasurement(angle, "in", "deg").value).toBe(90);
    expect(angle.canonicalValue).toBe(Math.PI / 2);
  });
  it("rejects degenerate and nonfinite geometry", () => {
    expect(() => measureGeometry({ kind: "distance", points: [origin] })).toThrow();
    expect(() => measureGeometry({ kind: "angle", points: [origin, origin, origin] })).toThrow();
    expect(() => measureGeometry({ kind: "depth", points: [origin, origin] })).toThrow();
    expect(() => measureGeometry({ kind: "wall-thickness", points: [origin, origin], normal: origin })).toThrow();
    for (const value of [NaN, Infinity, -Infinity, 1e10]) expect(() => measureGeometry({ kind: "radius", points: [origin, { ...origin, xMm: value }] })).toThrow();
  });
});

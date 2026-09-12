import { describe, expect, it } from "vitest";
import { compareStockResult, type ResultComparisonInput } from "../../packages/simulation/src/result-comparison";

const provenance = { runId: "7a000000-0000-4000-8000-000000000001", fixtureId: "fixture-1", stateHash: "a".repeat(64), stockHash: "b".repeat(64), logicalTimeS: 5.125,
  outcome: "completed" as const, collisionCount: 0, warningCount: 0, diagnosticCount: 0 };
function milling(): ResultComparisonInput {
  const boundsMm = { minimum: { xMm: 0, yMm: 0, zMm: 0 }, maximum: { xMm: 2, yMm: 2, zMm: 10 } };
  return { provenance, surface: { columns: 2, rows: 2, resolutionMm: 1, boundsMm, topZMm: new Float32Array([8, 7, 9, 10]) },
    target: { kind: "flat-end-sweep", targetId: "independent-flat-8", stockBoundsMm: boundsMm, cutterDiameterMm: 20,
      sweeps: [{ startMm: { xMm: 0, yMm: 1, zMm: 8 }, endMm: { xMm: 2, yMm: 1, zMm: 8 } }] } };
}
function turning(): ResultComparisonInput {
  return { provenance, surface: { axisCenterMm: { xMm: 0, yMm: 0 }, minimumZMm: 0, maximumZMm: 2, resolutionMm: 1, axialCells: 2, radialSegments: 16,
    outerRadiusMm: new Float32Array([5, 4]), innerRadiusMm: new Float32Array([1, 0]) },
    target: { targetId: "independent-od4", kind: "turning-radius-profile", process: "od-turning", axisCenterMm: { xMm: 0, yMm: 0 },
      minimumZMm: 0, maximumZMm: 2, initialOuterRadiusMm: 5, measurementZMm: 1,
      cuts: [{ operation: "od-turning", startZMm: 0, endZMm: 2, startOuterRadiusMm: 4, endOuterRadiusMm: 4 }] } };
}
describe("M11 actual Stock deviation field", () => {
  it("uses one canonical field for every mode and preserves authored targets", () => {
    const input = milling(); const before = structuredClone(input);
    const result = compareStockResult(input);
    expect(Array.from(result.field.targetMm)).toEqual([8, 8, 8, 8]);
    expect(Array.from(result.field.signedDeviationMm)).toEqual([0, -1, 1, 2]);
    expect(result.report).toMatchObject({ maxDeviationMm: 2, meanAbsoluteDeviationMm: 1, p95AbsoluteDeviationMm: 2,
      overcutVolumeMm3: 1, undercutVolumeMm3: 3, actualRemovedVolumeMm3: 6, targetRemovedVolumeMm3: 8 });
    expect(input).toEqual(before);
    expect(compareStockResult(input)).toEqual(result);
  });
  it("does not cancel simultaneous inner overcut and outer undercut", () => {
    const result = compareStockResult(turning());
    expect(result.report.overcutVolumeMm3).toBeCloseTo(Math.PI, 10);
    expect(result.report.undercutVolumeMm3).toBeCloseTo(9 * Math.PI, 10);
    expect(Array.from(result.field.signedDeviationMm)).toEqual([1, 0, -1, 0]);
    expect(result.report).toMatchObject({ comparedCells: 2, maxDeviationMm: 1, meanAbsoluteDeviationMm: 0.5, p95AbsoluteDeviationMm: 1 });
  });
  it("uses clipped edge cell area and nearest rank quantiles", () => {
    const input = milling();
    if (!("columns" in input.surface) || input.target.kind !== "flat-end-sweep") throw new Error("fixture");
    const boundsMm = { ...input.surface.boundsMm, maximum: { ...input.surface.boundsMm.maximum, xMm: 1.5 } };
    const result = compareStockResult({ ...input, surface: { ...input.surface, boundsMm }, target: { ...input.target, stockBoundsMm: boundsMm } });
    expect(result.report.meanAbsoluteDeviationMm).toBeCloseTo(5 / 6, 12);
    expect(result.report.p95AbsoluteDeviationMm).toBe(2);
  });
  it("rejects mismatched, huge and corrupt Stock inputs instead of fabricating results", () => {
    const input = milling();
    if (!("columns" in input.surface)) throw new Error("fixture");
    input.surface.topZMm[0] = NaN;
    expect(() => compareStockResult(input)).toThrow();
    expect(() => compareStockResult({ ...milling(), surface: turning().surface } as ResultComparisonInput)).toThrow();
    expect(() => compareStockResult({ ...milling(), surface: { ...input.surface, columns: 4_194_305 } } as ResultComparisonInput)).toThrow();
  });
});

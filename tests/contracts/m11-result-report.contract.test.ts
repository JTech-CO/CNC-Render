import { describe, expect, it } from "vitest";
import { GeometricMeasurementSchema, ResultReportSchema, type ResultReport } from "../../packages/contracts/src/result-report";
import { resultReportRows, serializeResultReport } from "../../packages/simulation/src/result-report-export";

const report: ResultReport = { schemaVersion: 1, accuracyGrade: "E2", runId: "7a000000-0000-4000-8000-000000000001", fixtureId: "milling", stateHash: "a".repeat(64), stockHash: "b".repeat(64), targetId: "authored-target", process: "milling",
  logicalTimeS: 52.2601234567, outcome: "completed", collisionCount: 0, warningCount: 1, diagnosticCount: 1,
  comparedCells: 1125, representationResolutionMm: 8, numericToleranceMm: 1e-6,
  maxDeviationMm: 8, meanAbsoluteDeviationMm: 1.123456789, p95AbsoluteDeviationMm: 4, quantileMethod: "nearest-rank-cell-absolute",
  overcutVolumeMm3: 512.125, undercutVolumeMm3: 1024.25, actualRemovedVolumeMm3: 357888, targetRemovedVolumeMm3: 358400.125,
  measurements: [{ kind: "angle", canonicalValue: Math.PI / 2, canonicalUnit: "rad" }] };

describe("M11 result report contract and exports", () => {
  it("strictly validates finite canonical data, metrics, units and grade", () => {
    expect(ResultReportSchema.parse(report)).toEqual(report);
    for (const invalid of [{ ...report, extra: true }, { ...report, accuracyGrade: "S1" }, { ...report, maxDeviationMm: NaN },
      { ...report, logicalTimeS: Infinity }, { ...report, overcutVolumeMm3: -1 }, { ...report, meanAbsoluteDeviationMm: 9 }, { ...report, p95AbsoluteDeviationMm: 9 },
      { ...report, runId: "not-a-uuid" }, { ...report, stockHash: "B".repeat(64) }, { ...report, stateHash: "abcd" },
      { ...report, measurements: Array.from({ length: 101 }, () => report.measurements[0]) },
      { ...report, outcome: "running" }, { ...report, collisionCount: -1 }, { ...report, warningCount: 0.5 }, { ...report, diagnosticCount: 0 }]) {
      expect(ResultReportSchema.safeParse(invalid).success).toBe(false);
    }
    expect(GeometricMeasurementSchema.safeParse({ kind: "angle", canonicalValue: 90, canonicalUnit: "mm" }).success).toBe(false);
    expect(GeometricMeasurementSchema.safeParse({ kind: "radius", canonicalValue: 3, canonicalUnit: "rad" }).success).toBe(false);
  });
  it("exports every displayed key value without precision loss in JSON CSV and HTML", () => {
    const json = JSON.parse(serializeResultReport(report, "json")) as ResultReport;
    expect(json).toEqual(report);
    const csv = serializeResultReport(report, "csv"); const html = serializeResultReport(report, "html");
    for (const row of resultReportRows(report)) {
      expect(csv).toContain(`"${row.key}","${row.label}","${row.value}","${row.unit}"`);
      expect(html).toContain(`data-key="${row.key}">${row.value}</td><td>${row.unit}</td>`);
    }
    expect(html).toContain("E2 교육용 근사"); expect(csv).toContain("mm³");
  });
  it("escapes HTML and spreadsheet formula injection in untrusted identities", () => {
    const malicious = { ...report, targetId: "=HYPERLINK(\"https://example.test\")", fixtureId: '+formula<img src=x onerror="alert(1)">' };
    const html = serializeResultReport(malicious, "html");
    expect(html).not.toContain("<img"); expect(html).toContain("&lt;img"); expect(html).not.toContain("<script");
    const csv = serializeResultReport(malicious, "csv");
    expect(csv).toContain('"\'=HYPERLINK'); expect(csv).toContain('"\'+formula');
    expect(JSON.parse(serializeResultReport(malicious, "json")).fixtureId).toBe(malicious.fixtureId);
  });
  it("refuses invalid data for every export format", () => {
    for (const format of ["json", "csv", "html"] as const) expect(() => serializeResultReport({ ...report, logicalTimeS: Infinity }, format)).toThrow();
  });
  it("preserves stopped outcomes and real event counts in all formats", () => {
    const stopped: ResultReport = { ...report, outcome: "stopped", collisionCount: 1, warningCount: 2, diagnosticCount: 3 };
    expect(JSON.parse(serializeResultReport(stopped, "json"))).toMatchObject({ outcome: "stopped", collisionCount: 1, warningCount: 2, diagnosticCount: 3 });
    for (const format of ["csv", "html"] as const) { const text = serializeResultReport(stopped, format); expect(text).toContain("stopped"); expect(text).toContain("collisionCount"); expect(text).toContain("diagnosticCount"); }
  });
});

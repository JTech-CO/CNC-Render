import { describe, expect, it } from "vitest";
import { validateMemoryEvidence, validateReferenceEvidence } from "../../scripts/check-reference-evidence.mjs";
import { benchmarkProjects, BENCHMARK_QUALITIES } from "../../scripts/benchmark-contract.mjs";

function reports() {
  return benchmarkProjects("reference").flatMap((project: { name: string; backend: string }) => BENCHMARK_QUALITIES.map((quality: string) => ({
    project: project.name, qualityPreset: quality, reportVersion: 3, freshBrowserPerCase: true, backend: project.backend, status: "pass", baselineResources: [],
    durationMs: 60_000, repetitions: 30, baseline: { privateBytes: 100, gpuBytes: 20 },
    emptyGpuInitializedBrowserSamples: Array.from({ length: 3 }, () => ({ processes: [{ privateBytes: 100 }], gpuReportedBytes: 20 })),
    samples: Array.from({ length: 10 }, () => ({ processes: [{ privateBytes: 200 }], gpuReportedBytes: 40, attributedBytes: 120 })),
    observedPeakBytes: 120, limitBytes: quality === "balanced" ? 600_000_000 : 1_500_000_000,
  })));
}

describe("M12 checked-in reference evidence", () => {
  it("recomputes all eight cases rather than trusting pass labels", () => {
    expect(() => validateMemoryEvidence(reports())).not.toThrow();
    const invalid = reports();
    invalid[0].samples[0].attributedBytes = 0;
    expect(() => validateMemoryEvidence(invalid)).toThrow("arithmetic");
  });
  it("rejects absent/duplicate cases and incomplete or contaminated baselines", () => {
    expect(() => validateMemoryEvidence(reports().slice(1))).toThrow();
    const duplicated = reports(); duplicated[0] = duplicated[1];
    expect(() => validateMemoryEvidence(duplicated)).toThrow();
    const warm = reports(); warm[0].freshBrowserPerCase = false;
    expect(() => validateMemoryEvidence(warm)).toThrow();
    const short = reports(); short[0].durationMs = 59_999;
    expect(() => validateMemoryEvidence(short)).toThrow();
  });
  it("rejects a changed budget or falsified baseline", () => {
    const budget = reports(); budget[0].limitBytes = 600_000_001;
    expect(() => validateMemoryEvidence(budget)).toThrow("budget");
    const baseline = reports(); baseline[0].baseline.privateBytes = 101;
    expect(() => validateMemoryEvidence(baseline)).toThrow("baseline");
  });
  it("requires remeasurement when runtime input identity changes", () => {
    expect(() => validateReferenceEvidence({ schemaVersion: 1, runtimeFingerprint: { sha256: "old" } }, { sha256: "new" })).toThrow("runtime changed");
  });
});

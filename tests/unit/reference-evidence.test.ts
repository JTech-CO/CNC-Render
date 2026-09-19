import { describe, expect, it } from "vitest";
import { validateMemoryEvidence, validateReferenceEvidence } from "../../scripts/check-reference-evidence.mjs";
import { aggregateLongTasks, benchmarkProjects, BENCHMARK_FIXTURES, BENCHMARK_QUALITIES } from "../../scripts/benchmark-contract.mjs";

function reports() {
  return benchmarkProjects("reference").flatMap((project: { name: string; backend: string }) => BENCHMARK_QUALITIES.map((quality: string) => ({
    project: project.name, qualityPreset: quality, reportVersion: 3, freshBrowserPerCase: true, backend: project.backend, status: "pass", baselineResources: [],
    durationMs: 60_000, repetitions: 30, baseline: { privateBytes: 100, gpuBytes: 20 },
    emptyGpuInitializedBrowserSamples: Array.from({ length: 3 }, () => ({ processes: [{ privateBytes: 100 }], gpuReportedBytes: 20 })),
    samples: Array.from({ length: 10 }, () => ({ processes: [{ privateBytes: 200 }], gpuReportedBytes: 40, attributedBytes: 120 })),
    observedPeakBytes: 120, limitBytes: quality === "balanced" ? 600_000_000 : 1_500_000_000,
  })));
}

function completeEvidence() {
  const longTaskEntries: { startTime: number; duration: number }[] = [];
  const executionWindows = [{ kind: "warmup", startMs: 0, endMs: 1 }, { kind: "realtime", startMs: 1, endMs: 8001 }];
  return {
    schemaVersion: 1, runtimeFingerprint: { sha256: "fixture" }, memory: reports(),
    benchmark: { matrix: "reference", gateStatus: "pass", functionalStatus: "pass", performanceStatus: "pass",
      executions: benchmarkProjects("reference").flatMap((project: { name: string; backend: string }) =>
        BENCHMARK_QUALITIES.flatMap((qualityPreset: string) => BENCHMARK_FIXTURES.map((fixture: string) => ({
          project: project.name, qualityPreset, fixture, status: "passed", sample: {
            qualityPreset, actualBackend: project.backend, gpuClass: "hardware-candidate", deterministic: true,
            pageErrorCount: 0, reactCommitDelta: 0, semantic: { completed: true, stockHash: fixture },
            frames: { framesRendered: 480, renderedFps: 60 }, shellReadyMs: 1000, maximumMainHandlerMs: 1,
            longTaskEntries, executionWindows, repetitions: 1, totalPlaybackLongTasksOver50Ms: 0,
            ...aggregateLongTasks(longTaskEntries, executionWindows),
          },
        })))),
    },
  };
}

describe("M12 checked-in reference evidence", () => {
  it("validates the complete per-execution matrix without treating cumulative counts as the gate", () => {
    const evidence = completeEvidence();
    expect(() => validateReferenceEvidence(evidence, evidence.runtimeFingerprint)).not.toThrow();
    evidence.benchmark.executions[0].sample.totalPlaybackLongTasksOver50Ms = 11;
    expect(() => validateReferenceEvidence(evidence, evidence.runtimeFingerprint)).not.toThrow();
  });
  it("rejects unmeasured FPS and invalid handlers even when every stored status says pass", () => {
    for (const quality of BENCHMARK_QUALITIES) for (const fps of [NaN, Infinity, 0]) {
      const evidence = completeEvidence();
      evidence.benchmark.executions.find((row: { qualityPreset: string }) => row.qualityPreset === quality)!.sample.frames.renderedFps = fps;
      expect(() => validateReferenceEvidence(evidence, evidence.runtimeFingerprint)).toThrow("performance");
    }
    for (const handler of [-1, -Infinity, NaN, Infinity, 50]) {
      const evidence = completeEvidence();
      evidence.benchmark.executions[0].sample.maximumMainHandlerMs = handler;
      expect(() => validateReferenceEvidence(evidence, evidence.runtimeFingerprint)).toThrow("main-thread");
    }
  });
  it("rejects mismatched quality and falsified long-task aggregation", () => {
    const quality = completeEvidence();
    quality.benchmark.executions[0].sample.qualityPreset = "precision";
    expect(() => validateReferenceEvidence(quality, quality.runtimeFingerprint)).toThrow("hardware case");
    const counts = completeEvidence();
    counts.benchmark.executions[0].sample.totalObservedLongTasksOver50Ms = 10;
    expect(() => validateReferenceEvidence(counts, counts.runtimeFingerprint)).toThrow("arithmetic");
  });
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

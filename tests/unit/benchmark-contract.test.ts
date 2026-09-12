import { describe, expect, it } from "vitest";
import { BENCHMARK_FIXTURES, benchmarkProjects, classifyGpu, compareBenchmarkMatrix, evaluatePerformance, frameStatistics, functionalSamplePassed } from "../../scripts/benchmark-contract.mjs";

describe("M12 benchmark evidence", () => {
  it("separates two software rows from four installed-browser hardware candidates", () => {
    expect(benchmarkProjects("software")).toHaveLength(2);
    expect(benchmarkProjects("reference")).toHaveLength(4);
    expect(benchmarkProjects("all")).toHaveLength(6);
    expect(benchmarkProjects("reference").every((item) => !item.softwareRequested)).toBe(true);
    expect(() => benchmarkProjects("unknown")).toThrow();
  });
  it("uses completed frames per wall-clock second, not inverse CPU submission time", () => {
    expect(frameStatistics([0, 10, 30, 60], 60, 1000)).toEqual({
      framesRendered: 60, elapsedMs: 1000, renderedFps: 60, observedFrameIntervals: 3, p95FrameIntervalMs: 30,
    });
  });
  it.each([[], [1], [1, 1], [2, 1], [1, Infinity], [NaN, 2]].map((times) => ({ times })))("rejects invalid timestamp sequences $times", ({ times }) => {
    expect(() => frameStatistics(times, 60, 1000)).toThrow();
  });
  it.each([0, -1, NaN, Infinity])("rejects invalid elapsed milliseconds %s", (duration) => {
    expect(() => frameStatistics([0, 10], 2, duration)).toThrow();
  });
  it("cannot qualify software or undisclosed adapters as hardware", () => {
    expect(classifyGpu(true, "NVIDIA")).toBe("software");
    expect(classifyGpu(false, "ANGLE SwiftShader")).toBe("software");
    expect(classifyGpu(false, "llvmpipe")).toBe("software");
    expect(classifyGpu(false, "")).toBe("unverified");
    expect(classifyGpu(false, "NVIDIA RTX")).toBe("hardware-candidate");
  });
  it("keeps the 60 FPS and 5000 ms thresholds without claiming memory or High certification", () => {
    const sample = { gpuClass: "hardware-candidate", frames: { renderedFps: 60 }, shellReadyMs: 5000 };
    expect(evaluatePerformance(sample)).toMatchObject({ mediumFps: "pass", coldShell: "pass", totalMemory: "not-measured", highPreset: "not-implemented", referenceHardwareApproval: "pending" });
    expect(evaluatePerformance({ ...sample, frames: { renderedFps: 59.99 }, shellReadyMs: 5000.01 })).toMatchObject({ mediumFps: "fail", coldShell: "fail" });
    expect(evaluatePerformance({ ...sample, gpuClass: "software" }).mediumFps).toBe("not-qualified");
    expect(evaluatePerformance({ ...sample, frames: { renderedFps: Infinity }, shellReadyMs: null })).toMatchObject({ mediumFps: "not-measured", coldShell: "not-measured" });
  });
  it("requires every requested backend/browser and identical semantic/Stock evidence", () => {
    const projects = benchmarkProjects("all");
    const rows = projects.flatMap((project) => BENCHMARK_FIXTURES.map((fixture) => ({
      project: project.name, fixture, status: "passed", sample: { actualBackend: project.backend, deterministic: true, semantic: { completed: true, stockHash: "same", axes: [1, 2, 3], diagnosticCodes: [] } },
    })));
    expect(compareBenchmarkMatrix(rows, projects).every((item) => item.status === "pass")).toBe(true);
    expect(compareBenchmarkMatrix(rows.slice(1), projects)[0].status).toBe("incomplete");
    expect(compareBenchmarkMatrix([...rows, rows[0]], projects)[0].status).toBe("incomplete");
    const failed = structuredClone(rows);
    failed[0].status = "failed";
    expect(compareBenchmarkMatrix(failed, projects)[0].status).toBe("pass");
    failed[0].sample.actualBackend = "wrong-backend";
    expect(compareBenchmarkMatrix(failed, projects)[0].status).toBe("incomplete");
    rows[0].sample.semantic.stockHash = "different";
    expect(compareBenchmarkMatrix(rows, projects)[0].status).toBe("fail");
    expect(() => compareBenchmarkMatrix([], [])).toThrow();
  });
  it("separates functional evidence from performance and rejects missing/error samples", () => {
    const sample = { semantic: { completed: true }, deterministic: true, actualBackend: "webgpu", pageErrorCount: 0, reactCommitDelta: 0, frames: { framesRendered: 10 } };
    expect(functionalSamplePassed(sample, "webgpu")).toBe(true);
    expect(functionalSamplePassed(sample, "webgl2")).toBe(false);
    expect(functionalSamplePassed({ ...sample, pageErrorCount: 1 }, "webgpu")).toBe(false);
    expect(functionalSamplePassed(null, "webgpu")).toBe(false);
  });
});

export const BENCHMARK_FIXTURES = ["milling", "turning", "drilling"];
export const BENCHMARK_BROWSERS = ["chromium", "chrome", "msedge"];
export const BENCHMARK_BACKENDS = ["webgpu", "webgl2"];
export const BENCHMARK_WINDOW_MS = 8_000;
export const BENCHMARK_VIEWPORT = { width: 1440, height: 900 };

export function benchmarkProjects(matrix) {
  if (!["software", "reference", "all"].includes(matrix)) {
    throw new Error("Benchmark matrix must be software, reference or all.");
  }
  return BENCHMARK_BROWSERS.filter((browser) =>
    matrix === "all" || (matrix === "software" ? browser === "chromium" : browser !== "chromium"),
  ).flatMap((browser) => BENCHMARK_BACKENDS.map((backend) => ({
    name: `${browser}-${backend}`,
    browser,
    backend,
    softwareRequested: browser === "chromium",
  })));
}

export function frameStatistics(timestamps, framesRendered, elapsedMs) {
  if (timestamps.length < 2 || !Number.isInteger(framesRendered) || framesRendered < 2 ||
      !Number.isFinite(elapsedMs) || elapsedMs <= 0 ||
      timestamps.some((value, index) => !Number.isFinite(value) || (index > 0 && value <= timestamps[index - 1]))) {
    throw new Error("Benchmark requires finite, increasing rendered-frame samples.");
  }
  const intervals = timestamps.slice(1).map((value, index) => value - timestamps[index]).sort((a, b) => a - b);
  const renderedFps = framesRendered * 1000 / elapsedMs;
  if (!Number.isFinite(renderedFps)) throw new Error("Benchmark FPS must be finite.");
  return {
    framesRendered,
    elapsedMs,
    renderedFps,
    observedFrameIntervals: intervals.length,
    p95FrameIntervalMs: intervals[Math.ceil(intervals.length * 0.95) - 1],
  };
}

export function classifyGpu(softwareRequested, adapter) {
  if (softwareRequested || /swiftshader|llvmpipe|lavapipe|software|basic render/iu.test(adapter ?? "")) {
    return "software";
  }
  return adapter?.trim() ? "hardware-candidate" : "unverified";
}

export function evaluatePerformance(sample) {
  const hardware = sample.gpuClass === "hardware-candidate";
  const fps = sample.frames.renderedFps;
  const shell = sample.shellReadyMs;
  return {
    mediumFps: !hardware ? "not-qualified" : !Number.isFinite(fps) || fps <= 0 ? "not-measured" : fps >= 60 ? "pass" : "fail",
    coldShell: !Number.isFinite(shell) || shell <= 0 ? "not-measured" : shell <= 5000 ? "pass" : "fail",
    // performance.memory excludes GPU and Worker heaps; it cannot prove total memory.
    totalMemory: "not-measured",
    highPreset: "not-implemented",
    landingLcp: "not-measured",
    referenceHardwareApproval: "pending",
  };
}

export function compareBenchmarkMatrix(rows, projects) {
  if (projects.length === 0) throw new Error("Benchmark matrix must not be empty.");
  return BENCHMARK_FIXTURES.map((fixture) => {
    if (projects.some((project) => rows.filter((row) => row.project === project.name && row.fixture === fixture).length !== 1)) {
      return { fixture, status: "incomplete", reason: "missing-or-duplicate-execution" };
    }
    const matches = projects.map((project) => rows.find((row) => row.project === project.name && row.fixture === fixture));
    const evidence = matches.map((row) => row?.sample?.semantic);
    // Performance budget failures do not erase independently valid semantic evidence.
    if (matches.some((row, index) => !row?.sample?.deterministic || row.sample.actualBackend !== projects[index].backend) ||
        evidence.some((item) => !item?.completed)) {
      return { fixture, status: "incomplete", reason: "missing-or-failed-execution" };
    }
    // This fixture uses the same WASM field on both backends: no relaxed tolerance.
    const canonical = JSON.stringify(evidence[0]);
    return { fixture, status: evidence.every((item) => JSON.stringify(item) === canonical) ? "pass" : "fail" };
  });
}

export function functionalSamplePassed(sample, backend) {
  return Boolean(sample && sample.semantic?.completed && sample.deterministic &&
    sample.actualBackend === backend && sample.pageErrorCount === 0 &&
    sample.reactCommitDelta === 0 && sample.frames?.framesRendered > 0);
}

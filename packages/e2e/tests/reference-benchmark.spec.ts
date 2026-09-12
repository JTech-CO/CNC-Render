import { expect, test } from "@playwright/test";
import { BENCHMARK_FIXTURES, BENCHMARK_WINDOW_MS, classifyGpu, frameStatistics } from "../../../scripts/benchmark-contract.mjs";
import type { M7PipelineFixture } from "@cnc-render/simulation";

for (const fixture of BENCHMARK_FIXTURES) {
  test(fixture, async ({ page, browser }, testInfo) => {
    const backend = testInfo.project.metadata.backend as string;
    const errors: string[] = [];
    page.on("pageerror", () => errors.push("pageerror"));
    await page.goto(`./?renderer=${backend}`);
    await page.waitForFunction(() => Boolean(window.__CNC_RENDER_M3__ && window.__CNC_RENDER_M7__));
    const shellReadyMs = await page.evaluate(() => performance.now());
    await expect(page.getByTestId("machine-viewport")).toHaveAttribute("data-ready", "true");
    // A requested WebGPU fallback must not silently count as a WebGPU pass.
    await expect(page.getByTestId("machine-viewport")).toHaveAttribute("data-renderer-mode", backend);

    const adapter = await page.evaluate(async (requested) => {
      if (requested === "webgpu") {
        const adapter = await navigator.gpu?.requestAdapter();
        return adapter ? `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.device} ${adapter.info.description}`.trim() : "";
      }
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="machine-canvas"]');
      const gl = canvas?.getContext("webgl2");
      const extension = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : "";
    }, backend);
    const result = await page.evaluate(async ({ selectedFixture, durationMs }) => {
      const scene = window.__CNC_RENDER_M3__!;
      const pipeline = window.__CNC_RENDER_M7__!;
      await pipeline.runPipelineFixture(selectedFixture, { playbackSpeed: 100, executionMode: "fast-forward" });
      scene.setView("isometric");
      scene.fit();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const baseline = scene.getDiagnostics();
      const commits = scene.getReactCommitCount();
      const timestamps: number[] = [];
      let lastFrame = baseline.telemetry.framesRendered;
      let raf = 0;
      let active = true;
      let lastOrbitTime = performance.now();
      const observe = (time: number) => {
        const frame = scene.getDiagnostics().telemetry.framesRendered;
        if (frame > lastFrame) { timestamps.push(time); lastFrame = frame; }
        // Equal angular velocity on 30/60/144 Hz devices, not a faster orbit on faster GPUs.
        scene.orbit(15 * (time - lastOrbitTime) / 1000, 0);
        lastOrbitTime = time;
        if (active) raf = requestAnimationFrame(observe);
      };
      const start = performance.now();
      raf = requestAnimationFrame(observe);
      let summary;
      let repetitions = 0;
      let firstSemantic = "";
      let deterministic = true;
      let maximumMainHandlerMs = 0;
      let maximumLongTasksPerRun = 0;
      try {
        do {
          summary = await pipeline.runPipelineFixture(selectedFixture, { playbackSpeed: 100, executionMode: "realtime" });
          const semantic = JSON.stringify([summary.finalSemanticHashSha256, summary.stockHashSha256, summary.toolPositionMm, summary.diagnosticCodes]);
          if (repetitions === 0) firstSemantic = semantic;
          else deterministic &&= firstSemantic === semantic;
          repetitions += 1;
          const state = pipeline.getPipelineState();
          maximumMainHandlerMs = Math.max(maximumMainHandlerMs, state.metrics.maximumMainHandlerMs);
          maximumLongTasksPerRun = Math.max(maximumLongTasksPerRun, state.longTasksOver50Ms);
        } while (performance.now() - start < durationMs);
      } finally { active = false; cancelAnimationFrame(raf); }
      const elapsedMs = performance.now() - start;
      const final = scene.getDiagnostics();
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="machine-canvas"]')!;
      return {
        timestamps, elapsedMs, framesRendered: final.telemetry.framesRendered - baseline.telemetry.framesRendered,
        repetitions, deterministic, maximumMainHandlerMs, maximumLongTasksPerRun,
        reactCommitDelta: scene.getReactCommitCount() - commits,
        actualBackend: final.status.backend.mode,
        crossOriginIsolated,
        canvas: { width: canvas.width, height: canvas.height, devicePixelRatio },
        jsHeapUsedBytes: memory?.usedJSHeapSize ?? null,
        resourcesBefore: baseline.telemetry.resources, resourcesAfter: final.telemetry.resources,
        stock: final.stockSurface ?? final.rotationalStockSurface,
        semantic: {
          completed: summary!.completed,
          totalSteps: summary!.totalSteps,
          finalSemanticHashSha256: summary!.finalSemanticHashSha256,
          stockHashSha256: summary!.stockHashSha256,
          toolPositionMm: summary!.toolPositionMm,
          diagnosticCodes: summary!.diagnosticCodes,
          removedVolumeMm3: summary!.removedVolumeMm3,
        },
      };
    }, { selectedFixture: fixture as M7PipelineFixture, durationMs: BENCHMARK_WINDOW_MS });
    const { timestamps, ...measurement } = result;
    const sample = {
      ...measurement,
      pageErrorCount: errors.length,
      frames: frameStatistics(timestamps, result.framesRendered, result.elapsedMs),
      browserVersion: browser.version(),
      viewport: testInfo.project.use.viewport,
      headless: true,
      gpuAdapterProbe: adapter,
      gpuClass: classifyGpu(Boolean(testInfo.project.metadata.softwareRequested), adapter),
      shellReadyMs,
      loadScope: "fresh-context-localhost-no-network-throttling",
      workload: "balanced-representative-plus-continuous-camera",
      workloadVersion: 1,
      seed: 7,
      cameraDegreesPerSecond: 15,
      windowMinimumMs: BENCHMARK_WINDOW_MS,
      warmup: "one-fast-forward-fixture",
      playbackSpeed: 100,
    };
    await testInfo.attach("reference-benchmark", { body: JSON.stringify(sample), contentType: "application/json" });
    expect(errors).toEqual([]);
    expect(result.actualBackend).toBe(backend);
    expect(result.semantic.completed).toBe(true);
    expect(result.semantic.removedVolumeMm3).toBeGreaterThan(0);
    expect(result.semantic.stockHashSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.deterministic).toBe(true);
    expect(result.reactCommitDelta).toBe(0);
    expect(result.maximumMainHandlerMs).toBeLessThan(50);
    expect(result.maximumLongTasksPerRun).toBeLessThanOrEqual(1);
  });
}

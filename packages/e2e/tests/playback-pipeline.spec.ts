import { expect, test, type Page } from "@playwright/test";

async function openM7Pipeline(
  page: Page,
  projectName: string,
) {
  test.skip(projectName === "visual", "M7 is covered by the WebGPU and WebGL 2 projects.");
  const requestedRenderer =
    projectName === "chromium-webgl2" ? "webgl2" : "webgpu";
  await page.goto(`/?renderer=${requestedRenderer}`);
  const viewport = page.getByTestId("machine-viewport");
  await expect(viewport).toHaveAttribute("data-ready", "true");
  await expect(viewport).toHaveAttribute("data-pipeline-state", "idle");
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(window.__CNC_RENDER_M7__)),
    )
    .toBe(true);
  return viewport;
}

test.describe("M7 Worker/WASM playback pipeline", () => {
  test("playback is deterministic from G-code through the milling and turning renderer", async ({
    page,
  }, testInfo) => {
    const viewport = await openM7Pipeline(page, testInfo.project.name);
    const baselineCommits = await page.evaluate(() =>
      window.__CNC_RENDER_M3__?.getReactCommitCount(),
    );

    const realtime = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M7__;
      if (!harness) {
        throw new Error("M7 browser harness is unavailable.");
      }
      const summary = await harness.runPipelineFixture("milling", {
        playbackSpeed: 100,
        executionMode: "realtime",
      });
      return { summary, state: harness.getPipelineState() };
    });
    expect(realtime.summary.completed).toBe(true);
    expect(realtime.summary.processType).toBe("milling");
    expect(realtime.summary.removedVolumeMm3).toBeGreaterThan(0);
    expect(realtime.summary.finalSemanticHashSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(realtime.state.renderedOnFrame).toBeGreaterThan(
      realtime.state.baselineRenderFrame ?? 0,
    );
    expect(realtime.state.playbackElapsedS).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(realtime.state.playbackElapsedS)).toBe(true);
    expect(
      Number(
        await viewport.getAttribute("data-pipeline-playback-elapsed-s"),
      ),
    ).toBeCloseTo(realtime.state.playbackElapsedS, 3);

    const outsidePlayback = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M7__;
      if (!harness) {
        throw new Error("M7 browser harness is unavailable.");
      }
      const before = harness.getPipelineState().longTasksOver50Ms;
      for (let iteration = 0; iteration < 2; iteration += 1) {
        let spinCount = 0;
        const startedAt = performance.now();
        while (performance.now() - startedAt <= 60) {
          spinCount += 1;
        }
        if (spinCount === 0) {
          throw new Error("Idle long-task fixture did not execute.");
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      return {
        before,
        after: harness.getPipelineState().longTasksOver50Ms,
      };
    });
    expect(outsidePlayback.after).toBe(outsidePlayback.before);

    const fastForward = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M7__;
      if (!harness) {
        throw new Error("M7 browser harness is unavailable.");
      }
      const summary = await harness.runPipelineFixture("milling", {
        playbackSpeed: 100,
        executionMode: "fast-forward",
      });
      return { summary, state: harness.getPipelineState() };
    });
    expect(fastForward.summary.finalSemanticHashSha256).toBe(
      realtime.summary.finalSemanticHashSha256,
    );
    expect(fastForward.summary.stockHashSha256).toBe(
      realtime.summary.stockHashSha256,
    );
    expect(fastForward.summary.toolPositionMm).toEqual(
      realtime.summary.toolPositionMm,
    );

    const turning = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M7__;
      if (!harness) {
        throw new Error("M7 browser harness is unavailable.");
      }
      const summary = await harness.runPipelineFixture("turning", {
        playbackSpeed: 100,
        executionMode: "fast-forward",
      });
      return { summary, state: harness.getPipelineState() };
    });
    expect(turning.summary.completed).toBe(true);
    expect(turning.summary.processType).toBe("turning");
    expect(turning.summary.removedVolumeMm3).toBeGreaterThan(0);
    expect(turning.state.renderedOnFrame).toBeGreaterThan(
      turning.state.baselineRenderFrame ?? 0,
    );
    expect(turning.state.metrics.maximumMainHandlerMs).toBeLessThan(50);
    expect(turning.state.longTasksOver50Ms).toBeLessThanOrEqual(1);
    expect(turning.state.metrics.generalUiSamples).toBeLessThanOrEqual(
      turning.state.metrics.workerMessages,
    );
    expect(turning.state.metrics.axisUiSamples).toBeLessThanOrEqual(
      turning.state.metrics.workerMessages,
    );
    expect(await page.evaluate(() =>
      window.__CNC_RENDER_M3__?.getReactCommitCount(),
    )).toBe(baselineCommits);
    await expect(viewport).toHaveAttribute("data-pipeline-wasm", "true");
    await expect(viewport).toHaveAttribute("data-pipeline-worker", "dedicated");
  });

  test("pause freezes stock, axes, diagnostics, and logical time until playback resumes", async ({
    page,
  }, testInfo) => {
    await openM7Pipeline(page, testInfo.project.name);
    const frozen = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M7__;
      if (!harness) {
        throw new Error("M7 browser harness is unavailable.");
      }
      await harness.startPipelineFixture("milling", {
        playbackSpeed: 0.1,
        executionMode: "realtime",
      });
      const first = await harness.pausePipeline();
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      const second = await harness.pausePipeline();
      harness.resumePipeline(100);
      return { first, second };
    });

    expect(frozen.second.stateSemanticHashSha256).toBe(
      frozen.first.stateSemanticHashSha256,
    );
    expect(frozen.second.stockHashSha256).toBe(frozen.first.stockHashSha256);
    expect(frozen.second.stockRevision).toBe(frozen.first.stockRevision);
    expect(frozen.second.toolPositionMm).toEqual(frozen.first.toolPositionMm);
    expect(frozen.second.diagnosticCodes).toEqual(frozen.first.diagnosticCodes);
    expect(frozen.second.logicalTimeS).toBe(frozen.first.logicalTimeS);

    await expect
      .poll(() =>
        page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().status),
      )
      .toBe("completed");
  });

  test("cancel and Worker restart prevent a superseded run from updating the renderer", async ({
    page,
  }, testInfo) => {
    await openM7Pipeline(page, testInfo.project.name);
    const result = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M7__;
      if (!harness) {
        throw new Error("M7 browser harness is unavailable.");
      }
      const first = await harness.startPipelineFixture("milling", {
        playbackSpeed: 0.1,
        executionMode: "realtime",
      });
      await harness.cancelPipeline();
      const cancelled = harness.getPipelineState();
      await harness.restartPipelineWorker();
      const terminal = await harness.runPipelineFixture("turning", {
        playbackSpeed: 100,
        executionMode: "fast-forward",
      });
      return { first, cancelled, terminal, final: harness.getPipelineState() };
    });

    expect(result.cancelled.status).toBe("cancelled");
    expect(result.cancelled.activeRunId).toBeNull();
    expect(result.terminal.runId).not.toBe(result.first.runId);
    expect(result.terminal.fixtureId).toBe("m7-turning");
    expect(result.terminal.completed).toBe(true);
    expect(result.final.status).toBe("completed");
    expect(result.final.summary?.runId).toBe(result.terminal.runId);
  });

  test("collision-stop terminates the Worker pipeline and marks the renderer frame", async ({
    page,
  }, testInfo) => {
    const viewport = await openM7Pipeline(page, testInfo.project.name);
    const result = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M7__;
      if (!harness) {
        throw new Error("M7 browser harness is unavailable.");
      }
      const terminal = await harness.runPipelineFixture("collision-stop", {
        playbackSpeed: 100,
        executionMode: "realtime",
      });
      return { terminal, state: harness.getPipelineState() };
    });

    expect(result.terminal.stopped).toBe(true);
    expect(result.terminal.completed).toBe(false);
    expect(result.terminal.collision).toMatchObject({
      code: "collision.tool.fixture",
      sourceLine: 5,
    });
    expect(result.terminal.currentStep).toBeLessThan(result.terminal.totalSteps);
    expect(result.state.renderedOnFrame).toBeGreaterThan(
      result.state.baselineRenderFrame ?? 0,
    );
    await expect(viewport).toHaveAttribute("data-pipeline-state", "stopped");
  });
});

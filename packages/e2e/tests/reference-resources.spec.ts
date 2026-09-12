import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { attributedMemory, emptyBrowserBaseline } from "../../../scripts/memory-contract.mjs";
import { BENCHMARK_VIEWPORT } from "../../../scripts/benchmark-contract.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const execute = promisify(execFile);
for (const qualityPreset of ["balanced", "precision"] as const) {
  test(`app-attributed memory ${qualityPreset}`, async ({ playwright }, testInfo) => {
    if (process.platform !== "win32") throw new Error("Reference memory gate requires the approved Windows host");
    // Playwright's default worker-scoped browser would retain the preceding
    // quality's app/driver caches and incorrectly subtract them as fixed cost.
    const browser = await playwright.chromium.launch({ channel: testInfo.project.metadata.browser as string, headless: true });
    try {
    const context = await browser.newContext({ viewport: BENCHMARK_VIEWPORT, deviceScaleFactor: 1, locale: "ko-KR", colorScheme: "light", serviceWorkers: "block" });
    const page = await context.newPage();
    const backend = testInfo.project.metadata.backend as string;
    const cdp = await browser.newBrowserCDPSession();
    const output = resolve(root, `artifacts/app-memory-${testInfo.project.name}-${qualityPreset}.json`);
    await mkdir(resolve(root, "artifacts"), { recursive: true });
    await writeFile(output, JSON.stringify({ reportVersion: 3, status: "incomplete", qualityPreset, backend }));
    const measure = async () => {
      const info = await cdp.send("SystemInfo.getProcessInfo");
      const ids = info.processInfo.map((item) => item.id);
      if (!ids.every((id) => Number.isSafeInteger(id) && id > 0)) throw new Error("Invalid CDP process IDs");
      const { stdout } = await execute("powershell.exe", ["-NoProfile", "-File", resolve(root, "scripts/measure-browser-memory.ps1"), "-ProcessIds", ids.join(",")], { windowsHide: true, timeout: 15_000 });
      return JSON.parse(stdout);
    };
    const blankSamples = [];
    for (let index = 0; index < 3; index++) blankSamples.push(await measure());
    // Measure native browser/driver startup without loading CNC code or assets.
    // Dispose the 1x1 probe before sampling: no application allocations excluded.
    await page.route("**/memory-baseline", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><title>GPU baseline</title><link rel="icon" href="data:,">' }));
    await page.goto("http://127.0.0.1:43175/memory-baseline");
    await page.evaluate(async (backend) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      if (backend === "webgpu") {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!adapter) throw new Error("Baseline GPU adapter unavailable");
        const device = await adapter.requestDevice();
        const context = canvas.getContext("webgpu")!;
        context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat() });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }] });
        pass.end();
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        context.unconfigure();
        device.destroy();
      } else {
        const context = canvas.getContext("webgl2", { powerPreference: "high-performance" });
        if (!context) throw new Error("Baseline WebGL unavailable");
        context.clear(context.COLOR_BUFFER_BIT);
        context.finish();
        context.getExtension("WEBGL_lose_context")?.loseContext();
      }
    }, backend);
    const baselineResources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
    expect(baselineResources).toEqual([]);
    expect(await page.evaluate(() => Boolean(window.__CNC_RENDER_M7__))).toBe(false);
    await page.goto("about:blank");
    const emptySamples = [];
    for (let index = 0; index < 3; index++) emptySamples.push(await measure());
    const baseline = emptyBrowserBaseline(emptySamples);
    const samples: Array<{ conservativeObservedBytes: number; attributedBytes: number; privateDeltaBytes: number; gpuDeltaBytes: number }> = [];
    const errors: string[] = [];
    page.on("pageerror", () => errors.push("pageerror"));
    await page.goto(`./?renderer=${backend}`);
    await expect(page.getByTestId("machine-viewport")).toHaveAttribute("data-renderer-mode", backend);
    await page.waitForFunction(() => Boolean(window.__CNC_RENDER_M7__));
    const started = Date.now();
    let active = true;
    let samplingError: unknown;
    const sampling = (async () => {
      while (active) {
        const sample = await measure();
        samples.push({ ...sample, ...attributedMemory(sample, baseline) });
        if (active) await new Promise((done) => setTimeout(done, 1000));
      }
    })().catch((error: unknown) => { samplingError = error; active = false; });
    let repetitions = 0;
    try {
      do {
        for (const fixture of ["milling", "turning", "drilling"] as const) {
          const result = await page.evaluate(async ({ fixture, qualityPreset }) => {
            const pipeline = window.__CNC_RENDER_M7__!;
            const summary = await pipeline.runPipelineFixture(fixture, { qualityPreset, playbackSpeed: 100, executionMode: "realtime" });
            const state = window.__CNC_RENDER_M3__!.getDiagnostics();
            return { completed: summary.completed, cells: (state.stockSurface ?? state.rotationalStockSurface)?.cells };
          }, { fixture, qualityPreset });
          expect(result.completed).toBe(true);
          expect(result.cells).toBe(fixture === "milling" ? qualityPreset === "precision" ? 4500 : 1125 : qualityPreset === "precision" ? 240 : 120);
        }
        repetitions++;
      } while (active && Date.now() - started < 60_000);
    } finally { active = false; await sampling; }
    if (samplingError) throw samplingError;
    const limit = qualityPreset === "balanced" ? 600_000_000 : 1_500_000_000;
    const peak = Math.max(...samples.map((sample) => sample.attributedBytes));
    const report = {
      reportVersion: 3, qualityPreset, backend, browserVersion: browser.version(), freshBrowserPerCase: true, baselineResources,
      coldBlankBrowserSamples: blankSamples, emptyGpuInitializedBrowserSamples: emptySamples, baseline,
      artifact: JSON.parse(await readFile(resolve(root, "dist/pages/release.json"), "utf8")),
      scope: "app-attributed-all-CDP-processes-including-Worker-WASM-and-GPU-minus-blank-browser",
      method: "positive delta of summed private committed bytes plus positive delta of WDDM dedicated/shared GPU; baseline minima of three blank samples after disposing a vanilla 1x1 GPU context; cold blank samples also retained; no CNC code or assets in baseline",
      limitations: "Sampled observed maximum, not allocation tracing. WDDM counters can over-report; unavailable counters fail closed. No unrelated user browser processes included.",
      durationMs: Date.now() - started, repetitions, samples, observedPeakBytes: peak, limitBytes: limit,
      status: samples.length >= 10 && peak <= limit && errors.length === 0 ? "pass" : "fail",
    };
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    expect(errors).toEqual([]);
    expect(samples.length).toBeGreaterThanOrEqual(10);
    expect(peak).toBeLessThanOrEqual(limit);
    } finally { await browser.close(); }
  });
}

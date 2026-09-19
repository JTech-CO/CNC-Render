import { expect, test, type Page, type TestInfo } from "@playwright/test";

const viewportSelector = '[data-testid="machine-viewport"]';

async function openViewport(page: Page, testInfo: TestInfo) {
  const requestedRenderer =
    testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu";
  await page.goto(`/?renderer=${requestedRenderer}`);
  const viewport = page.locator(viewportSelector);
  await expect(viewport).toHaveAttribute("data-ready", "true");
  return viewport;
}

test.describe("viewport renderer shell", () => {
  test("viewport exposes its selected backend and documented limits", async ({
    page,
  }, testInfo) => {
    const viewport = await openViewport(page, testInfo);
    const rendererMode = await viewport.getAttribute("data-renderer-mode");
    const webgpuAdvertised = await page.evaluate(
      () => "gpu" in navigator && Boolean(navigator.gpu),
    );

    if (testInfo.project.name === "chromium-webgl2") {
      expect(rendererMode).toBe("webgl2");
    } else if (webgpuAdvertised) {
      expect(rendererMode).toBe("webgpu");
    } else {
      expect(rendererMode).toBe("webgl2");
    }

    await expect(page.locator(".viewport-mode > span")).toHaveText(
      rendererMode === "webgpu" ? "WebGPU" : "WebGL 2",
    );
    await expect(page.locator(".limit-list li")).toHaveCount(4);
    await expect(page.locator(".accuracy-badge")).toHaveText("E2");
  });

  test("viewport keeps six semantic layers independently controllable", async ({
    page,
  }, testInfo) => {
    const viewport = await openViewport(page, testInfo);
    const layers = page.locator(".layer-row");
    await expect(layers).toHaveCount(6);

    const canvas = page.getByTestId("machine-canvas");
    await expect.poll(async () => Number(await viewport.getAttribute("data-render-frames"))).toBeGreaterThan(0);
    const before = await canvas.screenshot();
    await testInfo.attach("stock-visible", { body: before, contentType: "image/png" });
    const beforeFrame = Number(await viewport.getAttribute("data-render-frames"));
    const stockToggle = page.locator('[data-layer-id="stock"] input');
    await stockToggle.uncheck();
    await expect(stockToggle).not.toBeChecked();
    await expect.poll(async () => Number(await viewport.getAttribute("data-render-frames"))).toBeGreaterThan(beforeFrame);
    // GPU submission and compositor presentation need not finish together.
    // Keep the actual pixel-change gate; a blank canvas must still fail.
    await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
    await testInfo.attach("stock-hidden", { body: await canvas.screenshot(), contentType: "image/png" });
  });

  test("viewport camera presets, fit, orbit, pan and zoom stay in range", async ({
    page,
  }, testInfo) => {
    const viewport = await openViewport(page, testInfo);

    for (const view of ["front", "top", "right", "isometric"]) {
      await page.locator(`[data-view="${view}"]`).click();
      await expect(viewport).toHaveAttribute("data-camera-view", view);
    }

    await page.getByTestId("machine-canvas").press("1");
    await expect(viewport).toHaveAttribute("data-camera-view", "front");
    await page.getByTestId("machine-canvas").press("f");
    await expect(viewport).toHaveAttribute("data-camera-view", "custom");

    const diagnostics = await page.evaluate(() => {
      const harness = window.__CNC_RENDER_M3__;
      if (!harness) {
        throw new Error("M3 browser harness is unavailable.");
      }
      harness.orbit(12, -4);
      harness.pan(16, -8);
      harness.zoom(0.85);
      return harness.getDiagnostics();
    });

    expect(diagnostics.camera.distanceMm).toBeGreaterThanOrEqual(180);
    expect(diagnostics.camera.distanceMm).toBeLessThanOrEqual(5_000);
    expect(diagnostics.camera.positionMm.every(Number.isFinite)).toBe(true);
    expect(diagnostics.camera.targetMm.every(Number.isFinite)).toBe(true);
  });

  test("viewport render invalidation does not commit React per frame", async ({
    page,
  }, testInfo) => {
    const viewport = await openViewport(page, testInfo);
    const baseline = await page.evaluate(() => {
      const harness = window.__CNC_RENDER_M3__;
      if (!harness) {
        throw new Error("M3 browser harness is unavailable.");
      }
      return {
        commits: harness.getReactCommitCount(),
        diagnostics: harness.getDiagnostics(),
      };
    });

    // Demand rendering coalesces synchronous invalidations. Exercise ten actual
    // completed frames, retaining all 200 camera changes and the zero-commit gate.
    for (let batch = 0; batch < 10; batch += 1) {
     const beforeFrame = Number(await viewport.getAttribute("data-render-frames"));
     await page.evaluate(() => {
      const harness = window.__CNC_RENDER_M3__;
      if (!harness) {
        throw new Error("M3 browser harness is unavailable.");
      }
      for (let index = 0; index < 20; index += 1) {
        harness.orbit(0.25, index % 2 === 0 ? 0.05 : -0.05);
      }
     });
     await expect
      .poll(async () =>
        Number(await viewport.getAttribute("data-render-frames")),
      )
      .toBeGreaterThan(beforeFrame);
    }

    const current = await page.evaluate(() => {
      const harness = window.__CNC_RENDER_M3__;
      if (!harness) {
        throw new Error("M3 browser harness is unavailable.");
      }
      return {
        commits: harness.getReactCommitCount(),
        diagnostics: harness.getDiagnostics(),
      };
    });

    expect(current.commits).toBe(baseline.commits);
    expect(current.diagnostics.telemetry.resources).toEqual(
      baseline.diagnostics.telemetry.resources,
    );
    expect(current.diagnostics.telemetry.framesRendered).toBeGreaterThan(
      current.commits,
    );
  });
});

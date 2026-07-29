import { expect, test } from "@playwright/test";

const soakPhaseMs = Number(process.env.CNC_RENDER_SOAK_PHASE_MS ?? "0");

test("viewport resource stability across idle and camera soak", async ({
  page,
}, testInfo) => {
  test.skip(
    !Number.isFinite(soakPhaseMs) || soakPhaseMs <= 0,
    "Set CNC_RENDER_SOAK_PHASE_MS=600000 for the M3 10+10 minute soak.",
  );
  test.setTimeout(soakPhaseMs * 2 + 120_000);

  const requestedRenderer =
    testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu";
  await page.goto(`/?renderer=${requestedRenderer}`);
  const viewport = page.getByTestId("machine-viewport");
  await expect(viewport).toHaveAttribute("data-ready", "true");
  await page.waitForTimeout(1_000);

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

  await page.waitForTimeout(soakPhaseMs);
  const afterIdle = await page.evaluate(() => {
    const harness = window.__CNC_RENDER_M3__;
    if (!harness) {
      throw new Error("M3 browser harness is unavailable.");
    }
    return harness.getDiagnostics();
  });

  const cameraDeadline = Date.now() + soakPhaseMs;
  while (Date.now() < cameraDeadline) {
    await page.evaluate(() => {
      const harness = window.__CNC_RENDER_M3__;
      if (!harness) {
        throw new Error("M3 browser harness is unavailable.");
      }
      harness.orbit(0.2, 0.05);
      harness.pan(0.1, -0.05);
      harness.zoom(1.0001);
    });
    await page.waitForTimeout(100);
  }

  const afterCamera = await page.evaluate(() => {
    const harness = window.__CNC_RENDER_M3__;
    if (!harness) {
      throw new Error("M3 browser harness is unavailable.");
    }
    return {
      commits: harness.getReactCommitCount(),
      diagnostics: harness.getDiagnostics(),
    };
  });

  expect(afterIdle.telemetry.resources).toEqual(
    baseline.diagnostics.telemetry.resources,
  );
  expect(afterCamera.diagnostics.telemetry.resources).toEqual(
    baseline.diagnostics.telemetry.resources,
  );
  expect(afterCamera.commits).toBe(baseline.commits);
  expect(afterCamera.diagnostics.telemetry.framesRendered).toBeGreaterThan(
    baseline.diagnostics.telemetry.framesRendered,
  );
});

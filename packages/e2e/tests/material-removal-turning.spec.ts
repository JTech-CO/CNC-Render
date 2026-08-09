import { expect, test } from "@playwright/test";

const operations = ["facing", "od-turning", "taper"] as const;

test.describe("M6 turning material removal frame contract", () => {
  for (const operation of operations) {
    test(`${operation} applies dirty rotational Stock ranges without a React frame loop`, async ({
      page,
    }, testInfo) => {
      const requestedRenderer =
        testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu";
      await page.goto(`/?renderer=${requestedRenderer}`);
      const viewport = page.getByTestId("machine-viewport");
      await expect(viewport).toHaveAttribute("data-ready", "true");
      await expect(viewport).toHaveAttribute("data-turning-state", "idle");

      const baseline = await page.evaluate(() => {
        const harness = window.__CNC_RENDER_M6__;
        if (!harness) {
          throw new Error("M6 browser harness is unavailable.");
        }
        return {
          frames: harness.getDiagnostics().telemetry.framesRendered,
          commits: harness.getReactCommitCount(),
        };
      });
      const run = await page.evaluate(async (requestedOperation) => {
        const harness = window.__CNC_RENDER_M6__;
        if (!harness) {
          throw new Error("M6 browser harness is unavailable.");
        }
        return harness.runTurningFixture(requestedOperation);
      }, operation);

      expect(run.operation).toBe(operation);
      expect(run.profileHashSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(run.removedVolumeMm3).toBeGreaterThan(0);
      expect(run.engineDiagnostics).toMatchObject({
        representation: "lathe-radius-field",
        preset: "balanced",
        dirtyCells: 0,
        fullSurfaceExtractions: 1,
        partialSurfaceExtractions: 1,
      });
      expect(run.engineDiagnostics.allocatedBytes).toBeLessThanOrEqual(
        run.engineDiagnostics.memoryCapBytes,
      );
      expect(run.rendererDiagnostics).toMatchObject({
        revision: run.engineDiagnostics.revision,
        fullBufferUploads: 1,
        partialBufferUpdates: 1,
        radialSegments: 24,
      });
      expect(run.rendererDiagnostics.lastUpdatedCells).toBeGreaterThan(0);
      expect(run.rendererDiagnostics.activeUpdateRanges).toBeGreaterThan(0);

      await expect(viewport).toHaveAttribute("data-turning-state", "rendered");
      await expect(viewport).toHaveAttribute("data-turning-operation", operation);
      await expect(viewport).toHaveAttribute(
        "data-turning-profile-hash",
        run.profileHashSha256,
      );
      const renderedFrame = Number(
        await viewport.getAttribute("data-turning-rendered-frame"),
      );
      expect(renderedFrame).toBeGreaterThan(baseline.frames);

      const completed = await page.evaluate(() => {
        const harness = window.__CNC_RENDER_M6__;
        if (!harness) {
          throw new Error("M6 browser harness is unavailable.");
        }
        return {
          state: harness.getTurningState(),
          diagnostics: harness.getDiagnostics(),
          commits: harness.getReactCommitCount(),
        };
      });
      expect(completed.state?.renderedOnFrame).toBe(renderedFrame);
      expect(completed.state?.profileHashSha256).toBe(run.profileHashSha256);
      expect(completed.diagnostics.rotationalStockSurface).toMatchObject({
        fullBufferUploads: 1,
        partialBufferUpdates: 1,
      });
      expect(completed.commits).toBe(baseline.commits);
    });
  }
});

import { expect, test } from "@playwright/test";

const operations = ["face-milling", "slot", "pocket"] as const;

test.describe("M5 material removal milling frame contract", () => {
  for (const operation of operations) {
    test(`${operation} applies dirty Stock ranges without a React frame loop`, async ({
      page,
    }, testInfo) => {
      const requestedRenderer =
        testInfo.project.name === "chromium-webgl2"
          ? "webgl2"
          : "webgpu";
      await page.goto(`/?renderer=${requestedRenderer}`);
      const viewport = page.getByTestId("machine-viewport");
      await expect(viewport).toHaveAttribute("data-ready", "true");
      await expect(viewport).toHaveAttribute("data-milling-state", "idle");

      const baseline = await page.evaluate(() => {
        const harness = window.__CNC_RENDER_M5__;
        if (!harness) {
          throw new Error("M5 browser harness is unavailable.");
        }
        return {
          frames: harness.getDiagnostics().telemetry.framesRendered,
          commits: harness.getReactCommitCount(),
        };
      });
      const run = await page.evaluate(async (requestedOperation) => {
        const harness = window.__CNC_RENDER_M5__;
        if (!harness) {
          throw new Error("M5 browser harness is unavailable.");
        }
        return harness.runMillingFixture(requestedOperation);
      }, operation);

      expect(run.operation).toBe(operation);
      expect(run.stockHashSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(run.removedVolumeMm3).toBeGreaterThan(0);
      expect(run.engineDiagnostics).toMatchObject({
        representation: "sparse-z-multi-dexel",
        preset: "balanced",
        dirtyBricks: 0,
        dirtyDexels: 0,
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
      });
      expect(run.rendererDiagnostics.lastUpdatedCells).toBeGreaterThan(0);
      expect(run.rendererDiagnostics.activeUpdateRanges).toBeGreaterThan(0);

      await expect(viewport).toHaveAttribute("data-milling-state", "rendered");
      await expect(viewport).toHaveAttribute(
        "data-milling-operation",
        operation,
      );
      await expect(viewport).toHaveAttribute(
        "data-milling-stock-hash",
        run.stockHashSha256,
      );
      const renderedFrame = Number(
        await viewport.getAttribute("data-milling-rendered-frame"),
      );
      expect(renderedFrame).toBeGreaterThan(baseline.frames);

      const completed = await page.evaluate(() => {
        const harness = window.__CNC_RENDER_M5__;
        if (!harness) {
          throw new Error("M5 browser harness is unavailable.");
        }
        return {
          state: harness.getMillingState(),
          diagnostics: harness.getDiagnostics(),
          commits: harness.getReactCommitCount(),
        };
      });
      expect(completed.state?.renderedOnFrame).toBe(renderedFrame);
      expect(completed.state?.stockHashSha256).toBe(run.stockHashSha256);
      expect(completed.diagnostics.stockSurface).toMatchObject({
        fullBufferUploads: 1,
        partialBufferUpdates: 1,
      });
      expect(completed.commits).toBe(baseline.commits);
    });
  }
});

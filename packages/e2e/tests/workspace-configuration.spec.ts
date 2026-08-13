import { expect, test, type Page } from "@playwright/test";

async function openWorkspace(page: Page, projectName: string) {
  test.skip(
    projectName === "visual",
    "Interactive Stock configuration is covered by WebGPU and WebGL 2.",
  );
  const renderer = projectName === "chromium-webgl2" ? "webgl2" : "webgpu";
  await page.goto(`/?renderer=${renderer}`);
  const viewport = page.getByTestId("machine-viewport");
  await expect(viewport).toHaveAttribute("data-ready", "true");
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__CNC_RENDER_M7__)))
    .toBe(true);
  return viewport;
}

test.describe("workspace milling configuration", () => {
  test("replaces Stock and runs the selected X/Y raster direction", async ({
    page,
  }, testInfo) => {
    const viewport = await openWorkspace(page, testInfo.project.name);
    const fixture = page.getByTestId("pipeline-fixture");
    const stock = page.getByTestId("pipeline-stock-preset");
    const direction = page.getByTestId("pipeline-cut-direction");

    await fixture.selectOption("turning");
    await expect(stock).toBeDisabled();
    await expect(direction).toBeDisabled();
    await fixture.selectOption("milling");
    await expect(stock).toBeEnabled();
    await expect(direction).toBeEnabled();

    await stock.selectOption("compact");
    await direction.selectOption("y");
    await page.getByTestId("pipeline-play").click();
    await expect
      .poll(() =>
        page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().status),
      )
      .toBe("completed");

    const compact = await page.evaluate(() => ({
      state: window.__CNC_RENDER_M7__?.getPipelineState(),
      renderer: window.__CNC_RENDER_M3__?.getDiagnostics(),
      cutDirection: document.querySelector<HTMLElement>(
        '[data-testid="machine-viewport"]',
      )?.dataset.pipelineCutDirection,
      stockPreset: document.querySelector<HTMLElement>(
        '[data-testid="machine-viewport"]',
      )?.dataset.pipelineStockPreset,
    }));
    expect(compact.state?.millingConfiguration).toEqual({
      stockPreset: "compact",
      cutDirection: "y",
    });
    expect(compact.state?.summary?.toolPositionMm).toEqual({
      xMm: 130,
      yMm: 60,
      zMm: 354,
    });
    expect(compact.state?.summary?.removedVolumeMm3).toBeGreaterThan(0);
    expect(compact.renderer?.stockSurface?.cells).toBe(700);
    expect(compact.stockPreset).toBe("compact");
    expect(compact.cutDirection).toBe("y");

    const saved = await page.evaluate(async () => {
      const persistence = window.__CNC_RENDER_M8__;
      if (!persistence) {
        throw new Error("M8 browser harness is unavailable.");
      }
      return persistence.saveFixture("milling", {
        stockPreset: "compact",
        cutDirection: "y",
      });
    });
    expect(saved.componentHashes.gcodeSha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(viewport).toHaveAttribute("data-persistence-state", "saved");
    const savedConfiguration = await page.evaluate(() => ({
      configuration:
        window.__CNC_RENDER_M7__?.getPipelineState().millingConfiguration,
      cells: window.__CNC_RENDER_M3__?.getDiagnostics().stockSurface?.cells,
    }));
    expect(savedConfiguration.configuration).toEqual({
      stockPreset: "compact",
      cutDirection: "y",
    });
    expect(savedConfiguration.cells).toBe(700);

    const compactRunId = await page.evaluate(
      () => window.__CNC_RENDER_M7__?.getPipelineState().summary?.runId,
    );
    const compactHash = compact.state?.summary?.stockHashSha256;
    await stock.selectOption("standard");
    await direction.selectOption("x");
    await page.getByTestId("pipeline-play").click();
    await expect
      .poll(() =>
        page.evaluate(
          (previousRunId) => {
            const state = window.__CNC_RENDER_M7__?.getPipelineState();
            return state?.status === "completed" &&
              state.summary?.runId !== previousRunId
              ? state.summary?.runId
              : null;
          },
          compactRunId,
        ),
      )
      .not.toBeNull();

    const standard = await page.evaluate(() => ({
      state: window.__CNC_RENDER_M7__?.getPipelineState(),
      renderer: window.__CNC_RENDER_M3__?.getDiagnostics(),
    }));
    expect(standard.state?.millingConfiguration).toEqual({
      stockPreset: "standard",
      cutDirection: "x",
    });
    expect(standard.state?.summary?.toolPositionMm).toEqual({
      xMm: 170,
      yMm: 80,
      zMm: 370,
    });
    expect(standard.renderer?.stockSurface?.cells).toBe(1_125);
    expect(standard.state?.summary?.stockHashSha256).not.toBe(compactHash);
    await expect(viewport).toHaveAttribute("data-pipeline-stock-preset", "standard");
    await expect(viewport).toHaveAttribute("data-pipeline-cut-direction", "x");
  });
});

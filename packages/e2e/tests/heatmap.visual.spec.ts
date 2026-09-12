import { expect, test } from "@playwright/test";

test("heatmap visual baseline shows actual overcut and undercut against authored target", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "visual", "Dedicated deterministic WebGL 2 visual project.");
  await page.goto("/?renderer=webgl2");
  await expect(page.getByTestId("machine-viewport")).toHaveAttribute("data-ready", "true");
  await page.evaluate(async () => {
    if (!window.__CNC_RENDER_M7__) throw new Error("M7 not ready");
    await window.__CNC_RENDER_M7__.runPipelineFixture("milling", { executionMode: "fast-forward", playbackSpeed: 100,
      source: "G21 G90\nG0 X-170 Y-80 Z370\nG1 Z330 F1200\nG1 X170 F2400\nG0 Z370\nM30" });
  });
  await page.getByTestId("workspace-area-results").click();
  await page.getByRole("button", { name: "현재 Stock 비교" }).click();
  await expect(page.locator('[data-result-key="overcutVolumeMm3"]')).toBeVisible();
  expect(Number(await page.locator('[data-result-key="overcutVolumeMm3"]').getAttribute("data-canonical-value"))).toBeGreaterThan(0);
  expect(Number(await page.locator('[data-result-key="undercutVolumeMm3"]').getAttribute("data-canonical-value"))).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await page.evaluate(async () => { await document.fonts.ready; if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await expect(page.getByTestId("result-comparison-canvas")).toHaveScreenshot("heatmap.png");
});

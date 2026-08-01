import { expect, test } from "@playwright/test";

test("machine-scene viewport visual regression", async ({ page }) => {
  await page.goto("/?renderer=webgl2");
  const viewport = page.getByTestId("machine-viewport");
  await expect(viewport).toHaveAttribute("data-ready", "true");

  await page.evaluate(() => {
    const harness = window.__CNC_RENDER_M3__;
    if (!harness) {
      throw new Error("M3 browser harness is unavailable.");
    }
    harness.setView("isometric");
    harness.fit();
  });
  await page.waitForTimeout(150);

  await expect(page.getByTestId("machine-canvas")).toHaveScreenshot(
    "machine-scene.png",
  );
});

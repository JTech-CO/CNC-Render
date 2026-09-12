import { expect, test } from "@playwright/test";

test("gcode-error visual baseline distinguishes the parser diagnostic", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "visual",
    "The G-code error baseline runs only in the dedicated WebGL 2 project.",
  );
  await page.goto("/?renderer=webgl2");
  await expect(page.getByTestId("machine-viewport")).toHaveAttribute(
    "data-ready",
    "true",
  );

  await page.getByTestId("workspace-area-code").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__CNC_RENDER_M11__?.getState().editorLoadState ?? null,
      ),
    )
    .toBe("ready");

  const lab = page.getByTestId("gcode-lab");
  await page.getByTestId("gcode-editor").click({ position: { x: 160, y: 30 } });
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("G21 G90\nG41\nM30\n");
  const diagnostic = page.getByTestId("gcode-diagnostic-item");
  await expect(diagnostic).toContainText("오류 · 2행");
  await expect(diagnostic).toContainText("recognized-unsupported");
  await diagnostic.click();
  await expect(diagnostic).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("gcode-editor")).toHaveAttribute(
    "data-focused-line",
    "2",
  );

  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(lab).toHaveScreenshot("gcode-error.png");
});

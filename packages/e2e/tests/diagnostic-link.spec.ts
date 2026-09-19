import { expect, test, type Page } from "@playwright/test";

async function editProgram(page: Page, source: string) {
  await page.getByTestId("gcode-editor").click({ position: { x: 160, y: 30 } });
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(source);
  await expect.poll(() => page.evaluate(() => window.__CNC_RENDER_M11__?.getState())).toMatchObject({ source, editorLoadState: "ready", analysis: { accepted: true } });
}

for (const example of [
  { origin: "axis-limit", fixture: "milling", source: "G21 G90\nG1 X600 Z370 F1200\nM30\n", status: "stopped" },
  { origin: "collision", fixture: "collision-stop", source: "G21 G90\nG0 X-170 Y-80 Z370\nG1 Z338 F1200\nG1 X170 F2400\nG1 Y-40 F1200\nM30\n", status: "stopped" },
  { origin: "machining-warning", fixture: "milling", source: "G21 G90\nG0 Z370\nG1 X0 Y0 F1200\nM30\n", status: "completed" },
] as const) {
  test(`diagnostic-link ${example.origin}: engine source/object/3D marker are bidirectional`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "visual", "Both rendering backends cover navigation.");
    await page.goto(`/?renderer=${testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu"}`);
    await expect(page.getByTestId("machine-viewport")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("pipeline-fixture").selectOption(example.fixture);
    await page.getByTestId("workspace-area-code").click();
    await expect(page.getByTestId("gcode-editor")).toHaveAttribute("data-analysis-state", "ready");
    await editProgram(page, example.source);
    await page.getByTestId("gcode-run").click();
    await expect.poll(() => page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().status)).toBe(example.status);
    const diagnostic = await page.evaluate((origin) => window.__CNC_RENDER_M7__?.getPipelineState().summary?.runtimeDiagnostics?.find((item) => item.origin === origin), example.origin);
    expect(diagnostic?.sourceLine).toBeGreaterThan(0);
    expect(diagnostic?.objectId).not.toBeNull();
    expect(diagnostic?.positionMm).not.toBeNull();
    const id = diagnostic!.id;
    const item = page.locator(`[data-diagnostic-id="${id}"]`);
    await item.getByRole("button").click();
    await expect(page.getByTestId("gcode-editor")).toHaveAttribute("data-focused-line", String(diagnostic!.sourceLine));
    await expect(page.getByTestId("gcode-diagnostic-help")).toContainText(diagnostic!.objectId!);
    await page.getByTestId("gcode-focus-diagnostic").click();
    await expect(page.getByTestId("machine-viewport")).toHaveAttribute("data-camera-view", "custom");
    await page.getByTestId("workspace-area-scene").click();
    await expect(page.getByTestId("workspace-area-scene")).toHaveAttribute("aria-current", "page");
    // Real canvas hit testing, not a harness selection shortcut.
    const screen = await page.evaluate((value) => window.__CNC_RENDER_M3__?.getDiagnosticScreenPosition(value), id);
    expect(screen).not.toBeNull();
    expect(screen![0]).toBeGreaterThan(0);
    expect(screen![1]).toBeGreaterThan(0);
    expect(screen![0]).toBeLessThan(page.viewportSize()!.width);
    expect(screen![1]).toBeLessThan(page.viewportSize()!.height);
    await page.mouse.click(screen![0], screen![1]);
    await expect(page.getByTestId("workspace-area-code")).toHaveAttribute("aria-current", "page");
    await expect(page.locator(`[data-diagnostic-id="${id}"]`)).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("gcode-editor")).toHaveAttribute("data-focused-line", String(diagnostic!.sourceLine));
  });
}

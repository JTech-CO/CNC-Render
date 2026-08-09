import { expect, test } from "@playwright/test";

test("GitHub Pages preserves styled, clickable workspace behavior", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("./?renderer=webgl2");
  const viewport = page.getByTestId("machine-viewport");
  await expect(viewport).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".milestone-label")).toContainText("v0.9.0");

  const deploymentStyles = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const button = getComputedStyle(
      document.querySelector<HTMLElement>(".command-actions .ui-button")!,
    );
    const shell = document.querySelector<HTMLElement>(".application-shell")!;
    return {
      appBackground: root.getPropertyValue("--app-bg").trim(),
      buttonMinHeight: Number.parseFloat(button.minHeight),
      buttonBackground: button.backgroundColor,
      noPageOverflow:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
      shellWidth: shell.getBoundingClientRect().width,
    };
  });
  expect(deploymentStyles).toMatchObject({
    appBackground: "#f4f6f8",
    buttonMinHeight: 32,
    buttonBackground: "rgb(255, 255, 255)",
    noPageOverflow: true,
    shellWidth: 2_048,
  });

  await page.getByTestId("open-help").click();
  await expect(page.getByTestId("help-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("help-dialog")).toBeHidden();

  const workspace = page.locator(".workspace-grid");
  await page.getByTestId("workspace-area-code").click();
  await expect(workspace).toHaveAttribute("data-active-area", "code");
  await page.getByTestId("workspace-area-learn").click();
  await expect(workspace).toHaveAttribute("data-active-area", "learn");
  await page.getByTestId("workspace-area-scene").click();
  await expect(workspace).toHaveAttribute("data-active-area", "scene");

  await page.locator(".command-actions .ui-button--primary").click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().status),
    )
    .toBe("completed");
  expect(
    Number(await viewport.getAttribute("data-pipeline-stock-revision")),
  ).toBeGreaterThan(0);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

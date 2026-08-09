import { expect, test, type Page, type TestInfo } from "@playwright/test";

const resolutions = [
  { width: 1_920, height: 1_080 },
  { width: 1_600, height: 900 },
  { width: 1_440, height: 900 },
  { width: 1_366, height: 768 },
  { width: 1_280, height: 720 },
  { width: 1_024, height: 768 },
  { width: 834, height: 1_194 },
  { width: 768, height: 1_024 },
  { width: 390, height: 844 },
] as const;

async function openWorkspace(page: Page, testInfo: TestInfo) {
  test.skip(
    testInfo.project.name === "visual",
    "M9 behavior is covered by the WebGPU and WebGL 2 projects.",
  );
  const renderer =
    testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu";
  await page.goto(`/?renderer=${renderer}`);
  await expect(page.getByTestId("machine-viewport")).toHaveAttribute(
    "data-ready",
    "true",
  );
}

test.describe("M9 workspace UI", () => {
  test("workspace-layout keeps controls visible at all nine target resolutions", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page, testInfo);

    await page.setViewportSize({ width: 1_440, height: 900 });
    const viewportShare = await page.evaluate(() => {
      const shell = document.querySelector(".viewport-shell")?.getBoundingClientRect();
      const peerSelectors = [".scene-panel", ".viewport-shell", ".inspector-panel"];
      const peers = peerSelectors
        .map((selector) => document.querySelector<HTMLElement>(selector))
        .filter((element): element is HTMLElement =>
          Boolean(element && getComputedStyle(element).display !== "none"),
        );
      if (!shell || peers.length === 0) {
        return 0;
      }
      const topContentArea = peers.reduce((total, element) => {
        const bounds = element.getBoundingClientRect();
        return total + bounds.width * bounds.height;
      }, 0);
      return (shell.width * shell.height) / topContentArea;
    });
    expect(viewportShare).toBeGreaterThanOrEqual(0.6);
    const uiBudget = await page.evaluate(() => {
      const visibleDomNodes = Array.from(
        document.body.querySelectorAll<HTMLElement>("*"),
      ).filter((element) => {
        const style = getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getClientRects().length > 0
        );
      }).length;
      const coreFontSizes = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".simulation-readout dd, .simulation-section select, .viewport-status strong, .command-actions button",
        ),
      ).map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      const commandStyle = getComputedStyle(
        document.querySelector<HTMLElement>(".command-bar")!,
      );
      return {
        colorScheme: rootStyle.colorScheme,
        minimumCoreFontPx: Math.min(...coreFontSizes),
        palette: {
          bodyBackground: bodyStyle.backgroundColor,
          bodyColor: bodyStyle.color,
          commandBackground: commandStyle.backgroundColor,
        },
        visibleDomNodes,
      };
    });
    expect(uiBudget.visibleDomNodes).toBeLessThanOrEqual(2_000);
    expect(uiBudget.minimumCoreFontPx).toBeGreaterThanOrEqual(12);
    expect(uiBudget.colorScheme).toBe("light");

    await page.emulateMedia({ colorScheme: "dark" });
    const darkSystemPalette = await page.evaluate(() => {
      const bodyStyle = getComputedStyle(document.body);
      const commandStyle = getComputedStyle(
        document.querySelector<HTMLElement>(".command-bar")!,
      );
      return {
        bodyBackground: bodyStyle.backgroundColor,
        bodyColor: bodyStyle.color,
        commandBackground: commandStyle.backgroundColor,
      };
    });
    expect(darkSystemPalette).toEqual(uiBudget.palette);

    for (const resolution of resolutions) {
      await page.setViewportSize(resolution);
      await page.waitForTimeout(50);
      const layout = await page.evaluate(() => {
        const visible = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) {
            return false;
          }
          const bounds = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            bounds.width > 0 &&
            bounds.height > 0
          );
        };
        return {
          noPageOverflow:
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
          activityVisible: visible('[data-testid="workspace-area-code"]'),
          playVisible: visible('[data-testid="pipeline-play"]') ||
            visible(".command-actions .ui-button--primary"),
          helpVisible: visible('[data-testid="open-help"]'),
          panelCollapsePolicy:
            (document.querySelector(".viewport-shell")?.getBoundingClientRect().width ?? 0) >= 720 ||
            !visible(".scene-panel") ||
            !visible(".inspector-panel"),
        };
      });
      expect(layout, JSON.stringify(resolution)).toEqual({
        noPageOverflow: true,
        activityVisible: true,
        playVisible: true,
        helpVisible: true,
        panelCollapsePolicy: true,
      });
    }
  });

  test("keyboard opens and closes help and switches core workspace tabs", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page, testInfo);

    const help = page.getByTestId("open-help");
    await help.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByTestId("help-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("실행과 절삭");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(help).toBeFocused();

    const code = page.getByTestId("workspace-area-code");
    await code.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "코드" })).toBeVisible();

    const diagnostics = page.getByRole("tab", { name: /Diagnostics/u });
    await diagnostics.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tabpanel", { name: /Diagnostics/u })).toBeVisible();
    const gcode = page.getByRole("tab", { name: "G-code" });
    await page.keyboard.press("ArrowLeft");
    await expect(gcode).toBeFocused();
    await expect(gcode).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "G-code" })).toBeVisible();
    await page.keyboard.press("End");
    await expect(diagnostics).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: /Diagnostics/u })).toBeVisible();
  });

  test("zoom-200 preserves help, activity navigation, and simulation commands", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page, testInfo);
    await page.setViewportSize({ width: 1_440, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await page.waitForTimeout(100);

    await expect(page.getByTestId("open-help")).toBeVisible();
    await expect(page.getByTestId("workspace-area-results")).toBeVisible();
    await expect(page.locator(".command-actions .ui-button--primary")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
  });

  test("workspace-layout exposes code, learning, results, and progressive material removal", async ({
    page,
  }, testInfo) => {
    await openWorkspace(page, testInfo);
    await page.setViewportSize({ width: 1_440, height: 900 });

    await page.getByTestId("workspace-area-code").click();
    await expect(page.getByText("대표 밀링 Fixture")).toBeVisible();
    await page.getByTestId("workspace-area-learn").click();
    await expect(page.getByRole("button", { name: "기본 절삭 실행" })).toBeVisible();
    await page.getByTestId("workspace-area-scene").click();

    const viewport = page.getByTestId("machine-viewport");
    const baselineFrames = Number(await viewport.getAttribute("data-render-frames"));
    const commandPlay = page.getByRole("button", { name: "실행", exact: true });
    await expect(commandPlay).toBeEnabled();
    await commandPlay.click();
    await expect(viewport).toHaveAttribute("data-pipeline-state", /progress|completed/u);
    await expect
      .poll(() =>
        page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().status),
      )
      .toBe("completed");

    expect(Number(await viewport.getAttribute("data-pipeline-stock-revision"))).toBeGreaterThan(0);
    expect(Number(await viewport.getAttribute("data-render-frames"))).toBeGreaterThan(
      baselineFrames,
    );
    await expect(page.locator('[data-pipeline-field="removed"]').first()).not.toHaveText(
      "0.00 mm³",
    );

    await page.getByTestId("workspace-area-results").click();
    await expect(page.locator(".context-panel")).toContainText("완료");
    await expect(page.locator(".context-panel")).toContainText("mm³");
  });
});

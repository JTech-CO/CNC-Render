import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("M9 accessibility", () => {
  test("workspace has no critical or serious axe violations", async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });
    test.skip(
      testInfo.project.name === "visual",
      "Accessibility is covered by the WebGPU and WebGL 2 projects.",
    );
    const renderer =
      testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu";
    const response = await page.goto(`/?renderer=${renderer}`);
    const viewport = page.getByTestId("machine-viewport");
    await page.waitForTimeout(1_000);
    const diagnostic = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      body: document.body.textContent?.slice(0, 300),
      ready: document
        .querySelector('[data-testid="machine-viewport"]')
        ?.getAttribute("data-ready"),
      error: document.querySelector(".viewport-error")?.textContent,
      errorHidden:
        document.querySelector(".viewport-error")?.hasAttribute("hidden"),
      m3: Boolean(window.__CNC_RENDER_M3__),
      m7: Boolean(window.__CNC_RENDER_M7__),
    }));
    expect(
      pageErrors,
      `runtime diagnostic status=${response?.status()}: ${JSON.stringify(diagnostic)}`,
    ).toEqual([]);
    expect(
      diagnostic.ready,
      `runtime diagnostic status=${response?.status()}: ${JSON.stringify(diagnostic)}`,
    ).toBe("true");
    await expect(viewport).toHaveAttribute(
      "data-ready",
      "true",
    );

    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      scan.violations.filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      ),
    ).toEqual([]);

    await page.getByTestId("workspace-area-learn").click();
    await expect(page.getByTestId("face-milling-lesson")).toBeVisible();
    const lessonScan = await new AxeBuilder({ page })
      .include('[data-testid="face-milling-lesson"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      lessonScan.violations.filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      ),
    ).toEqual([]);

    await page.getByTestId("open-help").click();
    await expect(page.getByTestId("help-dialog")).toBeVisible();
    const dialogScan = await new AxeBuilder({ page })
      .include('[data-testid="help-dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      dialogScan.violations.filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      ),
    ).toEqual([]);
  });
});

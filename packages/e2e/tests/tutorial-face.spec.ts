import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function openLesson(page: Page, testInfo: TestInfo) {
  test.skip(
    testInfo.project.name === "visual",
    "tutorial-face behavior is covered by the WebGPU and WebGL 2 projects.",
  );
  const renderer =
    testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu";
  await page.goto(`/?renderer=${renderer}`);
  await expect(page.getByTestId("machine-viewport")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__CNC_RENDER_M10__)))
    .toBe(true);
  await page.getByTestId("workspace-area-learn").click();
}

test.describe("M10 face-milling Lesson controller", () => {
  test("tutorial-face runs prepare through measured assessment on the actual Worker/WASM Stock", async ({
    page,
  }, testInfo) => {
    await openLesson(page, testInfo);

    const lesson = page.getByTestId("face-milling-lesson");
    const primary = page.getByTestId("lesson-primary-action");
    await expect(lesson.getByRole("heading", { name: "평면 밀링 기초" })).toBeVisible();
    await expect(lesson.locator("[data-lesson-step]")).toHaveCount(5);
    await expect(lesson).toContainText("8 mm 덱셀");

    await page.getByRole("button", { name: "실행", exact: true }).click();
    await expect(lesson.getByRole("alert")).toContainText(
      "준비 항목이 확정되기 전에",
    );
    await lesson
      .getByRole("button", { name: "준비 단계 체크포인트로 되돌리기" })
      .click();
    await expect(lesson.getByRole("alert")).toHaveCount(0);

    await expect(primary).toHaveText("준비 확인");
    await primary.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__CNC_RENDER_M10__?.getLessonState().controller.currentStep
              .phase,
        ),
      )
      .toBe("setup");

    await expect(primary).toHaveText("설정 확정");
    await primary.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__CNC_RENDER_M10__?.getLessonState().controller.currentStep
              .phase,
        ),
      )
      .toBe("execute");

    await expect(primary).toHaveText("실제 절삭 실행");
    await primary.click();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__CNC_RENDER_M10__?.getLessonState().running,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__CNC_RENDER_M10__?.getLessonState().controller.currentStep
              .phase,
        ),
      )
      .toBe("measure");
    await expect(page.getByTestId("machine-viewport")).toHaveAttribute(
      "data-pipeline-state",
      "completed",
    );

    await expect(primary).toHaveText("Stock 측정 기록");
    await primary.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__CNC_RENDER_M10__?.getLessonState().controller.currentStep
              .phase,
        ),
      )
      .toBe("assess");
    const measured = await page.evaluate(() => {
      const state = window.__CNC_RENDER_M10__?.getLessonState();
      return {
        measurement: state?.measurement,
        run: state?.run,
        serialized: JSON.stringify(state),
      };
    });
    expect(measured.measurement).toMatchObject({
      targetId: "m7.face-milling.standard.x",
      comparedCells: 1_125,
      targetCutCells: 699,
      representationResolutionMm: 8,
      maxDeviationMm: 0,
      overcutVolumeMm3: 0,
      undercutVolumeMm3: 0,
      actualRemovedVolumeMm3: 357_888,
      targetRemovedVolumeMm3: 357_888,
    });
    expect(measured.run).toMatchObject({
      removedVolumeMm3: 357_888,
      collisionCount: 0,
    });
    expect(measured.serialized).not.toContain("topZMm");
    await expect(page.getByTestId("lesson-measurement")).toContainText(
      "0.000 mm",
    );

    await expect(primary).toHaveText("결과 판정");
    await primary.click();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__CNC_RENDER_M10__?.getLessonState().controller.status,
        ),
      )
      .toBe("completed");
    const completed = await page.evaluate(() =>
      window.__CNC_RENDER_M10__?.getLessonState(),
    );
    expect(completed?.controller.completedStepIds).toHaveLength(5);
    expect(completed?.controller.score).toMatchObject({
      score: 100,
      maximumScore: 100,
      passed: true,
    });
    expect(completed?.evidenceSource).toBe("worker-wasm");
    await expect(page.getByTestId("lesson-score")).toContainText("100.00 / 100");
    await expect(page.getByTestId("machine-viewport")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          window.__CNC_RENDER_M3__?.getDiagnostics().stockSurface
            ?.partialBufferUpdates,
      ),
    ).toBeGreaterThan(0);
  });
});

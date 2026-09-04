import { expect, test, type Page, type TestInfo } from "@playwright/test";

type LessonPhase = "prepare" | "setup" | "execute" | "measure" | "assess";

const lessonCurrentSelector = ".lesson-current";

async function lessonState(page: Page) {
  return page.evaluate(() => window.__CNC_RENDER_M10__?.getLessonState());
}

async function waitForLessonPhase(page: Page, phase: LessonPhase) {
  await expect
    .poll(
      async () =>
        (await lessonState(page))?.controller.currentStep.phase ?? null,
      { timeout: 30_000 },
    )
    .toBe(phase);
}

async function openLesson(page: Page, testInfo: TestInfo) {
  test.skip(
    testInfo.project.name !== "visual",
    "M10 visual baselines run only in the dedicated WebGL 2 project.",
  );
  await page.goto("/?renderer=webgl2");
  const viewport = page.getByTestId("machine-viewport");
  await expect(viewport).toHaveAttribute("data-ready", "true");
  await expect(viewport).toHaveAttribute("data-renderer-mode", "webgl2");
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__CNC_RENDER_M10__)))
    .toBe(true);
  await page.getByTestId("workspace-area-learn").click();
  await expect(page.getByTestId("tutorial-lesson")).toBeVisible();
  await waitForLessonPhase(page, "prepare");
  return viewport;
}

async function advanceLesson(
  page: Page,
  actionLabel: string,
  nextPhase: LessonPhase,
) {
  const primary = page.getByTestId("lesson-primary-action");
  await expect(primary).toBeEnabled();
  await expect(primary).toHaveText(actionLabel);
  await primary.click();
  await waitForLessonPhase(page, nextPhase);
}

async function settleScopedScreenshot(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  const lessonCurrent = page.locator(lessonCurrentSelector);
  await lessonCurrent.scrollIntoViewIfNeeded();
  await expect(lessonCurrent).toBeVisible();
  return lessonCurrent;
}

test("tutorial-success visual baseline retains the final 3D result", async ({
  page,
}, testInfo) => {
  const viewport = await openLesson(page, testInfo);

  await advanceLesson(page, "준비 확인", "setup");
  await advanceLesson(page, "설정 확정", "execute");

  const primary = page.getByTestId("lesson-primary-action");
  await expect(primary).toHaveText("실제 절삭 실행");
  await primary.click();
  await expect
    .poll(async () => (await lessonState(page))?.running ?? false)
    .toBe(true);
  await waitForLessonPhase(page, "measure");
  await expect(viewport).toHaveAttribute("data-pipeline-state", "completed");

  const executed = await lessonState(page);
  expect(executed?.run).toMatchObject({ collisionCount: 0 });
  expect(executed?.run?.removedVolumeMm3).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () =>
        window.__CNC_RENDER_M3__?.getDiagnostics().stockSurface
          ?.partialBufferUpdates ?? 0,
    ),
  ).toBeGreaterThan(0);

  await advanceLesson(page, "Stock 측정 기록", "assess");
  const measured = await lessonState(page);
  expect(measured?.measurement).toMatchObject({
    targetId: "m7.face-milling.standard.x",
    maxDeviationMm: 0,
    overcutVolumeMm3: 0,
    undercutVolumeMm3: 0,
  });

  await expect(primary).toHaveText("결과 판정");
  await primary.click();
  await expect
    .poll(async () => (await lessonState(page))?.controller.status ?? null)
    .toBe("completed");

  const completed = await lessonState(page);
  expect(completed?.evidenceSource).toBe("worker-wasm");
  expect(completed?.controller.completedStepIds).toHaveLength(5);
  expect(completed?.controller.score).toMatchObject({
    score: 100,
    maximumScore: 100,
    passed: true,
  });

  const outcome = page.getByTestId("lesson-outcome");
  await expect(outcome).toHaveAttribute("data-outcome", "completed");
  await expect(outcome).toContainText("Lesson 완료");
  await expect(page.getByTestId("lesson-score")).toContainText("100.00 / 100");
  await expect(page.getByTestId("machine-canvas")).toBeVisible();
  await expect(page.getByTestId("lesson-celebration")).toHaveCount(0);
  await expect(await settleScopedScreenshot(page)).toHaveScreenshot(
    "tutorial-success.png",
  );
});

test("tutorial-failure visual baseline shows authored reason and recovery", async ({
  page,
}, testInfo) => {
  await openLesson(page, testInfo);
  await advanceLesson(page, "준비 확인", "setup");

  const failureFixture = page.getByTestId("lesson-failure-fixture");
  await expect(failureFixture).toHaveText("잘못된 공구 실패 예시");
  await failureFixture.click();
  await expect
    .poll(async () => (await lessonState(page))?.controller.status ?? null)
    .toBe("failed");

  const failed = await lessonState(page);
  expect(failed?.controller.currentStep.phase).toBe("setup");
  expect(failed?.controller.lastEvaluation?.matchedFailureRuleId).toBe(
    "setup.wrong-tool",
  );
  expect(failed?.controller.guidance).toMatchObject({
    kind: "failure",
    recovery: { kind: "restore-step-checkpoint" },
  });

  const outcome = page.getByTestId("lesson-outcome");
  const recovery = page.getByRole("button", {
    name: "설정 단계 체크포인트로 되돌리기",
  });
  await expect(outcome).toHaveAttribute("data-outcome", "failed");
  await expect(outcome).toContainText("단계 복구 필요");
  await expect(page.getByRole("alert")).toContainText(
    "이 실습에는 20 mm 평엔드밀이 필요합니다.",
  );
  await expect(recovery).toBeVisible();
  await expect(await settleScopedScreenshot(page)).toHaveScreenshot(
    "tutorial-failure.png",
  );

  await recovery.click();
  await expect
    .poll(async () => (await lessonState(page))?.controller.status ?? null)
    .toBe("active");
  await waitForLessonPhase(page, "setup");
  const restored = await lessonState(page);
  expect(restored?.controller.guidance).toBeNull();
  expect(restored?.controller.lastEvaluation).toBeNull();
  await expect(page.getByTestId("lesson-outcome")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(failureFixture).toBeVisible();
  await expect(page.getByTestId("lesson-primary-action")).toHaveText(
    "설정 확정",
  );
});

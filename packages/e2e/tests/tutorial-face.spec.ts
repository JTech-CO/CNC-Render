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

    const lesson = page.getByTestId("tutorial-lesson");
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

async function runLessonToAssessment(page: Page) {
  const primary = page.getByTestId("lesson-primary-action");

  await primary.click();
  await primary.click();
  await primary.click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__CNC_RENDER_M10__?.getLessonState().controller.currentStep
              .phase,
        ),
      { timeout: 30_000 },
    )
    .toBe("measure");

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

  await primary.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__CNC_RENDER_M10__?.getLessonState().controller.status,
      ),
    )
    .toBe("completed");

  return measured;
}

for (const fixtureCase of [
  {
    lessonId: "od-turning",
    title: "외경 선삭 기초",
    targetId: "m7.od-turning.balanced",
    process: "od-turning",
    comparedCells: 120,
    targetCutCells: 101,
    diameterMm: 64,
    depthMm: null,
  },
  {
    lessonId: "drilling",
    title: "선반 센터 드릴링 기초",
    targetId: "m7.drilling-16x80.balanced",
    process: "drilling",
    comparedCells: 120,
    targetCutCells: 80,
    diameterMm: 16,
    depthMm: 80,
  },
] as const) {
  test.describe("M10 " + fixtureCase.lessonId + " Lesson controller", () => {
    test("runs the actual Worker/WASM radius field through measurement and assessment", async ({
      page,
    }, testInfo) => {
      await openLesson(page, testInfo);

      const lesson = page.getByTestId("tutorial-lesson");
      await page
        .getByTestId("lesson-selector")
        .selectOption(fixtureCase.lessonId);
      await expect(
        lesson.getByRole("heading", { name: fixtureCase.title }),
      ).toBeVisible();
      await expect(page.getByTestId("pipeline-fixture")).toHaveValue(
        fixtureCase.lessonId === "od-turning" ? "turning" : "drilling",
      );

      const measured = await runLessonToAssessment(page);

      expect(measured.measurement).toMatchObject({
        targetId: fixtureCase.targetId,
        process: fixtureCase.process,
        comparedCells: fixtureCase.comparedCells,
        targetCutCells: fixtureCase.targetCutCells,
        representationResolutionMm: 1,
        maxDeviationMm: 0,
        overcutVolumeMm3: 0,
        undercutVolumeMm3: 0,
        feature: {
          actualDiameterMm: fixtureCase.diameterMm,
          targetDiameterMm: fixtureCase.diameterMm,
        },
      });
      if (fixtureCase.depthMm !== null) {
        expect(measured.measurement).toMatchObject({
          feature: {
            actualDepthMm: fixtureCase.depthMm,
            targetDepthMm: fixtureCase.depthMm,
          },
        });
      }
      expect(measured.run).toMatchObject({
        collisionCount: 0,
      });
      expect(measured.run?.removedVolumeMm3).toBeGreaterThan(0);
      expect(measured.serialized).not.toContain("outerRadiusMm");
      expect(measured.serialized).not.toContain("innerRadiusMm");
      await expect(page.getByTestId("lesson-measurement")).toContainText(
        fixtureCase.diameterMm.toFixed(2) +
          " / " +
          fixtureCase.diameterMm.toFixed(2) +
          " mm",
      );
      if (fixtureCase.depthMm !== null) {
        await expect(page.getByTestId("lesson-measurement")).toContainText(
          "80.00 / 80.00 mm",
        );
      }

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
      await expect(page.getByTestId("lesson-score")).toContainText(
        "100.00 / 100",
      );
      await expect(page.getByTestId("machine-viewport")).toHaveAttribute(
        "data-pipeline-state",
        "completed",
      );
    });
  });
}

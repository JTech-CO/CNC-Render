import { expect, test } from "@playwright/test";

test.describe("M4 collision-stop frame contract", () => {
  test("collision-stop appears on the next renderer frame and maps to source", async ({
    page,
  }, testInfo) => {
    const requestedRenderer =
      testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu";
    await page.goto(`/?renderer=${requestedRenderer}`);
    const viewport = page.getByTestId("machine-viewport");
    await expect(viewport).toHaveAttribute("data-ready", "true");
    await expect(viewport).toHaveAttribute("data-simulation-state", "idle");

    const baseline = await page.evaluate(() => {
      const harness = window.__CNC_RENDER_M4__;
      if (!harness) {
        throw new Error("M4 browser harness is unavailable.");
      }
      return {
        frames: harness.getDiagnostics().telemetry.framesRendered,
        commits: harness.getReactCommitCount(),
      };
    });

    await page.getByTestId("run-collision-fixture").click();
    await expect(viewport).toHaveAttribute(
      "data-simulation-state",
      "stopped",
    );
    const stoppedFrame = Number(
      await viewport.getAttribute("data-collision-stopped-frame"),
    );
    expect(stoppedFrame).toBeGreaterThan(baseline.frames);

    const diagnostic = page.getByTestId("collision-diagnostic");
    await expect(diagnostic).toBeVisible();
    await expect(diagnostic).toContainText("충돌로 시뮬레이션 정지");
    await expect(diagnostic).toContainText("공구 ↔ 바이스");
    await expect(diagnostic).toContainText("G-code 원본 3행");
    await expect(
      page.locator('.program-preview li[data-source-line="3"]'),
    ).toHaveClass(/is-collision/u);
    await expect(page.locator(".dock-tabs button").nth(1)).toContainText(
      "Diagnostics 1",
    );

    const stopped = await page.evaluate(() => {
      const harness = window.__CNC_RENDER_M4__;
      if (!harness) {
        throw new Error("M4 browser harness is unavailable.");
      }
      return {
        state: harness.getCollisionState(),
        diagnostics: harness.getDiagnostics(),
        commits: harness.getReactCommitCount(),
      };
    });
    expect(stopped.state.state).toBe("stopped");
    expect(stopped.state.event).toMatchObject({
      eventType: "simulation.collision",
      severity: "stop",
      sourceLine: 3,
    });
    expect(stopped.state.stoppedOnRenderFrame).toBe(stoppedFrame);
    expect(stopped.diagnostics.collisionMarkerMm).toEqual([
      stopped.state.event?.positionMm.xMm,
      stopped.state.event?.positionMm.yMm,
      stopped.state.event?.positionMm.zMm,
    ]);
    expect(stopped.commits).toBe(baseline.commits);

    await page.getByTestId("reset-collision-fixture").click();
    await expect(viewport).toHaveAttribute("data-simulation-state", "idle");
    await expect(diagnostic).toBeHidden();
    await expect(
      page.locator('.program-preview li[data-source-line="3"]'),
    ).not.toHaveClass(/is-collision/u);
    expect(
      await page.evaluate(
        () => window.__CNC_RENDER_M4__?.getDiagnostics().collisionMarkerMm,
      ),
    ).toBeNull();
  });
});

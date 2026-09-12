import { expect, test, type Page } from "@playwright/test";

const SHA256_HEX = /^[a-f0-9]{64}$/u;

interface GcodeLabHarnessState {
  readonly editorLoadState: "unloaded" | "loading" | "ready" | "failed";
  readonly workerMode: "dedicated";
  readonly selectedDiagnosticId: string | null;
  readonly source: string;
  readonly currentSourceLine: number | null;
  readonly breakpoints: readonly number[];
  readonly analysis: {
    readonly coreVersion: string;
    readonly wasm: true;
    readonly phase: "analysis";
    readonly accepted: boolean;
    readonly sourceHashSha256: string;
    readonly diagnostics: ReadonlyArray<{
      readonly id: string;
      readonly code: string;
      readonly range: {
        readonly start: { readonly line: number; readonly column: number };
        readonly end: { readonly line: number; readonly column: number };
      };
      readonly supportLevel: string;
      readonly replacementAvailability: string;
    }>;
  } | null;
}

interface GcodeLabHarness {
  getState(): GcodeLabHarnessState;
}

function gcodeLabState(): GcodeLabHarnessState | null {
  const harness = (
    window as unknown as { readonly __CNC_RENDER_M11__?: GcodeLabHarness }
  ).__CNC_RENDER_M11__;
  return harness?.getState() ?? null;
}

function monacoResourceUrls(): string[] {
  return performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((url) =>
      /(?:monaco|gcode-lab-panel|gcode-editor-runtime|editor\.api)/iu.test(url),
    );
}

async function editProgram(page: Page, source: string) {
  await page.getByTestId("gcode-editor").click({ position: { x: 160, y: 30 } });
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+A");
  if (source) await page.keyboard.insertText(source);
  else await page.keyboard.press("Backspace");
  await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ source });
}

test.describe("M11 G-code Lab", () => {
  test("gcode-lab diagnostic-link lazy-loads Monaco and links the Worker/WASM G41 diagnostic", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "visual",
      "G-code Lab behavior is covered by the WebGPU and WebGL 2 projects.",
    );
    const renderer =
      testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu";
    await page.goto(`/?renderer=${renderer}`);
    await expect(page.getByTestId("machine-viewport")).toHaveAttribute(
      "data-ready",
      "true",
    );

    const [beforeState, beforeMonacoResources] = await Promise.all([
      page.evaluate(gcodeLabState),
      page.evaluate(monacoResourceUrls),
    ]);
    expect(beforeState?.editorLoadState ?? "unloaded").toBe("unloaded");
    expect(beforeMonacoResources).toEqual([]);

    await page.getByTestId("workspace-area-code").click();
    const lab = page.getByTestId("gcode-lab");
    const editor = page.getByTestId("gcode-editor");
    await expect(lab).toBeVisible();
    await expect
      .poll(() => page.evaluate(gcodeLabState))
      .toMatchObject({ editorLoadState: "ready", workerMode: "dedicated" });

    // The actual selected fixture is loaded first; unsupported source is a user edit.
    expect((await page.evaluate(gcodeLabState))?.analysis?.accepted).toBe(true);
    expect((await page.evaluate(gcodeLabState))?.source).toContain("G1");
    await editProgram(page, "G21 G90\nG41\nM30\n");
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ editorLoadState: "ready", analysis: { accepted: false } });

    const state = await page.evaluate(gcodeLabState);
    expect(state?.analysis).toMatchObject({
      wasm: true,
      phase: "analysis",
      accepted: false,
    });
    expect(state?.analysis?.coreVersion).not.toBe("");
    expect(state?.analysis?.sourceHashSha256).toMatch(SHA256_HEX);
    expect(state?.analysis?.diagnostics).toHaveLength(1);
    const diagnostic = state?.analysis?.diagnostics[0];
    expect(diagnostic).toMatchObject({
      code: "semantic.cutter_comp.unsupported",
      range: {
        start: { line: 2, column: 1 },
        end: { line: 2, column: 4 },
      },
      supportLevel: "recognized-unsupported",
      replacementAvailability: "unavailable",
    });
    expect(diagnostic?.id).toMatch(/^gcode-[a-f0-9]{64}$/u);

    const item = page.getByTestId("gcode-diagnostic-item").filter({
      has: page.getByText("semantic.cutter_comp.unsupported", { exact: true }),
    });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("2행");
    await expect(item).toContainText("recognized-unsupported");
    await expect(item).toContainText("대체 불가");
    await expect(item).toHaveAttribute("data-diagnostic-id", diagnostic!.id);
    await item.click();

    await expect(editor).toHaveAttribute("data-focused-line", "2");
    await expect(editor).toHaveAttribute(
      "data-selected-diagnostic-id",
      diagnostic!.id,
    );
    await expect(item).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("gcode-diagnostic-help")).toContainText("공구 중심 경로");
    await expect(page.getByTestId("gcode-focus-diagnostic")).toBeDisabled();
    await expect(page.getByTestId("gcode-run")).toBeDisabled();
    expect((await page.evaluate(gcodeLabState))?.selectedDiagnosticId).toBe(
      diagnostic!.id,
    );
    await expect
      .poll(() => page.evaluate(monacoResourceUrls))
      .not.toEqual([]);

    const invalidHash = state?.analysis?.sourceHashSha256;
    const validSource = "G21 G90\nG0 X-170 Y-80 Z370\nG1 Z338 F1200\nG0 Z370\nM30\n";
    // Replace another invalid draft immediately: stale responses must never replace this result.
    await editProgram(page, "G21 G90\nG42\nM30\n");
    await editProgram(page, validSource);
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ editorLoadState: "ready", source: validSource, analysis: { accepted: true, diagnostics: [] } });
    expect((await page.evaluate(gcodeLabState))?.analysis?.sourceHashSha256).not.toBe(invalidHash);
    await expect(page.getByTestId("gcode-run")).toBeEnabled();
    await expect(page.getByTestId("gcode-diagnostic-item")).toHaveCount(0);
    await page.getByTestId("workspace-area-scene").click();
    await page.getByTestId("workspace-area-code").click();
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ source: validSource, analysis: { accepted: true } });
  });

  test("gcode-lab Worker source-line stepping and breakpoint stop before the selected line", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "visual", "Execution is covered by both rendering backends.");
    const renderer = testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu";
    await page.goto(`/?renderer=${renderer}`);
    await expect(page.getByTestId("machine-viewport")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("workspace-area-code").click();
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ editorLoadState: "ready" });
    const source = "G21 G90\nG0 X-170 Y-80 Z370\nG1 Z338 F1200\nG1 X-130 F2400\nG0 Z370\nM30\n";
    await editProgram(page, source);
    await expect(page.getByTestId("gcode-run")).toBeEnabled();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("F9");
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ breakpoints: [3] });
    await expect(page.getByLabel("코드 줄 표시 범례")).toContainText("◆ 중단점 3");
    await page.getByTestId("gcode-run").click();
    await expect.poll(() => page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().status)).toBe("paused");
    const stopped = await page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().summary);
    expect(stopped?.removedVolumeMm3).toBe(0);
    await page.getByTestId("gcode-step").click();
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ currentSourceLine: 3 });
    await expect.poll(() => page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().status)).toBe("paused");
    await expect(page.getByLabel("코드 줄 표시 범례")).toContainText("▶ 현재 줄 3");
    await page.getByTestId("gcode-run").click();
    await expect.poll(() => page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().status)).toBe("completed");
    expect((await page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().summary))?.removedVolumeMm3).toBeGreaterThan(0);
  });

  test("diagnostic-link selects matching list item from the editor line and rejects an empty program", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "visual", "Diagnostic navigation is covered by both rendering backends.");
    const renderer = testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu";
    await page.goto(`/?renderer=${renderer}`);
    await expect(page.getByTestId("machine-viewport")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("workspace-area-code").click();
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ editorLoadState: "ready" });
    await editProgram(page, "G21 G90\nG41\nG42\nM30\n");
    await expect(page.getByTestId("gcode-diagnostic-item")).toHaveCount(2);
    const items = page.getByTestId("gcode-diagnostic-item");
    await items.first().getByRole("button").click();
    await expect(items.first()).toHaveAttribute("aria-current", "true");
    await page.getByTestId("gcode-editor").locator(".view-line").filter({ hasText: /^G42$/u }).click();
    await expect(items.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("gcode-editor")).toHaveAttribute("data-focused-line", "3");
    await editProgram(page, "");
    await expect(page.getByTestId("gcode-lab").locator(".gcode-diagnostics").getByRole("alert")).toContainText("프로그램을 입력");
    await expect(page.getByTestId("gcode-run")).toBeDisabled();
    await editProgram(page, "G21 G90\n" + "G41\n".repeat(55) + "M30\n");
    await expect.poll(() => page.evaluate(gcodeLabState).then((state) => state?.analysis?.diagnostics.length)).toBe(55);
    await expect(items).toHaveCount(50);
    await page.getByRole("button", { name: "다음 진단", exact: true }).click();
    await expect(items).toHaveCount(5);
    await expect(items.last()).toContainText("56행");
    await items.last().getByRole("button").click();
    await expect(page.getByTestId("gcode-editor")).toHaveAttribute("data-focused-line", "56");
  });

  test("gcode-lab stop unlocks editing and a new program can restart", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "visual", "Stop and restart are covered by both rendering backends.");
    await page.goto(`/?renderer=${testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu"}`);
    await expect(page.getByTestId("machine-viewport")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("workspace-area-code").click();
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ editorLoadState: "ready" });
    await page.getByTestId("gcode-editor").click({ position: { x: 160, y: 30 } });
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("F9");
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ breakpoints: [1] });
    await page.getByTestId("gcode-run").click();
    await expect.poll(() => page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().status)).toBe("paused");
    await page.getByTestId("gcode-lab").getByRole("button", { name: "정지", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().status)).toBe("cancelled");
    await expect(page.getByTestId("gcode-run")).toBeEnabled();
    const replacement = "G21 G90\nG0 X-170 Y-80 Z370\nG1 Z338 F1200\nG1 X-130 F2400\nG0 Z370\nM30\n";
    await editProgram(page, replacement);
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ source: replacement, analysis: { accepted: true } });
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("F9");
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ breakpoints: [] });
    await page.getByTestId("gcode-run").click();
    await expect.poll(() => page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().status)).toBe("completed");
    expect((await page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineSource()))).toBe(replacement);
  });

  test("diagnostic-link never reattaches an old run diagnostic to an edited program after tab switching", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "visual", "Source provenance is covered by both rendering backends.");
    await page.goto(`/?renderer=${testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu"}`);
    await expect(page.getByTestId("machine-viewport")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("workspace-area-code").click();
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ editorLoadState: "ready" });
    await editProgram(page, "G21 G90\nG1 X600 Z370 F1200\nM30\n");
    await expect(page.getByTestId("gcode-run")).toBeEnabled();
    await page.getByTestId("gcode-run").click();
    await expect.poll(() => page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().status)).toBe("stopped");
    const diagnostic = await page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().summary?.runtimeDiagnostics?.find((item) => item.origin === "axis-limit"));
    expect(diagnostic).toBeDefined();
    await expect(page.locator(`[data-diagnostic-id="${diagnostic!.id}"]`)).toBeVisible();
    const replacement = "G21 G90\nG0 X-170 Y-80 Z370\nM30\n";
    await editProgram(page, replacement);
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ source: replacement, analysis: { accepted: true }, currentSourceLine: null });
    await expect(page.getByTestId("gcode-diagnostic-item")).toHaveCount(0);
    await page.getByTestId("workspace-area-scene").click();
    await page.getByTestId("workspace-area-code").click();
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ source: replacement, analysis: { accepted: true }, currentSourceLine: null });
    await expect(page.getByTestId("gcode-diagnostic-item")).toHaveCount(0);
    expect(await page.evaluate((id) => window.__CNC_RENDER_M3__?.getDiagnosticScreenPosition(id), diagnostic!.id)).toBeNull();
  });

  test("gcode-lab refuses representative project save for an edited session", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "visual", "Edited-session save protection is covered by both rendering backends.");
    await page.goto(`/?renderer=${testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu"}`);
    const viewport = page.getByTestId("machine-viewport");
    await expect(viewport).toHaveAttribute("data-ready", "true");
    await expect(viewport).toHaveAttribute("data-persistence-state", "ready");
    await page.getByTestId("workspace-area-code").click();
    await expect.poll(() => page.evaluate(gcodeLabState)).toMatchObject({ editorLoadState: "ready" });
    const source = "G21 G90\nG0 X-170 Y-80 Z370\nG1 Z338 F1200\nG1 X-130 F2400\nG0 Z370\nM30\n";
    await editProgram(page, source);
    await expect(page.getByTestId("gcode-run")).toBeEnabled();
    await page.getByTestId("gcode-run").click();
    await expect.poll(() => page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().status)).toBe("completed");
    const before = await page.evaluate(() => {
      const pipeline = window.__CNC_RENDER_M7__;
      const state = pipeline?.getPipelineState();
      return {
        source: pipeline?.getPipelineSource(),
        runId: state?.summary?.runId,
        stockHash: state?.summary?.stockHashSha256,
        status: state?.status,
      };
    });
    expect(before.source).toBe(source);
    expect(before.runId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(before.stockHash).toMatch(SHA256_HEX);
    expect(before.status).toBe("completed");
    await page.locator(".command-actions").getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.locator('.m11-code-context > [role="alert"]')).toHaveText("G-code 편집 세션은 프로젝트 저장을 지원하지 않습니다. 코드를 별도로 복사하고 결과 탭에서 리포트를 저장하세요.");
    expect(await page.evaluate(() => {
      const pipeline = window.__CNC_RENDER_M7__;
      const state = pipeline?.getPipelineState();
      return {
        source: pipeline?.getPipelineSource(),
        runId: state?.summary?.runId,
        stockHash: state?.summary?.stockHashSha256,
        status: state?.status,
      };
    })).toEqual(before);
    expect((await page.evaluate(gcodeLabState))?.source).toBe(source);
    await expect(viewport).toHaveAttribute("data-pipeline-state", "completed");
  });
});

import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("measurement keeps all six canonical dimensions across display unit changes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "visual", "Functional matrix only.");
  await page.goto(`/?renderer=${testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu"}`);
  await expect(page.getByTestId("machine-viewport")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("workspace-area-results").click();
  for (const [kind, canonical] of [["distance", 25.4], ["radius", 25.4], ["diameter", 50.8], ["angle", Math.PI / 2], ["depth", 0], ["wall-thickness", 0]] as const) {
    await page.getByLabel("측정 종류", { exact: true }).selectOption(kind);
    await page.getByRole("button", { name: "측정 계산", exact: true }).click();
    const output = page.getByTestId("measurement-value");
    expect(Number(await output.getAttribute("data-canonical-value"))).toBeCloseTo(canonical, 12);
    const before = await output.getAttribute("data-canonical-value");
    await page.getByLabel("길이 표시 단위").selectOption("in");
    await page.getByLabel("각도 표시 단위").selectOption("rad");
    await expect(output).toHaveAttribute("data-canonical-value", before!);
    await page.getByLabel("길이 표시 단위").selectOption("mm");
    await page.getByLabel("각도 표시 단위").selectOption("deg");
  }
  await page.getByLabel("법선 Z").fill("0");
  await page.getByRole("button", { name: "측정 계산", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("법선 벡터");
});

test("result-compare shares actual milling/turning/drilling data across modes and exports", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "visual", "Functional matrix only.");
  test.setTimeout(90_000);
  await page.goto(`/?renderer=${testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu"}`);
  await expect(page.getByTestId("machine-viewport")).toHaveAttribute("data-ready", "true");
  for (const fixture of ["milling", "turning", "drilling"] as const) {
    const terminal = await page.evaluate(async (selected) => {
      if (!window.__CNC_RENDER_M7__) throw new Error("M7 not ready");
      return window.__CNC_RENDER_M7__.runPipelineFixture(selected, { executionMode: "fast-forward", playbackSpeed: 100 });
    }, fixture);
    expect(terminal.completed).toBe(true);
    await page.getByTestId("workspace-area-results").click();
    await page.getByRole("button", { name: "현재 Stock 비교" }).click();
    const maximum = page.locator('[data-result-key="maxDeviationMm"]');
    await expect(maximum).toHaveAttribute("data-canonical-value", "0");
    const metrics = await page.locator("[data-result-key]").evaluateAll((rows) => rows.map((row) => [row.getAttribute("data-result-key"), row.getAttribute("data-canonical-value")]));
    for (const mode of ["Split", "Heatmap", "Overlay"]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      await expect(page.getByTestId("result-legend")).toContainText("범위 ±0.000000 mm");
      expect(await page.locator("[data-result-key]").evaluateAll((rows) => rows.map((row) => [row.getAttribute("data-result-key"), row.getAttribute("data-canonical-value")]))).toEqual(metrics);
    }
    for (const [format, button] of [["json", "JSON 저장"], ["csv", "CSV 저장"], ["html", "인쇄 HTML 저장"]] as const) {
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: button, exact: true }).click()]);
      const path = await download.path(); expect(path).not.toBeNull(); const text = await readFile(path!, "utf8");
      if (format === "json") {
        const report = JSON.parse(text) as Record<string, unknown>;
        expect(report.runId).toBe(terminal.runId); expect(report.stockHash).toBe(terminal.stockHashSha256);
        for (const [key, value] of metrics) expect(report[key!]).toBe(Number(value));
      } else for (const [key, value] of metrics) { expect(text).toContain(key!); expect(text).toContain(value!); }
    }
  }
});

test("result-compare denies restored checkpoint results until rerun and invalidates previous runs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "visual", "Functional matrix only.");
  test.setTimeout(90_000);
  await page.goto(`/?renderer=${testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu"}`);
  const viewport = page.getByTestId("machine-viewport");
  await expect(viewport).toHaveAttribute("data-ready", "true");
  await expect(viewport).toHaveAttribute("data-persistence-state", "ready");
  await page.evaluate(async () => { if (!window.__CNC_RENDER_M8__) throw new Error("M8 not ready"); await window.__CNC_RENDER_M8__.saveFixture("milling"); });
  await page.getByTestId("workspace-area-results").click();
  await page.getByRole("button", { name: "현재 Stock 비교" }).click();
  await expect(page.getByTestId("result-provenance")).toBeVisible();
  await page.evaluate(async () => { if (!window.__CNC_RENDER_M8__) throw new Error("M8 not ready"); await window.__CNC_RENDER_M8__.loadPersistedProject(); });
  await expect(viewport).toHaveAttribute("data-pipeline-state", "checkpoint-restored");
  await expect(page.getByRole("button", { name: "현재 Stock 비교" })).toBeDisabled();
  await expect(page.getByTestId("result-provenance")).toHaveCount(0);
  await expect(page.getByTestId("result-comparison-surface")).toContainText("재실행 후 결과를 비교하세요");
  const rerun = await page.evaluate(async () => {
    if (!window.__CNC_RENDER_M7__) throw new Error("M7 not ready");
    return window.__CNC_RENDER_M7__.runPipelineFixture("milling", { playbackSpeed: 100, executionMode: "fast-forward" });
  });
  await page.getByRole("button", { name: "현재 Stock 비교" }).click();
  await expect(page.getByTestId("result-provenance")).toContainText(rerun.runId);
  await page.evaluate(async () => {
    if (!window.__CNC_RENDER_M7__) throw new Error("M7 not ready");
    await window.__CNC_RENDER_M7__.startPipelineFixture("turning", { startPaused: true });
  });
  await expect(page.getByTestId("result-provenance")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "JSON 저장", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "현재 Stock 비교" }).click();
  await expect(page.getByTestId("result-comparison").getByRole("alert")).toContainText("공정이 완료되거나");
});

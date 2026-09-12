import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { readReleaseIdentity } from "../../../scripts/release-metadata.mjs";

test("GitHub Pages serves verifiable release identity and matching WASM bytes", async ({ request }) => {
  const response = await request.get("./release.json");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/json");
  const metadata = await response.json();
  const wasmResponse = await request.get("./wasm/cnc_render_wasm.wasm");
  expect(wasmResponse.ok()).toBe(true);
  const wasm = await wasmResponse.body();
  expect(metadata).toEqual({
    metadataVersion: 1,
    ...readReleaseIdentity(),
    target: "pages",
    wasm: {
      path: "wasm/cnc_render_wasm.wasm",
      byteLength: wasm.length,
      sha256: createHash("sha256").update(wasm).digest("hex"),
    },
  });
});

test("GitHub Pages preserves styled, clickable workspace behavior", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const workerUrls: string[] = [];
  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));
  page.on("worker", (worker) => workerUrls.push(worker.url()));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("./?renderer=webgl2");
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", /connect-src 'self';/u);
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
      buttonForeground: button.color,
      noPageOverflow:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
      shellWidth: shell.getBoundingClientRect().width,
    };
  });
  expect(deploymentStyles).toMatchObject({
    appBackground: "#f4f6f8",
    buttonMinHeight: 32,
    buttonBackground: "rgb(40, 89, 197)",
    buttonForeground: "rgb(255, 255, 255)",
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
  await expect(page.getByTestId("gcode-editor")).toHaveAttribute("data-analysis-state", "ready");
  await expect.poll(() => page.evaluate(() => window.__CNC_RENDER_M11__?.getState())).toMatchObject({
    editorLoadState: "ready",
    workerMode: "dedicated",
    analysis: { wasm: true, phase: "analysis", accepted: true },
  });
  await expect(page.getByTestId("gcode-editor").locator(".monaco-editor")).toBeVisible();
  expect((await page.evaluate(() => window.__CNC_RENDER_M11__?.getState().source))).toContain("G1");
  await expect.poll(() => workerUrls.find((url) => url.includes("gcode-analysis.worker")) ?? null).not.toBeNull();
  const analysisWorkerUrl = workerUrls.find((url) => url.includes("gcode-analysis.worker"))!;
  expect(new URL(analysisWorkerUrl).pathname).toMatch(/^\/CNC-Render\/assets\//u);
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

  const terminal = await page.evaluate(() => window.__CNC_RENDER_M7__?.getPipelineState().summary);
  expect(terminal?.completed).toBe(true);
  expect(terminal?.stockHashSha256).toMatch(/^[a-f0-9]{64}$/u);
  await page.getByTestId("workspace-area-results").click();
  await expect(workspace).toHaveAttribute("data-active-area", "results");
  await page.getByRole("button", { name: "현재 Stock 비교", exact: true }).click();
  await expect(page.getByTestId("result-provenance")).toContainText(terminal!.runId);
  await expect(page.getByTestId("result-outcome")).toHaveText("완료");
  await expect(page.locator('[data-result-key="maxDeviationMm"]')).toHaveAttribute("data-canonical-value", "0");
  await expect.poll(() => workerUrls.find((url) => url.includes("result-comparison.worker")) ?? null).not.toBeNull();
  const comparisonWorkerUrl = workerUrls.find((url) => url.includes("result-comparison.worker"))!;
  expect(new URL(comparisonWorkerUrl).pathname).toMatch(/^\/CNC-Render\/assets\//u);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "JSON 저장", exact: true }).click(),
  ]);
  const reportPath = await download.path();
  expect(reportPath).not.toBeNull();
  const report = JSON.parse(await readFile(reportPath!, "utf8")) as Record<string, unknown>;
  expect(report).toMatchObject({
    runId: terminal!.runId,
    fixtureId: terminal!.fixtureId,
    stockHash: terminal!.stockHashSha256,
    maxDeviationMm: 0,
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  const origin = new URL(page.url()).origin;
  expect(requestUrls.filter((url) => /^https?:/u.test(url) && new URL(url).origin !== origin)).toEqual([]);
});

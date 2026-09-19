import { expect, test, type Page, type TestInfo } from "@playwright/test";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SANDBOX_IDS = {
  machineId: "83000000-0000-4000-8000-000000000002",
  materialId: "83000000-0000-4000-8000-000000000005",
  toolAssemblyId: "83000000-0000-4000-8000-000000000007",
} as const;

interface SandboxPersistenceReport {
  readonly generationId: string;
  readonly checkpointId: string;
  readonly componentHashes: Readonly<Record<string, string>>;
  readonly stateSemanticHashSha256: string;
  readonly stockHashSha256: string;
  readonly operationDocument: {
    readonly presetId: string;
    readonly configuration: {
      readonly stockPreset: string;
      readonly cutDirection: string;
    };
    readonly operation: {
      readonly id: string;
      readonly name: string;
      readonly operationType: string;
      readonly strategy: string;
      readonly setupId: string;
      readonly toolAssemblyId: string;
      readonly feed: {
        readonly mode: string;
        readonly feedMmPerMin?: number;
        readonly feedMmPerRev?: number;
        readonly feedMmPerTooth?: number;
      };
      readonly spindleSpeedRpm: number;
      readonly spindleDirection: string;
      readonly depthOfCutMm: number;
      readonly widthOfCutMm: number;
    };
  };
  readonly journal:
    | string
    | {
        readonly schemaVersion: number;
        readonly cursor: number;
        readonly revisions: readonly unknown[];
      };
}

async function loadSandboxPersistence(): Promise<SandboxPersistenceReport> {
  const harness = window.__CNC_RENDER_M8__ as
    | (NonNullable<typeof window.__CNC_RENDER_M8__> & {
        loadSandboxOperation(): Promise<SandboxPersistenceReport>;
      })
    | undefined;
  if (!harness || typeof harness.loadSandboxOperation !== "function") {
    throw new Error("M10 sandbox persistence harness is unavailable.");
  }
  return harness.loadSandboxOperation();
}

async function openSandbox(page: Page, testInfo: TestInfo) {
  test.skip(
    testInfo.project.name === "visual",
    "Sandbox behavior is covered by the WebGPU and WebGL 2 projects.",
  );
  const renderer =
    testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu";
  await page.goto(`/?renderer=${renderer}`);
  const viewport = page.getByTestId("machine-viewport");
  await expect(viewport).toHaveAttribute("data-ready", "true");
  await expect(viewport).toHaveAttribute("data-persistence-state", "ready");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Boolean(window.__CNC_RENDER_M7__) &&
          Boolean(window.__CNC_RENDER_M8__),
      ),
    )
    .toBe(true);
  await page.getByTestId("workspace-area-sandbox").click();
  await expect(page.getByTestId("sandbox-workspace")).toBeVisible();
  return viewport;
}

function parsedJournal(report: SandboxPersistenceReport) {
  return typeof report.journal === "string"
    ? (JSON.parse(report.journal) as {
        readonly schemaVersion: number;
        readonly cursor: number;
        readonly revisions: readonly unknown[];
      })
    : report.journal;
}

test.describe("M10 sandbox operation", () => {
  test("creates, edits, runs, saves, and reloads one face-milling operation", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const viewport = await openSandbox(page, testInfo);
    const sandbox = page.getByTestId("sandbox-workspace");

    const machine = page.getByTestId("sandbox-machine");
    const stock = page.getByTestId("sandbox-stock-preset");
    const material = page.getByTestId("sandbox-material");
    const tool = page.getByTestId("sandbox-tool");
    const direction = page.getByTestId("sandbox-cut-direction");
    await machine.selectOption(SANDBOX_IDS.machineId);
    await material.selectOption(SANDBOX_IDS.materialId);
    await tool.selectOption(SANDBOX_IDS.toolAssemblyId);
    await stock.selectOption("compact");
    await direction.selectOption("y");
    await page.getByTestId("sandbox-operation-create").click();

    const name = page.getByTestId("sandbox-operation-name");
    const feed = page.getByTestId("sandbox-feed-mm-per-min");
    const spindle = page.getByTestId("sandbox-spindle-rpm");
    const depth = page.getByTestId("sandbox-depth-of-cut-mm");
    const width = page.getByTestId("sandbox-width-of-cut-mm");
    await expect(sandbox).toHaveAttribute("data-state", "ready");
    await expect(feed).toHaveValue("2400");
    await expect(spindle).toHaveValue("6000");
    await expect(depth).toHaveValue("4");
    await expect(width).toHaveValue("20");

    await name.fill("소형 Y축 정삭");
    await feed.fill("1800");
    await spindle.fill("7200");
    await depth.fill("5");
    await width.fill("16");
    await page.getByTestId("sandbox-operation-apply").click();
    await expect(sandbox).toHaveAttribute("data-revision", "2");

    const undo = page.getByTestId("sandbox-operation-undo");
    const redo = page.getByTestId("sandbox-operation-redo");
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(feed).toHaveValue("2400");
    await expect(depth).toHaveValue("4");
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(name).toHaveValue("소형 Y축 정삭");
    await expect(feed).toHaveValue("1800");
    await expect(spindle).toHaveValue("7200");
    await expect(depth).toHaveValue("5");
    await expect(width).toHaveValue("16");

    const previousRunId = await page.evaluate(
      () => window.__CNC_RENDER_M7__?.getPipelineState().summary?.runId,
    );
    await page.getByTestId("sandbox-operation-run").click();
    await expect
      .poll(
        () =>
          page.evaluate((beforeRunId) => {
            const state = window.__CNC_RENDER_M7__?.getPipelineState();
            return state?.status === "completed" &&
              state.summary?.runId !== beforeRunId
              ? state.summary
              : null;
          }, previousRunId),
        { timeout: 30_000 },
      )
      .not.toBeNull();
    const completed = await page.evaluate(() =>
      window.__CNC_RENDER_M7__?.getPipelineState(),
    );
    expect(completed?.fixture).toBe("milling");
    expect(completed?.millingConfiguration).toEqual({
      stockPreset: "compact",
      cutDirection: "y",
    });
    expect(completed?.millingOperation).toEqual({
      cuttingFeedMmPerMin: 1_800,
      spindleSpeedRpm: 7_200,
      depthOfCutMm: 5,
    });
    expect(completed?.summary).toMatchObject({
      completed: true,
      stopped: false,
    });
    expect(completed?.summary?.removedVolumeMm3).toBeGreaterThan(0);
    await expect(viewport).toHaveAttribute(
      "data-pipeline-stock-preset",
      "compact",
    );
    await expect(viewport).toHaveAttribute("data-pipeline-cut-direction", "y");
    await expect(viewport).toHaveAttribute("data-pipeline-cutting-feed", "1800");
    await expect(viewport).toHaveAttribute("data-pipeline-spindle-speed", "7200");
    await expect(viewport).toHaveAttribute("data-pipeline-cut-depth", "5");

    await page.getByTestId("sandbox-operation-save").click();
    await expect(viewport).toHaveAttribute("data-persistence-state", "saved");
    const beforeReload = await page.evaluate(loadSandboxPersistence);
    const beforeJournal = parsedJournal(beforeReload);
    expect(beforeReload.operationDocument).toMatchObject({
      presetId: "sandbox.face-milling.e2",
      configuration: { stockPreset: "compact", cutDirection: "y" },
      operation: {
        name: "소형 Y축 정삭",
        operationType: "milling",
        strategy: "face-zig-zag-y",
        toolAssemblyId: SANDBOX_IDS.toolAssemblyId,
        feed: { mode: "per-minute", feedMmPerMin: 1_800 },
        spindleSpeedRpm: 7_200,
        spindleDirection: "clockwise",
        depthOfCutMm: 5,
        widthOfCutMm: 16,
      },
    });
    expect(beforeJournal).toMatchObject({ schemaVersion: 1, cursor: 1 });
    expect(beforeJournal.revisions).toHaveLength(2);
    for (const hash of Object.values(beforeReload.componentHashes)) {
      expect(hash).toMatch(SHA256_HEX);
    }
    expect(beforeReload.stateSemanticHashSha256).toMatch(SHA256_HEX);
    expect(beforeReload.stockHashSha256).toMatch(SHA256_HEX);

    await page.reload();
    await openSandbox(page, testInfo);
    await page.getByTestId("sandbox-operation-load").click();
    await expect(page.getByTestId("sandbox-operation-name")).toHaveValue(
      "소형 Y축 정삭",
    );
    await expect(page.getByTestId("sandbox-feed-mm-per-min")).toHaveValue(
      "1800",
    );
    await expect(page.getByTestId("sandbox-spindle-rpm")).toHaveValue("7200");
    await expect(page.getByTestId("sandbox-depth-of-cut-mm")).toHaveValue(
      "5",
    );
    await expect(page.getByTestId("sandbox-width-of-cut-mm")).toHaveValue(
      "16",
    );
    await expect(page.getByTestId("sandbox-stock-preset")).toHaveValue(
      "compact",
    );
    await expect(page.getByTestId("sandbox-cut-direction")).toHaveValue("y");

    const afterReload = await page.evaluate(loadSandboxPersistence);
    const afterJournal = parsedJournal(afterReload);
    expect(afterReload.generationId).toBe(beforeReload.generationId);
    expect(afterReload.checkpointId).toBe(beforeReload.checkpointId);
    expect(afterReload.componentHashes).toEqual(beforeReload.componentHashes);
    expect(afterReload.stateSemanticHashSha256).toBe(
      beforeReload.stateSemanticHashSha256,
    );
    expect(afterReload.stockHashSha256).toBe(beforeReload.stockHashSha256);
    expect(afterReload.operationDocument).toEqual(
      beforeReload.operationDocument,
    );
    expect(afterJournal).toEqual(beforeJournal);
    await expect(page.getByTestId("sandbox-operation-undo")).toBeEnabled();
  });
});

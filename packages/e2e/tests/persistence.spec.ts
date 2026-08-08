import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function openM8Persistence(page: Page, testInfo: TestInfo) {
  test.skip(
    testInfo.project.name === "visual",
    "M8 persistence is covered by the WebGPU and WebGL 2 projects.",
  );
  const renderer =
    testInfo.project.name === "chromium-webgl2" ? "webgl2" : "webgpu";
  await page.goto(`/?renderer=${renderer}`);
  const viewport = page.getByTestId("machine-viewport");
  await expect(viewport).toHaveAttribute("data-ready", "true");
  await expect(viewport).toHaveAttribute("data-persistence-state", "ready");
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__CNC_RENDER_M8__)))
    .toBe(true);
  return viewport;
}

test.describe("M8 browser persistence pipeline", () => {
  test("save-load preserves semantic hashes after restart and quarantines an interrupted save", async ({
    page,
  }, testInfo) => {
    const viewport = await openM8Persistence(page, testInfo);
    const saved = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M8__;
      if (!harness) {
        throw new Error("M8 browser harness is unavailable.");
      }
      return harness.saveFixture("milling");
    });
    expect(saved.currentStep).toBeGreaterThan(0);
    expect(saved.logicalTimeS).toBeGreaterThan(0);
    expect(saved.checkpointByteLength).toBeGreaterThan(0);
    for (const hash of Object.values(saved.componentHashes)) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    }
    await expect(viewport).toHaveAttribute("data-persistence-state", "saved");

    await page.reload();
    await openM8Persistence(page, testInfo);
    const loaded = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M8__;
      if (!harness) {
        throw new Error("M8 browser harness is unavailable after reload.");
      }
      return harness.loadPersistedProject();
    });
    expect(loaded.generationId).toBe(saved.generationId);
    expect(loaded.checkpointId).toBe(saved.checkpointId);
    expect(loaded.componentHashes).toEqual(saved.componentHashes);
    expect(loaded.stateSemanticHashSha256).toBe(
      saved.stateSemanticHashSha256,
    );
    expect(loaded.stockHashSha256).toBe(saved.stockHashSha256);
    expect(loaded.currentStep).toBe(saved.currentStep);
    expect(loaded.logicalTimeS).toBe(saved.logicalTimeS);
    expect(loaded.renderedOnFrame).toBeGreaterThan(0);
    expect(loaded.recoveryOutcomes).toEqual([]);

    const interrupted = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M8__;
      if (!harness) {
        throw new Error("M8 browser harness is unavailable.");
      }
      return harness.testInterruptedSave();
    });
    expect(interrupted.beforeGenerationId).toBe(saved.generationId);
    expect(interrupted.afterGenerationId).toBe(saved.generationId);
    expect(interrupted.recoveryOutcome).toBe("quarantined");
    expect(interrupted.diagnosticCode).toBe(
      "storage.recovery.marker-missing",
    );
    expect(interrupted.quarantineCount).toBe(1);

    const cloudPlan = await page.evaluate(
      () => window.__CNC_RENDER_M8__?.getCloudPlan(),
    );
    expect(cloudPlan).toEqual({
      schemaVersion: 1,
      enabled: false,
      reason: "user-consent-required",
      d1Binding: null,
      r2Binding: null,
      containsProjectBytes: false,
    });
  });

  test("checkpoint reverse scrub matches a full Worker/WASM replay", async ({
    page,
  }, testInfo) => {
    const viewport = await openM8Persistence(page, testInfo);
    const saved = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M8__;
      if (!harness) {
        throw new Error("M8 browser harness is unavailable.");
      }
      return harness.saveFixture("milling");
    });

    await page.evaluate(async () => {
      const pipeline = window.__CNC_RENDER_M7__;
      if (!pipeline) {
        throw new Error("M7 browser harness is unavailable.");
      }
      await pipeline.runPipelineFixture("turning", {
        playbackSpeed: 100,
        executionMode: "fast-forward",
      });
    });
    const restored = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M8__;
      if (!harness) {
        throw new Error("M8 browser harness is unavailable.");
      }
      return harness.loadPersistedProject();
    });
    await expect(viewport).toHaveAttribute(
      "data-pipeline-state",
      "checkpoint-restored",
    );
    expect(restored.stateSemanticHashSha256).toBe(
      saved.stateSemanticHashSha256,
    );
    expect(restored.stockHashSha256).toBe(saved.stockHashSha256);

    const replayed = await page.evaluate(async () => {
      const pipeline = window.__CNC_RENDER_M7__;
      if (!pipeline) {
        throw new Error("M7 browser harness is unavailable.");
      }
      return pipeline.runPipelineFixture("milling", {
        playbackSpeed: 100,
        executionMode: "fast-forward",
      });
    });
    expect(replayed.stateSemanticHashSha256).toBe(
      saved.stateSemanticHashSha256,
    );
    expect(replayed.stockHashSha256).toBe(saved.stockHashSha256);
  });

  test("migration preserves the prior schema fixture bytes", async ({
    page,
  }, testInfo) => {
    await openM8Persistence(page, testInfo);
    const migration = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M8__;
      if (!harness) {
        throw new Error("M8 browser harness is unavailable.");
      }
      return harness.testMigrationFixture();
    });
    expect(migration.migratedFromSchemaVersion).toBe(0);
    expect(migration.schemaVersion).toBe(1);
    expect(migration.originalPreserved).toBe(true);
    expect(migration.originalSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(migration.deterministicSeed).toBe(0);
  });

  test("corruption reports a stable CRC diagnostic under the 100 MiB limit", async ({
    page,
  }, testInfo) => {
    await openM8Persistence(page, testInfo);
    const result = await page.evaluate(async () => {
      const harness = window.__CNC_RENDER_M8__;
      if (!harness) {
        throw new Error("M8 browser harness is unavailable.");
      }
      return harness.testCorruptionFixture();
    });
    expect(result.diagnosticCode).toBe("storage.import.crc-mismatch");
    expect(result.defaultUploadLimitBytes).toBe(100 * 1024 * 1024);
  });
});

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { CoordinatorCoreSummary } from "@cnc-render/contracts";
import {
  CncRenderWasmRuntime,
  createM7PipelineFixture,
  type M7PipelineFixture,
} from "@cnc-render/simulation";
import { beforeAll, describe, expect, test } from "vitest";

let wasmBytes: ArrayBuffer;

beforeAll(async () => {
  const bytes = await readFile(
    resolve("public", "wasm", "cnc_render_wasm.wasm"),
  );
  wasmBytes = Uint8Array.from(bytes).buffer;
});

async function replay(
  fixture: M7PipelineFixture,
  runId: string,
): Promise<{
  readonly summary: CoordinatorCoreSummary;
  readonly renderUpdates: number;
}> {
  const runtime = await CncRenderWasmRuntime.instantiate(wasmBytes);
  let invocation = runtime.initialize(createM7PipelineFixture(fixture, runId));
  let renderUpdates = invocation.summary.render === null ? 0 : 1;
  while (!invocation.summary.completed && !invocation.summary.stopped) {
    invocation = runtime.step();
    if (invocation.summary.render !== null) {
      renderUpdates += 1;
      expect(invocation.binary.byteLength).toBeGreaterThan(0);
    }
  }
  return { summary: invocation.summary, renderUpdates };
}

describe("M7 deterministic WASM replay parity", () => {
  test.each([
    ["milling", "70000000-0000-4000-8000-000000000201", "70000000-0000-4000-8000-000000000202"],
    ["turning", "70000000-0000-4000-8000-000000000203", "70000000-0000-4000-8000-000000000204"],
  ] as const)(
    "%s has the same final semantic hash for realtime and fast-forward runs",
    async (fixture, realtimeRunId, fastForwardRunId) => {
      const realtime = await replay(fixture, realtimeRunId);
      const fastForward = await replay(fixture, fastForwardRunId);

      expect(realtime.summary.finalSemanticHashSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fastForward.summary.finalSemanticHashSha256).toBe(
        realtime.summary.finalSemanticHashSha256,
      );
      expect(fastForward.summary.stockHashSha256).toBe(
        realtime.summary.stockHashSha256,
      );
      expect(fastForward.summary.toolPositionMm).toEqual(
        realtime.summary.toolPositionMm,
      );
      expect(realtime.renderUpdates).toBeGreaterThan(1);
    },
  );

  test("pause snapshots do not advance stock, axes, diagnostics, or logical time", async () => {
    const runtime = await CncRenderWasmRuntime.instantiate(wasmBytes);
    runtime.initialize(
      createM7PipelineFixture(
        "milling",
        "70000000-0000-4000-8000-000000000205",
      ),
    );
    runtime.step();
    const first = runtime.snapshot().summary;
    const second = runtime.snapshot().summary;

    expect(second.stateSemanticHashSha256).toBe(first.stateSemanticHashSha256);
    expect(second.stockRevision).toBe(first.stockRevision);
    expect(second.toolPositionMm).toEqual(first.toolPositionMm);
    expect(second.diagnosticCodes).toEqual(first.diagnosticCodes);
    expect(second.logicalTimeS).toBe(first.logicalTimeS);
  });

  test("collision-stop terminates before the remaining toolpath is applied", async () => {
    const result = await replay(
      "collision-stop",
      "70000000-0000-4000-8000-000000000206",
    );
    expect(result.summary.stopped).toBe(true);
    expect(result.summary.completed).toBe(false);
    expect(result.summary.collision?.code).toBe("collision.tool.fixture");
    expect(result.summary.currentStep).toBeLessThan(result.summary.totalSteps);
    expect(result.summary.finalSemanticHashSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

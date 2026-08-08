import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { CoordinatorCoreSummary } from "@cnc-render/contracts";
import {
  CncRenderWasmRuntime,
  createM7PipelineFixture,
  type M7PipelineFixture,
  type WasmCoreInvocation,
} from "@cnc-render/simulation";
import {
  decodeSimulationCheckpoint,
  encodeSimulationCheckpoint,
  type CheckpointRender,
  type EncodedSimulationCheckpoint,
} from "@cnc-render/storage";
import { beforeAll, describe, expect, test } from "vitest";

const PROJECT_ID = "82000000-0000-4000-8000-000000000001";
const PROJECT_HASH = "8".repeat(64);

let wasmBytes: ArrayBuffer;

beforeAll(async () => {
  const bytes = await readFile(
    resolve("public", "wasm", "cnc_render_wasm.wasm"),
  );
  wasmBytes = Uint8Array.from(bytes).buffer;
});

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  const parsed = number(value, label);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return parsed;
}

function point3(value: unknown, label: string) {
  const point = record(value, label);
  return {
    xMm: number(point.xMm, `${label}.xMm`),
    yMm: number(point.yMm, `${label}.yMm`),
    zMm: number(point.zMm, `${label}.zMm`),
  };
}

function floatSlice(
  invocation: WasmCoreInvocation,
  binaryKind: string,
): Float32Array {
  const layout = invocation.summary.binaryLayout.find(
    (entry) => entry.binaryKind === binaryKind,
  );
  if (!layout) {
    throw new Error(`missing WASM binary slice ${binaryKind}`);
  }
  const offset = number(layout.offset, `${binaryKind}.offset`);
  const byteLength = number(layout.byteLength, `${binaryKind}.byteLength`);
  if (offset % 4 !== 0 || byteLength % 4 !== 0) {
    throw new Error(`unaligned WASM binary slice ${binaryKind}`);
  }
  return new Float32Array(
    invocation.binary,
    offset,
    byteLength / 4,
  ).slice();
}

function fullRender(invocation: WasmCoreInvocation): CheckpointRender {
  const render = record(invocation.summary.render, "render");
  if (render.renderType === "milling-full") {
    const bounds = record(render.boundsMm, "boundsMm");
    return {
      renderType: "milling-full",
      boundsMm: {
        minimum: point3(bounds.minimum, "boundsMm.minimum"),
        maximum: point3(bounds.maximum, "boundsMm.maximum"),
      },
      columns: integer(render.columns, "columns"),
      rows: integer(render.rows, "rows"),
      resolutionMm: number(render.resolutionMm, "resolutionMm"),
      topZMm: floatSlice(invocation, "milling.top-z-mm"),
    };
  }
  if (render.renderType === "turning-full") {
    const center = record(render.axisCenterMm, "axisCenterMm");
    return {
      renderType: "turning-full",
      axisCenterMm: {
        xMm: number(center.xMm, "axisCenterMm.xMm"),
        yMm: number(center.yMm, "axisCenterMm.yMm"),
      },
      minimumZMm: number(render.minimumZMm, "minimumZMm"),
      maximumZMm: number(render.maximumZMm, "maximumZMm"),
      axialCells: integer(render.axialCells, "axialCells"),
      radialSegments: integer(render.radialSegments, "radialSegments"),
      resolutionMm: number(render.resolutionMm, "resolutionMm"),
      innerRadiusMm: floatSlice(invocation, "turning.inner-radius-mm"),
      outerRadiusMm: floatSlice(invocation, "turning.outer-radius-mm"),
    };
  }
  throw new Error(`snapshot is not a full render: ${String(render.renderType)}`);
}

async function encodeInvocation(
  invocation: WasmCoreInvocation,
): Promise<EncodedSimulationCheckpoint> {
  const summary = invocation.summary;
  return encodeSimulationCheckpoint(
    {
      schemaVersion: 1,
      engineVersion: summary.coreVersion,
      projectId: PROJECT_ID,
      projectSemanticHashSha256: PROJECT_HASH,
      runId: summary.runId,
      currentStep: summary.currentStep,
      totalSteps: summary.totalSteps,
      logicalTimeS: summary.logicalTimeS,
      toolPositionMm: summary.toolPositionMm,
      stockRevision: summary.stockRevision,
      stateSemanticHashSha256: summary.stateSemanticHashSha256,
      stockHashSha256: summary.stockHashSha256,
      diagnosticCodes: summary.diagnosticCodes,
      completed: summary.completed,
      stopped: summary.stopped,
    },
    fullRender(invocation),
  );
}

async function snapshotAtStep(
  fixture: M7PipelineFixture,
  runId: string,
  stepCount: number,
): Promise<{
  readonly runtime: CncRenderWasmRuntime;
  readonly invocation: WasmCoreInvocation;
}> {
  const runtime = await CncRenderWasmRuntime.instantiate(wasmBytes);
  const initialized = runtime.initialize(createM7PipelineFixture(fixture, runId));
  const count = Math.min(stepCount, initialized.summary.totalSteps);
  for (let step = 0; step < count; step += 1) {
    runtime.step();
  }
  return { runtime, invocation: runtime.snapshot() };
}

function expectRenderParity(
  persisted: CheckpointRender,
  replayed: CheckpointRender,
): void {
  expect(persisted.renderType).toBe(replayed.renderType);
  if (
    persisted.renderType === "milling-full" &&
    replayed.renderType === "milling-full"
  ) {
    expect(persisted.boundsMm).toEqual(replayed.boundsMm);
    expect(persisted.columns).toBe(replayed.columns);
    expect(persisted.rows).toBe(replayed.rows);
    expect(persisted.resolutionMm).toBe(replayed.resolutionMm);
    expect(persisted.topZMm).toEqual(replayed.topZMm);
    return;
  }
  if (
    persisted.renderType === "turning-full" &&
    replayed.renderType === "turning-full"
  ) {
    expect(persisted.axisCenterMm).toEqual(replayed.axisCenterMm);
    expect(persisted.minimumZMm).toBe(replayed.minimumZMm);
    expect(persisted.maximumZMm).toBe(replayed.maximumZMm);
    expect(persisted.axialCells).toBe(replayed.axialCells);
    expect(persisted.radialSegments).toBe(replayed.radialSegments);
    expect(persisted.resolutionMm).toBe(replayed.resolutionMm);
    expect(persisted.innerRadiusMm).toEqual(replayed.innerRadiusMm);
    expect(persisted.outerRadiusMm).toEqual(replayed.outerRadiusMm);
    return;
  }
  throw new Error("persisted and replayed process types differ");
}

describe("M8 persisted-project WASM checkpoint parity", () => {
  test.each([
    ["milling", "82000000-0000-4000-8000-000000000101"],
    ["turning", "82000000-0000-4000-8000-000000000102"],
  ] as const)(
    "%s reverse scrub matches a full replay at the checkpoint step",
    async (fixture, runId) => {
      const first = await snapshotAtStep(fixture, runId, 2);
      const persisted = await encodeInvocation(first.invocation);

      let terminal: CoordinatorCoreSummary = first.invocation.summary;
      while (!terminal.completed && !terminal.stopped) {
        terminal = first.runtime.step().summary;
      }
      expect(terminal.currentStep).toBeGreaterThanOrEqual(
        first.invocation.summary.currentStep,
      );

      const decoded = await decodeSimulationCheckpoint(persisted.bytes);
      const replay = await snapshotAtStep(fixture, runId, 2);
      const replayEncoded = await encodeInvocation(replay.invocation);

      expect(decoded.header.currentStep).toBe(
        replay.invocation.summary.currentStep,
      );
      expect(decoded.header.stateSemanticHashSha256).toBe(
        replay.invocation.summary.stateSemanticHashSha256,
      );
      expect(decoded.header.stockHashSha256).toBe(
        replay.invocation.summary.stockHashSha256,
      );
      expect(decoded.header.toolPositionMm).toEqual(
        replay.invocation.summary.toolPositionMm,
      );
      expect(decoded.header.diagnosticCodes).toEqual(
        replay.invocation.summary.diagnosticCodes,
      );
      expectRenderParity(decoded.render, fullRender(replay.invocation));
      expect(replayEncoded.bytes).toEqual(persisted.bytes);
    },
  );
});

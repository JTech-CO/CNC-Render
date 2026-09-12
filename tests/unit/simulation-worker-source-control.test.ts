import type { CoordinatorCoreSummary, CoordinatorEvent } from "@cnc-render/contracts";
import { createM7PipelineFixture } from "@cnc-render/simulation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyntheticCoordinatorSummary } from "../helpers/synthetic-coordinator-worker";

const mocked = vi.hoisted(() => ({ runtime: {} as Record<string, unknown> }));
vi.mock("../../packages/simulation/src/wasm-runtime", () => ({
  CncRenderWasmRuntime: { fetch: async () => mocked.runtime },
  CncRenderWasmError: class extends Error {
    constructor(readonly code: string, message: string) { super(message); }
  },
}));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("M11 Worker source-line controls", () => {
  it("bounds a full warning buffer without dropping terminal axis/collision evidence or blocking stopped updates", async () => {
    vi.useFakeTimers();
    const run = createM7PipelineFixture("milling", "70000000-0000-4000-8000-000000000409");
    const packets: { message: CoordinatorEvent }[] = [];
    const warning = (index: number): NonNullable<CoordinatorCoreSummary["runtimeDiagnostics"]>[number] => ({
      id: "runtime-" + index.toString(16).padStart(64, "0"),
      code: "machining.feed.no-removal", origin: "machining-warning", severity: "warning",
      message: "No material removed at E2 resolution.", sourceLine: index + 1,
      objectId: "70000000-0000-4000-8000-000000000010", positionMm: { xMm: 0, yMm: 0, zMm: 370 },
    });
    const warnings = Array.from({ length: 10_000 }, (_, index) => warning(index));
    const collision = { ...warning(10_000), code: "collision.tool.fixture", origin: "collision" as const, severity: "error" as const };
    const axes = [0, 1, 2].map((index) => ({ ...warning(10_001 + index), code: "kinematics.axis.limit-max",
      origin: "axis-limit" as const, severity: "error" as const }));
    let fatal: NonNullable<CoordinatorCoreSummary["runtimeDiagnostics"]> = [collision];
    mocked.runtime = {
      initialize: () => ({ summary: { ...createSyntheticCoordinatorSummary(run, 0, "initialized"), nextSourceLine: 1 }, binary: new ArrayBuffer(0) }),
      sourceTick: () => ({ summary: { ...createSyntheticCoordinatorSummary(run, 1, "stopped"), runtimeDiagnostics: [...warnings, ...fatal] }, binary: new ArrayBuffer(0) }),
      cancel: () => {},
    };
    vi.stubGlobal("location", { origin: "https://cnc-render.example" });
    vi.stubGlobal("postMessage", (packet: { message: CoordinatorEvent }) => packets.push(packet));
    vi.stubGlobal("onmessage", null);
    const { boundRuntimeDiagnostics } = await import("../../packages/simulation/src/simulation.worker");
    expect(boundRuntimeDiagnostics(warnings)).toBe(warnings);
    const boundedAxes = boundRuntimeDiagnostics([...warnings, ...axes]);
    expect(boundedAxes).toHaveLength(10_000);
    expect(boundedAxes.slice(-3)).toEqual(axes);
    expect(warnings).toHaveLength(10_000);
    expect(warnings.at(-1)?.id).toBe(warning(9_999).id);
    const scope = globalThis as unknown as { onmessage(event: { data: unknown }): void };
    for (const [index, evidence] of [[collision], axes].entries()) {
      fatal = evidence;
      scope.onmessage({ data: { protocolVersion: 1, messageId: crypto.randomUUID(), replyTo: null,
        kind: "command", type: "simulation.start", runId: run.runId, sequence: index + 1,
        payload: { executionMode: "fast-forward", playbackSpeed: 1, run } } });
      await vi.advanceTimersByTimeAsync(0);
      const message = packets.at(-1)?.message;
      expect(message?.type).toBe("simulation.update");
      if (message?.type !== "simulation.update") throw new Error(JSON.stringify(message));
      expect(message.payload.summary.stopped).toBe(true);
      expect(message.payload.summary.runtimeDiagnostics).toHaveLength(10_000);
      expect(message.payload.summary.runtimeDiagnostics?.slice(-evidence.length)).toEqual(evidence);
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(packets.some((packet) => packet.message.type === "coordinator.error")).toBe(false);
  });

  it("pauses before a breakpoint, resumes the whole cycle once, honors M0 and steps M30", async () => {
    vi.useFakeTimers();
    const run = createM7PipelineFixture("milling", "70000000-0000-4000-8000-000000000400");
    const packets: { message: CoordinatorEvent }[] = [];
    let tick = 0;
    const states = [
      { currentSourceLine: null, nextSourceLine: 1, currentStep: 0 },
      { currentSourceLine: 1, nextSourceLine: 2, currentStep: 0 },
      { currentSourceLine: 2, nextSourceLine: 2, currentStep: 1 },
      { currentSourceLine: 2, nextSourceLine: 3, currentStep: 2 },
      { currentSourceLine: 3, nextSourceLine: 4, currentStep: 2 },
      { currentSourceLine: 4, nextSourceLine: null, currentStep: 2 },
    ];
    const invocation = () => ({
      summary: {
        ...createSyntheticCoordinatorSummary(run, states[tick].currentStep),
        ...states[tick], totalSteps: 2, completed: tick === 5,
        programPause: tick === 4, phase: tick === 5 ? "completed" : "progress",
      }, binary: new ArrayBuffer(0),
    });
    mocked.runtime = {
      initialize: () => { tick = 0; return invocation(); },
      snapshot: invocation,
      sourceTick: () => { tick += 1; return invocation(); },
      stepSourceLine: () => { const line = states[tick].nextSourceLine;
        do { tick += 1; } while (tick < 5 && states[tick].nextSourceLine === line);
        return invocation(); },
      cancel: () => {},
    };
    vi.stubGlobal("location", { origin: "https://cnc-render.example" });
    vi.stubGlobal("postMessage", (packet: { message: CoordinatorEvent }) => packets.push(packet));
    vi.stubGlobal("onmessage", null);
    await import("../../packages/simulation/src/simulation.worker");
    let sequence = 0;
    const send = async (type: string, payload: unknown) => {
      sequence += 1;
      const scope = globalThis as unknown as { onmessage(event: { data: unknown }): void };
      scope.onmessage({ data: { protocolVersion: 1, messageId: crypto.randomUUID(), replyTo: null,
        kind: "command", type, runId: run.runId, sequence, payload } });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    };
    const latest = (): CoordinatorCoreSummary => {
      const message = packets.at(-1)?.message;
      if (message?.type !== "simulation.update") throw new Error(JSON.stringify(message));
      return message.payload.summary;
    };
    await send("simulation.start", { executionMode: "realtime", playbackSpeed: 1, startPaused: true, breakpoints: [2], run });
    expect(latest()).toMatchObject({ paused: true, currentSourceLine: null, nextSourceLine: 1 });
    await send("simulation.step-source-line", {});
    expect(latest()).toMatchObject({ paused: true, currentStep: 0, currentSourceLine: 1, pauseReason: "step" });
    await send("simulation.resume", { playbackSpeed: 1 });
    await vi.advanceTimersByTimeAsync(20);
    expect(latest()).toMatchObject({ paused: true, currentStep: 0, nextSourceLine: 2, pauseReason: "breakpoint" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toBe(1);
    await send("simulation.resume", { playbackSpeed: 1 });
    await vi.advanceTimersByTimeAsync(40);
    expect(latest()).toMatchObject({ paused: false, currentSourceLine: 2, nextSourceLine: 3, currentStep: 2 });
    await vi.advanceTimersByTimeAsync(20);
    expect(latest()).toMatchObject({ paused: true, currentSourceLine: 3, pauseReason: "program-control" });
    await send("simulation.breakpoints", { lines: [4] });
    expect(latest()).toMatchObject({ paused: true, currentSourceLine: 3 });
    await send("simulation.step-source-line", {});
    expect(latest()).toMatchObject({ paused: false, completed: true, currentSourceLine: 4, nextSourceLine: null });
  });
});

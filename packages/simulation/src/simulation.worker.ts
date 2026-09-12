import {
  CoordinatorCommandSchema,
  CoordinatorEventSchema,
  PRODUCT_VERSION,
  type CoordinatorBinarySlice,
  type CoordinatorCommand,
  type CoordinatorCoreSummary,
  type CoordinatorEvent,
  type CoordinatorTransportPacket,
} from "@cnc-render/contracts";

import {
  CncRenderWasmError,
  CncRenderWasmRuntime,
  type WasmCoreInvocation,
} from "./wasm-runtime";

interface WorkerScope {
  readonly location: Location;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
const ASSET_BASE_URL = new URL(import.meta.env.BASE_URL, scope.location.origin);
const CORE_URL = new URL("wasm/cnc_render_wasm.wasm", ASSET_BASE_URL);
const BASE_DISPLAY_STEP_MS = 20;
const MAX_RUNTIME_DIAGNOSTICS = 10_000;

type RuntimeDiagnostics = NonNullable<CoordinatorCoreSummary["runtimeDiagnostics"]>;

/** Keep terminal evidence when the core's warning buffer already fills the wire limit. */
export function boundRuntimeDiagnostics(diagnostics: RuntimeDiagnostics): RuntimeDiagnostics {
  if (diagnostics.length <= MAX_RUNTIME_DIAGNOSTICS) return diagnostics;
  const isTerminalEvidence = (diagnostic: RuntimeDiagnostics[number]) =>
    diagnostic.origin !== "machining-warning" || diagnostic.severity === "error";
  const terminalCount = diagnostics.reduce((count, diagnostic) => count + (isTerminalEvidence(diagnostic) ? 1 : 0), 0);
  if (terminalCount > MAX_RUNTIME_DIAGNOSTICS) {
    // No valid current core run can emit this many fatal records. Never silently lose them.
    throw new CncRenderWasmError("coordinator.diagnostics.resource-limit", "Terminal diagnostic evidence exceeds the protocol limit.");
  }
  let warningSlots = MAX_RUNTIME_DIAGNOSTICS - terminalCount;
  return diagnostics.filter((diagnostic) => {
    if (isTerminalEvidence(diagnostic)) return true;
    if (warningSlots === 0) return false;
    warningSlots -= 1;
    return true;
  });
}

let runtimePromise: Promise<CncRenderWasmRuntime> | null = null;
let activeRunId: string | null = null;
let playbackSpeed = 1;
let executionMode: "realtime" | "fast-forward" = "realtime";
let eventSequence = 0;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let paused = false;
let pauseReason: CoordinatorCoreSummary["pauseReason"] = null;
let breakpoints = new Set<number>();
let breakpointPassLine: number | null = null;
let lastSummary: CoordinatorCoreSummary | null = null;
let lastCommandSequence = 0;

function runtime(): Promise<CncRenderWasmRuntime> {
  runtimePromise ??= CncRenderWasmRuntime.fetch(CORE_URL);
  return runtimePromise;
}

function clearScheduledStep(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function nextEventSequence(): number {
  eventSequence += 1;
  return eventSequence;
}

function binarySlices(
  summary: CoordinatorCoreSummary,
): CoordinatorBinarySlice[] {
  return summary.binaryLayout.map((entry) => {
    const binaryKind = entry.binaryKind;
    const byteOffset = entry.offset;
    const byteLength = entry.byteLength;
    const elementType = entry.elementType;
    if (
      typeof binaryKind !== "string" ||
      typeof byteOffset !== "number" ||
      typeof byteLength !== "number" ||
      (elementType !== "uint32" && elementType !== "float32")
    ) {
      throw new CncRenderWasmError(
        "wasm.binary-layout.invalid",
        "WASM returned an invalid binary layout descriptor.",
      );
    }
    return {
      handleId: crypto.randomUUID(),
      binaryKind: binaryKind as CoordinatorBinarySlice["binaryKind"],
      byteOffset,
      byteLength,
      elementType,
      ownership: "receiver",
      transferMode: "transferable",
    };
  });
}

function postPacket(
  message: CoordinatorEvent,
  binary: ArrayBuffer | null = null,
): void {
  const validated = CoordinatorEventSchema.parse(message);
  const packet: CoordinatorTransportPacket = {
    message: validated,
    binary,
  };
  if (binary && binary.byteLength > 0) {
    scope.postMessage(packet, [binary]);
  } else {
    scope.postMessage(packet);
  }
}

function postInvocation(
  invocation: WasmCoreInvocation,
  replyTo: string | null,
): void {
  const summary = {
    ...invocation.summary,
    ...(invocation.summary.runtimeDiagnostics ? {
      runtimeDiagnostics: boundRuntimeDiagnostics(invocation.summary.runtimeDiagnostics),
    } : {}),
    paused: paused && !invocation.summary.completed && !invocation.summary.stopped,
    pauseReason: invocation.summary.completed || invocation.summary.stopped ? null : pauseReason,
  };
  lastSummary = summary;
  if (summary.runId !== activeRunId) {
    return;
  }
  postPacket(
    {
      protocolVersion: 1,
      messageId: crypto.randomUUID(),
      replyTo,
      kind: "event",
      type: "simulation.update",
      runId: summary.runId,
      sequence: nextEventSequence(),
      payload: {
        summary,
        binarySlices: binarySlices(summary),
      },
    },
    invocation.binary.byteLength > 0 ? invocation.binary : null,
  );
}

function postError(
  error: unknown,
  replyTo: string | null,
  recoverable = false,
): void {
  const code =
    error instanceof CncRenderWasmError
      ? error.code
      : "coordinator.worker.failed";
  const message = error instanceof Error ? error.message : String(error);
  postPacket({
    protocolVersion: 1,
    messageId: crypto.randomUUID(),
    replyTo,
    kind: "event",
    type: "coordinator.error",
    runId: activeRunId,
    sequence: activeRunId === null ? 0 : nextEventSequence(),
    payload: { code, message, recoverable },
  });
}

function scheduleStep(expectedGeneration: number): void {
  clearScheduledStep();
  if (paused || activeRunId === null || expectedGeneration !== generation) {
    return;
  }
  const delay =
    executionMode === "fast-forward"
      ? 0
      : Math.max(0, BASE_DISPLAY_STEP_MS / playbackSpeed);
  timer = setTimeout(() => {
    timer = null;
    void runStep(expectedGeneration);
  }, delay);
}

async function runStep(expectedGeneration: number): Promise<void> {
  if (paused || activeRunId === null || expectedGeneration !== generation) {
    return;
  }
  try {
    const wasm = await runtime();
    if (expectedGeneration !== generation || paused || activeRunId === null) {
      return;
    }
    const nextLine = lastSummary?.nextSourceLine ?? null;
    if (breakpointPassLine !== null && nextLine !== breakpointPassLine) {
      breakpointPassLine = null;
    }
    if (nextLine !== null && nextLine !== lastSummary?.currentSourceLine
      && breakpoints.has(nextLine) && breakpointPassLine !== nextLine) {
      paused = true;
      pauseReason = "breakpoint";
      postInvocation(wasm.snapshot(), null);
      return;
    }
    const invocation = wasm.sourceTick();
    if (expectedGeneration !== generation || invocation.summary.runId !== activeRunId) {
      return;
    }
    if (invocation.summary.programPause && !invocation.summary.completed && !invocation.summary.stopped) {
      paused = true;
      pauseReason = "program-control";
    }
    postInvocation(invocation, null);
    if (!invocation.summary.completed && !invocation.summary.stopped) {
      scheduleStep(expectedGeneration);
    }
  } catch (error) {
    postError(error, null);
  }
}

function acceptRunCommand(command: CoordinatorCommand): boolean {
  if (command.runId === null || command.runId !== activeRunId) {
    return false;
  }
  if (command.sequence <= lastCommandSequence) {
    return false;
  }
  lastCommandSequence = command.sequence;
  return true;
}

async function handleCommand(command: CoordinatorCommand): Promise<void> {
  switch (command.type) {
    case "coordinator.handshake": {
      try {
        await runtime();
        postPacket({
          protocolVersion: 1,
          messageId: crypto.randomUUID(),
          replyTo: command.messageId,
          kind: "event",
          type: "coordinator.ready",
          runId: null,
          sequence: 0,
          payload: {
            coreVersion: PRODUCT_VERSION,
            selectedProtocolVersion: 1,
            transferMode: "transferable",
            wasm: true,
          },
        });
      } catch (error) {
        postError(error, command.messageId);
      }
      return;
    }
    case "simulation.start": {
      clearScheduledStep();
      generation += 1;
      const currentGeneration = generation;
      activeRunId = command.runId;
      playbackSpeed = command.payload.playbackSpeed;
      executionMode = command.payload.executionMode;
      eventSequence = 0;
      lastCommandSequence = command.sequence;
      paused = command.payload.startPaused ?? false;
      pauseReason = paused ? "user" : null;
      breakpoints = new Set(command.payload.breakpoints ?? []);
      breakpointPassLine = null;
      lastSummary = null;
      try {
        const wasm = await runtime();
        if (currentGeneration !== generation) {
          return;
        }
        const invocation = wasm.initialize(command.payload.run);
        postInvocation(invocation, command.messageId);
        if (!invocation.summary.completed) {
          scheduleStep(currentGeneration);
        }
      } catch (error) {
        postError(error, command.messageId);
      }
      return;
    }
    case "simulation.pause": {
      if (!acceptRunCommand(command)) {
        return;
      }
      paused = true;
      pauseReason = "user";
      clearScheduledStep();
      try {
        postInvocation((await runtime()).snapshot(), command.messageId);
      } catch (error) {
        postError(error, command.messageId, true);
      }
      return;
    }
    case "simulation.resume": {
      if (!acceptRunCommand(command)) {
        return;
      }
      playbackSpeed = command.payload.playbackSpeed;
      if (pauseReason === "breakpoint") {
        breakpointPassLine = lastSummary?.nextSourceLine ?? null;
      }
      paused = false;
      pauseReason = null;
      scheduleStep(generation);
      return;
    }
    case "simulation.breakpoints": {
      if (!acceptRunCommand(command)) return;
      breakpoints = new Set(command.payload.lines);
      try {
        postInvocation((await runtime()).snapshot(), command.messageId);
      } catch (error) {
        postError(error, command.messageId, true);
      }
      return;
    }
    case "simulation.step-source-line": {
      if (!acceptRunCommand(command)) return;
      clearScheduledStep();
      paused = true;
      pauseReason = "step";
      breakpointPassLine = null;
      try {
        const invocation = (await runtime()).stepSourceLine();
        if (invocation.summary.programPause) pauseReason = "program-control";
        postInvocation(invocation, command.messageId);
      } catch (error) {
        postError(error, command.messageId, true);
      }
      return;
    }
    case "simulation.snapshot": {
      if (!acceptRunCommand(command)) {
        return;
      }
      try {
        postInvocation((await runtime()).snapshot(), command.messageId);
      } catch (error) {
        postError(error, command.messageId, true);
      }
      return;
    }
    case "simulation.cancel":
    case "run.dispose": {
      if (!acceptRunCommand(command)) {
        return;
      }
      clearScheduledStep();
      paused = true;
      generation += 1;
      try {
        (await runtime()).cancel();
      } catch (error) {
        postError(error, command.messageId, true);
      }
      postPacket({
        protocolVersion: 1,
        messageId: crypto.randomUUID(),
        replyTo: command.messageId,
        kind: "event",
        type: "run.disposed",
        runId: command.runId,
        sequence: nextEventSequence(),
        payload: {
          reason:
            command.type === "simulation.cancel"
              ? command.payload.reason
              : command.payload.reason,
        },
      });
      activeRunId = null;
      return;
    }
  }
}

scope.onmessage = (event) => {
  const parsed = CoordinatorCommandSchema.safeParse(event.data);
  if (!parsed.success) {
    postError(
      new CncRenderWasmError(
        "coordinator.command.invalid",
        parsed.error.issues[0]?.message ?? "Invalid coordinator command.",
      ),
      null,
    );
    return;
  }
  void handleCommand(parsed.data);
};

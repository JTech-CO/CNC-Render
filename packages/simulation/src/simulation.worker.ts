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

let runtimePromise: Promise<CncRenderWasmRuntime> | null = null;
let activeRunId: string | null = null;
let playbackSpeed = 1;
let executionMode: "realtime" | "fast-forward" = "realtime";
let eventSequence = 0;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let paused = false;
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
  const summary = invocation.summary;
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
    const invocation = wasm.step();
    if (expectedGeneration !== generation || invocation.summary.runId !== activeRunId) {
      return;
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
      paused = false;
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
      paused = false;
      scheduleStep(generation);
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

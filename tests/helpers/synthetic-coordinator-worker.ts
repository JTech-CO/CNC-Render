import {
  CoordinatorCommandSchema,
  CoordinatorEventSchema,
  type CoordinatorCoreSummary,
  type CoordinatorRunRequest,
} from "@cnc-render/contracts";

const TOOLPATH_ID = "70000000-0000-4000-8000-000000000301";
const HASH = "7".repeat(64);

export function createSyntheticCoordinatorSummary(
  run: CoordinatorRunRequest,
  currentStep: number,
  phase: CoordinatorCoreSummary["phase"] = "progress",
): CoordinatorCoreSummary {
  const terminal = phase === "completed" || phase === "stopped";
  return {
    schemaVersion: 1,
    coreVersion: "0.1.0",
    wasm: true,
    phase,
    runId: run.runId,
    fixtureId: run.fixtureId,
    processType: run.process.processType,
    toolpathId: TOOLPATH_ID,
    parseSemanticHashSha256: HASH,
    stateSemanticHashSha256: HASH,
    finalSemanticHashSha256: terminal ? HASH : null,
    stockHashSha256: HASH,
    currentStep,
    totalSteps: 10_000,
    logicalTimeS: currentStep / 100,
    toolPositionMm: {
      xMm: currentStep / 100,
      yMm: 0,
      zMm: 0,
    },
    stockRevision: currentStep,
    removedVolumeMm3: currentStep / 10,
    diagnosticCodes: [],
    collision: null,
    completed: phase === "completed",
    stopped: phase === "stopped",
    render: null,
    binaryLayout: [],
    binaryByteLength: 0,
  };
}

export class SyntheticCoordinatorWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  #activeRun: CoordinatorRunRequest | null = null;
  #eventSequence = 0;

  postMessage(input: unknown): void {
    const command = CoordinatorCommandSchema.parse(input);
    switch (command.type) {
      case "coordinator.handshake":
        this.#emit({
          protocolVersion: 1,
          messageId: crypto.randomUUID(),
          replyTo: command.messageId,
          kind: "event",
          type: "coordinator.ready",
          runId: null,
          sequence: 0,
          payload: {
            coreVersion: "0.1.0",
            selectedProtocolVersion: 1,
            transferMode: "transferable",
            wasm: true,
          },
        });
        return;
      case "simulation.start":
        this.#activeRun = command.payload.run;
        this.#eventSequence = 1;
        this.emitRunUpdate(
          command.payload.run,
          this.#eventSequence,
          "initialized",
          command.messageId,
        );
        return;
      case "simulation.pause":
      case "simulation.snapshot":
        if (this.#activeRun) {
          this.#eventSequence += 1;
          this.emitRunUpdate(
            this.#activeRun,
            this.#eventSequence,
            "snapshot",
            command.messageId,
          );
        }
        return;
      case "simulation.cancel":
      case "run.dispose":
        this.#eventSequence += 1;
        this.#emit({
          protocolVersion: 1,
          messageId: crypto.randomUUID(),
          replyTo: command.messageId,
          kind: "event",
          type: "run.disposed",
          runId: command.runId,
          sequence: this.#eventSequence,
          payload: { reason: command.payload.reason },
        });
        this.#activeRun = null;
        return;
      case "simulation.resume":
        return;
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  emitRunUpdate(
    run: CoordinatorRunRequest,
    sequence: number,
    phase: CoordinatorCoreSummary["phase"] = "progress",
    replyTo: string | null = null,
  ): void {
    this.#emit({
      protocolVersion: 1,
      messageId: crypto.randomUUID(),
      replyTo,
      kind: "event",
      type: "simulation.update",
      runId: run.runId,
      sequence,
      payload: {
        summary: createSyntheticCoordinatorSummary(run, sequence, phase),
        binarySlices: [],
      },
    });
  }

  #emit(input: unknown): void {
    const message = CoordinatorEventSchema.parse(input);
    this.onmessage?.({
      data: { message, binary: null },
    } as MessageEvent<unknown>);
  }
}

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

  readonly #fullSnapshotRender: boolean;
  #activeRun: CoordinatorRunRequest | null = null;
  #eventSequence = 0;

  constructor(options: { readonly fullSnapshotRender?: boolean } = {}) {
    this.#fullSnapshotRender = options.fullSnapshotRender ?? false;
  }

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
          if (command.type === "simulation.snapshot" && this.#fullSnapshotRender) {
            this.#emitFullSnapshot(this.#activeRun, command.messageId);
            return;
          }
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

  #emitFullSnapshot(run: CoordinatorRunRequest, replyTo: string): void {
    if (run.process.processType !== "milling") {
      throw new TypeError("Synthetic full snapshots currently require milling.");
    }
    const { sizeMm, positionMm, baseResolutionMm } = run.process.stock;
    const columns = Math.ceil(sizeMm.xMm / baseResolutionMm);
    const rows = Math.ceil(sizeMm.yMm / baseResolutionMm);
    const minimum = {
      xMm: positionMm.xMm - sizeMm.xMm / 2,
      yMm: positionMm.yMm - sizeMm.yMm / 2,
      zMm: positionMm.zMm - sizeMm.zMm / 2,
    };
    const maximum = {
      xMm: positionMm.xMm + sizeMm.xMm / 2,
      yMm: positionMm.yMm + sizeMm.yMm / 2,
      zMm: positionMm.zMm + sizeMm.zMm / 2,
    };
    const topZMm = new Float32Array(columns * rows).fill(maximum.zMm);
    const binary = topZMm.buffer.slice(0);
    const summary: CoordinatorCoreSummary = {
      ...createSyntheticCoordinatorSummary(
        run,
        this.#eventSequence,
        "snapshot",
      ),
      render: {
        renderType: "milling-full",
        boundsMm: { minimum, maximum },
        columns,
        rows,
        resolutionMm: baseResolutionMm,
      },
      binaryLayout: [
        {
          binaryKind: "milling.top-z-mm",
          offset: 0,
          byteLength: binary.byteLength,
          elementType: "float32",
        },
      ],
      binaryByteLength: binary.byteLength,
    };
    this.#emit(
      {
        protocolVersion: 1,
        messageId: crypto.randomUUID(),
        replyTo,
        kind: "event",
        type: "simulation.update",
        runId: run.runId,
        sequence: this.#eventSequence,
        payload: {
          summary,
          binarySlices: [
            {
              handleId: "70000000-0000-4000-8000-000000000399",
              binaryKind: "milling.top-z-mm",
              byteOffset: 0,
              byteLength: binary.byteLength,
              elementType: "float32",
              ownership: "receiver",
              transferMode: "transferable",
            },
          ],
        },
      },
      binary,
    );
  }

  #emit(input: unknown, binary: ArrayBuffer | null = null): void {
    const message = CoordinatorEventSchema.parse(input);
    this.onmessage?.({
      data: { message, binary },
    } as MessageEvent<unknown>);
  }
}

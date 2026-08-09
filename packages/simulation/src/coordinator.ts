import {
  CoordinatorCommandSchema,
  CoordinatorEventSchema,
  PRODUCT_VERSION,
  type CoordinatorCommand,
  type CoordinatorCoreSummary,
  type CoordinatorEvent,
  type CoordinatorRunRequest,
  type CoordinatorTransportPacket,
} from "@cnc-render/contracts";

export type CoordinatorExecutionMode = "realtime" | "fast-forward";
export type CoordinatorPlaybackStatus =
  | "starting"
  | "running"
  | "paused"
  | "completed"
  | "stopped"
  | "cancelled"
  | "error";

export interface MillingFullRenderUpdate {
  readonly renderType: "milling-full";
  readonly boundsMm: {
    readonly minimum: { readonly xMm: number; readonly yMm: number; readonly zMm: number };
    readonly maximum: { readonly xMm: number; readonly yMm: number; readonly zMm: number };
  };
  readonly columns: number;
  readonly rows: number;
  readonly resolutionMm: number;
  readonly topZMm: Float32Array;
}

export interface MillingPatchRenderUpdate {
  readonly renderType: "milling-patch";
  readonly revision: number;
  readonly brickX: number;
  readonly brickY: number;
  readonly cellIndices: Uint32Array;
  readonly topZMm: Float32Array;
}

export interface TurningFullRenderUpdate {
  readonly renderType: "turning-full";
  readonly axisCenterMm: { readonly xMm: number; readonly yMm: number };
  readonly minimumZMm: number;
  readonly maximumZMm: number;
  readonly axialCells: number;
  readonly radialSegments: number;
  readonly resolutionMm: number;
  readonly innerRadiusMm: Float32Array;
  readonly outerRadiusMm: Float32Array;
}

export interface TurningPatchRenderUpdate {
  readonly renderType: "turning-patch";
  readonly revision: number;
  readonly cellIndices: Uint32Array;
  readonly innerRadiusMm: Float32Array;
  readonly outerRadiusMm: Float32Array;
}

export type CoordinatorRenderUpdate =
  | MillingFullRenderUpdate
  | MillingPatchRenderUpdate
  | TurningFullRenderUpdate
  | TurningPatchRenderUpdate;

export type CoordinatorFullRenderUpdate =
  | MillingFullRenderUpdate
  | TurningFullRenderUpdate;

export interface CoordinatorCheckpoint {
  readonly summary: CoordinatorCoreSummary;
  readonly render: CoordinatorFullRenderUpdate;
}

export interface CoordinatorMetrics {
  readonly workerMessages: number;
  readonly renderUpdates: number;
  readonly generalUiSamples: number;
  readonly axisUiSamples: number;
  readonly staleEventsRejected: number;
  readonly maximumMainHandlerMs: number;
}

export interface CoordinatorSnapshot {
  readonly status: CoordinatorPlaybackStatus;
  readonly activeRunId: string | null;
  readonly summary: CoordinatorCoreSummary | null;
  readonly metrics: CoordinatorMetrics;
}

interface WorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

type WorkerFactory = () => WorkerPort;
type SummaryListener = (summary: CoordinatorCoreSummary) => void;
type RenderListener = (
  update: CoordinatorRenderUpdate,
  summary: CoordinatorCoreSummary,
) => void;

interface ReplyWaiter {
  readonly resolve: (packet: CoordinatorTransportPacket) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const GENERAL_UI_INTERVAL_MS = 100;
const AXIS_UI_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 15_000;

export class SimulationCoordinatorError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SimulationCoordinatorError";
    this.code = code;
  }
}

function browserWorkerFactory(): WorkerPort {
  if (typeof Worker === "undefined") {
    throw new SimulationCoordinatorError(
      "coordinator.worker.unavailable",
      "A dedicated Web Worker is required for simulation.",
    );
  }
  return new Worker(new URL("./simulation.worker.ts", import.meta.url), {
    type: "module",
    name: "cnc-render-simulation",
  });
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SimulationCoordinatorError(
      "coordinator.render-metadata.invalid",
      `${label} must be finite.`,
    );
  }
  return value;
}

function integer(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new SimulationCoordinatorError(
      "coordinator.render-metadata.invalid",
      `${label} must be a non-negative safe integer.`,
    );
  }
  return parsed;
}

function point3(value: unknown, label: string) {
  if (!value || typeof value !== "object") {
    throw new SimulationCoordinatorError(
      "coordinator.render-metadata.invalid",
      `${label} must be a point.`,
    );
  }
  const point = value as Record<string, unknown>;
  return {
    xMm: finiteNumber(point.xMm, `${label}.xMm`),
    yMm: finiteNumber(point.yMm, `${label}.yMm`),
    zMm: finiteNumber(point.zMm, `${label}.zMm`),
  };
}

function typedSlice(
  packet: CoordinatorTransportPacket,
  binaryKind: string,
  elementType: "float32" | "uint32",
): Float32Array | Uint32Array {
  const slice =
    packet.message.type === "simulation.update"
      ? packet.message.payload.binarySlices.find(
          (candidate) => candidate.binaryKind === binaryKind,
        )
      : undefined;
  if (!slice || !(packet.binary instanceof ArrayBuffer)) {
    throw new SimulationCoordinatorError(
      "coordinator.binary.missing",
      `Missing transferred buffer ${binaryKind}.`,
    );
  }
  if (
    slice.elementType !== elementType ||
    slice.byteOffset % 4 !== 0 ||
    slice.byteLength % 4 !== 0 ||
    slice.byteOffset + slice.byteLength > packet.binary.byteLength
  ) {
    throw new SimulationCoordinatorError(
      "coordinator.binary.layout-invalid",
      `Transferred buffer ${binaryKind} has an invalid layout.`,
    );
  }
  const length = slice.byteLength / 4;
  return elementType === "float32"
    ? new Float32Array(packet.binary, slice.byteOffset, length)
    : new Uint32Array(packet.binary, slice.byteOffset, length);
}

function renderUpdate(
  packet: CoordinatorTransportPacket,
  summary: CoordinatorCoreSummary,
): CoordinatorRenderUpdate | null {
  const render = summary.render;
  if (!render) {
    return null;
  }
  const renderType = render.renderType;
  if (renderType === "milling-full") {
    const bounds = render.boundsMm as Record<string, unknown>;
    return {
      renderType,
      boundsMm: {
        minimum: point3(bounds.minimum, "boundsMm.minimum"),
        maximum: point3(bounds.maximum, "boundsMm.maximum"),
      },
      columns: integer(render.columns, "columns"),
      rows: integer(render.rows, "rows"),
      resolutionMm: finiteNumber(render.resolutionMm, "resolutionMm"),
      topZMm: typedSlice(
        packet,
        "milling.top-z-mm",
        "float32",
      ) as Float32Array,
    };
  }
  if (renderType === "milling-patch") {
    return {
      renderType,
      revision: integer(render.revision, "revision"),
      brickX: integer(render.brickX, "brickX"),
      brickY: integer(render.brickY, "brickY"),
      cellIndices: typedSlice(
        packet,
        "milling.cell-indices",
        "uint32",
      ) as Uint32Array,
      topZMm: typedSlice(
        packet,
        "milling.top-z-mm",
        "float32",
      ) as Float32Array,
    };
  }
  if (renderType === "turning-full") {
    const center = render.axisCenterMm as Record<string, unknown>;
    return {
      renderType,
      axisCenterMm: {
        xMm: finiteNumber(center.xMm, "axisCenterMm.xMm"),
        yMm: finiteNumber(center.yMm, "axisCenterMm.yMm"),
      },
      minimumZMm: finiteNumber(render.minimumZMm, "minimumZMm"),
      maximumZMm: finiteNumber(render.maximumZMm, "maximumZMm"),
      axialCells: integer(render.axialCells, "axialCells"),
      radialSegments: integer(render.radialSegments, "radialSegments"),
      resolutionMm: finiteNumber(render.resolutionMm, "resolutionMm"),
      innerRadiusMm: typedSlice(
        packet,
        "turning.inner-radius-mm",
        "float32",
      ) as Float32Array,
      outerRadiusMm: typedSlice(
        packet,
        "turning.outer-radius-mm",
        "float32",
      ) as Float32Array,
    };
  }
  if (renderType === "turning-patch") {
    return {
      renderType,
      revision: integer(render.revision, "revision"),
      cellIndices: typedSlice(
        packet,
        "turning.cell-indices",
        "uint32",
      ) as Uint32Array,
      innerRadiusMm: typedSlice(
        packet,
        "turning.inner-radius-mm",
        "float32",
      ) as Float32Array,
      outerRadiusMm: typedSlice(
        packet,
        "turning.outer-radius-mm",
        "float32",
      ) as Float32Array,
    };
  }
  throw new SimulationCoordinatorError(
    "coordinator.render-type.unsupported",
    `Unsupported render update ${String(renderType)}.`,
  );
}

function terminalStatus(summary: CoordinatorCoreSummary): CoordinatorPlaybackStatus {
  if (summary.stopped) {
    return "stopped";
  }
  if (summary.completed) {
    return "completed";
  }
  return "running";
}

export class SimulationCoordinator {
  readonly #workerFactory: WorkerFactory;
  readonly #generalListeners = new Set<SummaryListener>();
  readonly #axisListeners = new Set<SummaryListener>();
  readonly #renderListeners = new Set<RenderListener>();
  readonly #replyWaiters = new Map<string, ReplyWaiter>();
  readonly #terminalWaiters = new Set<{
    runId: string;
    resolve: (summary: CoordinatorCoreSummary) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  #worker!: WorkerPort;
  #workerGeneration = 0;
  #readyPromise!: Promise<void>;
  #activeRunId: string | null = null;
  #commandSequence = 0;
  #lastEventSequence = 0;
  #status: CoordinatorPlaybackStatus = "starting";
  #summary: CoordinatorCoreSummary | null = null;
  #lastGeneralSampleMs = Number.NEGATIVE_INFINITY;
  #lastAxisSampleMs = Number.NEGATIVE_INFINITY;
  #metrics = {
    workerMessages: 0,
    renderUpdates: 0,
    generalUiSamples: 0,
    axisUiSamples: 0,
    staleEventsRejected: 0,
    maximumMainHandlerMs: 0,
  };

  constructor(workerFactory: WorkerFactory = browserWorkerFactory) {
    this.#workerFactory = workerFactory;
    this.#spawnWorker();
  }

  onGeneralSummary(listener: SummaryListener): () => void {
    this.#generalListeners.add(listener);
    return () => this.#generalListeners.delete(listener);
  }

  onAxisSummary(listener: SummaryListener): () => void {
    this.#axisListeners.add(listener);
    return () => this.#axisListeners.delete(listener);
  }

  onRender(listener: RenderListener): () => void {
    this.#renderListeners.add(listener);
    return () => this.#renderListeners.delete(listener);
  }

  async start(
    run: CoordinatorRunRequest,
    options: {
      readonly playbackSpeed: number;
      readonly executionMode: CoordinatorExecutionMode;
    },
  ): Promise<CoordinatorCoreSummary> {
    await this.#readyPromise;
    if (this.#activeRunId !== null) {
      await this.cancel("replaced");
    }
    this.#activeRunId = run.runId;
    this.#commandSequence = 1;
    this.#lastEventSequence = 0;
    this.#summary = null;
    this.#status = "starting";
    const command = this.#command({
      type: "simulation.start",
      runId: run.runId,
      sequence: this.#commandSequence,
      payload: {
        executionMode: options.executionMode,
        playbackSpeed: options.playbackSpeed,
        run,
      },
    });
    const event = await this.#sendWithReply(command);
    if (event.type !== "simulation.update") {
      throw new SimulationCoordinatorError(
        "coordinator.start.reply-invalid",
        "Simulation start did not return an initialized update.",
      );
    }
    return event.payload.summary;
  }

  async pause(): Promise<CoordinatorCoreSummary> {
    const runId = this.#requireRun();
    const command = this.#command({
      type: "simulation.pause",
      runId,
      sequence: this.#nextCommandSequence(),
      payload: {},
    });
    const event = await this.#sendWithReply(command);
    if (event.type !== "simulation.update") {
      throw new SimulationCoordinatorError(
        "coordinator.pause.reply-invalid",
        "Pause did not return a stable snapshot.",
      );
    }
    this.#status = "paused";
    return event.payload.summary;
  }

  resume(playbackSpeed: number): void {
    const runId = this.#requireRun();
    const command = this.#command({
      type: "simulation.resume",
      runId,
      sequence: this.#nextCommandSequence(),
      payload: { playbackSpeed },
    });
    this.#worker.postMessage(command);
    this.#status = "running";
  }

  async snapshot(): Promise<CoordinatorCoreSummary> {
    const runId = this.#requireRun();
    const command = this.#command({
      type: "simulation.snapshot",
      runId,
      sequence: this.#nextCommandSequence(),
      payload: {},
    });
    const event = await this.#sendWithReply(command);
    if (event.type !== "simulation.update") {
      throw new SimulationCoordinatorError(
        "coordinator.snapshot.reply-invalid",
        "Snapshot command did not return simulation state.",
      );
    }
    return event.payload.summary;
  }

  async checkpoint(): Promise<CoordinatorCheckpoint> {
    const runId = this.#requireRun();
    const command = this.#command({
      type: "simulation.snapshot",
      runId,
      sequence: this.#nextCommandSequence(),
      payload: {},
    });
    const packet = await this.#sendPacketWithReply(command);
    if (packet.message.type !== "simulation.update") {
      throw new SimulationCoordinatorError(
        "coordinator.checkpoint.reply-invalid",
        "Checkpoint command did not return simulation state.",
      );
    }
    const summary = packet.message.payload.summary;
    const render = renderUpdate(packet, summary);
    if (
      !render ||
      (render.renderType !== "milling-full" &&
        render.renderType !== "turning-full")
    ) {
      throw new SimulationCoordinatorError(
        "coordinator.checkpoint.render-incomplete",
        "Checkpoint must contain a complete stock render payload.",
      );
    }
    return { summary, render };
  }

  async cancel(
    reason: "user" | "replaced" | "collision" | "shutdown" = "user",
  ): Promise<void> {
    if (this.#activeRunId === null) {
      return;
    }
    const runId = this.#activeRunId;
    const command = this.#command({
      type: "simulation.cancel",
      runId,
      sequence: this.#nextCommandSequence(),
      payload: { reason },
    });
    const event = await this.#sendWithReply(command);
    if (event.type !== "run.disposed") {
      throw new SimulationCoordinatorError(
        "coordinator.cancel.reply-invalid",
        "Cancel did not dispose the active run.",
      );
    }
    this.#activeRunId = null;
    this.#status = "cancelled";
  }

  async restartWorker(): Promise<void> {
    this.#rejectPending(
      new SimulationCoordinatorError(
        "coordinator.worker.restarted",
        "The simulation Worker was restarted.",
      ),
    );
    this.#worker.terminate();
    this.#activeRunId = null;
    this.#summary = null;
    this.#status = "starting";
    this.#spawnWorker();
    await this.#readyPromise;
  }

  waitForTerminal(
    runId = this.#requireRun(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<CoordinatorCoreSummary> {
    if (
      this.#summary?.runId === runId &&
      (this.#summary.completed || this.#summary.stopped)
    ) {
      return Promise.resolve(this.#summary);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        runId,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#terminalWaiters.delete(waiter);
          reject(
            new SimulationCoordinatorError(
              "coordinator.timeout",
              "Timed out waiting for simulation completion.",
            ),
          );
        }, timeoutMs),
      };
      this.#terminalWaiters.add(waiter);
    });
  }

  getSnapshot(): CoordinatorSnapshot {
    return {
      status: this.#status,
      activeRunId: this.#activeRunId,
      summary: this.#summary,
      metrics: { ...this.#metrics },
    };
  }

  dispose(): void {
    this.#rejectPending(
      new SimulationCoordinatorError(
        "coordinator.disposed",
        "The simulation coordinator was disposed.",
      ),
    );
    this.#worker.terminate();
    this.#activeRunId = null;
  }

  #spawnWorker(): void {
    const workerGeneration = ++this.#workerGeneration;
    this.#worker = this.#workerFactory();
    this.#worker.onmessage = (event) => {
      if (workerGeneration !== this.#workerGeneration) {
        this.#metrics.staleEventsRejected += 1;
        return;
      }
      this.#handleMessage(event.data);
    };
    this.#worker.onerror = (event) => {
      const error = new SimulationCoordinatorError(
        "coordinator.worker.error",
        event.message || "The simulation Worker failed.",
      );
      this.#status = "error";
      this.#rejectPending(error);
    };
    const handshake = this.#command({
      type: "coordinator.handshake",
      runId: null,
      sequence: 0,
      payload: {
        clientVersion: PRODUCT_VERSION,
        supportedProtocolVersions: [1],
        transferModes: ["transferable", "copy"],
      },
    });
    this.#readyPromise = this.#sendWithReply(handshake).then((event) => {
      if (event.type !== "coordinator.ready" || !event.payload.wasm) {
        throw new SimulationCoordinatorError(
          "coordinator.handshake.invalid",
          "The Worker did not confirm its WASM core.",
        );
      }
    });
  }

  #handleMessage(input: unknown): void {
    const startedAt = performance.now();
    try {
      if (!input || typeof input !== "object") {
        throw new SimulationCoordinatorError(
          "coordinator.packet.invalid",
          "Worker packet must be an object.",
        );
      }
      const rawPacket = input as Record<string, unknown>;
      const message = CoordinatorEventSchema.parse(rawPacket.message);
      const packet: CoordinatorTransportPacket = {
        message,
        binary:
          rawPacket.binary instanceof ArrayBuffer ? rawPacket.binary : null,
      };
      this.#metrics.workerMessages += 1;

      if (
        message.runId !== null &&
        (this.#activeRunId === null || message.runId !== this.#activeRunId)
      ) {
        this.#metrics.staleEventsRejected += 1;
        return;
      }
      if (
        message.runId !== null &&
        message.sequence <= this.#lastEventSequence
      ) {
        this.#metrics.staleEventsRejected += 1;
        return;
      }
      if (message.runId !== null) {
        this.#lastEventSequence = message.sequence;
      }

      if (message.type === "coordinator.error") {
        const error = new SimulationCoordinatorError(
          message.payload.code,
          message.payload.message,
        );
        if (message.replyTo) {
          this.#settleReply(message.replyTo, error);
        }
        if (!message.payload.recoverable) {
          this.#status = "error";
          this.#rejectTerminal(error);
        }
        return;
      }

      if (message.type === "simulation.update") {
        const summary = message.payload.summary;
        if (summary.runId !== message.runId) {
          throw new SimulationCoordinatorError(
            "coordinator.run-id.mismatch",
            "Worker update summary and envelope runId differ.",
          );
        }
        this.#summary = summary;
        this.#status = terminalStatus(summary);
        const update = renderUpdate(packet, summary);
        if (update) {
          this.#metrics.renderUpdates += 1;
          for (const listener of this.#renderListeners) {
            listener(update, summary);
          }
        }
        this.#sampleUi(summary);
        if (summary.completed || summary.stopped) {
          this.#resolveTerminal(summary);
        }
      }

      if (message.replyTo) {
        this.#settleReply(message.replyTo, packet);
      }
    } catch (error) {
      const normalized =
        error instanceof Error
          ? error
          : new SimulationCoordinatorError(
              "coordinator.message.failed",
              String(error),
            );
      this.#status = "error";
      this.#rejectPending(normalized);
    } finally {
      this.#metrics.maximumMainHandlerMs = Math.max(
        this.#metrics.maximumMainHandlerMs,
        Math.max(0, performance.now() - startedAt),
      );
    }
  }

  #sampleUi(summary: CoordinatorCoreSummary): void {
    const now = performance.now();
    const terminal = summary.completed || summary.stopped;
    if (terminal || now - this.#lastGeneralSampleMs >= GENERAL_UI_INTERVAL_MS) {
      this.#lastGeneralSampleMs = now;
      this.#metrics.generalUiSamples += 1;
      for (const listener of this.#generalListeners) {
        listener(summary);
      }
    }
    if (terminal || now - this.#lastAxisSampleMs >= AXIS_UI_INTERVAL_MS) {
      this.#lastAxisSampleMs = now;
      this.#metrics.axisUiSamples += 1;
      for (const listener of this.#axisListeners) {
        listener(summary);
      }
    }
  }

  #command(
    input:
      | Omit<Extract<CoordinatorCommand, { type: "coordinator.handshake" }>, "protocolVersion" | "messageId" | "replyTo" | "kind">
      | Omit<Exclude<CoordinatorCommand, { type: "coordinator.handshake" }>, "protocolVersion" | "messageId" | "replyTo" | "kind">,
  ): CoordinatorCommand {
    return CoordinatorCommandSchema.parse({
      protocolVersion: 1,
      messageId: crypto.randomUUID(),
      replyTo: null,
      kind: "command",
      ...input,
    });
  }

  #sendWithReply(command: CoordinatorCommand): Promise<CoordinatorEvent> {
    return this.#sendPacketWithReply(command).then(
      (packet) => packet.message,
    );
  }

  #sendPacketWithReply(
    command: CoordinatorCommand,
  ): Promise<CoordinatorTransportPacket> {
    const promise = new Promise<CoordinatorTransportPacket>((
      resolve,
      reject,
    ) => {
      const timer = setTimeout(() => {
        this.#replyWaiters.delete(command.messageId);
        reject(
          new SimulationCoordinatorError(
            "coordinator.timeout",
            `Timed out waiting for ${command.type}.`,
          ),
        );
      }, DEFAULT_TIMEOUT_MS);
      this.#replyWaiters.set(command.messageId, { resolve, reject, timer });
    });
    this.#worker.postMessage(command);
    return promise;
  }

  #settleReply(
    replyTo: string,
    value: CoordinatorTransportPacket | Error,
  ): void {
    const waiter = this.#replyWaiters.get(replyTo);
    if (!waiter) {
      return;
    }
    clearTimeout(waiter.timer);
    this.#replyWaiters.delete(replyTo);
    if (value instanceof Error) {
      waiter.reject(value);
    } else {
      waiter.resolve(value);
    }
  }

  #resolveTerminal(summary: CoordinatorCoreSummary): void {
    for (const waiter of this.#terminalWaiters) {
      if (waiter.runId !== summary.runId) {
        continue;
      }
      clearTimeout(waiter.timer);
      this.#terminalWaiters.delete(waiter);
      waiter.resolve(summary);
    }
  }

  #rejectTerminal(error: Error): void {
    for (const waiter of this.#terminalWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.#terminalWaiters.clear();
  }

  #rejectPending(error: Error): void {
    for (const waiter of this.#replyWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.#replyWaiters.clear();
    this.#rejectTerminal(error);
  }

  #nextCommandSequence(): number {
    this.#commandSequence += 1;
    return this.#commandSequence;
  }

  #requireRun(): string {
    if (this.#activeRunId === null) {
      throw new SimulationCoordinatorError(
        "coordinator.run.missing",
        "No simulation run is active.",
      );
    }
    return this.#activeRunId;
  }
}

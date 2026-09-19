import {
  GcodeAnalysisRequestSchema,
  GcodeAnalysisWorkerEventSchema,
  type GcodeAnalysisRequest,
  type GcodeAnalysisResult,
  type GcodeAnalysisWorkerCommand,
} from "@cnc-render/contracts";

interface WorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

type WorkerFactory = () => WorkerPort;

interface PendingAnalysis {
  readonly resolve: (result: GcodeAnalysisResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class GcodeAnalysisClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GcodeAnalysisClientError";
    this.code = code;
  }
}

function browserWorkerFactory(): WorkerPort {
  if (typeof Worker === "undefined") {
    throw new GcodeAnalysisClientError(
      "gcode.analysis.worker-unavailable",
      "G-code analysis requires a dedicated Web Worker.",
    );
  }
  return new Worker(new URL("./gcode-analysis.worker.ts", import.meta.url), {
    type: "module",
    name: "cnc-render-gcode-analysis",
  });
}

export class GcodeAnalysisClient {
  readonly #worker: WorkerPort;
  readonly #pending = new Map<string, PendingAnalysis>();
  #disposed = false;
  #failure: GcodeAnalysisClientError | null = null;

  constructor(workerFactory: WorkerFactory = browserWorkerFactory) {
    this.#worker = workerFactory();
    this.#worker.onmessage = (event) => this.#handleMessage(event.data);
    this.#worker.onerror = (event) => {
      this.#failure = new GcodeAnalysisClientError(
          "gcode.analysis.worker-failed",
          event.message || "The G-code analysis Worker failed.",
      );
      this.#rejectAll(this.#failure);
    };
  }

  analyze(
    request: GcodeAnalysisRequest,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<GcodeAnalysisResult> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new GcodeAnalysisClientError("gcode.analysis.invalid-timeout", "Analysis timeout must be finite and positive."));
    }
    if (this.#disposed) {
      return Promise.reject(
        new GcodeAnalysisClientError(
          "gcode.analysis.disposed",
          "The G-code analysis client has been disposed.",
        ),
      );
    }
    if (this.#failure) return Promise.reject(this.#failure);
    const payload = GcodeAnalysisRequestSchema.parse(request);
    const messageId = crypto.randomUUID();
    const command: GcodeAnalysisWorkerCommand = {
      protocolVersion: 1,
      messageId,
      replyTo: null,
      kind: "command",
      type: "gcode.analysis.request",
      payload,
    };
    return new Promise((resolve, reject) => {
      const pending = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending.delete(messageId);
          reject(
            new GcodeAnalysisClientError(
              "gcode.analysis.timeout",
              "Timed out waiting for G-code analysis.",
            ),
          );
        }, timeoutMs),
      };
      this.#pending.set(messageId, pending);
      try {
        this.#worker.postMessage(command);
      } catch (error: unknown) {
        clearTimeout(pending.timer);
        this.#pending.delete(messageId);
        reject(new GcodeAnalysisClientError("gcode.analysis.post-failed", error instanceof Error ? error.message : String(error)));
      }
    });
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#rejectAll(
      new GcodeAnalysisClientError(
        "gcode.analysis.disposed",
        "The G-code analysis client has been disposed.",
      ),
    );
    this.#worker.terminate();
  }

  #handleMessage(input: unknown): void {
    const parsed = GcodeAnalysisWorkerEventSchema.safeParse(input);
    if (!parsed.success) {
      return;
    }
    const pending = this.#pending.get(parsed.data.replyTo);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(parsed.data.replyTo);
    if (parsed.data.type === "gcode.analysis.error") {
      pending.reject(
        new GcodeAnalysisClientError(
          parsed.data.payload.code,
          parsed.data.payload.message,
        ),
      );
      return;
    }
    pending.resolve(parsed.data.payload);
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

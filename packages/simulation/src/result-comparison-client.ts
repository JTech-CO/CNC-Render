import type { ResultComparison, ResultComparisonInput, ResultProvenance } from "./result-comparison";
import { validateResultComparisonRequest, validateResultComparisonResponse } from "./result-comparison-protocol";
export interface ResultComparisonWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export class ResultComparisonClient {
  readonly #worker: ResultComparisonWorkerPort;
  #sequence = 0;
  #closed = false;
  readonly #pending = new Map<number, { provenance: ResultProvenance; resolve: (value: ResultComparison) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(createWorker: () => ResultComparisonWorkerPort = () => new Worker(new URL("./result-comparison.worker.ts", import.meta.url), { type: "module", name: "cnc-result-comparison" })) {
    this.#worker = createWorker();
    this.#worker.onmessage = ({ data: raw }) => {
      if (!raw || typeof raw !== "object" || !("requestId" in raw) || typeof raw.requestId !== "number") return;
      const data = raw as { requestId: number };
      const pending = this.#pending.get(data.requestId);
      if (!pending) return;
      this.#pending.delete(data.requestId); clearTimeout(pending.timer);
      try {
        pending.resolve(validateResultComparisonResponse(data, pending.provenance, data.requestId));
      } catch (error) { pending.reject(error instanceof Error ? error : new Error("결과 비교 계약이 올바르지 않습니다.")); }
    };
    this.#worker.onerror = () => this.dispose();
  }
  compare(input: ResultComparisonInput): Promise<ResultComparison> {
    if (this.#closed) return Promise.reject(new Error("비교 Worker가 종료되었습니다."));
    const requestId = ++this.#sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(requestId); reject(new Error("결과 비교 시간이 초과되었습니다.")); }, 30_000);
      this.#pending.set(requestId, { provenance: { ...input.provenance }, resolve, reject, timer });
      // Structured cloning intentionally preserves the checkpoint caller's arrays.
      try { this.#worker.postMessage(validateResultComparisonRequest({ protocolVersion: 1, requestId, input })); }
      catch (error) { clearTimeout(timer); this.#pending.delete(requestId); reject(error); }
    });
  }
  dispose(): void {
    this.#closed = true; this.#worker.terminate();
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("결과 비교가 취소되었습니다.")); }
    this.#pending.clear();
  }
}

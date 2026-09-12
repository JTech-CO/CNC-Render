import {
  GcodeAnalysisResultSchema,
  GcodeAnalysisWorkerCommandSchema,
  GcodeAnalysisWorkerEventSchema,
  type GcodeAnalysisWorkerEvent,
} from "@cnc-render/contracts";

import { CncRenderWasmError, CncRenderWasmRuntime } from "./wasm-runtime";

interface WorkerScope {
  readonly location: Location;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;
const ASSET_BASE_URL = new URL(import.meta.env.BASE_URL, scope.location.origin);
const CORE_URL = new URL("wasm/cnc_render_wasm.wasm", ASSET_BASE_URL);

let runtimePromise: Promise<CncRenderWasmRuntime> | null = null;

function runtime(): Promise<CncRenderWasmRuntime> {
  runtimePromise ??= CncRenderWasmRuntime.fetch(CORE_URL);
  return runtimePromise;
}

function postEvent(event: GcodeAnalysisWorkerEvent): void {
  scope.postMessage(GcodeAnalysisWorkerEventSchema.parse(event));
}

scope.onmessage = (event) => {
  const parsed = GcodeAnalysisWorkerCommandSchema.safeParse(event.data);
  if (!parsed.success) {
    return;
  }
  const command = parsed.data;
  void runtime()
    .then((wasm) =>
      GcodeAnalysisResultSchema.parse(wasm.analyzeGcode(command.payload)),
    )
    .then((result) => {
      postEvent({
        protocolVersion: 1,
        messageId: crypto.randomUUID(),
        replyTo: command.messageId,
        kind: "event",
        type: "gcode.analysis.result",
        payload: result,
      });
    })
    .catch((error: unknown) => {
      const candidateCode =
        error instanceof CncRenderWasmError
          ? error.code
          : "gcode.analysis.failed";
      const code = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u.test(candidateCode)
        ? candidateCode
        : "gcode.analysis.failed";
      postEvent({
        protocolVersion: 1,
        messageId: crypto.randomUUID(),
        replyTo: command.messageId,
        kind: "event",
        type: "gcode.analysis.error",
        payload: {
          code,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    });
};

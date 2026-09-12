import type {
  CoordinatorCoreSummary,
  CoordinatorRunRequest,
  GcodeAnalysisRequest as ContractGcodeAnalysisRequest,
  GcodeAnalysisResult,
} from "@cnc-render/contracts";

const WASM_PROTOCOL_VERSION = 1;
const MAX_WASM_OUTPUT_BYTES = 128 * 1024 * 1024;

export type GcodeAnalysisRequest = ContractGcodeAnalysisRequest;
export type GcodeAnalysisResponse = GcodeAnalysisResult;

interface CncRenderWasmExports extends WebAssembly.Exports {
  readonly memory: WebAssembly.Memory;
  cnc_render_protocol_version(): number;
  cnc_render_input_resize(byteLength: number): number;
  cnc_render_initialize(): number;
  cnc_render_analyze_gcode(): number;
  cnc_render_step(): number;
  cnc_render_source_tick(): number;
  cnc_render_step_source_line(): number;
  cnc_render_snapshot(): number;
  cnc_render_cancel(): number;
  cnc_render_output_json_ptr(): number;
  cnc_render_output_json_len(): number;
  cnc_render_output_binary_ptr(): number;
  cnc_render_output_binary_len(): number;
}

export interface WasmCoreInvocation {
  readonly summary: CoordinatorCoreSummary;
  readonly binary: ArrayBuffer;
}

interface WasmInvocation<TSummary> {
  readonly summary: TSummary;
  readonly binary: ArrayBuffer;
}

export class CncRenderWasmError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CncRenderWasmError";
    this.code = code;
  }
}

function assertExports(
  exports: WebAssembly.Exports,
): asserts exports is CncRenderWasmExports {
  const requiredFunctions = [
    "cnc_render_protocol_version",
    "cnc_render_input_resize",
    "cnc_render_initialize",
    "cnc_render_analyze_gcode",
    "cnc_render_step",
    "cnc_render_source_tick",
    "cnc_render_step_source_line",
    "cnc_render_snapshot",
    "cnc_render_cancel",
    "cnc_render_output_json_ptr",
    "cnc_render_output_json_len",
    "cnc_render_output_binary_ptr",
    "cnc_render_output_binary_len",
  ] as const;
  if (!(exports.memory instanceof WebAssembly.Memory)) {
    throw new CncRenderWasmError(
      "wasm.exports.memory-missing",
      "cnc-render-wasm must export its linear memory.",
    );
  }
  for (const name of requiredFunctions) {
    if (typeof exports[name] !== "function") {
      throw new CncRenderWasmError(
        "wasm.exports.function-missing",
        `cnc-render-wasm is missing export ${name}.`,
      );
    }
  }
}

async function instantiateBytes(
  source: BufferSource,
): Promise<WebAssembly.Instance> {
  const result = await WebAssembly.instantiate(source, {});
  return result instanceof WebAssembly.Instance ? result : result.instance;
}

export class CncRenderWasmRuntime {
  readonly #exports: CncRenderWasmExports;
  readonly #encoder = new TextEncoder();
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });

  private constructor(instance: WebAssembly.Instance) {
    assertExports(instance.exports);
    this.#exports = instance.exports;
    if (
      this.#exports.cnc_render_protocol_version() !== WASM_PROTOCOL_VERSION
    ) {
      throw new CncRenderWasmError(
        "wasm.protocol-version.unsupported",
        `Expected WASM protocol ${WASM_PROTOCOL_VERSION}.`,
      );
    }
  }

  static async instantiate(source: BufferSource): Promise<CncRenderWasmRuntime> {
    return new CncRenderWasmRuntime(await instantiateBytes(source));
  }

  static async fetch(url: URL | string): Promise<CncRenderWasmRuntime> {
    const response = await globalThis.fetch(url);
    if (!response.ok) {
      throw new CncRenderWasmError(
        "wasm.fetch.failed",
        `Could not load cnc-render-wasm (${response.status}).`,
      );
    }
    return CncRenderWasmRuntime.instantiate(await response.arrayBuffer());
  }

  initialize(request: CoordinatorRunRequest): WasmCoreInvocation {
    this.#writeInput(request, "The run request exceeded the WASM input limit.");
    return this.#invoke<CoordinatorCoreSummary>(() =>
      this.#exports.cnc_render_initialize(),
    );
  }

  analyzeGcode(request: GcodeAnalysisRequest): GcodeAnalysisResponse {
    this.#writeInput(
      request,
      "The G-code analysis request exceeded the WASM input limit.",
    );
    const { summary } = this.#invoke<GcodeAnalysisResponse>(() =>
      this.#exports.cnc_render_analyze_gcode(),
    );
    if (summary.phase !== "analysis") {
      throw new CncRenderWasmError(
        "wasm.analysis.invalid-response",
        "The WASM core returned an invalid G-code analysis response.",
      );
    }
    return summary;
  }

  step(): WasmCoreInvocation {
    return this.#invoke<CoordinatorCoreSummary>(() =>
      this.#exports.cnc_render_step(),
    );
  }

  snapshot(): WasmCoreInvocation {
    return this.#invoke<CoordinatorCoreSummary>(() =>
      this.#exports.cnc_render_snapshot(),
    );
  }

  sourceTick(): WasmCoreInvocation {
    return this.#invoke<CoordinatorCoreSummary>(() => this.#exports.cnc_render_source_tick());
  }

  stepSourceLine(): WasmCoreInvocation {
    return this.#invoke<CoordinatorCoreSummary>(() => this.#exports.cnc_render_step_source_line());
  }

  cancel(): void {
    this.#exports.cnc_render_cancel();
  }

  #writeInput(request: unknown, limitMessage: string): void {
    const input = this.#encoder.encode(JSON.stringify(request));
    const pointer = this.#exports.cnc_render_input_resize(input.byteLength);
    if (pointer === 0 && input.byteLength > 0) {
      throw new CncRenderWasmError("wasm.input.resource-limit", limitMessage);
    }
    new Uint8Array(this.#exports.memory.buffer, pointer, input.byteLength).set(
      input,
    );
  }

  #invoke<TSummary>(call: () => number): WasmInvocation<TSummary> {
    const status = call();
    const jsonLength = this.#exports.cnc_render_output_json_len();
    const binaryLength = this.#exports.cnc_render_output_binary_len();
    if (
      jsonLength <= 0 ||
      jsonLength > 16 * 1024 * 1024 ||
      binaryLength > MAX_WASM_OUTPUT_BYTES
    ) {
      throw new CncRenderWasmError(
        "wasm.output.resource-limit",
        "The WASM output exceeded its declared resource limits.",
      );
    }
    const jsonPointer = this.#exports.cnc_render_output_json_ptr();
    const jsonBytes = new Uint8Array(
      this.#exports.memory.buffer,
      jsonPointer,
      jsonLength,
    ).slice();
    const decoded = JSON.parse(this.#decoder.decode(jsonBytes)) as Record<
      string,
      unknown
    >;
    if (status !== 0 || decoded.phase === "error") {
      throw new CncRenderWasmError(
        typeof decoded.code === "string" ? decoded.code : "wasm.core.failed",
        typeof decoded.message === "string"
          ? decoded.message
          : "The WASM simulation core rejected the request.",
      );
    }
    const binaryPointer = this.#exports.cnc_render_output_binary_ptr();
    const binary = new Uint8Array(
      this.#exports.memory.buffer,
      binaryPointer,
      binaryLength,
    ).slice().buffer;
    return {
      summary: decoded as unknown as TSummary,
      binary,
    };
  }
}

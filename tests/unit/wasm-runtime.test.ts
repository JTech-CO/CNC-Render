import {
  CncRenderWasmRuntime,
  type GcodeAnalysisRequest,
  type GcodeAnalysisResponse,
} from "@cnc-render/simulation";
import { afterEach, describe, expect, it, vi } from "vitest";

const INPUT_POINTER = 32;
const OUTPUT_POINTER = 4_096;

function mockAnalysisInstance(response: GcodeAnalysisResponse) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let inputLength = 0;
  let outputLength = 0;
  let capturedRequest: unknown;

  const exports = {
    memory,
    cnc_render_protocol_version: () => 1,
    cnc_render_input_resize: (byteLength: number) => {
      inputLength = byteLength;
      return INPUT_POINTER;
    },
    cnc_render_initialize: () => 0,
    cnc_render_analyze_gcode: () => {
      capturedRequest = JSON.parse(
        decoder.decode(
          new Uint8Array(memory.buffer, INPUT_POINTER, inputLength),
        ),
      );
      const bytes = encoder.encode(JSON.stringify(response));
      new Uint8Array(memory.buffer, OUTPUT_POINTER, bytes.byteLength).set(bytes);
      outputLength = bytes.byteLength;
      return 0;
    },
    cnc_render_step: () => 0,
    cnc_render_source_tick: () => 0,
    cnc_render_step_source_line: () => 0,
    cnc_render_snapshot: () => 0,
    cnc_render_cancel: () => 0,
    cnc_render_output_json_ptr: () => OUTPUT_POINTER,
    cnc_render_output_json_len: () => outputLength,
    cnc_render_output_binary_ptr: () => 0,
    cnc_render_output_binary_len: () => 0,
  };
  const instance = { exports } as unknown as WebAssembly.Instance;
  const wasmModule = {} as WebAssembly.Module;
  vi.spyOn(WebAssembly, "instantiate").mockImplementation(
    (() =>
      Promise.resolve({
        instance,
        module: wasmModule,
      })) as unknown as typeof WebAssembly.instantiate,
  );

  return {
    getCapturedRequest: () => capturedRequest,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CncRenderWasmRuntime G-code analysis", () => {
  it("writes the typed request and returns the parser-only response", async () => {
    const expected: GcodeAnalysisResponse = {
      schemaVersion: 1,
      coreVersion: "0.9.0",
      wasm: true,
      phase: "analysis",
      dialect: "common-v1",
      accepted: false,
      sourceHashSha256: "a".repeat(64),
      diagnostics: [
        {
          id: "gcode-" + "b".repeat(64),
          code: "parser.gcode.unsupported",
          origin: "parser",
          severity: "error",
          recoverable: false,
          message: "unsupported G-code G84",
          range: {
            start: { line: 1, column: 1 },
            end: { line: 1, column: 4 },
          },
          token: "G84",
          supportLevel: "recognized-unsupported",
          replacementAvailability: "unavailable",
          helpKey: "gcode.help.parser.gcode.unsupported",
        },
      ],
      toolpathId: null,
      sourceLineMap: [],
      programControlEvents: [],
    };
    const wasm = mockAnalysisInstance(expected);
    const runtime = await CncRenderWasmRuntime.instantiate(
      new Uint8Array([0]),
    );
    const request: GcodeAnalysisRequest = {
      schemaVersion: 1,
      dialect: "common-v1",
      source: "G84\n",
    };

    expect(runtime.analyzeGcode(request)).toEqual(expected);
    expect(wasm.getCapturedRequest()).toEqual(request);
  });
});

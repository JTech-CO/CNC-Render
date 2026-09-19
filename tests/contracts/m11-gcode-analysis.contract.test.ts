import {
  GcodeAnalysisRequestSchema,
  GcodeAnalysisResultSchema,
  GcodeAnalysisWorkerCommandSchema,
  GcodeAnalysisWorkerEventSchema,
} from "@cnc-render/contracts";
import { describe, expect, test } from "vitest";

const MESSAGE_ID = "b1000000-0000-4000-8000-000000000001";
const RESULT_MESSAGE_ID = "b1000000-0000-4000-8000-000000000002";
const MAX_DIAGNOSTICS = 10_000;

function analysisRequest() {
  return {
    schemaVersion: 1 as const,
    dialect: "common-v1" as const,
    source: "G21 G90\nG41\nM30",
  };
}

function diagnostic(index = 1) {
  return {
    id: `gcode-${index.toString(16).padStart(64, "0")}`,
    code: "semantic.cutter_comp.unsupported",
    origin: "parser" as const,
    severity: "error" as const,
    recoverable: false,
    message: "Cutter radius compensation is not supported.",
    range: {
      start: { line: 2, column: 1 },
      end: { line: 2, column: 4 },
    },
    token: "G41",
    supportLevel: "recognized-unsupported" as const,
    replacementAvailability: "unavailable" as const,
    helpKey: "gcode.help.semantic.cutter_comp.unsupported",
  };
}

function analysisResult(diagnostics = [diagnostic()]) {
  return {
    schemaVersion: 1 as const,
    coreVersion: "0.1.0",
    wasm: true as const,
    phase: "analysis" as const,
    dialect: "common-v1" as const,
    accepted: false,
    sourceHashSha256: "a".repeat(64),
    diagnostics,
    toolpathId: null,
    sourceLineMap: [],
    programControlEvents: [],
  };
}

function workerCommand() {
  return {
    protocolVersion: 1 as const,
    replyTo: null,
    kind: "command" as const,
    type: "gcode.analysis.request" as const,
    messageId: MESSAGE_ID,
    payload: analysisRequest(),
  };
}

function workerEvent() {
  return {
    protocolVersion: 1 as const,
    kind: "event" as const,
    type: "gcode.analysis.result" as const,
    messageId: RESULT_MESSAGE_ID,
    replyTo: MESSAGE_ID,
    payload: analysisResult(),
  };
}

describe("M11 G-code analysis contracts", () => {
  test("accepts the strict G41 analysis request, result, and Worker envelopes", () => {
    expect(GcodeAnalysisRequestSchema.safeParse(analysisRequest()).success).toBe(
      true,
    );
    expect(GcodeAnalysisResultSchema.safeParse(analysisResult()).success).toBe(
      true,
    );
    expect(
      GcodeAnalysisWorkerCommandSchema.safeParse(workerCommand()).success,
    ).toBe(true);
    expect(GcodeAnalysisWorkerEventSchema.safeParse(workerEvent()).success).toBe(
      true,
    );
  });

  test("rejects unknown fields at every public boundary", () => {
    expect(
      GcodeAnalysisRequestSchema.safeParse({
        ...analysisRequest(),
        unknown: true,
      }).success,
    ).toBe(false);
    expect(
      GcodeAnalysisResultSchema.safeParse({
        ...analysisResult(),
        unknown: true,
      }).success,
    ).toBe(false);
    expect(
      GcodeAnalysisResultSchema.safeParse({
        ...analysisResult(),
        diagnostics: [{ ...diagnostic(), unknown: true }],
      }).success,
    ).toBe(false);
    expect(
      GcodeAnalysisResultSchema.safeParse({
        ...analysisResult(),
        diagnostics: [
          {
            ...diagnostic(),
            range: {
              ...diagnostic().range,
              unknown: true,
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      GcodeAnalysisWorkerCommandSchema.safeParse({
        ...workerCommand(),
        unknown: true,
      }).success,
    ).toBe(false);
    expect(
      GcodeAnalysisWorkerEventSchema.safeParse({
        ...workerEvent(),
        unknown: true,
      }).success,
    ).toBe(false);
  });

  test("requires 1-based, non-empty, end-exclusive diagnostic ranges", () => {
    for (const range of [
      {
        start: { line: 0, column: 1 },
        end: { line: 2, column: 4 },
      },
      {
        start: { line: 2, column: 0 },
        end: { line: 2, column: 4 },
      },
      {
        start: { line: 2, column: 1 },
        end: { line: 2, column: 1 },
      },
      {
        start: { line: 3, column: 1 },
        end: { line: 2, column: 4 },
      },
    ]) {
      expect(
        GcodeAnalysisResultSchema.safeParse({
          ...analysisResult(),
          diagnostics: [{ ...diagnostic(), range }],
        }).success,
      ).toBe(false);
    }
  });

  test("caps structured diagnostics at the documented 10,000 entries", () => {
    const atLimit = Array.from({ length: MAX_DIAGNOSTICS }, (_, index) =>
      diagnostic(index + 1),
    );
    expect(
      GcodeAnalysisResultSchema.safeParse(analysisResult(atLimit)).success,
    ).toBe(true);
    expect(
      GcodeAnalysisResultSchema.safeParse(
        analysisResult([...atLimit, diagnostic(MAX_DIAGNOSTICS + 1)]),
      ).success,
    ).toBe(false);
  });

  test("rejects malformed identities, protocol versions, and support metadata", () => {
    expect(
      GcodeAnalysisResultSchema.safeParse({
        ...analysisResult(),
        diagnostics: [{ ...diagnostic(), id: `gcode-${"A".repeat(64)}` }],
      }).success,
    ).toBe(false);
    expect(
      GcodeAnalysisResultSchema.safeParse({
        ...analysisResult(),
        diagnostics: [
          { ...diagnostic(), supportLevel: "silently-supported" },
        ],
      }).success,
    ).toBe(false);
    expect(
      GcodeAnalysisWorkerCommandSchema.safeParse({
        ...workerCommand(),
        protocolVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      GcodeAnalysisWorkerEventSchema.safeParse({
        ...workerEvent(),
        replyTo: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});

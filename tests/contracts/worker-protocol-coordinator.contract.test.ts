import {
  CoordinatorCommandSchema,
  CoordinatorEventSchema,
} from "@cnc-render/contracts";
import { createM7PipelineFixture } from "@cnc-render/simulation";
import { describe, expect, test } from "vitest";

const RUN_ID = "70000000-0000-4000-8000-000000000301";

function startCommand() {
  return {
    protocolVersion: 1,
    messageId: "70000000-0000-4000-8000-000000000302",
    replyTo: null,
    kind: "command",
    type: "simulation.start",
    runId: RUN_ID,
    sequence: 1,
    payload: {
      executionMode: "realtime",
      playbackSpeed: 1,
      run: createM7PipelineFixture("milling", RUN_ID),
    },
  };
}

describe("M7 coordinator Worker protocol", () => {
  test("accepts a strict G-code run command from 0.1x through 100x", () => {
    for (const playbackSpeed of [0.1, 1, 10, 100]) {
      const command = startCommand();
      command.payload.playbackSpeed = playbackSpeed;
      expect(CoordinatorCommandSchema.safeParse(command).success).toBe(true);
    }
  });

  test("rejects speed clamping, run mismatch, unknown fields, and inline binary", () => {
    for (const playbackSpeed of [0.099, 100.001]) {
      const command = startCommand();
      command.payload.playbackSpeed = playbackSpeed;
      expect(CoordinatorCommandSchema.safeParse(command).success).toBe(false);
    }

    const mismatch = startCommand();
    mismatch.payload.run.runId =
      "70000000-0000-4000-8000-000000000399";
    expect(CoordinatorCommandSchema.safeParse(mismatch).success).toBe(false);

    expect(
      CoordinatorCommandSchema.safeParse({
        ...startCommand(),
        unknown: true,
      }).success,
    ).toBe(false);
    expect(
      CoordinatorCommandSchema.safeParse({
        ...startCommand(),
        binary: new Uint8Array(8),
      }).success,
    ).toBe(false);
  });

  test("requires receiver ownership and an exclusive terminal state", () => {
    const event = {
      protocolVersion: 1,
      messageId: "70000000-0000-4000-8000-000000000303",
      replyTo: null,
      kind: "event",
      type: "simulation.update",
      runId: RUN_ID,
      sequence: 1,
      payload: {
        summary: {
          schemaVersion: 1,
          coreVersion: "0.1.0",
          wasm: true,
          phase: "initialized",
          runId: RUN_ID,
          fixtureId: "m7-milling",
          processType: "milling",
          toolpathId: "70000000-0000-4000-8000-000000000304",
          parseSemanticHashSha256: "1".repeat(64),
          stateSemanticHashSha256: "2".repeat(64),
          finalSemanticHashSha256: null,
          stockHashSha256: "3".repeat(64),
          currentStep: 0,
          totalSteps: 4,
          logicalTimeS: 0,
          toolPositionMm: { xMm: 0, yMm: 0, zMm: 8 },
          stockRevision: 0,
          removedVolumeMm3: 0,
          diagnosticCodes: [],
          collision: null,
          completed: false,
          stopped: false,
          render: { renderType: "milling-full" },
          binaryLayout: [],
          binaryByteLength: 64,
        },
        binarySlices: [
          {
            handleId: "70000000-0000-4000-8000-000000000305",
            binaryKind: "milling.top-z-mm",
            byteOffset: 0,
            byteLength: 64,
            elementType: "float32",
            ownership: "receiver",
            transferMode: "transferable",
          },
        ],
      },
    };

    expect(CoordinatorEventSchema.safeParse(event).success).toBe(true);
    event.payload.binarySlices[0].ownership = "sender";
    expect(CoordinatorEventSchema.safeParse(event).success).toBe(false);

    event.payload.binarySlices[0].ownership = "receiver";
    event.payload.summary.phase = "stopped";
    event.payload.summary.completed = true;
    event.payload.summary.stopped = true;
    expect(CoordinatorEventSchema.safeParse(event).success).toBe(false);
  });
});

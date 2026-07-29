import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  WORKER_PROTOCOL_VERSION,
  WorkerMessageSchema,
  WorkerProtocolValidator,
} from "@cnc-render/contracts";

const messages = JSON.parse(
  readFileSync(
    new URL("../fixtures/m1/worker-messages.json", import.meta.url),
    "utf8",
  ),
) as Array<Record<string, unknown>>;

describe("schema M1 Worker protocol", () => {
  it("schema accepts every shared Worker fixture", () => {
    for (const message of messages) {
      expect(WorkerMessageSchema.safeParse(message).success).toBe(true);
      expect(message.protocolVersion).toBe(WORKER_PROTOCOL_VERSION);
    }
  });

  it("schema enforces monotonic event sequences and unique message IDs", () => {
    const validator = new WorkerProtocolValidator();
    for (const message of messages) {
      expect(validator.accept(message).success).toBe(true);
    }

    const duplicate = validator.accept(messages.at(-1));
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) {
      expect(duplicate.issues[0]?.code).toBe("message.duplicate");
    }

    const stale = structuredClone(messages.at(-1)!);
    stale.messageId = "10000000-0000-4000-8000-000000000099";
    stale.sequence = 0;
    (stale.payload as Record<string, unknown>).event = {
      ...((stale.payload as Record<string, unknown>).event as object),
      sequence: 0,
    };
    const staleResult = validator.accept(stale);
    expect(staleResult.success).toBe(false);
    if (!staleResult.success) {
      expect(staleResult.issues[0]?.code).toBe("sequence.not_monotonic");
    }
  });

  it("schema rejects unknown protocol versions, types, and inline binaries", () => {
    const unknownVersion = {
      ...structuredClone(messages[0]),
      protocolVersion: 2,
    };
    expect(WorkerMessageSchema.safeParse(unknownVersion).success).toBe(false);

    const unknownType = {
      ...structuredClone(messages[0]),
      type: "simulation.execute",
    };
    expect(WorkerMessageSchema.safeParse(unknownType).success).toBe(false);

    const validator = new WorkerProtocolValidator();
    const inlineBinary = structuredClone(messages[0]);
    (inlineBinary.payload as Record<string, unknown>).buffer =
      new Uint8Array(8);
    expect(validator.accept(inlineBinary).success).toBe(false);
  });

  it("schema keeps transfer mode semantics explicit without embedding buffers", () => {
    const transferModes = ["transferable", "shared-array-buffer", "copy"];
    for (const transferMode of transferModes) {
      const handshake = structuredClone(messages[0]);
      handshake.messageId = `10000000-0000-4000-8000-0000000000${transferModes.indexOf(transferMode) + 10}`;
      (handshake.payload as Record<string, unknown>).transferModes = [
        transferMode,
      ];
      expect(WorkerMessageSchema.safeParse(handshake).success).toBe(true);
    }
  });
});

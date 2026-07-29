import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  WorkerMessageSchema,
  WorkerProtocolValidator,
} from "@cnc-render/contracts";

const project = JSON.parse(
  readFileSync(
    new URL("../fixtures/m1/valid-project.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;
const projectHash = readFileSync(
  new URL("../fixtures/m1/valid-project.sha256", import.meta.url),
  "utf8",
).trim();
const runId = "20000000-0000-4000-8000-000000000001";

const messages = [
  {
    protocolVersion: 1,
    messageId: "10000000-0000-4000-8000-000000000010",
    replyTo: null,
    kind: "command",
    type: "project.load",
    runId,
    sequence: 0,
    payload: {
      project,
      transferMode: "transferable",
      binaryHandles: [],
    },
  },
  {
    protocolVersion: 1,
    messageId: "10000000-0000-4000-8000-000000000011",
    replyTo: null,
    kind: "command",
    type: "run.dispose",
    runId,
    sequence: 1,
    payload: { reason: "cancelled" },
  },
  {
    protocolVersion: 1,
    messageId: "10000000-0000-4000-8000-000000000012",
    replyTo: "10000000-0000-4000-8000-000000000010",
    kind: "event",
    type: "project.accepted",
    runId,
    sequence: 0,
    payload: {
      projectId: project.id,
      semanticHashSha256: projectHash,
    },
  },
  {
    protocolVersion: 1,
    messageId: "10000000-0000-4000-8000-000000000013",
    replyTo: "10000000-0000-4000-8000-000000000010",
    kind: "event",
    type: "project.rejected",
    runId,
    sequence: 0,
    payload: {
      code: "project.invalid",
      messageKey: "project.invalid",
      path: ["operations", 0, "feed"],
    },
  },
  {
    protocolVersion: 1,
    messageId: "10000000-0000-4000-8000-000000000014",
    replyTo: null,
    kind: "event",
    type: "worker.error",
    runId: null,
    sequence: 0,
    payload: {
      code: "worker.internal",
      messageKey: "worker.internal",
      recoverable: false,
    },
  },
] as const;

describe("schema M1 complete Worker protocol surface", () => {
  it("accepts every declared command and response shape", () => {
    for (const message of messages) {
      expect(
        WorkerMessageSchema.safeParse(message).success,
        message.type,
      ).toBe(true);
    }
  });

  it("rejects newline-suffixed digests and diagnostic codes", () => {
    const badDigest = structuredClone(messages[2]) as {
      payload: { semanticHashSha256: string };
    };
    badDigest.payload.semanticHashSha256 = `${projectHash}\n`;
    expect(WorkerMessageSchema.safeParse(badDigest).success).toBe(false);

    const badCode = structuredClone(messages[4]) as {
      payload: { code: string };
    };
    badCode.payload.code = "worker.internal\n";
    expect(WorkerMessageSchema.safeParse(badCode).success).toBe(false);
  });

  it("rejects omitted nullable envelope keys and inline shared memory", () => {
    const missingReply = structuredClone(messages[4]) as Record<
      string,
      unknown
    >;
    delete missingReply.replyTo;
    expect(WorkerMessageSchema.safeParse(missingReply).success).toBe(false);

    if (typeof SharedArrayBuffer !== "undefined") {
      const inlineBinary = structuredClone(messages[0]) as Record<
        string,
        unknown
      >;
      (inlineBinary.payload as Record<string, unknown>).buffer =
        new SharedArrayBuffer(16);
      expect(new WorkerProtocolValidator().accept(inlineBinary).success).toBe(
        false,
      );
    }
  });
});

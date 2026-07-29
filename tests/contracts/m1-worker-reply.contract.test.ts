import { describe, expect, it } from "vitest";

import { WorkerProtocolValidator } from "@cnc-render/contracts";

function workerError(
  messageId: string,
  runId: string | null,
  replyTo: string | null,
) {
  return {
    protocolVersion: 1,
    messageId,
    replyTo,
    kind: "event",
    type: "worker.error",
    runId,
    sequence: 0,
    payload: {
      code: "worker.internal",
      messageKey: "worker.internal",
      recoverable: false,
    },
  };
}

describe("schema M1 Worker reply correlation", () => {
  it("rejects unknown reply targets", () => {
    const validator = new WorkerProtocolValidator();
    const result = validator.accept({
      protocolVersion: 1,
      messageId: "10000000-0000-4000-8000-000000000020",
      replyTo: "10000000-0000-4000-8000-000000000099",
      kind: "event",
      type: "worker.ready",
      runId: null,
      sequence: 0,
      payload: {
        selectedProtocolVersion: 1,
        coreVersion: "0.1.0",
        transferMode: "copy",
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]?.code).toBe("reply.unknown");
    }
  });

  it("rejects reply targets of the wrong message type", () => {
    const validator = new WorkerProtocolValidator();
    const target = workerError(
      "10000000-0000-4000-8000-000000000021",
      null,
      null,
    );
    expect(validator.accept(target).success).toBe(true);

    const result = validator.accept({
      protocolVersion: 1,
      messageId: "10000000-0000-4000-8000-000000000022",
      replyTo: target.messageId,
      kind: "event",
      type: "worker.ready",
      runId: null,
      sequence: 0,
      payload: {
        selectedProtocolVersion: 1,
        coreVersion: "0.1.0",
        transferMode: "copy",
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]?.code).toBe("reply.type_mismatch");
    }
  });

  it("rejects reply targets from another run", () => {
    const validator = new WorkerProtocolValidator();
    const target = workerError(
      "10000000-0000-4000-8000-000000000023",
      "20000000-0000-4000-8000-000000000001",
      null,
    );
    expect(validator.accept(target).success).toBe(true);

    const result = validator.accept(
      workerError(
        "10000000-0000-4000-8000-000000000024",
        "20000000-0000-4000-8000-000000000002",
        target.messageId,
      ),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]?.code).toBe("reply.run_mismatch");
    }
  });
});

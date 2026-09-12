import {
  GcodeAnalysisWorkerCommandSchema,
  type GcodeAnalysisRequest,
  type GcodeAnalysisResult,
} from "@cnc-render/contracts";
import {
  GcodeAnalysisClient,
  GcodeAnalysisClientError,
} from "@cnc-render/simulation";
import { describe, expect, test, vi } from "vitest";

const RESULT_MESSAGE_ID = "b2000000-0000-4000-8000-000000000001";
const ERROR_MESSAGE_ID = "b2000000-0000-4000-8000-000000000002";
const STALE_MESSAGE_ID = "b2000000-0000-4000-8000-000000000003";
const STALE_REPLY_ID = "b2000000-0000-4000-8000-000000000099";

class FakeWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly postedMessages: unknown[] = [];
  terminateCalls = 0;

  postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  emitMessage(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}

function analysisRequest(): GcodeAnalysisRequest {
  return {
    schemaVersion: 1,
    dialect: "common-v1",
    source: "G21 G90\nG41\nM30",
  };
}

function analysisResult(): GcodeAnalysisResult {
  return {
    schemaVersion: 1,
    coreVersion: "0.1.0",
    wasm: true,
    phase: "analysis",
    dialect: "common-v1",
    accepted: false,
    sourceHashSha256: "a".repeat(64),
    diagnostics: [
      {
        id: `gcode-${"1".repeat(64)}`,
        code: "semantic.cutter_comp.unsupported",
        origin: "parser",
        severity: "error",
        recoverable: false,
        message: "Cutter radius compensation is not supported.",
        range: {
          start: { line: 2, column: 1 },
          end: { line: 2, column: 4 },
        },
        token: "G41",
        supportLevel: "recognized-unsupported",
        replacementAvailability: "unavailable",
        helpKey: "gcode.help.semantic.cutter_comp.unsupported",
      },
    ],
    toolpathId: null,
    sourceLineMap: [],
    programControlEvents: [],
  };
}

function resultEvent(replyTo: string, messageId = RESULT_MESSAGE_ID) {
  return {
    protocolVersion: 1 as const,
    messageId,
    replyTo,
    kind: "event" as const,
    type: "gcode.analysis.result" as const,
    payload: analysisResult(),
  };
}

function errorEvent(replyTo: string) {
  return {
    protocolVersion: 1 as const,
    messageId: ERROR_MESSAGE_ID,
    replyTo,
    kind: "event" as const,
    type: "gcode.analysis.error" as const,
    payload: {
      code: "gcode.analysis.failed",
      message: "The parser-only WASM analysis failed.",
    },
  };
}

function postedCommand(worker: FakeWorkerPort) {
  expect(worker.postedMessages).toHaveLength(1);
  return GcodeAnalysisWorkerCommandSchema.parse(worker.postedMessages[0]);
}

describe("GcodeAnalysisClient", () => {
  test("correlates overlapping analyses even when replies arrive in reverse order", async () => {
    const worker = new FakeWorkerPort();
    const client = new GcodeAnalysisClient(() => worker);
    const first = client.analyze(analysisRequest());
    const second = client.analyze({ ...analysisRequest(), source: "G21 G90\nG42\nM30" });
    const requests = worker.postedMessages.map((message) => GcodeAnalysisWorkerCommandSchema.parse(message));
    const newest = { ...resultEvent(requests[1]!.messageId), payload: { ...analysisResult(), sourceHashSha256: "b".repeat(64) } };
    worker.emitMessage(newest);
    await expect(second).resolves.toMatchObject({ sourceHashSha256: "b".repeat(64) });
    worker.emitMessage(resultEvent(requests[0]!.messageId));
    await expect(first).resolves.toMatchObject({ sourceHashSha256: "a".repeat(64) });
    client.dispose();
  });

  test("timeout discards late replies and invalid timeout never posts", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorkerPort();
      const client = new GcodeAnalysisClient(() => worker);
      await expect(client.analyze(analysisRequest(), Number.NaN)).rejects.toMatchObject({ code: "gcode.analysis.invalid-timeout" });
      expect(worker.postedMessages).toHaveLength(0);
      const pending = client.analyze(analysisRequest(), 5).catch((error: unknown) => error);
      const request = postedCommand(worker);
      await vi.advanceTimersByTimeAsync(5);
      await expect(pending).resolves.toMatchObject({ code: "gcode.analysis.timeout" });
      worker.emitMessage(resultEvent(request.messageId));
      expect(vi.getTimerCount()).toBe(0);
      client.dispose();
    } finally { vi.useRealTimers(); }
  });

  test("postMessage failure clears timers and Worker crash fails later analyses immediately", async () => {
    vi.useFakeTimers();
    try {
      const brokenWorker = new FakeWorkerPort();
      brokenWorker.postMessage = () => { throw new Error("Worker channel is closed"); };
      const brokenClient = new GcodeAnalysisClient(() => brokenWorker);
      await expect(brokenClient.analyze(analysisRequest())).rejects.toMatchObject({ code: "gcode.analysis.post-failed" });
      expect(vi.getTimerCount()).toBe(0);
      brokenClient.dispose();
      const worker = new FakeWorkerPort();
      const client = new GcodeAnalysisClient(() => worker);
      const pending = client.analyze(analysisRequest());
      worker.onerror?.({ message: "WASM Worker crashed" } as ErrorEvent);
      await expect(pending).rejects.toMatchObject({ code: "gcode.analysis.worker-failed" });
      await expect(client.analyze(analysisRequest())).rejects.toMatchObject({ code: "gcode.analysis.worker-failed" });
      expect(worker.postedMessages).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
      client.dispose();
    } finally { vi.useRealTimers(); }
  });

  test("sends a strict request envelope and resolves only its matching result", async () => {
    const worker = new FakeWorkerPort();
    const client = new GcodeAnalysisClient(() => worker);
    const request = analysisRequest();

    const pending = client.analyze(request);
    const command = postedCommand(worker);

    expect(command).toMatchObject({
      protocolVersion: 1,
      replyTo: null,
      kind: "command",
      type: "gcode.analysis.request",
      payload: request,
    });
    expect(Object.keys(command.payload).sort()).toEqual([
      "dialect",
      "schemaVersion",
      "source",
    ]);

    const expected = analysisResult();
    worker.emitMessage(resultEvent(command.messageId));

    await expect(pending).resolves.toEqual(expected);
    client.dispose();
    expect(worker.terminateCalls).toBe(1);
  });

  test("rejects a matching analysis error with its typed code", async () => {
    const worker = new FakeWorkerPort();
    const client = new GcodeAnalysisClient(() => worker);

    const pending = client.analyze(analysisRequest());
    const command = postedCommand(worker);
    worker.emitMessage(errorEvent(command.messageId));

    const error = await pending.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(GcodeAnalysisClientError);
    expect(error).toMatchObject({
      code: "gcode.analysis.failed",
      message: "The parser-only WASM analysis failed.",
    });
    client.dispose();
  });

  test("dispose rejects pending analysis and terminates the Worker", async () => {
    const worker = new FakeWorkerPort();
    const client = new GcodeAnalysisClient(() => worker);
    const pending = client.analyze(analysisRequest());

    client.dispose();

    const error = await pending.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(GcodeAnalysisClientError);
    expect(error).toMatchObject({ code: "gcode.analysis.disposed" });
    expect(worker.terminateCalls).toBe(1);

    client.dispose();
    expect(worker.terminateCalls).toBe(1);
  });

  test("ignores unknown events and stale replies until the matching reply arrives", async () => {
    const worker = new FakeWorkerPort();
    const client = new GcodeAnalysisClient(() => worker);
    const pending = client.analyze(analysisRequest());
    const command = postedCommand(worker);
    let settlement: "pending" | "resolved" | "rejected" = "pending";
    void pending.then(
      () => {
        settlement = "resolved";
      },
      () => {
        settlement = "rejected";
      },
    );

    worker.emitMessage({ type: "gcode.analysis.unknown" });
    worker.emitMessage(resultEvent(STALE_REPLY_ID, STALE_MESSAGE_ID));
    await Promise.resolve();
    expect(settlement).toBe("pending");

    worker.emitMessage(resultEvent(command.messageId));
    await expect(pending).resolves.toEqual(analysisResult());
    expect(settlement).toBe("resolved");
    client.dispose();
  });
});

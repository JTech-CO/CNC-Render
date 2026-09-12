import { describe, expect, it, vi } from "vitest";
import { ResultComparisonClient, type ResultComparisonWorkerPort } from "../../packages/simulation/src/result-comparison-client";
import { compareStockResult, type ResultComparisonInput } from "../../packages/simulation/src/result-comparison";
import { validateResultComparisonRequest, validateResultComparisonResponse } from "../../packages/simulation/src/result-comparison-protocol";

class Port implements ResultComparisonWorkerPort {
  onmessage: ResultComparisonWorkerPort["onmessage"] = null;
  onerror: ResultComparisonWorkerPort["onerror"] = null;
  messages: unknown[] = [];
  terminated = 0;
  postMessage(value: unknown) { this.messages.push(value); }
  terminate() { this.terminated += 1; }
  emit(value: unknown) { this.onmessage?.({ data: value } as MessageEvent<unknown>); }
}
function input(): ResultComparisonInput {
  const boundsMm = { minimum: { xMm: 0, yMm: 0, zMm: 0 }, maximum: { xMm: 1, yMm: 1, zMm: 10 } };
  return { provenance: { runId: "7a000000-0000-4000-8000-000000000001", fixtureId: "milling", stateHash: "a".repeat(64), stockHash: "b".repeat(64), logicalTimeS: 1,
      outcome: "completed", collisionCount: 0, warningCount: 0, diagnosticCount: 0 },
    surface: { columns: 1, rows: 1, resolutionMm: 1, boundsMm, topZMm: new Float32Array([8]) },
    target: { targetId: "authored-target", kind: "flat-end-sweep", stockBoundsMm: boundsMm, cutterDiameterMm: 20,
      sweeps: [{ startMm: { xMm: 0, yMm: 0, zMm: 8 }, endMm: { xMm: 1, yMm: 1, zMm: 8 } }] } };
}
describe("M11 comparison Worker protocol", () => {
  it("matches only the current reply and ignores stale / unrelated messages", async () => {
    const port = new Port(); const client = new ResultComparisonClient(() => port); const source = input();
    const pending = client.compare(source); const result = compareStockResult(source);
    expect(port.messages[0]).toMatchObject({ protocolVersion: 1, requestId: 1 });
    port.emit(null); port.emit({ protocolVersion: 1, requestId: 999, result });
    port.emit({ protocolVersion: 1, requestId: 1, result });
    await expect(pending).resolves.toEqual(result); client.dispose();
  });
  it("rejects stale Stock provenance, malformed buffers and extra fields", () => {
    const source = input(); const result = compareStockResult(source);
    const valid = { protocolVersion: 1, requestId: 1, result };
    for (const bad of [{ ...valid, protocolVersion: 2 }, { ...valid, extra: true },
      { ...valid, result: { ...result, report: { ...result.report, stockHash: "c".repeat(64) } } },
      { ...valid, result: { ...result, field: { ...result.field, actualMm: new Float64Array([NaN]) } } },
      { ...valid, result: { ...result, field: { ...result.field, coordinatesMm: new Float64Array(2) } } },
      { ...valid, result: { ...result, field: { ...result.field, columns: 2 } } }]) {
      expect(() => validateResultComparisonResponse(bad, source.provenance, 1)).toThrow();
    }
  });
  it("rejects invalid request identity and protocol", () => {
    for (const bad of [{ protocolVersion: 2, requestId: 1, input: input() }, { protocolVersion: 1, requestId: NaN, input: input() },
      { protocolVersion: 1, requestId: 1, input: { ...input(), provenance: { ...input().provenance, runId: "bad" } } },
      { protocolVersion: 1, requestId: 1, input: { ...input(), provenance: { ...input().provenance, stateHash: "BAD" } } }]) expect(() => validateResultComparisonRequest(bad)).toThrow();
  });
  it("rejects failures and disposes pending requests without leaking timers", async () => {
    vi.useFakeTimers();
    try {
      const port = new Port(); const client = new ResultComparisonClient(() => port);
      const pending = client.compare(input());
      port.emit({ protocolVersion: 1, requestId: 1, error: "Stock mismatch" });
      await expect(pending).rejects.toThrow("Stock mismatch");
      const canceled = client.compare(input()); client.dispose();
      await expect(canceled).rejects.toThrow("취소"); expect(vi.getTimerCount()).toBe(0);
      await expect(client.compare(input())).rejects.toThrow("종료");
    } finally { vi.useRealTimers(); }
  });
  it("times out a silent Worker and cleans up posting / Worker failures", async () => {
    vi.useFakeTimers();
    try {
      const port = new Port(); const client = new ResultComparisonClient(() => port);
      const timeout = client.compare(input()); const assertion = expect(timeout).rejects.toThrow("시간이 초과");
      await vi.advanceTimersByTimeAsync(30_000); await assertion;
      port.postMessage = () => { throw new Error("closed channel"); };
      await expect(client.compare(input())).rejects.toThrow("closed channel");
      expect(vi.getTimerCount()).toBe(0); client.dispose();
      const failedPort = new Port(); const failedClient = new ResultComparisonClient(() => failedPort);
      const pending = failedClient.compare(input()); failedPort.onerror?.({ message: "crashed" } as ErrorEvent);
      await expect(pending).rejects.toThrow("취소"); expect(failedPort.terminated).toBe(1); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

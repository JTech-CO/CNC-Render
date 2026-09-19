import { describe, expect, it } from "vitest";
import { encodeReferenceEvidence, decodeReferenceEvidence } from "../../scripts/reference-evidence-envelope.mjs";

const evidence = { schemaVersion: 1, runtimeFingerprint: { sha256: "fixture" }, benchmark: { executions: [] } };

describe("reference evidence envelope", () => {
  it("round-trips bounded chunks without dropping raw evidence", () => {
    const large = { ...evidence, samples: Array.from({ length: 8000 }, (_, index) => ({ index, timestamp: Math.sin(index) })) };
    const envelope = encodeReferenceEvidence(large);
    expect(envelope.payloadChunks.length).toBeGreaterThan(1);
    expect(envelope.payloadChunks.every((chunk: string) => chunk.length <= 8192)).toBe(true);
    expect(decodeReferenceEvidence(envelope)).toEqual(large);
  });
  it("still reads the previous single-string envelope", () => {
    const envelope = encodeReferenceEvidence(evidence);
    expect(decodeReferenceEvidence({ ...envelope, schemaVersion: 1, payload: envelope.payloadChunks.join("") })).toEqual(evidence);
  });
  it("rejects corrupt, oversized, missing or mismatched evidence", () => {
    const envelope = encodeReferenceEvidence(evidence);
    for (const invalid of [
      { schemaVersion: 3 }, { encoding: "plain" }, { payloadChunks: [] }, { payloadChunks: [42] },
      { payloadChunks: ["A".repeat(8193)] }, { payloadChunks: ["invalid!"] }, { runtimeFingerprint: { sha256: "changed" } },
    ]) expect(() => decodeReferenceEvidence({ ...envelope, ...invalid })).toThrow();
    expect(() => decodeReferenceEvidence(encodeReferenceEvidence({ ...evidence, oversized: "x".repeat(2_000_001) }))).toThrow();
  });
});

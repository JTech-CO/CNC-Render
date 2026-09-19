import { gzipSync, gunzipSync } from "node:zlib";

export function encodeReferenceEvidence(evidence) {
  const payload = gzipSync(JSON.stringify(evidence), { level: 9 }).toString("base64");
  return {
    schemaVersion: 2,
    encoding: "gzip-base64",
    runtimeFingerprint: evidence.runtimeFingerprint,
    description: "Run node scripts/check-reference-evidence.mjs to validate and expand the sanitized report into artifacts/approved-host-reference-evidence.json",
    // Bounded lines keep raw execution evidence editable on Windows without
    // dropping samples to fit the command-line or diff viewer's line limits.
    payloadChunks: payload.match(/.{1,8192}/gu) ?? [],
  };
}

export function decodeReferenceEvidence(envelope) {
  if (envelope.encoding !== "gzip-base64" || ![1, 2].includes(envelope.schemaVersion)) throw new Error("Unsupported evidence envelope");
  if (envelope.schemaVersion === 2 && (!Array.isArray(envelope.payloadChunks) || envelope.payloadChunks.length === 0 ||
      envelope.payloadChunks.some((chunk) => typeof chunk !== "string" || chunk.length === 0 || chunk.length > 8192))) {
    throw new Error("Invalid evidence chunks");
  }
  const payload = envelope.schemaVersion === 1 ? envelope.payload : envelope.payloadChunks.join("");
  if (typeof payload !== "string" || payload.length > 3_000_000 || Buffer.from(payload, "base64").toString("base64") !== payload) throw new Error("Invalid evidence payload");
  const evidence = JSON.parse(gunzipSync(Buffer.from(payload, "base64"), { maxOutputLength: 2_000_000 }).toString("utf8"));
  if (JSON.stringify(envelope.runtimeFingerprint) !== JSON.stringify(evidence.runtimeFingerprint)) throw new Error("Envelope fingerprint mismatch");
  return evidence;
}

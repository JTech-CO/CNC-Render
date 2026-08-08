import { canonicalJson, type JsonValue } from "@cnc-render/contracts";

import { persistenceFailure, type PersistenceStage } from "./errors";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export function cloneBytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes);
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

export function encodeUtf8(value: string): Uint8Array {
  return UTF8_ENCODER.encode(value);
}

export function decodeUtf8(
  bytes: Uint8Array,
  stage: PersistenceStage,
): string {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch (error) {
    throw persistenceFailure(
      `storage.${stage}.utf8.invalid`,
      stage,
      "persisted text must be valid UTF-8",
      { cause: error },
    );
  }
}

export function canonicalJsonBytes(value: JsonValue): Uint8Array {
  return encodeUtf8(canonicalJson(value));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = Uint8Array.from(bytes).buffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function assertJsonValue(
  value: unknown,
  stage: PersistenceStage,
  depth = 0,
  maxDepth = Number.POSITIVE_INFINITY,
): asserts value is JsonValue {
  if (depth > maxDepth) {
    throw persistenceFailure(
      `storage.${stage}.json.depth-limit`,
      stage,
      `JSON nesting exceeds the ${maxDepth}-level limit`,
    );
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw persistenceFailure(
        `storage.${stage}.json.number-invalid`,
        stage,
        "persisted JSON numbers must be finite and cannot be negative zero",
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonValue(item, stage, depth + 1, maxDepth);
    }
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      assertJsonValue(item, stage, depth + 1, maxDepth);
    }
    return;
  }
  throw persistenceFailure(
    `storage.${stage}.json.value-invalid`,
    stage,
    "persisted JSON contains an unsupported value",
  );
}

export function parseJsonBytes(
  bytes: Uint8Array,
  stage: PersistenceStage,
  maxDepth: number,
): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(bytes, stage)) as unknown;
  } catch (error) {
    if (error instanceof Error && error.name === "ProjectPersistenceError") {
      throw error;
    }
    throw persistenceFailure(
      `storage.${stage}.json.invalid`,
      stage,
      "persisted JSON could not be parsed",
      { cause: error },
    );
  }
  assertJsonValue(value, stage, 0, maxDepth);
  return value;
}

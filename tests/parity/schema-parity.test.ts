import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ProjectSchema,
  canonicalJson,
  semanticHash,
  type JsonValue,
} from "@cnc-render/contracts";

const fixtureUrl = new URL(
  "../fixtures/m1/valid-project.json",
  import.meta.url,
);
const expectedHashUrl = new URL(
  "../fixtures/m1/valid-project.sha256",
  import.meta.url,
);

describe("schema TypeScript and Rust semantic parity", () => {
  it("produces the shared canonical semantic SHA-256", async () => {
    const project = ProjectSchema.parse(
      JSON.parse(readFileSync(fixtureUrl, "utf8")),
    ) as JsonValue;
    const expectedHash = readFileSync(expectedHashUrl, "utf8").trim();

    expect(await semanticHash(project)).toBe(expectedHash);
    expect(expectedHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is independent of object insertion order and preserves array order", () => {
    const left = {
      z: [1, 2, 3],
      a: { beta: true, alpha: "value" },
    } satisfies JsonValue;
    const right = {
      a: { alpha: "value", beta: true },
      z: [1, 2, 3],
    } satisfies JsonValue;

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalJson({ values: [1, 2] })).not.toBe(
      canonicalJson({ values: [2, 1] }),
    );
  });

  it("rejects non-finite values and negative zero before hashing", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0]) {
      expect(() => canonicalJson({ value })).toThrow(RangeError);
    }
  });
});

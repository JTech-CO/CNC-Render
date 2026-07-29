import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ProjectSchema, UuidSchema } from "@cnc-render/contracts";

const validProject = JSON.parse(
  readFileSync(
    new URL("../fixtures/m1/valid-project.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("schema M1 primitive parity", () => {
  it("accepts RFC 9562 UUID versions 1 through 8 and its variant", () => {
    expect(
      UuidSchema.safeParse("A0000000-0000-8000-B000-000000000001").success,
    ).toBe(true);
  });

  it("rejects nil, max, malformed, and newline-suffixed UUID values", () => {
    for (const value of [
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "00000000-0000-4000-7000-000000000001",
      "00000000-0000-4000-8000-000000000001\n",
    ]) {
      expect(UuidSchema.safeParse(value).success).toBe(false);
    }
  });

  it("requires nullable wire keys to be present even when their value is null", () => {
    const candidate = structuredClone(validProject);
    delete (
      (
        candidate.machines as Array<{
          axes: Array<Record<string, unknown>>;
        }>
      )[0]?.axes[0] as Record<string, unknown>
    ).parentId;

    expect(ProjectSchema.safeParse(candidate).success).toBe(false);
  });
});

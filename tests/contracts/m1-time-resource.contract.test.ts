import { describe, expect, it } from "vitest";

import {
  ResourceDescriptorSchema,
  UtcDateTimeSchema,
} from "@cnc-render/contracts";

const resource = {
  schemaVersion: 1,
  id: "00000000-0000-4000-8000-000000000001",
  path: "programs/main.nc",
  role: "gcode-program",
  mediaType: "text/x-gcode",
  byteLength: 128,
  sha256: "0".repeat(64),
  authoritative: true,
};

describe("schema M1 timestamp and resource boundaries", () => {
  it("accepts valid leap days and rejects impossible UTC instants", () => {
    expect(
      UtcDateTimeSchema.safeParse("2024-02-29T23:59:59.123456789Z").success,
    ).toBe(true);

    for (const value of [
      "0000-01-01T00:00:00Z",
      "2023-02-29T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-01-01T24:00:00Z",
      "2026-01-01T00:60:00Z",
      "2026-01-01T00:00:60Z",
      "2026-01-01T00:00:00Z\n",
    ]) {
      expect(UtcDateTimeSchema.safeParse(value).success).toBe(false);
    }
  });

  it("validates resource safety without requiring a Project wrapper", () => {
    expect(ResourceDescriptorSchema.safeParse(resource).success).toBe(true);
    expect(
      ResourceDescriptorSchema.safeParse({
        ...resource,
        path: "../escape.nc",
      }).success,
    ).toBe(false);
    expect(
      ResourceDescriptorSchema.safeParse({
        ...resource,
        role: "preview",
        authoritative: true,
      }).success,
    ).toBe(false);
  });

  it("rejects newline-suffixed fixed digests and MIME types", () => {
    expect(
      ResourceDescriptorSchema.safeParse({
        ...resource,
        sha256: `${resource.sha256}\n`,
      }).success,
    ).toBe(false);
    expect(
      ResourceDescriptorSchema.safeParse({
        ...resource,
        mediaType: "text/x-gcode\n",
      }).success,
    ).toBe(false);
  });
});

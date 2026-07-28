import { describe, expect, it } from "vitest";

import {
  loadGcodeFixtureManifests,
  parseGcodeFixture,
} from "../helpers/gcode-cli.mjs";

const manifests = loadGcodeFixtureManifests();

describe("gcode Rust CLI parity and determinism", () => {
  it.each(manifests)(
    "gcode keeps $fixtureId byte-stable across 100 parses",
    (manifest) => {
      const repeated = parseGcodeFixture(manifest, 100);

      expect(repeated.stable).toBe(true);
      expect(repeated.serializedSha256).toMatch(/^[a-f0-9]{64}$/u);
    },
    120_000,
  );

  it(
    "gcode emits the same ordered result in separate processes",
    () => {
      const representative =
        manifests.find((manifest) => manifest.expected.accepted) ??
        manifests[0];
      const first = parseGcodeFixture(representative);
      const second = parseGcodeFixture(representative);

      expect(first.serializedSha256).toBe(second.serializedSha256);
      expect(JSON.stringify(first.result)).toBe(JSON.stringify(second.result));
    },
    120_000,
  );
});

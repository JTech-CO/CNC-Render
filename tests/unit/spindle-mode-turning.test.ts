import { describe, expect, it } from "vitest";
import { resolveLatheSpindleSpeed } from "../../packages/simulation/src/material-removal-turning";
import { loadTurningGoldenFixture } from "../helpers/turning-fixture";

const fixture = loadTurningGoldenFixture();

describe("M6 G96/G97 spindle-mode formulas", () => {
  it("matches every Golden formula and clamps at the machine maximum", () => {
    for (const item of fixture.spindleCases) {
      const result = resolveLatheSpindleSpeed({
        mode: item.mode,
        commandedValue: item.commandedValue,
        diameterMm: item.diameterMm,
        machineMaxSpindleSpeedRpm: fixture.machine.maxSpindleSpeedRpm,
      });
      expect(result.requestedRpm, item.id).toBeCloseTo(
        item.expectedRequestedRpm,
        12,
      );
      expect(result.effectiveRpm, item.id).toBeCloseTo(
        item.expectedEffectiveRpm,
        12,
      );
      expect(result.clamped, item.id).toBe(item.expectedClamped);
      expect(result.maximumRpm).toBe(fixture.machine.maxSpindleSpeedRpm);
    }
  });

  it("also respects a lower tool RPM limit", () => {
    expect(
      resolveLatheSpindleSpeed({
        mode: "rpm",
        commandedValue: 4_000,
        diameterMm: 20,
        machineMaxSpindleSpeedRpm: 4_500,
        toolMaxSpindleSpeedRpm: 3_000,
      }),
    ).toMatchObject({
      requestedRpm: 4_000,
      effectiveRpm: 3_000,
      maximumRpm: 3_000,
      clamped: true,
    });
  });

  it("rejects zero, negative, and non-finite spindle inputs", () => {
    for (const commandedValue of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        resolveLatheSpindleSpeed({
          mode: "surface-speed",
          commandedValue,
          diameterMm: 20,
          machineMaxSpindleSpeedRpm: 4_500,
        }),
      ).toThrowError();
    }
  });
});

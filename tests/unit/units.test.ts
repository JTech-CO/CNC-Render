import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  degrees,
  degreesToRadians,
  inches,
  inchesPerMinuteToMillimetersPerMinute,
  inchesPerRevolutionToMillimetersPerRevolution,
  inchesPerToothToMillimetersPerTooth,
  inchesToMillimeters,
  millimeters,
  millimetersPerMinute,
  millimetersPerMinuteToInchesPerMinute,
  millimetersPerRevolution,
  millimetersPerRevolutionToInchesPerRevolution,
  millimetersPerTooth,
  millimetersPerToothToInchesPerTooth,
  millimetersToInches,
  quantitiesApproximatelyEqual,
  radians,
  radiansToDegrees,
  revolutionsPerMinute,
  roundForDisplay,
} from "@cnc-render/contracts";

type GoldenUnits = {
  length: Array<{ millimeters: number; inches: number }>;
  angles: Array<{ degrees: number; radians: number }>;
  feeds: {
    rpm: number;
    mmPerMin: number;
    inPerMin: number;
    mmPerRev: number;
    inPerRev: number;
    mmPerTooth: number;
    inPerTooth: number;
  };
  absoluteTolerance: number;
  relativeTolerance: number;
};

const golden = JSON.parse(
  readFileSync(
    new URL("../fixtures/m1/units.golden.json", import.meta.url),
    "utf8",
  ),
) as GoldenUnits;

function expectApproximately(left: number, right: number) {
  expect(
    quantitiesApproximatelyEqual(
      left,
      right,
      golden.absoluteTolerance,
      golden.relativeTolerance,
    ),
  ).toBe(true);
}

describe("units M1 golden conversions", () => {
  it("units round-trips mm and inch without changing canonical precision", () => {
    for (const sample of golden.length) {
      const canonical = millimeters(sample.millimeters);
      const displayed = millimetersToInches(canonical);
      expectApproximately(displayed, sample.inches);
      expectApproximately(inchesToMillimeters(inches(displayed)), canonical);
    }
  });

  it("units round-trips degree and radian", () => {
    for (const sample of golden.angles) {
      const canonical = degreesToRadians(degrees(sample.degrees));
      expectApproximately(canonical, sample.radians);
      expectApproximately(radiansToDegrees(radians(canonical)), sample.degrees);
    }
  });

  it("units preserves rpm and all feed dimensions", () => {
    expect(revolutionsPerMinute(golden.feeds.rpm)).toBe(golden.feeds.rpm);

    const feedPerMinute = millimetersPerMinute(golden.feeds.mmPerMin);
    expectApproximately(
      millimetersPerMinuteToInchesPerMinute(feedPerMinute),
      golden.feeds.inPerMin,
    );
    expectApproximately(
      inchesPerMinuteToMillimetersPerMinute(golden.feeds.inPerMin),
      feedPerMinute,
    );

    const feedPerRevolution = millimetersPerRevolution(
      golden.feeds.mmPerRev,
    );
    expectApproximately(
      millimetersPerRevolutionToInchesPerRevolution(feedPerRevolution),
      golden.feeds.inPerRev,
    );
    expectApproximately(
      inchesPerRevolutionToMillimetersPerRevolution(golden.feeds.inPerRev),
      feedPerRevolution,
    );

    const feedPerTooth = millimetersPerTooth(golden.feeds.mmPerTooth);
    expectApproximately(
      millimetersPerToothToInchesPerTooth(feedPerTooth),
      golden.feeds.inPerTooth,
    );
    expectApproximately(
      inchesPerToothToMillimetersPerTooth(golden.feeds.inPerTooth),
      feedPerTooth,
    );
  });

  it("units keeps display rounding separate from stored values", () => {
    const storedValue = 12.345_678_901_234_5;
    expect(roundForDisplay(storedValue, 3)).toBe("12.346");
    expect(storedValue).toBe(12.345_678_901_234_5);
    expect(JSON.parse(JSON.stringify(storedValue))).toBe(storedValue);
  });

  it("units rejects non-finite, negative zero, and non-positive rates", () => {
    expect(() => millimeters(Number.NaN)).toThrow();
    expect(() => millimeters(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => millimeters(-0)).toThrow();
    expect(() => millimetersPerMinute(0)).toThrow();
    expect(() => revolutionsPerMinute(-1)).toThrow();
  });
});

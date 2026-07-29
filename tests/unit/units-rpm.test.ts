import { describe, expect, it } from "vitest";

import {
  quantitiesApproximatelyEqual,
  revolutionsPerMinute,
  revolutionsPerMinuteToRevolutionsPerSecond,
  revolutionsPerSecond,
  revolutionsPerSecondToRevolutionsPerMinute,
} from "@cnc-render/contracts";

describe("units M1 rpm golden conversion", () => {
  it("round-trips 60 rpm and 1 rev/s", () => {
    const rpm = revolutionsPerMinute(60);
    const revolutionsEachSecond =
      revolutionsPerMinuteToRevolutionsPerSecond(rpm);
    expect(quantitiesApproximatelyEqual(revolutionsEachSecond, 1)).toBe(true);
    expect(
      quantitiesApproximatelyEqual(
        revolutionsPerSecondToRevolutionsPerMinute(
          revolutionsPerSecond(revolutionsEachSecond),
        ),
        rpm,
      ),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { canonicalJson, type JsonValue } from "@cnc-render/contracts";

describe("schema RFC 8785 canonical JSON boundaries", () => {
  it("uses ECMAScript number formatting thresholds", () => {
    expect(
      canonicalJson({
        threshold: 0.000001,
        small: 0.0000001,
        large: 1e21,
      }),
    ).toBe('{"large":1e+21,"small":1e-7,"threshold":0.000001}');
  });

  it("normalizes parsed integers through the IEEE-754 JSON number model", () => {
    const parsed = JSON.parse(
      '{"value":9007199254740993}',
    ) as JsonValue;
    expect(canonicalJson(parsed)).toBe('{"value":9007199254740992}');
  });

  it("sorts object keys by UTF-16 code units", () => {
    expect(
      canonicalJson({
        "\uE000": "private-use",
        "\u{1F600}": "astral",
      }),
    ).toBe('{"😀":"astral","":"private-use"}');
  });
});

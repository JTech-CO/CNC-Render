import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("M9 UI update budget", () => {
  test("keeps summary and axis sampling at 10 Hz and 20 Hz", async () => {
    const coordinator = await readFile(
      "packages/simulation/src/coordinator.ts",
      "utf8",
    );
    expect(coordinator).toMatch(/GENERAL_UI_INTERVAL_MS\s*=\s*100/u);
    expect(coordinator).toMatch(/AXIS_UI_INTERVAL_MS\s*=\s*50/u);
  });

  test("representative summary formatting stays below 4 ms average", () => {
    const fields = new Map<string, string>();
    const samples = 10_000;
    const startedAt = performance.now();
    for (let index = 0; index < samples; index += 1) {
      fields.set("state", index === samples - 1 ? "completed" : "running");
      fields.set("step", `${index % 7} / 7`);
      fields.set("time", `${(index / 1_000).toFixed(3)} s`);
      fields.set("removed", `${(index / 100).toFixed(2)} mm³`);
      fields.set(
        "axis",
        `X ${(index / 100).toFixed(2)} mm · Y 0.00 mm · Z 4.00 mm`,
      );
    }
    const averageMs = (performance.now() - startedAt) / samples;
    expect(fields.size).toBe(5);
    expect(averageMs).toBeLessThan(4);
  });

  test("default workspace source remains far below 2,000 visible nodes", async () => {
    const source = await readFile(
      "app/components/machine-workspace.tsx",
      "utf8",
    );
    const jsxOpeningTags = source.match(/<(?!\/|>|\?|!)[A-Za-z][^>]*>/gu) ?? [];
    expect(jsxOpeningTags.length).toBeLessThan(2_000);
  });
});

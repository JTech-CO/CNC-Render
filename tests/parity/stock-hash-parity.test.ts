import { describe, expect, it } from "vitest";
import {
  loadMillingGoldenFixture,
  runMillingGoldenItem,
} from "../helpers/milling-fixture";
import { runSimulationCli } from "../helpers/simulation-cli.mjs";

interface RustStockHashResponse {
  readonly stable: boolean;
  readonly result: {
    readonly stockHashSha256: string;
    readonly removedVolumeMm3: number;
    readonly allocatedBricks: number;
    readonly allocatedBytes: number;
    readonly revision: number;
  };
}

const fixture = loadMillingGoldenFixture();
const presets = ["preview", "balanced", "precision"] as const;

function stockHashRequest(
  item: (typeof fixture.fixtures)[number],
  preset: (typeof presets)[number],
  repetitions: number,
) {
  return {
    requestType: "stock-hash",
    stock: fixture.stock,
    tool: item.tool,
    preset,
    seed: fixture.seed,
    brickSizeDexels: fixture.brickSizeDexels,
    sweeps: item.sweeps,
    repetitions,
  };
}

describe("M5 stock-hash TypeScript and Rust parity", () => {
  it(
    "matches every Golden fixture and preset at the canonical Stock boundary",
    async () => {
      for (const item of fixture.fixtures) {
        for (const preset of presets) {
          const typescript = runMillingGoldenItem(fixture, item, preset);
          const rust = runSimulationCli(
            stockHashRequest(item, preset, 2),
          ) as RustStockHashResponse;

          expect(rust.stable, `${item.id}/${preset}`).toBe(true);
          expect(
            rust.result.stockHashSha256,
            `${item.id}/${preset}`,
          ).toBe(await typescript.stockHashSha256());
          expect(
            rust.result.removedVolumeMm3,
            `${item.id}/${preset}`,
          ).toBe(typescript.removedVolumeMm3);
          expect(rust.result.allocatedBricks).toBe(
            typescript.getDiagnostics().allocatedBricks,
          );
          expect(rust.result.allocatedBytes).toBe(
            typescript.getDiagnostics().allocatedBytes,
          );
          expect(rust.result.revision).toBe(
            typescript.getDiagnostics().revision,
          );
        }
      }
    },
    120_000,
  );

  it("stays stable for 100 Rust runs and byte-identical processes", () => {
    const request = stockHashRequest(
      fixture.fixtures[1],
      "balanced",
      100,
    );
    const first = runSimulationCli(request) as RustStockHashResponse;
    const second = runSimulationCli(request) as RustStockHashResponse;

    expect(first.stable).toBe(true);
    expect(first.result.stockHashSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  }, 120_000);
});

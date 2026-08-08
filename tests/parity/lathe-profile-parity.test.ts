import { describe, expect, it } from "vitest";
import {
  loadTurningGoldenFixture,
  runTurningGoldenItem,
} from "../helpers/turning-fixture";
import { runSimulationCli } from "../helpers/simulation-cli.mjs";

interface RustLatheProfileResponse {
  readonly stable: boolean;
  readonly result: {
    readonly profileHashSha256: string;
    readonly removedVolumeMm3: number;
    readonly axialCells: number;
    readonly allocatedBytes: number;
    readonly revision: number;
  };
}

const fixture = loadTurningGoldenFixture();
const presets = ["preview", "balanced", "precision"] as const;

function latheProfileRequest(
  item: (typeof fixture.fixtures)[number],
  preset: (typeof presets)[number],
  repetitions: number,
) {
  return {
    requestType: "lathe-profile",
    stock: fixture.stock,
    toolKind: item.toolKind,
    preset,
    seed: fixture.seed,
    machineMaxSpindleSpeedRpm: fixture.machine.maxSpindleSpeedRpm,
    chuckGripLengthMm: fixture.machine.chuckGripLengthMm,
    cuts: [item.cut],
    repetitions,
  };
}

describe("M6 lathe-profile TypeScript and Rust parity", () => {
  it(
    "matches every representative process and preset at the canonical radius-field boundary",
    async () => {
      for (const item of fixture.fixtures) {
        for (const preset of presets) {
          const typescript = runTurningGoldenItem(fixture, item, preset);
          const rust = runSimulationCli(
            latheProfileRequest(item, preset, 2),
          ) as RustLatheProfileResponse;
          expect(rust.stable, `${item.id}/${preset}`).toBe(true);
          expect(
            rust.result.profileHashSha256,
            `${item.id}/${preset}`,
          ).toBe(await typescript.profileHashSha256());
          expect(rust.result.removedVolumeMm3).toBeCloseTo(
            typescript.removedVolumeMm3,
            9,
          );
          expect(rust.result.axialCells).toBe(
            typescript.getDiagnostics().axialCells,
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
    const item = fixture.fixtures.find(({ operation }) => operation === "taper")!;
    const request = latheProfileRequest(item, "balanced", 100);
    const first = runSimulationCli(request) as RustLatheProfileResponse;
    const second = runSimulationCli(request) as RustLatheProfileResponse;
    expect(first.stable).toBe(true);
    expect(first.result.profileHashSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  }, 120_000);
});

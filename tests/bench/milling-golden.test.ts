import { SparseDexelMillingEngine } from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";
import {
  createMillingStock,
  createMillingTool,
  loadMillingGoldenFixture,
  runMillingGoldenItem,
} from "../helpers/milling-fixture";

const fixture = loadMillingGoldenFixture();

describe("M5 milling-golden benchmark", () => {
  it("evaluates every fixture and preset within the CPU reference budget", () => {
    const startedAt = performance.now();
    let removedVolumeMm3 = 0;

    for (const item of fixture.fixtures) {
      for (const preset of ["preview", "balanced", "precision"] as const) {
        removedVolumeMm3 += runMillingGoldenItem(
          fixture,
          item,
          preset,
        ).removedVolumeMm3;
      }
    }

    const durationMs = performance.now() - startedAt;
    expect(removedVolumeMm3).toBeGreaterThan(0);
    expect(durationMs).toBeLessThanOrEqual(3_000);
  });

  it("keeps sparse memory flat during a logical five-minute 60 Hz cut", () => {
    const slot = fixture.fixtures[1];
    const engine = new SparseDexelMillingEngine({
      stock: createMillingStock(fixture),
      tool: createMillingTool(slot),
      preset: "balanced",
      seed: fixture.seed,
      brickSizeDexels: fixture.brickSizeDexels,
      memoryCapBytes: 2 * 1024 * 1024,
    });
    engine.createFullSurfaceSnapshot();

    const simulatedFrameCount = 5 * 60 * 60;
    let plateauBytes = 0;
    const startedAt = performance.now();
    for (let frame = 0; frame < simulatedFrameCount; frame += 1) {
      const yMm = -25 + (frame % 51);
      engine.applySweep({
        startMm: { xMm: -35, yMm, zMm: 6 },
        endMm: { xMm: 35, yMm, zMm: 6 },
      });
      engine.drainDirtySurfacePatches();
      if (frame === 599) {
        plateauBytes = engine.getDiagnostics().allocatedBytes;
      }
    }
    const durationMs = performance.now() - startedAt;
    const diagnostics = engine.getDiagnostics();

    expect(plateauBytes).toBeGreaterThan(0);
    expect(diagnostics.allocatedBytes).toBe(plateauBytes);
    expect(diagnostics.allocatedBytes).toBeLessThanOrEqual(
      diagnostics.memoryCapBytes,
    );
    expect(diagnostics.fullSurfaceExtractions).toBe(1);
    expect(diagnostics.partialSurfaceExtractions).toBeLessThan(600);
    expect(durationMs).toBeLessThanOrEqual(5_000);
  });
});

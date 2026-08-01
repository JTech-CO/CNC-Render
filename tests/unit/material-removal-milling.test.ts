import {
  MILLING_PRESET_RELATIVE_VOLUME_ERROR_LIMIT,
  SparseDexelMillingEngine,
  type MillingQualityPreset,
} from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";
import {
  createMillingStock,
  createMillingTool,
  loadMillingGoldenFixture,
  runMillingGoldenItem,
} from "../helpers/milling-fixture";

const fixture = loadMillingGoldenFixture();
const presets = ["preview", "balanced", "precision"] as const;

describe("M5 material-removal-milling sparse dexel core", () => {
  it("pins the portable Golden fixture and documented accuracy budgets", () => {
    expect(fixture.fixtureVersion).toBe(1);
    expect(fixture.units).toBe("mm");
    expect(fixture.fixtures.map(({ id }) => id)).toEqual([
      "face",
      "slot",
      "pocket",
      "outer-contour",
    ]);
    expect(fixture.presetRelativeVolumeErrorLimits).toEqual(
      MILLING_PRESET_RELATIVE_VOLUME_ERROR_LIMIT,
    );
  });

  for (const item of fixture.fixtures) {
    for (const preset of presets) {
      it(`${item.operation} stays inside the ${preset} analytic volume budget`, () => {
        const engine = runMillingGoldenItem(fixture, item, preset);
        const relativeError =
          Math.abs(
            engine.removedVolumeMm3 - item.expectedRemovedVolumeMm3,
          ) / item.expectedRemovedVolumeMm3;

        expect(
          relativeError,
          `${item.id}: ${item.analyticModel}`,
        ).toBeLessThanOrEqual(
          fixture.presetRelativeVolumeErrorLimits[preset],
        );
        expect(engine.getDiagnostics()).toMatchObject({
          representation: "sparse-z-multi-dexel",
          preset,
          removedVolumeMm3: engine.removedVolumeMm3,
        });
      });
    }
  }

  it("keeps a non-contact sweep at exact zero without allocating a brick", async () => {
    const item = fixture.fixtures[1];
    const engine = new SparseDexelMillingEngine({
      stock: createMillingStock(fixture),
      tool: createMillingTool(item),
      preset: "balanced",
      seed: fixture.seed,
    });
    const beforeHash = await engine.stockHashSha256();
    const result = engine.applySweep({
      startMm: { xMm: -25, yMm: 0, zMm: 12 },
      endMm: { xMm: 25, yMm: 0, zMm: 12 },
    });

    expect(result).toEqual({
      revision: 0,
      updatedDexels: 0,
      dirtyBricks: 0,
      removedVolumeDeltaMm3: 0,
      removedVolumeMm3: 0,
    });
    expect(engine.getDiagnostics()).toMatchObject({
      allocatedBricks: 0,
      dirtyBricks: 0,
      dirtyDexels: 0,
      allocatedBytes: 0,
      removedVolumeMm3: 0,
    });
    expect(engine.drainDirtySurfacePatches()).toEqual([]);
    expect(await engine.stockHashSha256()).toBe(beforeHash);
  });

  it("extracts one full surface then only changed dexel patches", () => {
    const item = fixture.fixtures[1];
    const engine = new SparseDexelMillingEngine({
      stock: createMillingStock(fixture),
      tool: createMillingTool(item),
      preset: "balanced",
      seed: fixture.seed,
    });
    const snapshot = engine.createFullSurfaceSnapshot();
    const first = engine.applySweep(item.sweeps[0]);
    const patches = engine.drainDirtySurfacePatches();
    const patchedDexels = patches.reduce(
      (sum, patch) => sum + patch.cellIndices.length,
      0,
    );

    expect(snapshot.topZMm).toHaveLength(snapshot.columns * snapshot.rows);
    expect(first.updatedDexels).toBeGreaterThan(0);
    expect(patches.length).toBeGreaterThan(0);
    expect(patchedDexels).toBe(first.updatedDexels);
    expect(engine.getDiagnostics()).toMatchObject({
      fullSurfaceExtractions: 1,
      partialSurfaceExtractions: 1,
      dirtyBricks: 0,
      dirtyDexels: 0,
    });

    expect(engine.applySweep(item.sweeps[0]).updatedDexels).toBe(0);
    expect(engine.drainDirtySurfacePatches()).toEqual([]);
    expect(engine.getDiagnostics().fullSurfaceExtractions).toBe(1);
  });

  it("reproduces a byte-identical final stock hash for 100 runs", async () => {
    const item = fixture.fixtures[1];
    const hashes: string[] = [];
    for (let repetition = 0; repetition < 100; repetition += 1) {
      hashes.push(
        await runMillingGoldenItem(
          fixture,
          item,
          "balanced",
        ).stockHashSha256(),
      );
    }
    expect(new Set(hashes)).toHaveLength(1);
    expect(hashes[0]).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("measures distance, depth, interval, and wall thickness within one dexel", () => {
    const distanceEngine = runMillingGoldenItem(
      fixture,
      fixture.fixtures[0],
      "precision",
    );
    expect(
      distanceEngine.measureDistance(
        { xMm: 0, yMm: 0, zMm: 0 },
        { xMm: 3, yMm: 4, zMm: 12 },
      ).valueMm,
    ).toBe(13);

    for (const preset of presets) {
      for (const item of fixture.fixtures) {
        const engine = runMillingGoldenItem(fixture, item, preset);
        const measurement =
          item.measurement.kind === "depth"
            ? engine.measureDepth(
                item.measurement.pointMm.xMm,
                item.measurement.pointMm.yMm,
              )
            : engine.measureWallThickness({
                axis: item.measurement.axis,
                pointMm: item.measurement.pointMm,
              });
        expect(
          Math.abs(measurement.valueMm - item.measurement.expectedMm),
          `${item.id}/${preset}`,
        ).toBeLessThanOrEqual(measurement.representationResolutionMm);
      }
    }

    const slot = runMillingGoldenItem(
      fixture,
      fixture.fixtures[1],
      "balanced",
    );
    expect(slot.getDexelIntervals(0, 0)).toEqual([
      { minimumZMm: -10, maximumZMm: 6 },
    ]);
  });

  it("fails closed before exceeding the sparse allocation cap", () => {
    const item = fixture.fixtures[0];
    const engine = new SparseDexelMillingEngine({
      stock: createMillingStock(fixture),
      tool: createMillingTool(item),
      preset: "balanced",
      seed: fixture.seed,
      memoryCapBytes: 1_024,
    });

    expect(() => {
      for (const sweep of item.sweeps) {
        engine.applySweep(sweep);
      }
    }).toThrow(/memory cap/u);
    expect(engine.getDiagnostics()).toMatchObject({
      allocatedBricks: 0,
      dirtyBricks: 0,
      dirtyDexels: 0,
      revision: 0,
      allocatedBytes: 0,
      removedVolumeMm3: 0,
    });
  });

  it("rejects malformed dimensions and grids before allocation", () => {
    const item = fixture.fixtures[1];
    const nonfiniteStock = structuredClone(createMillingStock(fixture));
    if (nonfiniteStock.geometry.primitiveType !== "box") {
      throw new Error("The M5 test fixture must be box Stock.");
    }
    nonfiniteStock.geometry.sizeMm.xMm = Number.NaN;
    expect(
      () =>
        new SparseDexelMillingEngine({
          stock: nonfiniteStock,
          tool: createMillingTool(item),
          preset: "balanced",
          seed: fixture.seed,
        }),
    ).toThrow(/finite millimetre/u);

    const invalidTool = structuredClone(createMillingTool(item));
    invalidTool.cutterGeometry.diameterMm = 0;
    expect(
      () =>
        new SparseDexelMillingEngine({
          stock: createMillingStock(fixture),
          tool: invalidTool,
          preset: "balanced",
          seed: fixture.seed,
        }),
    ).toThrow(/must be positive/u);

    const oversizedGridStock = structuredClone(
      createMillingStock(fixture),
    );
    oversizedGridStock.resolutionMm = 1e-9;
    expect(
      () =>
        new SparseDexelMillingEngine({
          stock: oversizedGridStock,
          tool: createMillingTool(item),
          preset: "balanced",
          seed: fixture.seed,
        }),
    ).toThrow(/Uint32 representation limits/u);
  });

  it.each<MillingQualityPreset>(presets)(
    "%s derives its resolution from the Stock API",
    (preset) => {
      const engine = new SparseDexelMillingEngine({
        stock: createMillingStock(fixture),
        tool: createMillingTool(fixture.fixtures[1]),
        preset,
        seed: fixture.seed,
      });
      expect(engine.resolutionMm).toBe(
        fixture.stock.baseResolutionMm *
          {
            preview: 2,
            balanced: 1,
            precision: 0.5,
          }[preset],
      );
    },
  );
});

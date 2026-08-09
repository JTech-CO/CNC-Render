import { PartialStockSurface } from "@cnc-render/renderer";
import { SparseDexelMillingEngine } from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";
import {
  createMillingStock,
  createMillingTool,
  loadMillingGoldenFixture,
} from "../helpers/milling-fixture";

const fixture = loadMillingGoldenFixture();

describe("M5 material-removal-milling renderer boundary", () => {
  it("keeps one geometry allocation and uploads changed cell ranges only", () => {
    const slot = fixture.fixtures[1];
    const engine = new SparseDexelMillingEngine({
      stock: createMillingStock(fixture),
      tool: createMillingTool(slot),
      preset: "balanced",
      seed: fixture.seed,
    });
    const surface = new PartialStockSurface(
      engine.createFullSurfaceSnapshot(),
    );
    const initial = surface.getDiagnostics();

    const sweep = engine.applySweep(slot.sweeps[0]);
    const patches = engine.drainDirtySurfacePatches();
    const updated = surface.applyPatches(patches);

    expect(initial).toMatchObject({
      fullBufferUploads: 1,
      partialBufferUpdates: 0,
      totalUpdatedCells: 0,
      activeUpdateRanges: 0,
    });
    expect(updated).toMatchObject({
      revision: sweep.revision,
      fullBufferUploads: 1,
      partialBufferUpdates: 1,
      lastUpdatedCells: sweep.updatedDexels,
      totalUpdatedCells: sweep.updatedDexels,
    });
    expect(updated.activeUpdateRanges).toBeGreaterThan(0);
    expect(updated.activeUpdateRanges).toBeLessThanOrEqual(
      sweep.updatedDexels,
    );
    expect(updated.uploadedBytes - initial.uploadedBytes).toBe(
      sweep.updatedDexels * 36 * 3 * Float32Array.BYTES_PER_ELEMENT,
    );

    expect(surface.applyPatches([])).toMatchObject({
      partialBufferUpdates: updated.partialBufferUpdates,
      lastUpdatedCells: 0,
      totalUpdatedCells: updated.totalUpdatedCells,
    });
    surface.finishUpload();
    expect(surface.getDiagnostics().activeUpdateRanges).toBe(0);
    expect(surface.geometry).toBe(surface.mesh.geometry);
    surface.dispose();
  });

  it("rejects malformed patches before touching the GPU buffer", () => {
    const slot = fixture.fixtures[1];
    const engine = new SparseDexelMillingEngine({
      stock: createMillingStock(fixture),
      tool: createMillingTool(slot),
      preset: "preview",
      seed: fixture.seed,
    });
    const surface = new PartialStockSurface(
      engine.createFullSurfaceSnapshot(),
    );

    expect(() =>
      surface.applyPatches([
        {
          revision: 1,
          brickX: 0,
          brickY: 0,
          cellIndices: new Uint32Array([surface.getDiagnostics().cells]),
          topZMm: new Float32Array([0]),
        },
      ]),
    ).toThrow(/outside the allocated buffer/u);
    expect(surface.getDiagnostics()).toMatchObject({
      revision: 0,
      partialBufferUpdates: 0,
      totalUpdatedCells: 0,
    });
    surface.dispose();
  });
});

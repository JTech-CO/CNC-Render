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
  it("preserves every clipped cell vertex and winding after allocation-free updates", () => {
    const heights = [10, 9, 8, 7];
    const surface = new PartialStockSurface({
      boundsMm: { minimum: { xMm: -3, yMm: 1, zMm: 5 }, maximum: { xMm: 0, yMm: 4, zMm: 10 } },
      columns: 2, rows: 2, resolutionMm: 2, topZMm: new Float32Array(heights),
    });
    const expected = () => heights.flatMap((top, cell) => {
      const x0 = -3 + (cell % 2) * 2;
      const x1 = Math.min(0, x0 + 2);
      const y0 = 1 + Math.floor(cell / 2) * 2;
      const y1 = Math.min(4, y0 + 2);
      const corners = [[x0, 5, -y0], [x1, 5, -y0], [x1, 5, -y1], [x0, 5, -y1],
        [x0, top, -y0], [x1, top, -y0], [x1, top, -y1], [x0, top, -y1]];
      return [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
        3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5].flatMap((index) => corners[index]);
    });
    expect(Array.from(surface.geometry.getAttribute("position").array)).toEqual(expected());
    heights[3] = 6;
    surface.applyPatches([{ revision: 1, brickX: 0, brickY: 0, cellIndices: new Uint32Array([3]), topZMm: new Float32Array([6]) }]);
    expect(Array.from(surface.geometry.getAttribute("position").array)).toEqual(expected());
    surface.dispose();
  });
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
    const normalAttribute = surface.geometry.getAttribute("normal");
    expect(normalAttribute.count).toBe(initial.cells * 36);
    expect(
      [0, 6, 12, 18, 24, 30].map((vertexIndex) => [
        normalAttribute.getX(vertexIndex),
        normalAttribute.getY(vertexIndex),
        normalAttribute.getZ(vertexIndex),
      ]),
    ).toEqual([
      [0, -1, 0], [0, 1, 0], [0, 0, 1],
      [0, 0, -1], [-1, 0, 0], [1, 0, 0],
    ]);

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
    expect(surface.geometry.getAttribute("normal")).toBe(normalAttribute);
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

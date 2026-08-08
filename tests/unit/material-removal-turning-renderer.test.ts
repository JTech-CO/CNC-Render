import { describe, expect, it } from "vitest";
import {
  PartialRotationalStockSurface,
  RotationalStockSurfaceInputError,
} from "../../packages/renderer/src/rotational-stock-surface";

function descriptor() {
  return {
    axisCenterMm: { xMm: 0, yMm: 0 },
    minimumZMm: -2,
    maximumZMm: 2,
    axialCells: 4,
    radialSegments: 8,
    resolutionMm: 1,
    innerRadiusMm: new Float32Array([0, 0, 0, 0]),
    outerRadiusMm: new Float32Array([4, 4, 4, 4]),
  };
}

describe("M6 partial rotational Stock renderer", () => {
  it("keeps one BufferGeometry and updates only changed axial cells", () => {
    const surface = new PartialRotationalStockSurface(descriptor());
    const geometry = surface.geometry;
    const positionArray = geometry.getAttribute("position").array;
    expect(surface.getDiagnostics()).toMatchObject({
      cells: 4,
      radialSegments: 8,
      fullBufferUploads: 1,
      partialBufferUpdates: 0,
    });
    const diagnostics = surface.applyPatches([
      {
        revision: 1,
        cellIndices: new Uint32Array([1, 2]),
        innerRadiusMm: new Float32Array([0, 1]),
        outerRadiusMm: new Float32Array([3, 3]),
      },
    ]);
    expect(surface.geometry).toBe(geometry);
    expect(geometry.getAttribute("position").array).toBe(positionArray);
    expect(diagnostics).toMatchObject({
      revision: 1,
      partialBufferUpdates: 1,
      lastUpdatedCells: 2,
      totalUpdatedCells: 2,
    });
    expect(diagnostics.activeUpdateRanges).toBeGreaterThan(0);
    surface.finishUpload();
    expect(surface.getDiagnostics().activeUpdateRanges).toBe(0);
    surface.dispose();
  });

  it("coalesces duplicate patches and leaves empty updates inert", () => {
    const surface = new PartialRotationalStockSurface(descriptor());
    expect(surface.applyPatches([]).partialBufferUpdates).toBe(0);
    expect(
      surface.applyPatches([
        {
          revision: 1,
          cellIndices: new Uint32Array([1]),
          innerRadiusMm: new Float32Array([0]),
          outerRadiusMm: new Float32Array([3]),
        },
        {
          revision: 1,
          cellIndices: new Uint32Array([1]),
          innerRadiusMm: new Float32Array([1]),
          outerRadiusMm: new Float32Array([2]),
        },
      ]).lastUpdatedCells,
    ).toBe(1);
    surface.dispose();
  });

  it("rejects invalid radii, lengths, revisions, and cell indices", () => {
    expect(
      () =>
        new PartialRotationalStockSurface({
          ...descriptor(),
          innerRadiusMm: new Float32Array([0, 5, 0, 0]),
        }),
    ).toThrowError(RotationalStockSurfaceInputError);
    const surface = new PartialRotationalStockSurface(descriptor());
    expect(() =>
      surface.applyPatches([
        {
          revision: 1,
          cellIndices: new Uint32Array([4]),
          innerRadiusMm: new Float32Array([0]),
          outerRadiusMm: new Float32Array([3]),
        },
      ]),
    ).toThrowError(/outside the allocated buffer/u);
    expect(() =>
      surface.applyPatches([
        {
          revision: 1,
          cellIndices: new Uint32Array([1]),
          innerRadiusMm: new Float32Array([]),
          outerRadiusMm: new Float32Array([3]),
        },
      ]),
    ).toThrowError(/equal lengths/u);
    surface.dispose();
  });
});

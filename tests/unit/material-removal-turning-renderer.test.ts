import { describe, expect, it, vi } from "vitest";
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

// Independent legacy construction: preserve every Float32 position and winding,
// including the zero-radius inner wall and clipped final axial cell.
function legacyPositions(model: ReturnType<typeof descriptor>): Float32Array {
  const positions: number[] = [];
  for (let cell = 0; cell < model.axialCells; cell++) {
    const z0 = model.minimumZMm + cell * model.resolutionMm;
    const z1 = Math.min(model.maximumZMm, z0 + model.resolutionMm);
    for (let segment = 0; segment < model.radialSegments; segment++) {
      const a0 = segment / model.radialSegments * Math.PI * 2;
      const a1 = (segment + 1) / model.radialSegments * Math.PI * 2;
      const point = (radius: number, angle: number, z: number) => [model.axisCenterMm.xMm + radius * Math.cos(angle), z, -(model.axisCenterMm.yMm + radius * Math.sin(angle))];
      const outer = model.outerRadiusMm[cell];
      const inner = model.innerRadiusMm[cell];
      const o00 = point(outer, a0, z0), o10 = point(outer, a1, z0), o11 = point(outer, a1, z1), o01 = point(outer, a0, z1);
      const i00 = point(inner, a0, z0), i10 = point(inner, a1, z0), i11 = point(inner, a1, z1), i01 = point(inner, a0, z1);
      for (const [a, b, c, d] of [[o00, o10, o11, o01], [i10, i00, i01, i11], [i00, o00, o10, i10], [i01, i11, o11, o01]]) {
        for (const vertex of [a, b, c, a, c, d]) positions.push(...vertex);
      }
    }
  }
  return new Float32Array(positions);
}

describe("M6 partial rotational Stock renderer", () => {
  it.each([8, 24, 128])("retains exact legacy vertices and winding at %i radial segments", (radialSegments) => {
    const model = { ...descriptor(), radialSegments, maximumZMm: 1.5, axisCenterMm: { xMm: 1.25, yMm: -2.5 },
      innerRadiusMm: new Float32Array([0, 1, 1, 0]), outerRadiusMm: new Float32Array([4, 2.5, 1, 0]) };
    const surface = new PartialRotationalStockSurface(model);
    expect(surface.geometry.getAttribute("position").array).toEqual(legacyPositions(model));
    surface.applyPatches([{ revision: 1, cellIndices: new Uint32Array([0]), innerRadiusMm: new Float32Array([0.5]), outerRadiusMm: new Float32Array([3]) }]);
    model.innerRadiusMm[0] = 0.5; model.outerRadiusMm[0] = 3;
    expect(surface.geometry.getAttribute("position").array).toEqual(legacyPositions(model));
    surface.dispose();
  });

  it("reuses derived data only for identical full profiles and recomputes changed profiles", () => {
    const model = descriptor();
    const surface = new PartialRotationalStockSurface(model);
    const normals = vi.spyOn(surface.geometry, "computeVertexNormals");
    const box = vi.spyOn(surface.geometry, "computeBoundingBox");
    const sphere = vi.spyOn(surface.geometry, "computeBoundingSphere");
    surface.applyPatches([{ revision: 1, cellIndices: new Uint32Array([1]), innerRadiusMm: new Float32Array([1]), outerRadiusMm: new Float32Array([2]) }]);
    expect(surface.reset(model)).toBe(true);
    expect(normals).not.toHaveBeenCalled(); expect(box).not.toHaveBeenCalled(); expect(sphere).not.toHaveBeenCalled();
    const changed = { ...model, innerRadiusMm: new Float32Array([1, 1, 0, 0]), outerRadiusMm: new Float32Array([3, 3, 2, 2]) };
    expect(surface.reset(changed)).toBe(true);
    expect(normals).toHaveBeenCalledTimes(1); expect(box).toHaveBeenCalledTimes(1); expect(sphere).toHaveBeenCalledTimes(1);
    const fresh = new PartialRotationalStockSurface(changed);
    expect(surface.geometry.getAttribute("position").array).toEqual(fresh.geometry.getAttribute("position").array);
    expect(surface.geometry.getAttribute("normal").array).toEqual(fresh.geometry.getAttribute("normal").array);
    expect(surface.geometry.boundingBox).toEqual(fresh.geometry.boundingBox);
    expect(surface.geometry.boundingSphere).toEqual(fresh.geometry.boundingSphere);
    surface.reset(changed);
    expect(normals).toHaveBeenCalledTimes(1);
    surface.reset(model);
    expect(normals).toHaveBeenCalledTimes(2);
    surface.dispose(); fresh.dispose();
  });

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

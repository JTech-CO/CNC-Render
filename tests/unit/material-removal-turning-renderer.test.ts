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

function expectLegacyGeometry(surface: PartialRotationalStockSurface, model: ReturnType<typeof descriptor>): void {
  const reference = surface.geometry.clone();
  const positions = legacyPositions(model);
  (reference.getAttribute("position").array as Float32Array).set(positions);
  reference.deleteAttribute("normal");
  reference.computeVertexNormals();
  reference.computeBoundingBox();
  reference.computeBoundingSphere();
  expect(surface.geometry.getAttribute("position").array).toEqual(positions);
  expect(surface.geometry.getAttribute("normal").array).toEqual(reference.getAttribute("normal").array);
  expect(surface.geometry.boundingBox).toEqual(reference.boundingBox);
  expect(surface.geometry.boundingSphere).toEqual(reference.boundingSphere);
  reference.dispose();
}

describe("M6 partial rotational Stock renderer", () => {
  it.each([8, 24, 128])("retains exact legacy vertices and winding at %i radial segments", (radialSegments) => {
    const model = { ...descriptor(), radialSegments, maximumZMm: 1.5, axisCenterMm: { xMm: 1.25, yMm: -2.5 },
      innerRadiusMm: new Float32Array([0, 1, 1, 0]), outerRadiusMm: new Float32Array([4, 2.5, 1, 0]) };
    const surface = new PartialRotationalStockSurface(model);
    expectLegacyGeometry(surface, model);
    surface.applyPatches([{ revision: 1, cellIndices: new Uint32Array([0]), innerRadiusMm: new Float32Array([0.5]), outerRadiusMm: new Float32Array([3]) }]);
    model.innerRadiusMm[0] = 0.5; model.outerRadiusMm[0] = 3;
    expect(surface.geometry.getAttribute("position").array).toEqual(legacyPositions(model));
    surface.dispose();
  });

  it("reuses derived data only for identical full profiles and recomputes changed profiles", () => {
    const model = descriptor();
    const surface = new PartialRotationalStockSurface(model);
    const normals = surface.geometry.getAttribute("normal");
    if (!("version" in normals)) throw new Error("Expected a non-interleaved normal attribute");
    const initialNormalVersion = normals.version;
    surface.applyPatches([{ revision: 1, cellIndices: new Uint32Array([1]), innerRadiusMm: new Float32Array([1]), outerRadiusMm: new Float32Array([2]) }]);
    expect(surface.reset(model)).toBe(true);
    expect(normals.version).toBe(initialNormalVersion);
    const changed = { ...model, innerRadiusMm: new Float32Array([1, 1, 0, 0]), outerRadiusMm: new Float32Array([3, 3, 2, 2]) };
    expect(surface.reset(changed)).toBe(true);
    expect(normals.version).toBe(initialNormalVersion + 1);
    expectLegacyGeometry(surface, changed);
    surface.reset(changed);
    expect(normals.version).toBe(initialNormalVersion + 1);
    surface.reset(model);
    expect(normals.version).toBe(initialNormalVersion + 2);
    expectLegacyGeometry(surface, model);
    surface.dispose();
  });

  it.each([8, 9, 17, 24, 37, 128])("matches Three normals and exact bounds for irregular profiles with %i segments", (radialSegments) => {
    for (const scale of [0.000001, 0.03125, 1, 1000]) {
      const model = { ...descriptor(), radialSegments, axialCells: 7, resolutionMm: scale,
        minimumZMm: -3.5 * scale, maximumZMm: 2.8 * scale,
        axisCenterMm: { xMm: 1000.123 * scale, yMm: -987.654 * scale },
        innerRadiusMm: new Float32Array([0, 0.25, 0.875, 0, 0.375, 0.5, 0].map((value) => value * scale)),
        outerRadiusMm: new Float32Array([2.5, 3.75, 0.875, 0, 1.5, 0.75, 2.375].map((value) => value * scale)) };
      const surface = new PartialRotationalStockSurface(model);
      expectLegacyGeometry(surface, model);
      surface.dispose();
    }
  });

  it.each([0.125, 0.2, 0.333333])("reuses repeated profiles without axial rounding drift at %f mm resolution", (resolutionMm) => {
    const model = { ...descriptor(), radialSegments: 37, axialCells: 11, resolutionMm,
      minimumZMm: 1000000.3, maximumZMm: 1000000.3 + 10.4 * resolutionMm,
      axisCenterMm: { xMm: 1.234, yMm: -4.567 },
      innerRadiusMm: new Float32Array(11).fill(1.25), outerRadiusMm: new Float32Array(11).fill(10.125) };
    const surface = new PartialRotationalStockSurface(model);
    expectLegacyGeometry(surface, model);
    surface.applyPatches([{ revision: 1, cellIndices: new Uint32Array([4]), innerRadiusMm: new Float32Array([2]), outerRadiusMm: new Float32Array([8]) }]);
    surface.reset(model);
    expectLegacyGeometry(surface, model);
    const stepped = { ...model, outerRadiusMm: new Float32Array([2, 2, 2, 2, 15, 15, 15, 15, 3, 3, 3]) };
    surface.reset(stepped);
    expectLegacyGeometry(surface, stepped);
    surface.dispose();
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

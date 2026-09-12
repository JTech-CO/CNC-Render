import { createMachineScene } from "../../packages/renderer/src/machine-scene";
import { describe, expect, it } from "vitest";
import { PartialStockSurface } from "../../packages/renderer/src/stock-surface";
import { PartialRotationalStockSurface } from "../../packages/renderer/src/rotational-stock-surface";

describe("machine scene dynamic Stock replacement", () => {
  it("resets milling patches in the same buffers and rejects incompatible topology", () => {
    const descriptor = { boundsMm: { minimum: { xMm: 0, yMm: 0, zMm: 0 }, maximum: { xMm: 4, yMm: 4, zMm: 4 } }, columns: 1, rows: 1, resolutionMm: 4, topZMm: new Float32Array([4]) };
    const surface = new PartialStockSurface(descriptor);
    const geometry = surface.geometry;
    const positions = geometry.getAttribute("position").array;
    const original = Array.from(positions);
    surface.applyPatches([{ revision: 9, brickX: 0, brickY: 0, cellIndices: new Uint32Array([0]), topZMm: new Float32Array([2]) }]);
    expect(surface.reset(descriptor)).toBe(true);
    expect(surface.geometry).toBe(geometry);
    expect(geometry.getAttribute("position").array).toBe(positions);
    expect(Array.from(positions)).toEqual(original);
    expect(surface.getDiagnostics()).toMatchObject({ revision: 0, partialBufferUpdates: 0, totalUpdatedCells: 0 });
    expect(surface.reset({ ...descriptor, resolutionMm: 2 })).toBe(false);
    expect(() => surface.reset({ ...descriptor, topZMm: new Float32Array([NaN]) })).toThrow();
    expect(Array.from(positions)).toEqual(original);
    surface.dispose();
  });
  it("resets rotational radii, normals and revisions without reallocating geometry", () => {
    const descriptor = { axisCenterMm: { xMm: 0, yMm: 0 }, minimumZMm: 0, maximumZMm: 4, axialCells: 1, radialSegments: 24, resolutionMm: 4, innerRadiusMm: new Float32Array([0]), outerRadiusMm: new Float32Array([4]) };
    const surface = new PartialRotationalStockSurface(descriptor);
    const geometry = surface.geometry;
    const positions = geometry.getAttribute("position").array;
    const original = Array.from(positions);
    surface.applyPatches([{ revision: 9, cellIndices: new Uint32Array([0]), innerRadiusMm: new Float32Array([1]), outerRadiusMm: new Float32Array([3]) }]);
    expect(surface.reset(descriptor)).toBe(true);
    expect(surface.geometry).toBe(geometry);
    expect(geometry.getAttribute("position").array).toBe(positions);
    expect(Array.from(positions)).toEqual(original);
    expect(surface.getDiagnostics()).toMatchObject({ revision: 0, partialBufferUpdates: 0, totalUpdatedCells: 0 });
    expect(surface.reset({ ...descriptor, radialSegments: 32 })).toBe(false);
    expect(() => surface.reset({ ...descriptor, innerRadiusMm: new Float32Array([5]) })).toThrow();
    expect(Array.from(positions)).toEqual(original);
    surface.dispose();
  });
  it("disposes incompatible cached geometry and material before replacing them", () => {
    const scene = createMachineScene();
    const descriptor = { boundsMm: { minimum: { xMm: 0, yMm: 0, zMm: 0 }, maximum: { xMm: 4, yMm: 4, zMm: 4 } }, columns: 1, rows: 1, resolutionMm: 4, topZMm: new Float32Array([4]) };
    scene.configureStockSurface(descriptor);
    const mesh = scene.selectableObjects.at(-1)! as PartialStockSurface["mesh"];
    const geometry = mesh.geometry;
    const material = mesh.material;
    if (Array.isArray(material)) throw new Error("Stock must use one material");
    let disposed = 0;
    geometry.addEventListener("dispose", () => { disposed++; });
    material.addEventListener("dispose", () => { disposed++; });
    scene.configureStockSurface({ ...descriptor, columns: 2, resolutionMm: 2, topZMm: new Float32Array([4, 4]) });
    expect(disposed).toBe(2);
    expect(mesh.geometry).not.toBe(geometry);
    scene.dispose();
  });
  it("bounds cached Stock to two identities, removes inactive picking, and disposes both", () => {
    const scene = createMachineScene();
    const baseline = scene.selectableObjects.length;
    let millingMesh: unknown;
    let turningMesh: unknown;
    let millingGeometry: unknown;
    let millingMaterial: unknown;
    let disposedMaterials = 0;
    for (let iteration = 0; iteration < 30; iteration++) {
      scene.configureStockSurface({
        boundsMm: { minimum: { xMm: 0, yMm: 0, zMm: 0 }, maximum: { xMm: 4, yMm: 4, zMm: 4 } },
        columns: 1, rows: 1, resolutionMm: 4, topZMm: new Float32Array([4]),
      });
      expect(scene.selectableObjects).toHaveLength(baseline + 1);
      const previous = scene.selectableObjects.at(-1)! as PartialStockSurface["mesh"];
      if (millingMesh) expect(previous).toBe(millingMesh);
      if (millingGeometry) expect(previous.geometry).toBe(millingGeometry);
      if (millingMaterial) expect(previous.material).toBe(millingMaterial);
      millingGeometry = previous.geometry;
      millingMaterial = previous.material;
      millingMesh = previous;
      if (Array.isArray(previous.material)) throw new Error("Stock must use one owned material");
      if (iteration === 0) previous.material.addEventListener("dispose", () => { disposedMaterials++; });
      scene.configureRotationalStockSurface({
        axisCenterMm: { xMm: 0, yMm: 0 }, minimumZMm: 0, maximumZMm: 4,
        axialCells: 1, radialSegments: 24, resolutionMm: 4,
        innerRadiusMm: new Float32Array([0]), outerRadiusMm: new Float32Array([4]),
      });
      expect(scene.selectableObjects).toHaveLength(baseline + 1);
      expect(scene.selectableObjects).not.toContain(previous);
      expect(previous.parent).toBeNull();
      expect(disposedMaterials).toBe(0);
      expect(scene.getStockSurfaceDiagnostics()).toBeNull();
      expect(() => scene.applyStockSurfacePatches([])).toThrow();
      if (turningMesh) expect(scene.selectableObjects.at(-1)).toBe(turningMesh);
      turningMesh = scene.selectableObjects.at(-1);
    }
    scene.dispose();
    expect(disposedMaterials).toBe(1);
    expect(scene.selectableObjects).toHaveLength(0);
    expect(scene.getStockSurfaceDiagnostics()).toBeNull();
    expect(scene.getRotationalStockSurfaceDiagnostics()).toBeNull();
  });
  it("hides the static Stock and its outline behind the dynamic surface", () => {
    const machineScene = createMachineScene();
    const stockLayer = machineScene.layerGroups.get("stock");
    const educationStock = stockLayer?.getObjectByName("education-stock");
    const educationOutline = stockLayer?.getObjectByName(
      "education-stock-outline",
    );

    expect(educationStock).toBeDefined();
    expect(educationOutline?.parent).toBe(educationStock);

    machineScene.configureStockSurface({
      boundsMm: {
        minimum: { xMm: -2, yMm: -2, zMm: 0 },
        maximum: { xMm: 2, yMm: 2, zMm: 4 },
      },
      columns: 1,
      rows: 1,
      resolutionMm: 4,
      topZMm: new Float32Array([4]),
    });

    expect(educationStock?.visible).toBe(false);
    expect(machineScene.getStockSurfaceDiagnostics()).toMatchObject({
      cells: 1,
      fullBufferUploads: 1,
      partialBufferUpdates: 0,
    });
    machineScene.dispose();
  });
});

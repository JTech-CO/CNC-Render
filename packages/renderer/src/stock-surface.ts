import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  type Material,
} from "three";

const VERTICES_PER_CELL = 36;
const COMPONENTS_PER_VERTEX = 3;
const FLOATS_PER_CELL = VERTICES_PER_CELL * COMPONENTS_PER_VERTEX;
const NUMERIC_EPSILON = 1e-5;

export interface StockSurfacePointMm {
  readonly xMm: number;
  readonly yMm: number;
  readonly zMm: number;
}

export interface StockSurfaceDescriptor {
  readonly boundsMm: {
    readonly minimum: StockSurfacePointMm;
    readonly maximum: StockSurfacePointMm;
  };
  readonly columns: number;
  readonly rows: number;
  readonly resolutionMm: number;
  readonly topZMm: Float32Array;
}

export interface StockSurfacePatch {
  readonly revision: number;
  readonly brickX: number;
  readonly brickY: number;
  readonly cellIndices: Uint32Array;
  readonly topZMm: Float32Array;
}

export interface StockSurfaceBufferDiagnostics {
  readonly cells: number;
  readonly revision: number;
  readonly fullBufferUploads: number;
  readonly partialBufferUpdates: number;
  readonly lastUpdatedCells: number;
  readonly totalUpdatedCells: number;
  readonly uploadedBytes: number;
  readonly activeUpdateRanges: number;
}

export class StockSurfaceInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StockSurfaceInputError";
    this.code = code;
  }
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new StockSurfaceInputError(
      "renderer.stock-surface.nonfinite",
      `${label} must be a finite millimetre value.`,
    );
  }
  return value;
}

function writeVertex(
  target: Float32Array,
  offset: number,
  xMm: number,
  yMm: number,
  zMm: number,
): number {
  target[offset] = xMm;
  target[offset + 1] = zMm;
  target[offset + 2] = -yMm;
  return offset + 3;
}

export class PartialStockSurface {
  readonly geometry: BufferGeometry;
  readonly mesh: Mesh;
  readonly #descriptor: StockSurfaceDescriptor;
  readonly #positions: Float32Array;
  readonly #positionAttribute: BufferAttribute;
  readonly #topZMm: Float32Array;
  readonly #ownedMaterial: Material | null;

  #revision = 0;
  #partialBufferUpdates = 0;
  #lastUpdatedCells = 0;
  #totalUpdatedCells = 0;
  #uploadedBytes: number;

  constructor(descriptor: StockSurfaceDescriptor, material?: Material) {
    this.#validateDescriptor(descriptor);
    this.#descriptor = descriptor;
    this.#topZMm = descriptor.topZMm.slice();
    this.#positions = new Float32Array(
      descriptor.columns * descriptor.rows * FLOATS_PER_CELL,
    );
    for (let cellIndex = 0; cellIndex < this.#topZMm.length; cellIndex += 1) {
      this.#writeCell(cellIndex, this.#topZMm[cellIndex]);
    }

    this.geometry = new BufferGeometry();
    this.#positionAttribute = new BufferAttribute(this.#positions, 3);
    this.geometry.setAttribute("position", this.#positionAttribute);
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
    this.#ownedMaterial =
      material === undefined
        ? new MeshStandardMaterial({ color: 0xfdfdfb, roughness: 0.7 })
        : null;
    this.mesh = new Mesh(this.geometry, material ?? this.#ownedMaterial!);
    this.mesh.name = "m5-partial-stock-surface";
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.#uploadedBytes = this.#positions.byteLength;
  }

  applyPatches(
    patches: readonly StockSurfacePatch[],
  ): StockSurfaceBufferDiagnostics {
    const updates = new Map<number, number>();
    let maximumRevision = this.#revision;
    for (const patch of patches) {
      if (
        !Number.isSafeInteger(patch.revision) ||
        patch.revision < this.#revision
      ) {
        throw new StockSurfaceInputError(
          "renderer.stock-surface.revision-invalid",
          "Stock surface patch revisions must be safe, monotonic integers.",
        );
      }
      if (patch.cellIndices.length !== patch.topZMm.length) {
        throw new StockSurfaceInputError(
          "renderer.stock-surface.patch-length-mismatch",
          "Stock surface patch indices and heights must have equal lengths.",
        );
      }
      maximumRevision = Math.max(maximumRevision, patch.revision);
      for (let index = 0; index < patch.cellIndices.length; index += 1) {
        const cellIndex = patch.cellIndices[index];
        if (cellIndex >= this.#topZMm.length) {
          throw new StockSurfaceInputError(
            "renderer.stock-surface.cell-out-of-range",
            `Stock surface cell ${cellIndex} is outside the allocated buffer.`,
          );
        }
        const topZMm = finite(patch.topZMm[index], "patch.topZMm");
        if (
          topZMm < this.#descriptor.boundsMm.minimum.zMm - NUMERIC_EPSILON ||
          topZMm > this.#descriptor.boundsMm.maximum.zMm + NUMERIC_EPSILON
        ) {
          throw new StockSurfaceInputError(
            "renderer.stock-surface.height-out-of-range",
            "Stock surface patch heights must stay inside Stock Z bounds.",
          );
        }
        updates.set(
          cellIndex,
          Math.min(
            this.#descriptor.boundsMm.maximum.zMm,
            Math.max(this.#descriptor.boundsMm.minimum.zMm, topZMm),
          ),
        );
      }
    }

    if (updates.size === 0) {
      this.#lastUpdatedCells = 0;
      return this.getDiagnostics();
    }

    const sortedIndices = [...updates.keys()].sort((left, right) => left - right);
    for (const cellIndex of sortedIndices) {
      const topZMm = updates.get(cellIndex)!;
      this.#topZMm[cellIndex] = topZMm;
      this.#writeCell(cellIndex, topZMm);
    }

    let rangeStart = sortedIndices[0];
    let previous = rangeStart;
    for (let index = 1; index <= sortedIndices.length; index += 1) {
      const current = sortedIndices[index];
      if (current === previous + 1) {
        previous = current;
        continue;
      }
      this.#positionAttribute.addUpdateRange(
        rangeStart * FLOATS_PER_CELL,
        (previous - rangeStart + 1) * FLOATS_PER_CELL,
      );
      rangeStart = current;
      previous = current;
    }
    this.#positionAttribute.needsUpdate = true;
    this.#revision = maximumRevision;
    this.#partialBufferUpdates += 1;
    this.#lastUpdatedCells = sortedIndices.length;
    this.#totalUpdatedCells += sortedIndices.length;
    this.#uploadedBytes +=
      sortedIndices.length * FLOATS_PER_CELL * Float32Array.BYTES_PER_ELEMENT;
    return this.getDiagnostics();
  }

  finishUpload(): void {
    this.#positionAttribute.clearUpdateRanges();
  }

  getDiagnostics(): StockSurfaceBufferDiagnostics {
    return {
      cells: this.#topZMm.length,
      revision: this.#revision,
      fullBufferUploads: 1,
      partialBufferUpdates: this.#partialBufferUpdates,
      lastUpdatedCells: this.#lastUpdatedCells,
      totalUpdatedCells: this.#totalUpdatedCells,
      uploadedBytes: this.#uploadedBytes,
      activeUpdateRanges: this.#positionAttribute.updateRanges.length,
    };
  }

  dispose(): void {
    this.geometry.dispose();
    this.#ownedMaterial?.dispose();
  }

  #validateDescriptor(descriptor: StockSurfaceDescriptor): void {
    const { minimum, maximum } = descriptor.boundsMm;
    for (const [label, value] of Object.entries({
      "bounds.minimum.xMm": minimum.xMm,
      "bounds.minimum.yMm": minimum.yMm,
      "bounds.minimum.zMm": minimum.zMm,
      "bounds.maximum.xMm": maximum.xMm,
      "bounds.maximum.yMm": maximum.yMm,
      "bounds.maximum.zMm": maximum.zMm,
      resolutionMm: descriptor.resolutionMm,
    })) {
      finite(value, label);
    }
    if (
      minimum.xMm >= maximum.xMm ||
      minimum.yMm >= maximum.yMm ||
      minimum.zMm >= maximum.zMm ||
      descriptor.resolutionMm <= 0
    ) {
      throw new StockSurfaceInputError(
        "renderer.stock-surface.bounds-invalid",
        "Stock surface bounds and resolution must be positive and ordered.",
      );
    }
    if (
      !Number.isSafeInteger(descriptor.columns) ||
      !Number.isSafeInteger(descriptor.rows) ||
      descriptor.columns <= 0 ||
      descriptor.rows <= 0 ||
      descriptor.topZMm.length !== descriptor.columns * descriptor.rows
    ) {
      throw new StockSurfaceInputError(
        "renderer.stock-surface.grid-invalid",
        "Stock surface grid dimensions must match the height array.",
      );
    }
    for (const topZMm of descriptor.topZMm) {
      finite(topZMm, "descriptor.topZMm");
      if (
        topZMm < minimum.zMm - NUMERIC_EPSILON ||
        topZMm > maximum.zMm + NUMERIC_EPSILON
      ) {
        throw new StockSurfaceInputError(
          "renderer.stock-surface.height-out-of-range",
          "Initial Stock surface heights must stay inside Stock Z bounds.",
        );
      }
    }
  }

  #writeCell(cellIndex: number, topZMm: number): void {
    const column = cellIndex % this.#descriptor.columns;
    const row = Math.floor(cellIndex / this.#descriptor.columns);
    const { minimum, maximum } = this.#descriptor.boundsMm;
    const x0 = minimum.xMm + column * this.#descriptor.resolutionMm;
    const x1 = Math.min(maximum.xMm, x0 + this.#descriptor.resolutionMm);
    const y0 = minimum.yMm + row * this.#descriptor.resolutionMm;
    const y1 = Math.min(maximum.yMm, y0 + this.#descriptor.resolutionMm);
    const z0 = minimum.zMm;
    const corners = [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y0, topZMm],
      [x1, y0, topZMm],
      [x1, y1, topZMm],
      [x0, y1, topZMm],
    ] as const;
    const triangles = [
      0, 2, 1, 0, 3, 2,
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      3, 7, 6, 3, 6, 2,
      0, 4, 7, 0, 7, 3,
      1, 2, 6, 1, 6, 5,
    ] as const;
    let offset = cellIndex * FLOATS_PER_CELL;
    for (const cornerIndex of triangles) {
      const [xMm, yMm, zMm] = corners[cornerIndex];
      offset = writeVertex(this.#positions, offset, xMm, yMm, zMm);
    }
  }
}

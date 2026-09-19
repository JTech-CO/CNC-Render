import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Sphere,
  type Material,
} from "three";

const COMPONENTS_PER_VERTEX = 3;
const VERTICES_PER_QUAD = 6;
const QUADS_PER_SEGMENT = 4;
const NUMERIC_EPSILON = 1e-5;
const SEGMENT_TRIANGLE_CORNERS = new Uint8Array([
  0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6,
  4, 0, 1, 4, 1, 5, 7, 6, 2, 7, 2, 3,
]);
// One occurrence of each of the eight corners in the 24-vertex triangle soup.
const SEGMENT_UNIQUE_FLOAT_OFFSETS = new Uint8Array([0, 3, 6, 15, 18, 21, 24, 33]);

export interface RotationalStockSurfaceDescriptor {
  readonly axisCenterMm: { readonly xMm: number; readonly yMm: number };
  readonly minimumZMm: number;
  readonly maximumZMm: number;
  readonly axialCells: number;
  readonly radialSegments: number;
  readonly resolutionMm: number;
  readonly innerRadiusMm: Float32Array;
  readonly outerRadiusMm: Float32Array;
}

export interface RotationalStockSurfacePatch {
  readonly revision: number;
  readonly cellIndices: Uint32Array;
  readonly innerRadiusMm: Float32Array;
  readonly outerRadiusMm: Float32Array;
}

export interface RotationalStockSurfaceDiagnostics {
  readonly cells: number;
  readonly radialSegments: number;
  readonly revision: number;
  readonly fullBufferUploads: number;
  readonly partialBufferUpdates: number;
  readonly lastUpdatedCells: number;
  readonly totalUpdatedCells: number;
  readonly uploadedBytes: number;
  readonly activeUpdateRanges: number;
}

export class RotationalStockSurfaceInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RotationalStockSurfaceInputError";
    this.code = code;
  }
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RotationalStockSurfaceInputError(
      "renderer.rotational-stock.nonfinite",
      `${label} must be a finite millimetre value.`,
    );
  }
  return value;
}

export class PartialRotationalStockSurface {
  readonly geometry: BufferGeometry;
  readonly mesh: Mesh;
  readonly #descriptor: RotationalStockSurfaceDescriptor;
  readonly #positions: Float32Array;
  readonly #positionAttribute: BufferAttribute;
  readonly #innerRadiusMm: Float32Array;
  readonly #outerRadiusMm: Float32Array;
  readonly #derivedInnerRadiusMm: Float32Array;
  readonly #derivedOuterRadiusMm: Float32Array;
  readonly #unitCircle: Float64Array;
  readonly #floatsPerCell: number;
  readonly #ownedMaterial: Material | null;
  #revision = 0;
  #partialBufferUpdates = 0;
  #lastUpdatedCells = 0;
  #totalUpdatedCells = 0;
  #uploadedBytes: number;

  constructor(
    descriptor: RotationalStockSurfaceDescriptor,
    material?: Material,
    reusableMesh?: Mesh,
  ) {
    this.#validateDescriptor(descriptor);
    this.#descriptor = descriptor;
    this.#innerRadiusMm = descriptor.innerRadiusMm.slice();
    this.#outerRadiusMm = descriptor.outerRadiusMm.slice();
    this.#derivedInnerRadiusMm = descriptor.innerRadiusMm.slice();
    this.#derivedOuterRadiusMm = descriptor.outerRadiusMm.slice();
    this.#unitCircle = new Float64Array((descriptor.radialSegments + 1) * 2);
    for (let segment = 0; segment <= descriptor.radialSegments; segment++) {
      const angle = (segment / descriptor.radialSegments) * Math.PI * 2;
      this.#unitCircle[segment * 2] = Math.cos(angle);
      this.#unitCircle[segment * 2 + 1] = Math.sin(angle);
    }
    this.#floatsPerCell =
      descriptor.radialSegments *
      QUADS_PER_SEGMENT *
      VERTICES_PER_QUAD *
      COMPONENTS_PER_VERTEX;
    this.#positions = new Float32Array(
      descriptor.axialCells * this.#floatsPerCell,
    );
    this.#writeFullProfile();
    this.geometry = new BufferGeometry();
    this.#positionAttribute = new BufferAttribute(this.#positions, 3);
    this.geometry.setAttribute("position", this.#positionAttribute);
    this.#recomputeDerivedGeometry();
    this.#ownedMaterial =
      material === undefined
        ? new MeshStandardMaterial({ color: 0xfdfdfb, roughness: 0.7 })
        : material.clone();
    // Dispose per-surface WebGPU render objects without disposing the scene material.
    this.mesh = reusableMesh ?? new Mesh(this.geometry, this.#ownedMaterial!);
    this.mesh.geometry = this.geometry;
    this.mesh.material = this.#ownedMaterial!;
    this.mesh.visible = true;
    this.mesh.name = "m6-partial-rotational-stock-surface";
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.#uploadedBytes = this.#positions.byteLength;
  }

  applyPatches(
    patches: readonly RotationalStockSurfacePatch[],
  ): RotationalStockSurfaceDiagnostics {
    const updates = new Map<number, readonly [number, number]>();
    let maximumRevision = this.#revision;
    for (const patch of patches) {
      if (!Number.isSafeInteger(patch.revision) || patch.revision < this.#revision) {
        throw new RotationalStockSurfaceInputError(
          "renderer.rotational-stock.revision-invalid",
          "Profile patch revisions must be safe, monotonic integers.",
        );
      }
      if (
        patch.cellIndices.length !== patch.innerRadiusMm.length ||
        patch.cellIndices.length !== patch.outerRadiusMm.length
      ) {
        throw new RotationalStockSurfaceInputError(
          "renderer.rotational-stock.patch-length-mismatch",
          "Profile patch indices and radius arrays must have equal lengths.",
        );
      }
      maximumRevision = Math.max(maximumRevision, patch.revision);
      for (let index = 0; index < patch.cellIndices.length; index += 1) {
        const cellIndex = patch.cellIndices[index];
        if (cellIndex >= this.#descriptor.axialCells) {
          throw new RotationalStockSurfaceInputError(
            "renderer.rotational-stock.cell-out-of-range",
            `Profile cell ${cellIndex} is outside the allocated buffer.`,
          );
        }
        const inner = finite(patch.innerRadiusMm[index], "patch.innerRadiusMm");
        const outer = finite(patch.outerRadiusMm[index], "patch.outerRadiusMm");
        this.#validateRadii(inner, outer);
        updates.set(cellIndex, [inner, outer]);
      }
    }
    if (updates.size === 0) {
      this.#lastUpdatedCells = 0;
      return this.getDiagnostics();
    }
    const sortedIndices = [...updates.keys()].sort((left, right) => left - right);
    for (const cellIndex of sortedIndices) {
      const [inner, outer] = updates.get(cellIndex)!;
      this.#innerRadiusMm[cellIndex] = inner;
      this.#outerRadiusMm[cellIndex] = outer;
      this.#writeCell(cellIndex, inner, outer);
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
        rangeStart * this.#floatsPerCell,
        (previous - rangeStart + 1) * this.#floatsPerCell,
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
      sortedIndices.length *
      this.#floatsPerCell *
      Float32Array.BYTES_PER_ELEMENT;
    return this.getDiagnostics();
  }

  finishUpload(): void {
    this.#positionAttribute.clearUpdateRanges();
  }

  reset(descriptor: RotationalStockSurfaceDescriptor): boolean {
    this.#validateDescriptor(descriptor);
    const previous = this.#descriptor;
    if (descriptor.axisCenterMm.xMm !== previous.axisCenterMm.xMm || descriptor.axisCenterMm.yMm !== previous.axisCenterMm.yMm ||
      descriptor.minimumZMm !== previous.minimumZMm || descriptor.maximumZMm !== previous.maximumZMm ||
      descriptor.axialCells !== previous.axialCells || descriptor.radialSegments !== previous.radialSegments || descriptor.resolutionMm !== previous.resolutionMm) return false;
    const sameDerivedProfile = descriptor.innerRadiusMm.every((radius, cell) => radius === this.#derivedInnerRadiusMm[cell]) &&
      descriptor.outerRadiusMm.every((radius, cell) => radius === this.#derivedOuterRadiusMm[cell]);
    this.#innerRadiusMm.set(descriptor.innerRadiusMm);
    this.#outerRadiusMm.set(descriptor.outerRadiusMm);
    this.#writeFullProfile();
    this.#positionAttribute.clearUpdateRanges();
    this.#positionAttribute.addUpdateRange(0, this.#positions.length);
    this.#positionAttribute.needsUpdate = true;
    // Patches retain the original per-cell face normals and conservative bounds.
    // An identical reset restores exactly that profile: its derived data is still
    // valid. A different full profile must recompute all three, then replace keys.
    if (!sameDerivedProfile) {
      this.#recomputeDerivedGeometry();
      this.#derivedInnerRadiusMm.set(descriptor.innerRadiusMm);
      this.#derivedOuterRadiusMm.set(descriptor.outerRadiusMm);
    }
    this.#revision = 0;
    this.#partialBufferUpdates = 0;
    this.#lastUpdatedCells = 0;
    this.#totalUpdatedCells = 0;
    this.#uploadedBytes = this.#positions.byteLength;
    return true;
  }

  getDiagnostics(): RotationalStockSurfaceDiagnostics {
    return {
      cells: this.#descriptor.axialCells,
      radialSegments: this.#descriptor.radialSegments,
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

  #validateDescriptor(descriptor: RotationalStockSurfaceDescriptor): void {
    finite(descriptor.axisCenterMm.xMm, "axisCenterMm.xMm");
    finite(descriptor.axisCenterMm.yMm, "axisCenterMm.yMm");
    finite(descriptor.minimumZMm, "minimumZMm");
    finite(descriptor.maximumZMm, "maximumZMm");
    finite(descriptor.resolutionMm, "resolutionMm");
    if (
      descriptor.minimumZMm >= descriptor.maximumZMm ||
      descriptor.resolutionMm <= 0 ||
      !Number.isSafeInteger(descriptor.axialCells) ||
      descriptor.axialCells <= 0 ||
      !Number.isSafeInteger(descriptor.radialSegments) ||
      descriptor.radialSegments < 8 ||
      descriptor.radialSegments > 128 ||
      descriptor.innerRadiusMm.length !== descriptor.axialCells ||
      descriptor.outerRadiusMm.length !== descriptor.axialCells
    ) {
      throw new RotationalStockSurfaceInputError(
        "renderer.rotational-stock.descriptor-invalid",
        "Profile bounds, grid, segments, resolution, and arrays must agree.",
      );
    }
    for (let index = 0; index < descriptor.axialCells; index += 1) {
      this.#validateRadii(
        finite(descriptor.innerRadiusMm[index], "innerRadiusMm"),
        finite(descriptor.outerRadiusMm[index], "outerRadiusMm"),
      );
    }
  }

  #validateRadii(inner: number, outer: number): void {
    if (inner < -NUMERIC_EPSILON || outer < inner - NUMERIC_EPSILON) {
      throw new RotationalStockSurfaceInputError(
        "renderer.rotational-stock.radius-invalid",
        "Profile radii must satisfy 0 <= inner <= outer.",
      );
    }
  }

  #samePreviousRadii(cell: number): boolean {
    return cell > 0 && Object.is(this.#innerRadiusMm[cell], this.#innerRadiusMm[cell - 1]) &&
      Object.is(this.#outerRadiusMm[cell], this.#outerRadiusMm[cell - 1]);
  }

  #writeFullProfile(): void {
    const { axialCells, radialSegments, minimumZMm, maximumZMm, resolutionMm } = this.#descriptor;
    for (let cell = 0; cell < axialCells; cell++) {
      if (!this.#samePreviousRadii(cell)) {
        this.#writeCell(cell, this.#innerRadiusMm[cell], this.#outerRadiusMm[cell]);
        continue;
      }
      let offset = cell * this.#floatsPerCell;
      this.#positions.copyWithin(offset, offset - this.#floatsPerCell, offset);
      const z0 = minimumZMm + cell * resolutionMm;
      const z1 = Math.min(maximumZMm, z0 + resolutionMm);
      // Reuse identical radial coordinates, but assign absolute axial values:
      // translating already-rounded Float32 values would accumulate drift.
      for (let segment = 0; segment < radialSegments; segment++) {
        for (const corner of SEGMENT_TRIANGLE_CORNERS) {
          this.#positions[offset + 1] = (corner & 2) ? z1 : z0;
          offset += 3;
        }
      }
    }
  }

  #recomputeDerivedGeometry(): void {
    const positions = this.#positions;
    let normalAttribute = this.geometry.getAttribute("normal") as BufferAttribute | undefined;
    if (!normalAttribute) {
      normalAttribute = new BufferAttribute(new Float32Array(positions.length), 3);
      this.geometry.setAttribute("normal", normalAttribute);
    }
    const normals = normalAttribute.array as Float32Array;
    for (let cell = 0; cell < this.#descriptor.axialCells; cell++) {
      const start = cell * this.#floatsPerCell;
      const previous = start - this.#floatsPerCell;
      // Translation preserves the cross products only if the *stored* Float32
      // cell height is identical. Clipped/quantized cells use the exact path.
      if (this.#samePreviousRadii(cell) && Object.is(positions[start + 7] - positions[start + 1], positions[previous + 7] - positions[previous + 1])) {
        normals.copyWithin(start, previous, start);
        continue;
      }
      for (let offset = start; offset < start + this.#floatsPerCell; offset += 9) {
      const cbX = positions[offset + 6] - positions[offset + 3];
      const cbY = positions[offset + 7] - positions[offset + 4];
      const cbZ = positions[offset + 8] - positions[offset + 5];
      const abX = positions[offset] - positions[offset + 3];
      const abY = positions[offset + 1] - positions[offset + 4];
      const abZ = positions[offset + 2] - positions[offset + 5];
      // Match Three's Float32 cross-product storage before normalizeNormals().
      // A non-indexed triangle has one flat normal, not three distinct normals.
      const x = Math.fround(cbY * abZ - cbZ * abY);
      const y = Math.fround(cbZ * abX - cbX * abZ);
      const z = Math.fround(cbX * abY - cbY * abX);
      const inverseLength = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
      const nx = x * inverseLength, ny = y * inverseLength, nz = z * inverseLength;
      for (let vertex = 0; vertex < 9; vertex += 3) {
        normals[offset + vertex] = nx;
        normals[offset + vertex + 1] = ny;
        normals[offset + vertex + 2] = nz;
      }
      }
    }
    normalAttribute.needsUpdate = true;

    const bounds = this.geometry.boundingBox ?? new Box3();
    bounds.makeEmpty();
    const segmentFloats = SEGMENT_TRIANGLE_CORNERS.length * 3;
    for (let cell = 0; cell < this.#descriptor.axialCells; cell++) {
      // Equal-radius runs have identical radial coordinates and monotonic axial
      // coordinates. Their AABB and farthest sphere point lie at run endpoints.
      if (this.#samePreviousRadii(cell) && cell + 1 < this.#descriptor.axialCells && this.#samePreviousRadii(cell + 1)) continue;
      for (let segment = cell * this.#floatsPerCell; segment < (cell + 1) * this.#floatsPerCell; segment += segmentFloats) {
      for (const corner of SEGMENT_UNIQUE_FLOAT_OFFSETS) {
        const offset = segment + corner;
        const x = positions[offset], y = positions[offset + 1], z = positions[offset + 2];
        bounds.min.x = Math.min(bounds.min.x, x); bounds.max.x = Math.max(bounds.max.x, x);
        bounds.min.y = Math.min(bounds.min.y, y); bounds.max.y = Math.max(bounds.max.y, y);
        bounds.min.z = Math.min(bounds.min.z, z); bounds.max.z = Math.max(bounds.max.z, z);
      }
      }
    }
    this.geometry.boundingBox = bounds;
    const sphere = this.geometry.boundingSphere ?? new Sphere();
    bounds.getCenter(sphere.center);
    let maximumRadiusSq = 0;
    for (let cell = 0; cell < this.#descriptor.axialCells; cell++) {
      if (this.#samePreviousRadii(cell) && cell + 1 < this.#descriptor.axialCells && this.#samePreviousRadii(cell + 1)) continue;
      for (let segment = cell * this.#floatsPerCell; segment < (cell + 1) * this.#floatsPerCell; segment += segmentFloats) {
      for (const corner of SEGMENT_UNIQUE_FLOAT_OFFSETS) {
        const offset = segment + corner;
        const dx = sphere.center.x - positions[offset];
        const dy = sphere.center.y - positions[offset + 1];
        const dz = sphere.center.z - positions[offset + 2];
        maximumRadiusSq = Math.max(maximumRadiusSq, dx * dx + dy * dy + dz * dz);
      }
      }
    }
    sphere.radius = Math.sqrt(maximumRadiusSq);
    this.geometry.boundingSphere = sphere;
  }

  #writeCell(cellIndex: number, innerRadiusMm: number, outerRadiusMm: number): void {
    const { axisCenterMm, minimumZMm, maximumZMm, radialSegments, resolutionMm } =
      this.#descriptor;
    const z0 = minimumZMm + cellIndex * resolutionMm;
    const z1 = Math.min(maximumZMm, z0 + resolutionMm);
    let offset = cellIndex * this.#floatsPerCell;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      for (const corner of SEGMENT_TRIANGLE_CORNERS) {
        const radius = (corner & 4) ? innerRadiusMm : outerRadiusMm;
        const angleOffset = ((corner & 1) ^ ((corner >> 1) & 1));
        const circleOffset = (segment + angleOffset) * 2;
        this.#positions[offset++] = axisCenterMm.xMm + radius * this.#unitCircle[circleOffset];
        this.#positions[offset++] = (corner & 2) ? z1 : z0;
        this.#positions[offset++] = -(axisCenterMm.yMm + radius * this.#unitCircle[circleOffset + 1]);
      }
    }
  }
}

import {
  semanticHash,
  type JsonValue,
  type Stock,
  type ToolAssembly,
  type Vec3Mm,
} from "@cnc-render/contracts";

import { minimumSweptFlatEndTipZMm } from "./milling-sweep-geometry";

const DEFAULT_BRICK_SIZE_DEXELS = 16;
const DEFAULT_MEMORY_CAP_BYTES = 64 * 1024 * 1024;
const MAX_COMPLETED_SWEEP_CACHE_ENTRIES = 1_024;
const NUMERIC_EPSILON = 1e-9;

export const MILLING_PRESET_RESOLUTION_MULTIPLIER = {
  preview: 2,
  balanced: 1,
  precision: 0.5,
} as const;

export const MILLING_PRESET_RELATIVE_VOLUME_ERROR_LIMIT = {
  preview: 0.05,
  balanced: 0.02,
  precision: 0.01,
} as const;

export type MillingQualityPreset =
  keyof typeof MILLING_PRESET_RESOLUTION_MULTIPLIER;

export interface MillingMaterialRemovalOptions {
  readonly stock: Stock;
  readonly tool: ToolAssembly;
  readonly preset: MillingQualityPreset;
  readonly seed: number;
  readonly brickSizeDexels?: number;
  readonly memoryCapBytes?: number;
}

export interface MillingSweep {
  readonly startMm: Vec3Mm;
  readonly endMm: Vec3Mm;
}

export interface MillingSweepResult {
  readonly revision: number;
  readonly updatedDexels: number;
  readonly dirtyBricks: number;
  readonly removedVolumeDeltaMm3: number;
  readonly removedVolumeMm3: number;
}

export interface DexelInterval {
  readonly minimumZMm: number;
  readonly maximumZMm: number;
}

export interface MillingMeasurement {
  readonly valueMm: number;
  readonly representationResolutionMm: number;
}

export interface WallThicknessMeasurementInput {
  readonly axis: "x" | "y";
  readonly pointMm: Vec3Mm;
}

export interface MillingStockSurfaceDescriptor {
  readonly boundsMm: {
    readonly minimum: Vec3Mm;
    readonly maximum: Vec3Mm;
  };
  readonly columns: number;
  readonly rows: number;
  readonly resolutionMm: number;
  readonly topZMm: Float32Array;
}

export interface MillingStockSurfacePatch {
  readonly revision: number;
  readonly brickX: number;
  readonly brickY: number;
  readonly cellIndices: Uint32Array;
  readonly topZMm: Float32Array;
}

export interface MillingMaterialRemovalDiagnostics {
  readonly representation: "sparse-z-multi-dexel";
  readonly preset: MillingQualityPreset;
  readonly resolutionMm: number;
  readonly columns: number;
  readonly rows: number;
  readonly brickSizeDexels: number;
  readonly logicalBricks: number;
  readonly allocatedBricks: number;
  readonly dirtyBricks: number;
  readonly dirtyDexels: number;
  readonly revision: number;
  readonly totalUpdatedDexels: number;
  readonly lastUpdatedDexels: number;
  readonly fullSurfaceExtractions: number;
  readonly partialSurfaceExtractions: number;
  readonly cachedSweeps: number;
  readonly allocatedBytes: number;
  readonly memoryCapBytes: number;
  readonly removedVolumeMm3: number;
}

export class MillingInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MillingInputError";
    this.code = code;
  }
}

interface SparseBrick {
  readonly brickX: number;
  readonly brickY: number;
  readonly removedDepthLayers: Uint32Array;
  readonly dirtyLocalIndices: Set<number>;
}

interface GridIndex {
  readonly column: number;
  readonly row: number;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new MillingInputError(
      "material-removal.input.nonfinite",
      `${label} must be a finite millimetre value.`,
    );
  }
  return value;
}

function normalizedZero(value: number): number {
  return value === 0 ? 0 : value;
}

function brickKey(brickX: number, brickY: number): string {
  return `${brickY}:${brickX}`;
}

function compareBricks(left: SparseBrick, right: SparseBrick): number {
  return left.brickY - right.brickY || left.brickX - right.brickX;
}

function finitePoint(point: Vec3Mm, label: string): void {
  finite(point.xMm, `${label}.xMm`);
  finite(point.yMm, `${label}.yMm`);
  finite(point.zMm, `${label}.zMm`);
}

export class SparseDexelMillingEngine {
  readonly #preset: MillingQualityPreset;
  readonly #seed: number;
  readonly #brickSizeDexels: number;
  readonly #memoryCapBytes: number;
  readonly #resolutionMm: number;
  readonly #columns: number;
  readonly #rows: number;
  readonly #maximumDepthLayers: number;
  readonly #cutterRadiusMm: number;
  readonly #cuttingLengthMm: number;
  readonly #bounds: MillingStockSurfaceDescriptor["boundsMm"];
  readonly #bricks = new Map<string, SparseBrick>();
  readonly #completedSweepKeys = new Set<string>();

  #revision = 0;
  #removedVolumeMm3 = 0;
  #totalUpdatedDexels = 0;
  #lastUpdatedDexels = 0;
  #fullSurfaceExtractions = 0;
  #partialSurfaceExtractions = 0;

  constructor(options: MillingMaterialRemovalOptions) {
    const {
      stock,
      tool,
      preset,
      seed,
      brickSizeDexels = DEFAULT_BRICK_SIZE_DEXELS,
      memoryCapBytes = DEFAULT_MEMORY_CAP_BYTES,
    } = options;

    if (stock.geometry.primitiveType !== "box") {
      throw new MillingInputError(
        "material-removal.stock.geometry-unsupported",
        "M5 milling material removal supports box stock only.",
      );
    }
    const rotation = stock.transform.rotationRad;
    finite(rotation.xRad, "stock.transform.rotationRad.xRad");
    finite(rotation.yRad, "stock.transform.rotationRad.yRad");
    finite(rotation.zRad, "stock.transform.rotationRad.zRad");
    if (
      Math.abs(rotation.xRad) > NUMERIC_EPSILON ||
      Math.abs(rotation.yRad) > NUMERIC_EPSILON ||
      Math.abs(rotation.zRad) > NUMERIC_EPSILON
    ) {
      throw new MillingInputError(
        "material-removal.stock.rotation-unsupported",
        "M5 sparse Z-dexels require axis-aligned stock.",
      );
    }
    if (
      tool.toolType !== "milling-cutter" ||
      tool.cutterGeometry.geometryType !== "flat-end-mill"
    ) {
      throw new MillingInputError(
        "material-removal.tool.geometry-unsupported",
        "M5 milling material removal supports flat-end milling cutters only.",
      );
    }
    const cutterDiameterMm = finite(
      tool.cutterGeometry.diameterMm,
      "tool.cutterGeometry.diameterMm",
    );
    const cuttingLengthMm = finite(
      tool.cutterGeometry.cuttingLengthMm,
      "tool.cutterGeometry.cuttingLengthMm",
    );
    if (cutterDiameterMm <= 0 || cuttingLengthMm <= 0) {
      throw new MillingInputError(
        "material-removal.tool.dimensions-invalid",
        "Cutter diameter and cutting length must be positive.",
      );
    }
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      throw new MillingInputError(
        "material-removal.seed.invalid",
        "seed must be an unsigned 32-bit integer.",
      );
    }
    if (
      !Number.isInteger(brickSizeDexels) ||
      brickSizeDexels < 4 ||
      brickSizeDexels > 64
    ) {
      throw new MillingInputError(
        "material-removal.brick-size.invalid",
        "brickSizeDexels must be an integer in the inclusive range 4..64.",
      );
    }
    if (!Number.isSafeInteger(memoryCapBytes) || memoryCapBytes <= 0) {
      throw new MillingInputError(
        "material-removal.memory-cap.invalid",
        "memoryCapBytes must be a positive safe integer.",
      );
    }

    const size = stock.geometry.sizeMm;
    const position = stock.transform.positionMm;
    finitePoint(size, "stock.geometry.sizeMm");
    finitePoint(position, "stock.transform.positionMm");
    if (size.xMm <= 0 || size.yMm <= 0 || size.zMm <= 0) {
      throw new MillingInputError(
        "material-removal.stock.size-invalid",
        "Stock dimensions must be positive.",
      );
    }
    const multiplier = MILLING_PRESET_RESOLUTION_MULTIPLIER[preset];
    const resolutionMm = finite(
      finite(stock.resolutionMm, "stock.resolutionMm") * multiplier,
      "effective resolutionMm",
    );
    if (resolutionMm <= 0) {
      throw new MillingInputError(
        "material-removal.resolution.invalid",
        "The effective representation resolution must be positive.",
      );
    }
    const columns = Math.ceil(size.xMm / resolutionMm);
    const rows = Math.ceil(size.yMm / resolutionMm);
    const maximumDepthLayers = Math.ceil(size.zMm / resolutionMm);
    if (
      !Number.isSafeInteger(columns) ||
      !Number.isSafeInteger(rows) ||
      !Number.isSafeInteger(maximumDepthLayers) ||
      columns * rows > 0xffff_ffff ||
      maximumDepthLayers > 0xffff_ffff
    ) {
      throw new MillingInputError(
        "material-removal.grid.invalid",
        "The sparse dexel grid exceeds the Uint32 representation limits.",
      );
    }

    this.#preset = preset;
    this.#seed = seed;
    this.#brickSizeDexels = brickSizeDexels;
    this.#memoryCapBytes = memoryCapBytes;
    this.#resolutionMm = resolutionMm;
    this.#columns = columns;
    this.#rows = rows;
    this.#maximumDepthLayers = maximumDepthLayers;
    this.#cutterRadiusMm = cutterDiameterMm / 2;
    this.#cuttingLengthMm = cuttingLengthMm;
    this.#bounds = {
      minimum: {
        xMm: normalizedZero(position.xMm - size.xMm / 2),
        yMm: normalizedZero(position.yMm - size.yMm / 2),
        zMm: normalizedZero(position.zMm - size.zMm / 2),
      },
      maximum: {
        xMm: normalizedZero(position.xMm + size.xMm / 2),
        yMm: normalizedZero(position.yMm + size.yMm / 2),
        zMm: normalizedZero(position.zMm + size.zMm / 2),
      },
    };
  }

  get resolutionMm(): number {
    return this.#resolutionMm;
  }

  get removedVolumeMm3(): number {
    return this.#removedVolumeMm3;
  }

  applySweep(sweep: MillingSweep): MillingSweepResult {
    finitePoint(sweep.startMm, "sweep.startMm");
    finitePoint(sweep.endMm, "sweep.endMm");
    const sweepKey = this.#sweepKey(sweep);
    if (this.#completedSweepKeys.has(sweepKey)) {
      this.#lastUpdatedDexels = 0;
      return {
        revision: this.#revision,
        updatedDexels: 0,
        dirtyBricks: 0,
        removedVolumeDeltaMm3: 0,
        removedVolumeMm3: this.#removedVolumeMm3,
      };
    }

    const topZMm = this.#bounds.maximum.zMm;
    const lowestTipZMm = Math.min(sweep.startMm.zMm, sweep.endMm.zMm);
    const requestedDepthMm = topZMm - lowestTipZMm;
    if (requestedDepthMm > this.#cuttingLengthMm + NUMERIC_EPSILON) {
      throw new MillingInputError(
        "material-removal.tool.cutting-length-exceeded",
        "The requested cut exceeds the cutter cutting length.",
      );
    }

    const minimumX = Math.min(sweep.startMm.xMm, sweep.endMm.xMm) - this.#cutterRadiusMm;
    const maximumX = Math.max(sweep.startMm.xMm, sweep.endMm.xMm) + this.#cutterRadiusMm;
    const minimumY = Math.min(sweep.startMm.yMm, sweep.endMm.yMm) - this.#cutterRadiusMm;
    const maximumY = Math.max(sweep.startMm.yMm, sweep.endMm.yMm) + this.#cutterRadiusMm;
    const columnRange = this.#indexRange(minimumX, maximumX, "x");
    const rowRange = this.#indexRange(minimumY, maximumY, "y");

    let removedVolumeDeltaMm3 = 0;
    const touchedBrickKeys = new Set<string>();
    const requiredBricks = new Map<
      string,
      { readonly brickX: number; readonly brickY: number }
    >();
    const pendingUpdates: Array<{
      readonly column: number;
      readonly row: number;
      readonly requestedLayers: number;
      readonly previousLayers: number;
      readonly brickX: number;
      readonly brickY: number;
      readonly key: string;
      readonly localIndex: number;
    }> = [];

    if (columnRange !== null && rowRange !== null && requestedDepthMm > 0) {
      for (let row = rowRange.minimum; row <= rowRange.maximum; row += 1) {
        const yMm = this.#cellCenter(row, "y");
        for (
          let column = columnRange.minimum;
          column <= columnRange.maximum;
          column += 1
        ) {
          const xMm = this.#cellCenter(column, "x");
          const minimumTipZMm = minimumSweptFlatEndTipZMm(
            sweep,
            this.#cutterRadiusMm,
            xMm,
            yMm,
          );
          if (minimumTipZMm === null || minimumTipZMm >= topZMm) {
            continue;
          }

          const requestedLayers = Math.min(
            this.#maximumDepthLayers,
            Math.max(
              0,
              Math.round((topZMm - minimumTipZMm) / this.#resolutionMm),
            ),
          );
          if (requestedLayers === 0) {
            continue;
          }

          const location = this.#brickLocation(column, row);
          const existingBrick = this.#bricks.get(location.key);
          const previousLayers =
            existingBrick?.removedDepthLayers[location.localIndex] ?? 0;
          if (requestedLayers <= previousLayers) {
            continue;
          }

          pendingUpdates.push({
            column,
            row,
            requestedLayers,
            previousLayers,
            ...location,
          });
          if (!existingBrick) {
            requiredBricks.set(location.key, {
              brickX: location.brickX,
              brickY: location.brickY,
            });
          }

          const previousDepthMm = this.#depthMm(previousLayers);
          const nextDepthMm = this.#depthMm(requestedLayers);
          removedVolumeDeltaMm3 +=
            (nextDepthMm - previousDepthMm) *
            this.#cellWidth(column) *
            this.#cellHeight(row);
        }
      }
    }

    const bytesPerBrick =
      this.#brickSizeDexels *
      this.#brickSizeDexels *
      Uint32Array.BYTES_PER_ELEMENT;
    if (
      (this.#bricks.size + requiredBricks.size) * bytesPerBrick >
      this.#memoryCapBytes
    ) {
      throw new MillingInputError(
        "material-removal.memory-cap.exceeded",
        "Sparse stock allocation would exceed the configured memory cap.",
      );
    }
    for (const { brickX, brickY } of requiredBricks.values()) {
      this.#allocateBrick(brickX, brickY);
    }
    for (const update of pendingUpdates) {
      const brick = this.#bricks.get(update.key);
      if (!brick) {
        throw new Error("Preflighted sparse brick allocation is missing.");
      }
      brick.removedDepthLayers[update.localIndex] =
        update.requestedLayers;
      brick.dirtyLocalIndices.add(update.localIndex);
      touchedBrickKeys.add(update.key);
    }

    const updatedDexels = pendingUpdates.length;

    if (updatedDexels > 0) {
      this.#revision += 1;
      this.#removedVolumeMm3 = normalizedZero(
        this.#removedVolumeMm3 + removedVolumeDeltaMm3,
      );
      this.#totalUpdatedDexels += updatedDexels;
    }
    this.#lastUpdatedDexels = updatedDexels;
    this.#rememberSweep(sweepKey);

    return {
      revision: this.#revision,
      updatedDexels,
      dirtyBricks: touchedBrickKeys.size,
      removedVolumeDeltaMm3: normalizedZero(removedVolumeDeltaMm3),
      removedVolumeMm3: this.#removedVolumeMm3,
    };
  }

  getDexelIntervals(xMm: number, yMm: number): readonly DexelInterval[] {
    const index = this.#gridIndex(xMm, yMm);
    if (index === null) {
      return [];
    }
    const removedDepthMm = this.#depthMm(this.#depthLayers(index.column, index.row));
    const maximumZMm = this.#bounds.maximum.zMm - removedDepthMm;
    if (maximumZMm <= this.#bounds.minimum.zMm + NUMERIC_EPSILON) {
      return [];
    }
    return [
      {
        minimumZMm: this.#bounds.minimum.zMm,
        maximumZMm: normalizedZero(maximumZMm),
      },
    ];
  }

  measureDistance(startMm: Vec3Mm, endMm: Vec3Mm): MillingMeasurement {
    finitePoint(startMm, "measurement.startMm");
    finitePoint(endMm, "measurement.endMm");
    return {
      valueMm: Math.hypot(
        endMm.xMm - startMm.xMm,
        endMm.yMm - startMm.yMm,
        endMm.zMm - startMm.zMm,
      ),
      representationResolutionMm: this.#resolutionMm,
    };
  }

  measureDepth(xMm: number, yMm: number): MillingMeasurement {
    const index = this.#requiredGridIndex(xMm, yMm, "depth measurement");
    return {
      valueMm: this.#depthMm(this.#depthLayers(index.column, index.row)),
      representationResolutionMm: this.#resolutionMm,
    };
  }

  measureWallThickness(
    input: WallThicknessMeasurementInput,
  ): MillingMeasurement {
    finitePoint(input.pointMm, "wall measurement point");
    const origin = this.#requiredGridIndex(
      input.pointMm.xMm,
      input.pointMm.yMm,
      "wall thickness measurement",
    );
    if (!this.#isSolidAt(origin.column, origin.row, input.pointMm.zMm)) {
      return {
        valueMm: 0,
        representationResolutionMm: this.#resolutionMm,
      };
    }

    let minimum = input.axis === "x" ? origin.column : origin.row;
    let maximum = minimum;
    const limit = input.axis === "x" ? this.#columns : this.#rows;
    const solid = (coordinate: number) =>
      input.axis === "x"
        ? this.#isSolidAt(coordinate, origin.row, input.pointMm.zMm)
        : this.#isSolidAt(origin.column, coordinate, input.pointMm.zMm);

    while (minimum > 0 && solid(minimum - 1)) {
      minimum -= 1;
    }
    while (maximum + 1 < limit && solid(maximum + 1)) {
      maximum += 1;
    }

    let valueMm = 0;
    for (let coordinate = minimum; coordinate <= maximum; coordinate += 1) {
      valueMm +=
        input.axis === "x"
          ? this.#cellWidth(coordinate)
          : this.#cellHeight(coordinate);
    }
    return {
      valueMm: normalizedZero(valueMm),
      representationResolutionMm: this.#resolutionMm,
    };
  }

  createFullSurfaceSnapshot(): MillingStockSurfaceDescriptor {
    const topZMm = new Float32Array(this.#columns * this.#rows);
    for (let row = 0; row < this.#rows; row += 1) {
      for (let column = 0; column < this.#columns; column += 1) {
        topZMm[row * this.#columns + column] = this.#topZMm(column, row);
      }
    }
    this.#fullSurfaceExtractions += 1;
    return {
      boundsMm: this.#bounds,
      columns: this.#columns,
      rows: this.#rows,
      resolutionMm: this.#resolutionMm,
      topZMm,
    };
  }

  drainDirtySurfacePatches(): readonly MillingStockSurfacePatch[] {
    const patches: MillingStockSurfacePatch[] = [];
    for (const brick of [...this.#bricks.values()].sort(compareBricks)) {
      if (brick.dirtyLocalIndices.size === 0) {
        continue;
      }
      const localIndices = [...brick.dirtyLocalIndices].sort(
        (left, right) => left - right,
      );
      const cellIndices = new Uint32Array(localIndices.length);
      const topZMm = new Float32Array(localIndices.length);
      let outputIndex = 0;
      for (const localIndex of localIndices) {
        const localColumn = localIndex % this.#brickSizeDexels;
        const localRow = Math.floor(localIndex / this.#brickSizeDexels);
        const column = brick.brickX * this.#brickSizeDexels + localColumn;
        const row = brick.brickY * this.#brickSizeDexels + localRow;
        if (column >= this.#columns || row >= this.#rows) {
          continue;
        }
        cellIndices[outputIndex] = row * this.#columns + column;
        topZMm[outputIndex] = this.#topZMm(column, row);
        outputIndex += 1;
      }
      brick.dirtyLocalIndices.clear();
      patches.push({
        revision: this.#revision,
        brickX: brick.brickX,
        brickY: brick.brickY,
        cellIndices:
          outputIndex === cellIndices.length
            ? cellIndices
            : cellIndices.slice(0, outputIndex),
        topZMm:
          outputIndex === topZMm.length ? topZMm : topZMm.slice(0, outputIndex),
      });
    }
    if (patches.length > 0) {
      this.#partialSurfaceExtractions += 1;
    }
    return patches;
  }

  async stockHashSha256(): Promise<string> {
    const manifest: JsonValue = {
      schema: "cnc-render.stock-hash.v1",
      seed: this.#seed,
      preset: this.#preset,
      resolutionMm: this.#resolutionMm,
      boundsMm: {
        minimum: {
          xMm: this.#bounds.minimum.xMm,
          yMm: this.#bounds.minimum.yMm,
          zMm: this.#bounds.minimum.zMm,
        },
        maximum: {
          xMm: this.#bounds.maximum.xMm,
          yMm: this.#bounds.maximum.yMm,
          zMm: this.#bounds.maximum.zMm,
        },
      },
      grid: {
        columns: this.#columns,
        rows: this.#rows,
        brickSizeDexels: this.#brickSizeDexels,
      },
      bricks: [...this.#bricks.values()].sort(compareBricks).map((brick) => ({
        brickX: brick.brickX,
        brickY: brick.brickY,
        removedDepthLayers: Array.from(brick.removedDepthLayers),
      })),
    };
    return semanticHash(manifest);
  }

  getDiagnostics(): MillingMaterialRemovalDiagnostics {
    let dirtyBricks = 0;
    let dirtyDexels = 0;
    for (const brick of this.#bricks.values()) {
      if (brick.dirtyLocalIndices.size > 0) {
        dirtyBricks += 1;
        dirtyDexels += brick.dirtyLocalIndices.size;
      }
    }
    return {
      representation: "sparse-z-multi-dexel",
      preset: this.#preset,
      resolutionMm: this.#resolutionMm,
      columns: this.#columns,
      rows: this.#rows,
      brickSizeDexels: this.#brickSizeDexels,
      logicalBricks:
        Math.ceil(this.#columns / this.#brickSizeDexels) *
        Math.ceil(this.#rows / this.#brickSizeDexels),
      allocatedBricks: this.#bricks.size,
      dirtyBricks,
      dirtyDexels,
      revision: this.#revision,
      totalUpdatedDexels: this.#totalUpdatedDexels,
      lastUpdatedDexels: this.#lastUpdatedDexels,
      fullSurfaceExtractions: this.#fullSurfaceExtractions,
      partialSurfaceExtractions: this.#partialSurfaceExtractions,
      cachedSweeps: this.#completedSweepKeys.size,
      allocatedBytes:
        this.#bricks.size *
        this.#brickSizeDexels *
        this.#brickSizeDexels *
        Uint32Array.BYTES_PER_ELEMENT,
      memoryCapBytes: this.#memoryCapBytes,
      removedVolumeMm3: this.#removedVolumeMm3,
    };
  }

  #sweepKey(sweep: MillingSweep): string {
    const keyPart = (value: number) =>
      Object.is(value, -0) ? "0" : value.toString();
    return [
      sweep.startMm.xMm,
      sweep.startMm.yMm,
      sweep.startMm.zMm,
      sweep.endMm.xMm,
      sweep.endMm.yMm,
      sweep.endMm.zMm,
    ]
      .map(keyPart)
      .join("|");
  }

  #rememberSweep(sweepKey: string): void {
    this.#completedSweepKeys.add(sweepKey);
    if (
      this.#completedSweepKeys.size >
      MAX_COMPLETED_SWEEP_CACHE_ENTRIES
    ) {
      const oldest = this.#completedSweepKeys.values().next().value;
      if (oldest !== undefined) {
        this.#completedSweepKeys.delete(oldest);
      }
    }
  }

  #indexRange(
    minimumMm: number,
    maximumMm: number,
    axis: "x" | "y",
  ): { readonly minimum: number; readonly maximum: number } | null {
    const boundsMinimum =
      axis === "x" ? this.#bounds.minimum.xMm : this.#bounds.minimum.yMm;
    const count = axis === "x" ? this.#columns : this.#rows;
    const minimum = Math.max(
      0,
      Math.floor((minimumMm - boundsMinimum) / this.#resolutionMm),
    );
    const maximum = Math.min(
      count - 1,
      Math.floor((maximumMm - boundsMinimum) / this.#resolutionMm),
    );
    return minimum > maximum ? null : { minimum, maximum };
  }

  #gridIndex(xMm: number, yMm: number): GridIndex | null {
    finite(xMm, "xMm");
    finite(yMm, "yMm");
    if (
      xMm < this.#bounds.minimum.xMm ||
      xMm > this.#bounds.maximum.xMm ||
      yMm < this.#bounds.minimum.yMm ||
      yMm > this.#bounds.maximum.yMm
    ) {
      return null;
    }
    return {
      column: Math.min(
        this.#columns - 1,
        Math.floor((xMm - this.#bounds.minimum.xMm) / this.#resolutionMm),
      ),
      row: Math.min(
        this.#rows - 1,
        Math.floor((yMm - this.#bounds.minimum.yMm) / this.#resolutionMm),
      ),
    };
  }

  #requiredGridIndex(xMm: number, yMm: number, label: string): GridIndex {
    const index = this.#gridIndex(xMm, yMm);
    if (index === null) {
      throw new MillingInputError(
        "material-removal.measurement.outside-stock",
        `${label} must lie inside the stock XY bounds.`,
      );
    }
    return index;
  }

  #brickLocation(column: number, row: number) {
    const brickX = Math.floor(column / this.#brickSizeDexels);
    const brickY = Math.floor(row / this.#brickSizeDexels);
    const localColumn = column % this.#brickSizeDexels;
    const localRow = row % this.#brickSizeDexels;
    return {
      brickX,
      brickY,
      key: brickKey(brickX, brickY),
      localIndex: localRow * this.#brickSizeDexels + localColumn,
    };
  }

  #allocateBrick(brickX: number, brickY: number): SparseBrick {
    const nextAllocatedBytes =
      (this.#bricks.size + 1) *
      this.#brickSizeDexels *
      this.#brickSizeDexels *
      Uint32Array.BYTES_PER_ELEMENT;
    if (nextAllocatedBytes > this.#memoryCapBytes) {
      throw new MillingInputError(
        "material-removal.memory-cap.exceeded",
        "Sparse stock allocation would exceed the configured memory cap.",
      );
    }
    const brick: SparseBrick = {
      brickX,
      brickY,
      removedDepthLayers: new Uint32Array(
        this.#brickSizeDexels * this.#brickSizeDexels,
      ),
      dirtyLocalIndices: new Set<number>(),
    };
    this.#bricks.set(brickKey(brickX, brickY), brick);
    return brick;
  }

  #depthLayers(column: number, row: number): number {
    const location = this.#brickLocation(column, row);
    return this.#bricks.get(location.key)?.removedDepthLayers[
      location.localIndex
    ] ?? 0;
  }

  #depthMm(layers: number): number {
    return Math.min(
      this.#bounds.maximum.zMm - this.#bounds.minimum.zMm,
      layers * this.#resolutionMm,
    );
  }

  #topZMm(column: number, row: number): number {
    return normalizedZero(
      this.#bounds.maximum.zMm -
        this.#depthMm(this.#depthLayers(column, row)),
    );
  }

  #cellCenter(index: number, axis: "x" | "y"): number {
    const minimum =
      axis === "x" ? this.#bounds.minimum.xMm : this.#bounds.minimum.yMm;
    const maximum =
      axis === "x" ? this.#bounds.maximum.xMm : this.#bounds.maximum.yMm;
    const start = minimum + index * this.#resolutionMm;
    const end = Math.min(maximum, start + this.#resolutionMm);
    return (start + end) / 2;
  }

  #cellWidth(column: number): number {
    return Math.min(
      this.#resolutionMm,
      this.#bounds.maximum.xMm -
        (this.#bounds.minimum.xMm + column * this.#resolutionMm),
    );
  }

  #cellHeight(row: number): number {
    return Math.min(
      this.#resolutionMm,
      this.#bounds.maximum.yMm -
        (this.#bounds.minimum.yMm + row * this.#resolutionMm),
    );
  }

  #isSolidAt(column: number, row: number, zMm: number): boolean {
    return (
      zMm >= this.#bounds.minimum.zMm - NUMERIC_EPSILON &&
      zMm <= this.#topZMm(column, row) + NUMERIC_EPSILON
    );
  }
}

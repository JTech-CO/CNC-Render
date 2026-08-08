import {
  semanticHash,
  type JsonValue,
  type Stock,
  type ToolAssembly,
} from "@cnc-render/contracts";

const NUMERIC_EPSILON = 1e-9;
const DEFAULT_MEMORY_CAP_BYTES = 64 * 1024 * 1024;

export const TURNING_PRESET_RESOLUTION_MULTIPLIER = {
  preview: 2,
  balanced: 1,
  precision: 0.5,
} as const;

export type TurningQualityPreset =
  keyof typeof TURNING_PRESET_RESOLUTION_MULTIPLIER;
export type TurningOuterOperation =
  | "od-turning"
  | "taper"
  | "groove"
  | "parting";

export interface TurningOuterCut {
  readonly operation: TurningOuterOperation;
  readonly startZMm: number;
  readonly endZMm: number;
  readonly startOuterRadiusMm: number;
  readonly endOuterRadiusMm: number;
}

export interface TurningFacingCut {
  readonly operation: "facing";
  readonly faceZMm: number;
  readonly freeEnd: "negative-z" | "positive-z";
}

export interface TurningInnerCut {
  readonly operation: "drilling" | "boring";
  readonly startZMm: number;
  readonly endZMm: number;
  readonly startInnerRadiusMm: number;
  readonly endInnerRadiusMm: number;
}

export type TurningCut = TurningFacingCut | TurningInnerCut | TurningOuterCut;

export interface TurningMaterialRemovalOptions {
  readonly stock: Stock;
  readonly tool: ToolAssembly;
  readonly preset: TurningQualityPreset;
  readonly seed: number;
  readonly machineMaxSpindleSpeedRpm: number;
  readonly chuckGripLengthMm: number;
  readonly memoryCapBytes?: number;
}

export interface TurningCutResult {
  readonly revision: number;
  readonly updatedCells: number;
  readonly removedVolumeDeltaMm3: number;
  readonly removedVolumeMm3: number;
}

export interface TurningProfileSample {
  readonly cellIndex: number;
  readonly centerZMm: number;
  readonly innerRadiusMm: number;
  readonly outerRadiusMm: number;
  readonly representationResolutionMm: number;
}

export interface TurningMeasurement {
  readonly valueMm: number;
  readonly representationResolutionMm: number;
}

export interface TurningProfileSurfaceDescriptor {
  readonly axisCenterMm: { readonly xMm: number; readonly yMm: number };
  readonly minimumZMm: number;
  readonly maximumZMm: number;
  readonly axialCells: number;
  readonly radialSegments: number;
  readonly resolutionMm: number;
  readonly innerRadiusMm: Float32Array;
  readonly outerRadiusMm: Float32Array;
}

export interface TurningProfileSurfacePatch {
  readonly revision: number;
  readonly cellIndices: Uint32Array;
  readonly innerRadiusMm: Float32Array;
  readonly outerRadiusMm: Float32Array;
}

export interface TurningProfileSnapshot {
  readonly profileVersion: 1;
  readonly representation: "lathe-radius-field";
  readonly seed: number;
  readonly preset: TurningQualityPreset;
  readonly resolutionMm: number;
  readonly axisCenterMm: { readonly xMm: number; readonly yMm: number };
  readonly minimumZMm: number;
  readonly maximumZMm: number;
  readonly initialRadiusMm: number;
  readonly axialCells: number;
  readonly outerRadiusLayers: readonly number[];
  readonly innerRadiusLayers: readonly number[];
  readonly revision: number;
}

export interface TurningMaterialRemovalDiagnostics {
  readonly representation: "lathe-radius-field";
  readonly preset: TurningQualityPreset;
  readonly resolutionMm: number;
  readonly axialCells: number;
  readonly revision: number;
  readonly dirtyCells: number;
  readonly totalUpdatedCells: number;
  readonly lastUpdatedCells: number;
  readonly fullSurfaceExtractions: number;
  readonly partialSurfaceExtractions: number;
  readonly allocatedBytes: number;
  readonly memoryCapBytes: number;
  readonly removedVolumeMm3: number;
}

export interface LatheSpindleCommand {
  readonly mode: "rpm" | "surface-speed";
  readonly commandedValue: number;
  readonly diameterMm: number;
  readonly machineMaxSpindleSpeedRpm: number;
  readonly toolMaxSpindleSpeedRpm?: number;
}

export interface LatheSpindleSpeedResult {
  readonly mode: LatheSpindleCommand["mode"];
  readonly requestedRpm: number;
  readonly effectiveRpm: number;
  readonly maximumRpm: number;
  readonly clamped: boolean;
  readonly effectiveSurfaceSpeedMPerMin: number;
}

export interface TurningToolPose {
  readonly xMm: number;
  readonly zMm: number;
}

export interface TurningRestrictedZoneCollision {
  readonly code:
    | "turning.collision.axis-opposite-side"
    | "turning.collision.chuck";
  readonly kind: "axis-opposite-side" | "chuck";
  readonly positionMm: {
    readonly xMm: number;
    readonly yMm: number;
    readonly zMm: number;
  };
}

export class TurningInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TurningInputError";
    this.code = code;
  }
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new TurningInputError(
      "turning.input.nonfinite",
      `${label} must be a finite number.`,
    );
  }
  return value;
}

function positive(value: number, label: string): number {
  const checked = finite(value, label);
  if (checked <= 0) {
    throw new TurningInputError(
      "turning.input.non-positive",
      `${label} must be positive.`,
    );
  }
  return checked;
}

function normalizedZero(value: number): number {
  return value === 0 ? 0 : value;
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= NUMERIC_EPSILON;
}

export function resolveLatheSpindleSpeed(
  command: LatheSpindleCommand,
): LatheSpindleSpeedResult {
  const commandedValue = positive(command.commandedValue, "commandedValue");
  const diameterMm = positive(command.diameterMm, "diameterMm");
  const machineMaximum = positive(
    command.machineMaxSpindleSpeedRpm,
    "machineMaxSpindleSpeedRpm",
  );
  const toolMaximum =
    command.toolMaxSpindleSpeedRpm === undefined
      ? machineMaximum
      : positive(command.toolMaxSpindleSpeedRpm, "toolMaxSpindleSpeedRpm");
  const maximumRpm = Math.min(machineMaximum, toolMaximum);
  const requestedRpm =
    command.mode === "surface-speed"
      ? (1_000 * commandedValue) / (Math.PI * diameterMm)
      : commandedValue;
  const effectiveRpm = Math.min(requestedRpm, maximumRpm);
  return {
    mode: command.mode,
    requestedRpm: normalizedZero(requestedRpm),
    effectiveRpm: normalizedZero(effectiveRpm),
    maximumRpm,
    clamped: requestedRpm > maximumRpm,
    effectiveSurfaceSpeedMPerMin:
      (Math.PI * diameterMm * effectiveRpm) / 1_000,
  };
}

export class LatheRadiusFieldEngine {
  readonly #preset: TurningQualityPreset;
  readonly #seed: number;
  readonly #resolutionMm: number;
  readonly #axialCells: number;
  readonly #initialRadiusMm: number;
  readonly #maximumRadiusLayers: number;
  readonly #axisCenterMm: TurningProfileSnapshot["axisCenterMm"];
  readonly #minimumZMm: number;
  readonly #maximumZMm: number;
  readonly #tool: ToolAssembly;
  readonly #machineMaxSpindleSpeedRpm: number;
  readonly #chuckGripLengthMm: number;
  readonly #memoryCapBytes: number;
  readonly #outerRadiusLayers: Uint32Array;
  readonly #innerRadiusLayers: Uint32Array;
  readonly #dirtyCellIndices = new Set<number>();
  #revision = 0;
  #totalUpdatedCells = 0;
  #lastUpdatedCells = 0;
  #fullSurfaceExtractions = 0;
  #partialSurfaceExtractions = 0;
  #removedVolumeMm3 = 0;

  constructor(options: TurningMaterialRemovalOptions) {
    const {
      stock,
      tool,
      preset,
      seed,
      machineMaxSpindleSpeedRpm,
      chuckGripLengthMm,
      memoryCapBytes = DEFAULT_MEMORY_CAP_BYTES,
    } = options;
    if (stock.geometry.primitiveType !== "cylinder") {
      throw new TurningInputError(
        "turning.stock.geometry-unsupported",
        "M6 turning material removal supports cylinder Stock only.",
      );
    }
    const rotation = stock.transform.rotationRad;
    for (const value of [rotation.xRad, rotation.yRad, rotation.zRad]) {
      finite(value, "stock.rotation");
      if (Math.abs(value) > NUMERIC_EPSILON) {
        throw new TurningInputError(
          "turning.stock.rotation-unsupported",
          "M6 radius fields require an unrotated canonical Z-axis cylinder.",
        );
      }
    }
    if (
      tool.toolType !== "turning-tool" &&
      tool.toolType !== "boring-bar" &&
      tool.toolType !== "drill"
    ) {
      throw new TurningInputError(
        "turning.tool.type-unsupported",
        "M6 accepts a turning tool, boring bar, or drill.",
      );
    }
    if (
      (tool.toolType === "drill" &&
        tool.cutterGeometry.geometryType !== "drill") ||
      (tool.toolType !== "drill" &&
        tool.cutterGeometry.geometryType !== "turning-insert")
    ) {
      throw new TurningInputError(
        "turning.tool.geometry-unsupported",
        "Tool type and cutter geometry are incompatible for M6 turning.",
      );
    }
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      throw new TurningInputError(
        "turning.seed.invalid",
        "seed must be an unsigned 32-bit integer.",
      );
    }
    if (!Number.isSafeInteger(memoryCapBytes) || memoryCapBytes <= 0) {
      throw new TurningInputError(
        "turning.memory-cap.invalid",
        "memoryCapBytes must be a positive safe integer.",
      );
    }
    const diameterMm = positive(
      stock.geometry.diameterMm,
      "stock.geometry.diameterMm",
    );
    const lengthMm = positive(
      stock.geometry.lengthMm,
      "stock.geometry.lengthMm",
    );
    const resolutionMm =
      positive(stock.resolutionMm, "stock.resolutionMm") *
      TURNING_PRESET_RESOLUTION_MULTIPLIER[preset];
    const axialCells = Math.ceil(lengthMm / resolutionMm);
    const initialRadiusMm = diameterMm / 2;
    const maximumRadiusLayers = Math.ceil(initialRadiusMm / resolutionMm);
    const allocatedBytes = axialCells * Uint32Array.BYTES_PER_ELEMENT * 2;
    if (
      !Number.isSafeInteger(axialCells) ||
      axialCells <= 0 ||
      axialCells > 0xffff_ffff ||
      !Number.isSafeInteger(maximumRadiusLayers) ||
      maximumRadiusLayers > 0xffff_ffff ||
      allocatedBytes > memoryCapBytes
    ) {
      throw new TurningInputError(
        "turning.grid.invalid",
        "The radius field exceeds the configured Uint32 or memory limits.",
      );
    }
    const position = stock.transform.positionMm;
    finite(position.xMm, "stock.position.xMm");
    finite(position.yMm, "stock.position.yMm");
    finite(position.zMm, "stock.position.zMm");
    const chuckLength = finite(chuckGripLengthMm, "chuckGripLengthMm");
    if (chuckLength < 0 || chuckLength >= lengthMm) {
      throw new TurningInputError(
        "turning.chuck-grip.invalid",
        "chuckGripLengthMm must be non-negative and shorter than Stock.",
      );
    }

    this.#preset = preset;
    this.#seed = seed;
    this.#resolutionMm = resolutionMm;
    this.#axialCells = axialCells;
    this.#initialRadiusMm = initialRadiusMm;
    this.#maximumRadiusLayers = maximumRadiusLayers;
    this.#axisCenterMm = { xMm: position.xMm, yMm: position.yMm };
    this.#minimumZMm = normalizedZero(position.zMm - lengthMm / 2);
    this.#maximumZMm = normalizedZero(position.zMm + lengthMm / 2);
    this.#tool = tool;
    this.#machineMaxSpindleSpeedRpm = positive(
      machineMaxSpindleSpeedRpm,
      "machineMaxSpindleSpeedRpm",
    );
    this.#chuckGripLengthMm = chuckLength;
    this.#memoryCapBytes = memoryCapBytes;
    this.#outerRadiusLayers = new Uint32Array(axialCells);
    this.#outerRadiusLayers.fill(maximumRadiusLayers);
    this.#innerRadiusLayers = new Uint32Array(axialCells);
  }

  static restoreProfile(
    options: TurningMaterialRemovalOptions,
    snapshot: TurningProfileSnapshot,
  ): LatheRadiusFieldEngine {
    const engine = new LatheRadiusFieldEngine(options);
    engine.#restore(snapshot);
    return engine;
  }

  get resolutionMm(): number {
    return this.#resolutionMm;
  }

  get removedVolumeMm3(): number {
    return this.#removedVolumeMm3;
  }

  applyCut(cut: TurningCut): TurningCutResult {
    this.#validateToolForCut(cut);
    let updatedCells = 0;
    let removedVolumeDeltaMm3 = 0;
    for (let cellIndex = 0; cellIndex < this.#axialCells; cellIndex += 1) {
      const centerZMm = this.#cellCenterZMm(cellIndex);
      const previousOuter = this.#outerRadiusLayers[cellIndex];
      const previousInner = this.#innerRadiusLayers[cellIndex];
      let nextOuter = previousOuter;
      let nextInner = previousInner;
      if (cut.operation === "facing") {
        const faceZMm = finite(cut.faceZMm, "cut.faceZMm");
        if (
          (cut.freeEnd === "positive-z" && centerZMm >= faceZMm) ||
          (cut.freeEnd === "negative-z" && centerZMm <= faceZMm)
        ) {
          nextOuter = 0;
          nextInner = 0;
        }
      } else {
        this.#validateRange(cut.startZMm, cut.endZMm);
        if (
          centerZMm < cut.startZMm - NUMERIC_EPSILON ||
          centerZMm > cut.endZMm + NUMERIC_EPSILON
        ) {
          continue;
        }
        const ratio = close(cut.startZMm, cut.endZMm)
          ? 0
          : (centerZMm - cut.startZMm) / (cut.endZMm - cut.startZMm);
        if ("startInnerRadiusMm" in cut) {
          const start = this.#validateRadius(
            cut.startInnerRadiusMm,
            "cut.startInnerRadiusMm",
          );
          const end = this.#validateRadius(
            cut.endInnerRadiusMm,
            "cut.endInnerRadiusMm",
          );
          const target = start + (end - start) * ratio;
          const targetLayers = Math.min(
            previousOuter,
            Math.ceil(target / this.#resolutionMm - NUMERIC_EPSILON),
          );
          nextInner = Math.max(previousInner, targetLayers);
        } else {
          const start = this.#validateRadius(
            cut.startOuterRadiusMm,
            "cut.startOuterRadiusMm",
          );
          const end = this.#validateRadius(
            cut.endOuterRadiusMm,
            "cut.endOuterRadiusMm",
          );
          const target = start + (end - start) * ratio;
          const targetLayers = Math.min(
            this.#maximumRadiusLayers,
            Math.floor(target / this.#resolutionMm + NUMERIC_EPSILON),
          );
          nextOuter = Math.min(previousOuter, targetLayers);
          nextInner = Math.min(previousInner, nextOuter);
        }
      }
      if (nextOuter === previousOuter && nextInner === previousInner) {
        continue;
      }
      const beforeArea = this.#materialAreaMm2(previousOuter, previousInner);
      const afterArea = this.#materialAreaMm2(nextOuter, nextInner);
      if (afterArea > beforeArea + NUMERIC_EPSILON) {
        throw new TurningInputError(
          "turning.material.non-monotonic",
          "A turning cut must not increase Stock material.",
        );
      }
      this.#outerRadiusLayers[cellIndex] = nextOuter;
      this.#innerRadiusLayers[cellIndex] = nextInner;
      this.#dirtyCellIndices.add(cellIndex);
      updatedCells += 1;
      removedVolumeDeltaMm3 +=
        (beforeArea - afterArea) * this.#cellWidthMm(cellIndex);
    }
    if (updatedCells > 0) {
      this.#revision += 1;
      this.#totalUpdatedCells += updatedCells;
      this.#removedVolumeMm3 = normalizedZero(
        this.#removedVolumeMm3 + removedVolumeDeltaMm3,
      );
    }
    this.#lastUpdatedCells = updatedCells;
    return {
      revision: this.#revision,
      updatedCells,
      removedVolumeDeltaMm3: normalizedZero(removedVolumeDeltaMm3),
      removedVolumeMm3: this.#removedVolumeMm3,
    };
  }

  profileAt(zMm: number): TurningProfileSample {
    const cellIndex = this.#cellIndexAt(zMm);
    return {
      cellIndex,
      centerZMm: this.#cellCenterZMm(cellIndex),
      innerRadiusMm: this.#innerRadiusMm(cellIndex),
      outerRadiusMm: this.#outerRadiusMm(cellIndex),
      representationResolutionMm: this.#resolutionMm,
    };
  }

  measureOuterDiameter(zMm: number): TurningMeasurement {
    return {
      valueMm: this.profileAt(zMm).outerRadiusMm * 2,
      representationResolutionMm: this.#resolutionMm,
    };
  }

  measureInnerDiameter(zMm: number): TurningMeasurement {
    return {
      valueMm: this.profileAt(zMm).innerRadiusMm * 2,
      representationResolutionMm: this.#resolutionMm,
    };
  }

  measureMaterialLength(): TurningMeasurement {
    let first = -1;
    let last = -1;
    for (let index = 0; index < this.#axialCells; index += 1) {
      if (this.#outerRadiusMm(index) > this.#innerRadiusMm(index)) {
        first = first < 0 ? index : first;
        last = index;
      }
    }
    return {
      valueMm:
        first < 0
          ? 0
          : this.#cellEndZMm(last) - this.#cellStartZMm(first),
      representationResolutionMm: this.#resolutionMm,
    };
  }

  resolveSpindleSpeed(
    mode: LatheSpindleCommand["mode"],
    commandedValue: number,
    diameterMm: number,
  ): LatheSpindleSpeedResult {
    return resolveLatheSpindleSpeed({
      mode,
      commandedValue,
      diameterMm,
      machineMaxSpindleSpeedRpm: this.#machineMaxSpindleSpeedRpm,
      toolMaxSpindleSpeedRpm: this.#tool.maxSpindleSpeedRpm,
    });
  }

  detectRestrictedZoneCollision(
    pose: TurningToolPose,
  ): TurningRestrictedZoneCollision | null {
    const xMm = finite(pose.xMm, "pose.xMm");
    const zMm = finite(pose.zMm, "pose.zMm");
    if (zMm <= this.#minimumZMm + this.#chuckGripLengthMm) {
      return {
        code: "turning.collision.chuck",
        kind: "chuck",
        positionMm: { xMm, yMm: this.#axisCenterMm.yMm, zMm },
      };
    }
    if (xMm < this.#axisCenterMm.xMm - NUMERIC_EPSILON) {
      return {
        code: "turning.collision.axis-opposite-side",
        kind: "axis-opposite-side",
        positionMm: { xMm, yMm: this.#axisCenterMm.yMm, zMm },
      };
    }
    return null;
  }

  createFullSurfaceSnapshot(
    radialSegments = 32,
  ): TurningProfileSurfaceDescriptor {
    if (
      !Number.isSafeInteger(radialSegments) ||
      radialSegments < 8 ||
      radialSegments > 128
    ) {
      throw new TurningInputError(
        "turning.surface.radial-segments-invalid",
        "radialSegments must be an integer in 8..128.",
      );
    }
    const outerRadiusMm = new Float32Array(this.#axialCells);
    const innerRadiusMm = new Float32Array(this.#axialCells);
    for (let index = 0; index < this.#axialCells; index += 1) {
      outerRadiusMm[index] = this.#outerRadiusMm(index);
      innerRadiusMm[index] = this.#innerRadiusMm(index);
    }
    this.#fullSurfaceExtractions += 1;
    return {
      axisCenterMm: this.#axisCenterMm,
      minimumZMm: this.#minimumZMm,
      maximumZMm: this.#maximumZMm,
      axialCells: this.#axialCells,
      radialSegments,
      resolutionMm: this.#resolutionMm,
      innerRadiusMm,
      outerRadiusMm,
    };
  }

  drainDirtySurfacePatches(): readonly TurningProfileSurfacePatch[] {
    if (this.#dirtyCellIndices.size === 0) {
      return [];
    }
    const indices = [...this.#dirtyCellIndices].sort((left, right) => left - right);
    const outerRadiusMm = new Float32Array(indices.length);
    const innerRadiusMm = new Float32Array(indices.length);
    indices.forEach((cellIndex, outputIndex) => {
      outerRadiusMm[outputIndex] = this.#outerRadiusMm(cellIndex);
      innerRadiusMm[outputIndex] = this.#innerRadiusMm(cellIndex);
    });
    this.#dirtyCellIndices.clear();
    this.#partialSurfaceExtractions += 1;
    return [
      {
        revision: this.#revision,
        cellIndices: Uint32Array.from(indices),
        innerRadiusMm,
        outerRadiusMm,
      },
    ];
  }

  serializeProfile(): TurningProfileSnapshot {
    return {
      profileVersion: 1,
      representation: "lathe-radius-field",
      seed: this.#seed,
      preset: this.#preset,
      resolutionMm: this.#resolutionMm,
      axisCenterMm: this.#axisCenterMm,
      minimumZMm: this.#minimumZMm,
      maximumZMm: this.#maximumZMm,
      initialRadiusMm: this.#initialRadiusMm,
      axialCells: this.#axialCells,
      outerRadiusLayers: Array.from(this.#outerRadiusLayers),
      innerRadiusLayers: Array.from(this.#innerRadiusLayers),
      revision: this.#revision,
    };
  }

  async profileHashSha256(): Promise<string> {
    const manifest: JsonValue = {
      schema: "cnc-render.lathe-profile.v1",
      seed: this.#seed,
      preset: this.#preset,
      resolutionMm: this.#resolutionMm,
      axisCenterMm: this.#axisCenterMm,
      minimumZMm: this.#minimumZMm,
      maximumZMm: this.#maximumZMm,
      initialRadiusMm: this.#initialRadiusMm,
      axialCells: this.#axialCells,
      outerRadiusLayers: Array.from(this.#outerRadiusLayers),
      innerRadiusLayers: Array.from(this.#innerRadiusLayers),
    };
    return semanticHash(manifest);
  }

  getDiagnostics(): TurningMaterialRemovalDiagnostics {
    return {
      representation: "lathe-radius-field",
      preset: this.#preset,
      resolutionMm: this.#resolutionMm,
      axialCells: this.#axialCells,
      revision: this.#revision,
      dirtyCells: this.#dirtyCellIndices.size,
      totalUpdatedCells: this.#totalUpdatedCells,
      lastUpdatedCells: this.#lastUpdatedCells,
      fullSurfaceExtractions: this.#fullSurfaceExtractions,
      partialSurfaceExtractions: this.#partialSurfaceExtractions,
      allocatedBytes:
        this.#outerRadiusLayers.byteLength + this.#innerRadiusLayers.byteLength,
      memoryCapBytes: this.#memoryCapBytes,
      removedVolumeMm3: this.#removedVolumeMm3,
    };
  }

  #restore(snapshot: TurningProfileSnapshot): void {
    if (
      snapshot.profileVersion !== 1 ||
      snapshot.representation !== "lathe-radius-field" ||
      snapshot.seed !== this.#seed ||
      snapshot.preset !== this.#preset ||
      !close(snapshot.resolutionMm, this.#resolutionMm) ||
      !close(snapshot.axisCenterMm.xMm, this.#axisCenterMm.xMm) ||
      !close(snapshot.axisCenterMm.yMm, this.#axisCenterMm.yMm) ||
      !close(snapshot.minimumZMm, this.#minimumZMm) ||
      !close(snapshot.maximumZMm, this.#maximumZMm) ||
      !close(snapshot.initialRadiusMm, this.#initialRadiusMm) ||
      snapshot.axialCells !== this.#axialCells ||
      snapshot.outerRadiusLayers.length !== this.#axialCells ||
      snapshot.innerRadiusLayers.length !== this.#axialCells ||
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0
    ) {
      throw new TurningInputError(
        "turning.snapshot.contract-mismatch",
        "The saved profile does not match the configured radius field.",
      );
    }
    for (let index = 0; index < this.#axialCells; index += 1) {
      const outer = snapshot.outerRadiusLayers[index];
      const inner = snapshot.innerRadiusLayers[index];
      if (
        !Number.isSafeInteger(outer) ||
        !Number.isSafeInteger(inner) ||
        outer < 0 ||
        inner < 0 ||
        outer > this.#maximumRadiusLayers ||
        inner > outer
      ) {
        throw new TurningInputError(
          "turning.snapshot.layers-invalid",
          "Saved layers must satisfy 0 <= inner <= outer <= initial.",
        );
      }
      this.#outerRadiusLayers[index] = outer;
      this.#innerRadiusLayers[index] = inner;
    }
    this.#revision = snapshot.revision;
    this.#removedVolumeMm3 = this.#calculateRemovedVolumeMm3();
    this.#dirtyCellIndices.clear();
  }

  #validateToolForCut(cut: TurningCut): void {
    if (cut.operation === "drilling" && this.#tool.toolType !== "drill") {
      throw new TurningInputError(
        "turning.tool.operation-incompatible",
        "The drilling profile requires a drill.",
      );
    }
    if (cut.operation === "boring" && this.#tool.toolType !== "boring-bar") {
      throw new TurningInputError(
        "turning.tool.operation-incompatible",
        "The boring profile requires a boring bar.",
      );
    }
    if (
      cut.operation !== "drilling" &&
      cut.operation !== "boring" &&
      this.#tool.toolType !== "turning-tool"
    ) {
      throw new TurningInputError(
        "turning.tool.operation-incompatible",
        "External profiles require a turning tool.",
      );
    }
    if (
      cut.operation === "drilling" &&
      Math.max(cut.startInnerRadiusMm, cut.endInnerRadiusMm) * 2 >
        this.#tool.cutterGeometry.diameterMm + this.#resolutionMm
    ) {
      throw new TurningInputError(
        "turning.tool.drill-diameter-exceeded",
        "The requested hole exceeds the drill geometry.",
      );
    }
  }

  #validateRange(startZMm: number, endZMm: number): void {
    finite(startZMm, "cut.startZMm");
    finite(endZMm, "cut.endZMm");
    if (startZMm > endZMm) {
      throw new TurningInputError(
        "turning.cut.range-invalid",
        "Turning profile ranges require startZMm <= endZMm.",
      );
    }
  }

  #validateRadius(radiusMm: number, label: string): number {
    const radius = finite(radiusMm, label);
    if (radius < 0 || radius > this.#initialRadiusMm + NUMERIC_EPSILON) {
      throw new TurningInputError(
        "turning.cut.radius-invalid",
        `${label} must stay inside the initial Stock radius.`,
      );
    }
    return Math.min(radius, this.#initialRadiusMm);
  }

  #cellIndexAt(zMm: number): number {
    const coordinate = finite(zMm, "zMm");
    if (coordinate < this.#minimumZMm || coordinate > this.#maximumZMm) {
      throw new TurningInputError(
        "turning.measurement.outside-stock",
        "Profile measurement Z must be inside Stock bounds.",
      );
    }
    return Math.min(
      this.#axialCells - 1,
      Math.floor((coordinate - this.#minimumZMm) / this.#resolutionMm),
    );
  }

  #cellStartZMm(index: number): number {
    return this.#minimumZMm + index * this.#resolutionMm;
  }

  #cellEndZMm(index: number): number {
    return Math.min(
      this.#maximumZMm,
      this.#cellStartZMm(index) + this.#resolutionMm,
    );
  }

  #cellCenterZMm(index: number): number {
    return (this.#cellStartZMm(index) + this.#cellEndZMm(index)) / 2;
  }

  #cellWidthMm(index: number): number {
    return this.#cellEndZMm(index) - this.#cellStartZMm(index);
  }

  #outerRadiusMm(index: number): number {
    return Math.min(
      this.#initialRadiusMm,
      this.#outerRadiusLayers[index] * this.#resolutionMm,
    );
  }

  #innerRadiusMm(index: number): number {
    return Math.min(
      this.#outerRadiusMm(index),
      this.#innerRadiusLayers[index] * this.#resolutionMm,
    );
  }

  #materialAreaMm2(outerLayers: number, innerLayers: number): number {
    const outer = Math.min(
      this.#initialRadiusMm,
      outerLayers * this.#resolutionMm,
    );
    const inner = Math.min(outer, innerLayers * this.#resolutionMm);
    return Math.PI * (outer ** 2 - inner ** 2);
  }

  #calculateRemovedVolumeMm3(): number {
    let removed = 0;
    const initialArea = Math.PI * this.#initialRadiusMm ** 2;
    for (let index = 0; index < this.#axialCells; index += 1) {
      removed +=
        (initialArea -
          this.#materialAreaMm2(
            this.#outerRadiusLayers[index],
            this.#innerRadiusLayers[index],
          )) *
        this.#cellWidthMm(index);
    }
    return normalizedZero(removed);
  }
}

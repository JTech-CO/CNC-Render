import {
  MAX_PROJECT_JSON_DEPTH,
  SimulationCheckpointHeaderSchema,
  type JsonValue,
  type SimulationCheckpointHeader,
} from "@cnc-render/contracts";

import {
  canonicalJsonBytes,
  concatBytes,
  parseJsonBytes,
  sha256Hex,
} from "./bytes";
import { persistenceFailure } from "./errors";

const CHECKPOINT_MAGIC = new Uint8Array([
  0x43, 0x4e, 0x43, 0x52, 0x43, 0x50, 0x30, 0x31,
]);
const PREFIX_BYTE_LENGTH = CHECKPOINT_MAGIC.byteLength + 4;
const MAX_CHECKPOINT_METADATA_BYTES = 16 * 1024 * 1024;

export interface MillingCheckpointRender {
  readonly renderType: "milling-full";
  readonly boundsMm: {
    readonly minimum: {
      readonly xMm: number;
      readonly yMm: number;
      readonly zMm: number;
    };
    readonly maximum: {
      readonly xMm: number;
      readonly yMm: number;
      readonly zMm: number;
    };
  };
  readonly columns: number;
  readonly rows: number;
  readonly resolutionMm: number;
  readonly topZMm: Float32Array;
}

export interface TurningCheckpointRender {
  readonly renderType: "turning-full";
  readonly axisCenterMm: {
    readonly xMm: number;
    readonly yMm: number;
  };
  readonly minimumZMm: number;
  readonly maximumZMm: number;
  readonly axialCells: number;
  readonly radialSegments: number;
  readonly resolutionMm: number;
  readonly innerRadiusMm: Float32Array;
  readonly outerRadiusMm: Float32Array;
}

export type CheckpointRender =
  | MillingCheckpointRender
  | TurningCheckpointRender;

export type CheckpointHeaderInput = Omit<
  SimulationCheckpointHeader,
  "payloadKind" | "payloadByteLength" | "payloadSha256"
>;

export interface EncodedSimulationCheckpoint {
  readonly bytes: Uint8Array;
  readonly header: SimulationCheckpointHeader;
}

export interface DecodedSimulationCheckpoint {
  readonly header: SimulationCheckpointHeader;
  readonly render: CheckpointRender;
}

interface MillingRenderMetadata {
  readonly renderType: "milling-full";
  readonly boundsMm: MillingCheckpointRender["boundsMm"];
  readonly columns: number;
  readonly rows: number;
  readonly resolutionMm: number;
}

interface TurningRenderMetadata {
  readonly renderType: "turning-full";
  readonly axisCenterMm: TurningCheckpointRender["axisCenterMm"];
  readonly minimumZMm: number;
  readonly maximumZMm: number;
  readonly axialCells: number;
  readonly radialSegments: number;
  readonly resolutionMm: number;
}

interface CheckpointMetadata {
  readonly schemaVersion: 1;
  readonly header: SimulationCheckpointHeader;
  readonly render: MillingRenderMetadata | TurningRenderMetadata;
}

function float32Bytes(values: Float32Array): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const bytesView = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    bytesView.setFloat32(index * 4, values[index] ?? 0, true);
  }
  return bytes;
}

function float32Values(
  bytes: Uint8Array,
  byteOffset: number,
  length: number,
): Float32Array {
  const values = new Float32Array(length);
  const bytesView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    values[index] = bytesView.getFloat32(byteOffset + index * 4, true);
  }
  return values;
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw persistenceFailure(
      "storage.checkpoint.render-invalid",
      "checkpoint",
      `${label} must be finite`,
    );
  }
}

function positive(value: number, label: string): void {
  finite(value, label);
  if (value <= 0) {
    throw persistenceFailure(
      "storage.checkpoint.render-invalid",
      "checkpoint",
      `${label} must be positive`,
    );
  }
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw persistenceFailure(
      "storage.checkpoint.render-invalid",
      "checkpoint",
      `${label} must be a positive safe integer`,
    );
  }
}

function validatePoint3(
  point: MillingCheckpointRender["boundsMm"]["minimum"],
  label: string,
): void {
  finite(point.xMm, `${label}.xMm`);
  finite(point.yMm, `${label}.yMm`);
  finite(point.zMm, `${label}.zMm`);
}

function renderPayload(render: CheckpointRender): {
  readonly payload: Uint8Array;
  readonly metadata: MillingRenderMetadata | TurningRenderMetadata;
  readonly payloadKind: SimulationCheckpointHeader["payloadKind"];
} {
  if (render.renderType === "milling-full") {
    positiveInteger(render.columns, "columns");
    positiveInteger(render.rows, "rows");
    positive(render.resolutionMm, "resolutionMm");
    validatePoint3(render.boundsMm.minimum, "boundsMm.minimum");
    validatePoint3(render.boundsMm.maximum, "boundsMm.maximum");
    if (render.topZMm.length !== render.columns * render.rows) {
      throw persistenceFailure(
        "storage.checkpoint.render-length-mismatch",
        "checkpoint",
        "milling surface length must equal columns multiplied by rows",
      );
    }
    return {
      payload: float32Bytes(render.topZMm),
      metadata: {
        renderType: render.renderType,
        boundsMm: render.boundsMm,
        columns: render.columns,
        rows: render.rows,
        resolutionMm: render.resolutionMm,
      },
      payloadKind: "milling-surface",
    };
  }

  positiveInteger(render.axialCells, "axialCells");
  positiveInteger(render.radialSegments, "radialSegments");
  positive(render.resolutionMm, "resolutionMm");
  finite(render.axisCenterMm.xMm, "axisCenterMm.xMm");
  finite(render.axisCenterMm.yMm, "axisCenterMm.yMm");
  finite(render.minimumZMm, "minimumZMm");
  finite(render.maximumZMm, "maximumZMm");
  if (
    render.innerRadiusMm.length !== render.axialCells ||
    render.outerRadiusMm.length !== render.axialCells
  ) {
    throw persistenceFailure(
      "storage.checkpoint.render-length-mismatch",
      "checkpoint",
      "turning profile lengths must equal axialCells",
    );
  }
  return {
    payload: concatBytes([
      float32Bytes(render.innerRadiusMm),
      float32Bytes(render.outerRadiusMm),
    ]),
    metadata: {
      renderType: render.renderType,
      axisCenterMm: render.axisCenterMm,
      minimumZMm: render.minimumZMm,
      maximumZMm: render.maximumZMm,
      axialCells: render.axialCells,
      radialSegments: render.radialSegments,
      resolutionMm: render.resolutionMm,
    },
    payloadKind: "turning-profile",
  };
}

export async function encodeSimulationCheckpoint(
  headerInput: CheckpointHeaderInput,
  render: CheckpointRender,
): Promise<EncodedSimulationCheckpoint> {
  const encoded = renderPayload(render);
  const header: SimulationCheckpointHeader = {
    ...headerInput,
    payloadKind: encoded.payloadKind,
    payloadByteLength: encoded.payload.byteLength,
    payloadSha256: await sha256Hex(encoded.payload),
  };
  const headerResult = SimulationCheckpointHeaderSchema.safeParse(header);
  if (!headerResult.success) {
    throw persistenceFailure(
      "storage.checkpoint.header-invalid",
      "checkpoint",
      "simulation checkpoint header does not satisfy its contract",
      { cause: headerResult.error },
    );
  }
  const metadata: CheckpointMetadata = {
    schemaVersion: 1,
    header: headerResult.data,
    render: encoded.metadata,
  };
  const metadataBytes = canonicalJsonBytes(metadata as unknown as JsonValue);
  if (metadataBytes.byteLength > MAX_CHECKPOINT_METADATA_BYTES) {
    throw persistenceFailure(
      "storage.checkpoint.metadata-limit",
      "checkpoint",
      "simulation checkpoint metadata is too large",
    );
  }
  const prefix = new Uint8Array(PREFIX_BYTE_LENGTH);
  prefix.set(CHECKPOINT_MAGIC);
  new DataView(prefix.buffer).setUint32(
    CHECKPOINT_MAGIC.byteLength,
    metadataBytes.byteLength,
    true,
  );
  return {
    bytes: concatBytes([prefix, metadataBytes, encoded.payload]),
    header: headerResult.data,
  };
}

function isJsonRecord(
  value: JsonValue | undefined,
): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function metadataRecord(value: JsonValue): {
  readonly header: SimulationCheckpointHeader;
  readonly render: Record<string, JsonValue>;
} {
  if (
    !isJsonRecord(value) ||
    value.schemaVersion !== 1 ||
    !isJsonRecord(value.render)
  ) {
    throw persistenceFailure(
      "storage.checkpoint.metadata-invalid",
      "checkpoint",
      "simulation checkpoint metadata must be a v1 object",
    );
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "header,render,schemaVersion") {
    throw persistenceFailure(
      "storage.checkpoint.metadata-invalid",
      "checkpoint",
      "simulation checkpoint metadata contains unknown fields",
    );
  }
  const headerResult = SimulationCheckpointHeaderSchema.safeParse(value.header);
  if (!headerResult.success) {
    throw persistenceFailure(
      "storage.checkpoint.header-invalid",
      "checkpoint",
      "simulation checkpoint header does not satisfy its contract",
      { cause: headerResult.error },
    );
  }
  return {
    header: headerResult.data,
    render: value.render,
  };
}

function readNumber(
  record: Record<string, JsonValue>,
  key: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw persistenceFailure(
      "storage.checkpoint.render-invalid",
      "checkpoint",
      `checkpoint render field ${key} must be finite`,
    );
  }
  return value;
}

function readPositiveInteger(
  record: Record<string, JsonValue>,
  key: string,
): number {
  const value = readNumber(record, key);
  positiveInteger(value, key);
  return value;
}

function readPoint(
  value: JsonValue | undefined,
  dimensions: readonly string[],
  label: string,
): Record<string, number> {
  if (!isJsonRecord(value)) {
    throw persistenceFailure(
      "storage.checkpoint.render-invalid",
      "checkpoint",
      `${label} must be an object`,
    );
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== [...dimensions].sort().join(",")) {
    throw persistenceFailure(
      "storage.checkpoint.render-invalid",
      "checkpoint",
      `${label} dimensions are invalid`,
    );
  }
  return Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      readNumber(value, dimension),
    ]),
  );
}

function decodeRender(
  metadata: ReturnType<typeof metadataRecord>,
  payload: Uint8Array,
): CheckpointRender {
  const renderType = metadata.render.renderType;
  if (
    renderType === "milling-full" &&
    metadata.header.payloadKind === "milling-surface"
  ) {
    const columns = readPositiveInteger(metadata.render, "columns");
    const rows = readPositiveInteger(metadata.render, "rows");
    const resolutionMm = readNumber(metadata.render, "resolutionMm");
    positive(resolutionMm, "resolutionMm");
    const bounds = metadata.render.boundsMm;
    if (!isJsonRecord(bounds)) {
      throw persistenceFailure(
        "storage.checkpoint.render-invalid",
        "checkpoint",
        "milling boundsMm must be an object",
      );
    }
    const boundsKeys = Object.keys(bounds).sort();
    if (boundsKeys.join(",") !== "maximum,minimum") {
      throw persistenceFailure(
        "storage.checkpoint.render-invalid",
        "checkpoint",
        "milling boundsMm fields are invalid",
      );
    }
    if (payload.byteLength !== columns * rows * 4) {
      throw persistenceFailure(
        "storage.checkpoint.render-length-mismatch",
        "checkpoint",
        "milling checkpoint payload length is invalid",
      );
    }
    const minimum = readPoint(
      bounds.minimum,
      ["xMm", "yMm", "zMm"],
      "boundsMm.minimum",
    );
    const maximum = readPoint(
      bounds.maximum,
      ["xMm", "yMm", "zMm"],
      "boundsMm.maximum",
    );
    return {
      renderType,
      boundsMm: {
        minimum: {
          xMm: minimum.xMm ?? 0,
          yMm: minimum.yMm ?? 0,
          zMm: minimum.zMm ?? 0,
        },
        maximum: {
          xMm: maximum.xMm ?? 0,
          yMm: maximum.yMm ?? 0,
          zMm: maximum.zMm ?? 0,
        },
      },
      columns,
      rows,
      resolutionMm,
      topZMm: float32Values(payload, 0, columns * rows),
    };
  }
  if (
    renderType === "turning-full" &&
    metadata.header.payloadKind === "turning-profile"
  ) {
    const axialCells = readPositiveInteger(metadata.render, "axialCells");
    const radialSegments = readPositiveInteger(
      metadata.render,
      "radialSegments",
    );
    const resolutionMm = readNumber(metadata.render, "resolutionMm");
    positive(resolutionMm, "resolutionMm");
    const minimumZMm = readNumber(metadata.render, "minimumZMm");
    const maximumZMm = readNumber(metadata.render, "maximumZMm");
    const center = readPoint(
      metadata.render.axisCenterMm,
      ["xMm", "yMm"],
      "axisCenterMm",
    );
    if (payload.byteLength !== axialCells * 8) {
      throw persistenceFailure(
        "storage.checkpoint.render-length-mismatch",
        "checkpoint",
        "turning checkpoint payload length is invalid",
      );
    }
    return {
      renderType,
      axisCenterMm: {
        xMm: center.xMm ?? 0,
        yMm: center.yMm ?? 0,
      },
      minimumZMm,
      maximumZMm,
      axialCells,
      radialSegments,
      resolutionMm,
      innerRadiusMm: float32Values(payload, 0, axialCells),
      outerRadiusMm: float32Values(payload, axialCells * 4, axialCells),
    };
  }
  throw persistenceFailure(
    "storage.checkpoint.render-kind-mismatch",
    "checkpoint",
    "checkpoint render type and payload kind do not match",
  );
}

export async function decodeSimulationCheckpoint(
  bytes: Uint8Array,
): Promise<DecodedSimulationCheckpoint> {
  if (bytes.byteLength < PREFIX_BYTE_LENGTH) {
    throw persistenceFailure(
      "storage.checkpoint.truncated",
      "checkpoint",
      "simulation checkpoint is truncated",
    );
  }
  for (let index = 0; index < CHECKPOINT_MAGIC.byteLength; index += 1) {
    if (bytes[index] !== CHECKPOINT_MAGIC[index]) {
      throw persistenceFailure(
        "storage.checkpoint.magic-invalid",
        "checkpoint",
        "simulation checkpoint magic is invalid",
      );
    }
  }
  const metadataByteLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(CHECKPOINT_MAGIC.byteLength, true);
  if (
    metadataByteLength === 0 ||
    metadataByteLength > MAX_CHECKPOINT_METADATA_BYTES ||
    PREFIX_BYTE_LENGTH + metadataByteLength > bytes.byteLength
  ) {
    throw persistenceFailure(
      "storage.checkpoint.metadata-length-invalid",
      "checkpoint",
      "simulation checkpoint metadata length is invalid",
    );
  }
  const metadata = metadataRecord(
    parseJsonBytes(
      bytes.subarray(
        PREFIX_BYTE_LENGTH,
        PREFIX_BYTE_LENGTH + metadataByteLength,
      ),
      "checkpoint",
      MAX_PROJECT_JSON_DEPTH,
    ),
  );
  const payload = bytes.subarray(PREFIX_BYTE_LENGTH + metadataByteLength);
  if (
    payload.byteLength !== metadata.header.payloadByteLength ||
    (await sha256Hex(payload)) !== metadata.header.payloadSha256
  ) {
    throw persistenceFailure(
      "storage.checkpoint.payload-hash-mismatch",
      "checkpoint",
      "simulation checkpoint payload is corrupt",
    );
  }
  return {
    header: metadata.header,
    render: decodeRender(metadata, payload),
  };
}

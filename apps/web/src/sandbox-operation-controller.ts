import {
  OperationSchema,
  UtcDateTimeSchema,
  UuidSchema,
  canonicalJson,
  type JsonValue,
  type Operation,
} from "@cnc-render/contracts";

export const SANDBOX_OPERATION_JOURNAL_SCHEMA_VERSION = 1 as const;
export const SANDBOX_OPERATION_HISTORY_LIMIT = 50 as const;
export const SANDBOX_FACE_MILLING_PRESET_ID = "sandbox.face-milling.e2" as const;
export const SANDBOX_FACE_MILLING_ENTITY_IDS = Object.freeze({
  projectId: "83000000-0000-4000-8000-000000000001",
  machineId: "83000000-0000-4000-8000-000000000002",
  materialId: "83000000-0000-4000-8000-000000000005",
  setupId: "83000000-0000-4000-8000-000000000006",
  toolAssemblyId: "83000000-0000-4000-8000-000000000007",
  standardStockId: "83000000-0000-4000-8000-000000000008",
  compactStockId: "83000000-0000-4000-8000-00000000000d",
} as const);

export type SandboxMillingStockPreset = "standard" | "compact";
export type SandboxMillingCutDirection = "x" | "y";
export interface SandboxMillingConfiguration {
  readonly stockPreset: SandboxMillingStockPreset;
  readonly cutDirection: SandboxMillingCutDirection;
}
export interface SandboxOperationDocument {
  readonly presetId: typeof SANDBOX_FACE_MILLING_PRESET_ID;
  readonly operation: Operation;
  readonly configuration: SandboxMillingConfiguration;
}
export interface SandboxOperationControllerPorts {
  readonly createUuid: () => string;
  readonly nowUtc: () => string;
}
export interface SandboxOperationCreateInput {
  readonly name?: string;
  readonly stockPreset?: SandboxMillingStockPreset;
  readonly cutDirection?: SandboxMillingCutDirection;
}
export interface SandboxOperationEdit {
  readonly name?: string;
  readonly setupId?: string;
  readonly toolAssemblyId?: string;
  readonly stockPreset?: SandboxMillingStockPreset;
  readonly cutDirection?: SandboxMillingCutDirection;
  readonly feedMmPerMin?: number;
  readonly spindleSpeedRpm?: number;
  readonly spindleDirection?: "clockwise" | "counterclockwise";
  readonly depthOfCutMm?: number;
  readonly widthOfCutMm?: number;
}
export interface SandboxOperationRevision {
  readonly sequence: number;
  readonly committedAt: string;
  readonly operation: Operation;
  readonly configuration: SandboxMillingConfiguration;
}
export interface SandboxOperationJournal {
  readonly schemaVersion: 1;
  readonly presetId: typeof SANDBOX_FACE_MILLING_PRESET_ID;
  readonly projectId: string;
  readonly cursor: number;
  readonly revisions: readonly SandboxOperationRevision[];
}
export interface SandboxOperationSnapshot {
  readonly status: "empty" | "ready";
  readonly presetId: typeof SANDBOX_FACE_MILLING_PRESET_ID;
  readonly projectId: string;
  readonly revision: number | null;
  readonly committedAt: string | null;
  readonly operation: Operation | null;
  readonly configuration: SandboxMillingConfiguration | null;
  readonly dirty: boolean;
  readonly canCommit: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly retainedRevisionCount: number;
}
export interface SandboxMillingRunParameters {
  readonly fixture: "milling";
  readonly projectId: string;
  readonly machineId: string;
  readonly materialId: string;
  readonly stockId: string;
  readonly setupId: string;
  readonly toolAssemblyId: string;
  readonly operationId: string;
  readonly millingConfiguration: SandboxMillingConfiguration;
  readonly feedMmPerMin: number;
  readonly spindleSpeedRpm: number;
  readonly depthOfCutMm: number;
  readonly widthOfCutMm: number;
}
export type SandboxOperationControllerErrorCode =
  | "sandbox.operation.already-created"
  | "sandbox.operation.not-created"
  | "sandbox.operation.invalid"
  | "sandbox.operation.draft-uncommitted"
  | "sandbox.operation.journal-invalid";

export class SandboxOperationControllerError extends Error {
  constructor(
    readonly code: SandboxOperationControllerErrorCode,
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(message);
    this.name = "SandboxOperationControllerError";
    this.issues = Object.freeze([...issues]);
  }
}

const LIMITS = {
  feedMmPerMin: 12_000,
  spindleSpeedRpm: 12_000,
  depthOfCutMm: 5,
  widthOfCutMm: 20,
} as const;
const DEFAULT_CONFIGURATION: SandboxMillingConfiguration = {
  stockPreset: "standard",
  cutDirection: "x",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join("|") === expected.sort().join("|");
}
function cloneOperation(operation: Operation): Operation {
  return { ...operation, feed: { ...operation.feed } };
}
function freezeOperation(operation: Operation): Operation {
  const clone = cloneOperation(operation);
  Object.freeze(clone.feed);
  return Object.freeze(clone);
}
function freezeConfiguration(
  configuration: SandboxMillingConfiguration,
): SandboxMillingConfiguration {
  return Object.freeze({ ...configuration });
}
function freezeDocument(
  document: SandboxOperationDocument,
): SandboxOperationDocument {
  return Object.freeze({
    presetId: SANDBOX_FACE_MILLING_PRESET_ID,
    operation: freezeOperation(document.operation),
    configuration: freezeConfiguration(document.configuration),
  });
}
function strategyFor(direction: SandboxMillingCutDirection): string {
  return "face-zig-zag-" + direction;
}
function positiveWithin(value: number, limit: number): boolean {
  return (
    Number.isFinite(value) &&
    !Object.is(value, -0) &&
    value > 0 &&
    value <= limit
  );
}
function portValue(
  schema: { safeParse(value: unknown): { success: boolean } },
  value: string,
  label: string,
): string {
  if (!schema.safeParse(value).success) {
    throw new SandboxOperationControllerError(
      "sandbox.operation.invalid",
      label + " returned an invalid value.",
    );
  }
  return value;
}

function validateDocument(
  document: SandboxOperationDocument,
): SandboxOperationDocument {
  const parsed = OperationSchema.safeParse(document.operation);
  const issues: string[] = [];
  if (!parsed.success) {
    issues.push("operation must satisfy the strict Operation schema");
  } else {
    const operation = parsed.data;
    if (operation.operationType !== "milling") {
      issues.push("operationType must be milling");
    }
    if (operation.setupId !== SANDBOX_FACE_MILLING_ENTITY_IDS.setupId) {
      issues.push("setupId must reference the face-milling setup");
    }
    if (
      operation.toolAssemblyId !==
      SANDBOX_FACE_MILLING_ENTITY_IDS.toolAssemblyId
    ) {
      issues.push("toolAssemblyId must reference the 20 mm face mill");
    }
    if (
      operation.strategy !== strategyFor(document.configuration.cutDirection)
    ) {
      issues.push("strategy must match cutDirection");
    }
    if (
      operation.feed.mode !== "per-minute" ||
      !positiveWithin(operation.feed.feedMmPerMin, LIMITS.feedMmPerMin)
    ) {
      issues.push("feedMmPerMin must be finite and within 0..12000 mm/min");
    }
    for (const field of ["spindleSpeedRpm", "widthOfCutMm"] as const) {
      if (!positiveWithin(operation[field], LIMITS[field])) {
        issues.push(field + " is outside the E2 preset limit");
      }
    }
    if (
      !positiveWithin(operation.depthOfCutMm, LIMITS.depthOfCutMm) ||
      operation.depthOfCutMm < 4
    ) {
      issues.push(
        "depthOfCutMm must be finite and within 4..5 mm for the E2 8 mm grid",
      );
    }
    if (operation.spindleDirection !== "clockwise") {
      issues.push("the E2 preset requires clockwise spindle motion");
    }
    if (
      operation.targetGeometryResourceId !== null ||
      operation.generatedToolpathId !== null
    ) {
      issues.push("preset-generated resource references must remain null");
    }
  }
  if (
    document.configuration.stockPreset !== "standard" &&
    document.configuration.stockPreset !== "compact"
  ) {
    issues.push("stockPreset must be standard or compact");
  }
  if (
    document.configuration.cutDirection !== "x" &&
    document.configuration.cutDirection !== "y"
  ) {
    issues.push("cutDirection must be x or y");
  }
  if (issues.length > 0) {
    throw new SandboxOperationControllerError(
      "sandbox.operation.invalid",
      "Sandbox operation does not satisfy the E2 face-milling contract.",
      issues,
    );
  }
  return freezeDocument(document);
}

function freezeRevision(
  revision: SandboxOperationRevision,
): SandboxOperationRevision {
  return Object.freeze({
    sequence: revision.sequence,
    committedAt: revision.committedAt,
    operation: freezeOperation(revision.operation),
    configuration: freezeConfiguration(revision.configuration),
  });
}
function documentFromRevision(
  revision: SandboxOperationRevision,
): SandboxOperationDocument {
  return freezeDocument({
    presetId: SANDBOX_FACE_MILLING_PRESET_ID,
    operation: revision.operation,
    configuration: revision.configuration,
  });
}
function sameDocument(
  left: SandboxOperationDocument,
  right: SandboxOperationDocument,
): boolean {
  return (
    canonicalJson(left as unknown as JsonValue) ===
    canonicalJson(right as unknown as JsonValue)
  );
}
function parseConfiguration(value: unknown): SandboxMillingConfiguration {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["stockPreset", "cutDirection"]) ||
    (value.stockPreset !== "standard" && value.stockPreset !== "compact") ||
    (value.cutDirection !== "x" && value.cutDirection !== "y")
  ) {
    throw new Error("configuration is invalid");
  }
  return {
    stockPreset: value.stockPreset,
    cutDirection: value.cutDirection,
  };
}
function parseRevision(value: unknown): SandboxOperationRevision {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "sequence",
      "committedAt",
      "operation",
      "configuration",
    ]) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) <= 0 ||
    !UtcDateTimeSchema.safeParse(value.committedAt).success
  ) {
    throw new Error("revision metadata is invalid");
  }
  const operation = OperationSchema.safeParse(value.operation);
  if (!operation.success) throw new Error("revision operation is invalid");
  const document = validateDocument({
    presetId: SANDBOX_FACE_MILLING_PRESET_ID,
    operation: operation.data,
    configuration: parseConfiguration(value.configuration),
  });
  return freezeRevision({
    sequence: value.sequence as number,
    committedAt: value.committedAt as string,
    operation: document.operation,
    configuration: document.configuration,
  });
}

export function parseSandboxOperationJournal(
  input: string | unknown,
): SandboxOperationJournal {
  try {
    const value = typeof input === "string" ? JSON.parse(input) : input;
    if (
      !isRecord(value) ||
      !exactKeys(value, [
        "schemaVersion",
        "presetId",
        "projectId",
        "cursor",
        "revisions",
      ]) ||
      value.schemaVersion !== SANDBOX_OPERATION_JOURNAL_SCHEMA_VERSION ||
      value.presetId !== SANDBOX_FACE_MILLING_PRESET_ID ||
      value.projectId !== SANDBOX_FACE_MILLING_ENTITY_IDS.projectId ||
      !Array.isArray(value.revisions) ||
      value.revisions.length === 0 ||
      value.revisions.length > SANDBOX_OPERATION_HISTORY_LIMIT ||
      !Number.isSafeInteger(value.cursor) ||
      (value.cursor as number) < 0 ||
      (value.cursor as number) >= value.revisions.length
    ) {
      throw new Error("journal envelope is invalid");
    }
    const revisions = value.revisions.map(parseRevision);
    const operationId = revisions[0]!.operation.id;
    let previousSequence = 0;
    for (const revision of revisions) {
      if (
        revision.sequence <= previousSequence ||
        revision.operation.id !== operationId
      ) {
        throw new Error("journal revision order or identity is invalid");
      }
      previousSequence = revision.sequence;
    }
    return Object.freeze({
      schemaVersion: SANDBOX_OPERATION_JOURNAL_SCHEMA_VERSION,
      presetId: SANDBOX_FACE_MILLING_PRESET_ID,
      projectId: SANDBOX_FACE_MILLING_ENTITY_IDS.projectId,
      cursor: value.cursor as number,
      revisions: Object.freeze(revisions),
    });
  } catch (error) {
    throw new SandboxOperationControllerError(
      "sandbox.operation.journal-invalid",
      "Sandbox operation journal is invalid.",
      error instanceof SandboxOperationControllerError
        ? error.issues
        : [error instanceof Error ? error.message : "unknown journal error"],
    );
  }
}

export function mapSandboxOperationToMillingConfiguration(
  document: SandboxOperationDocument,
): SandboxMillingConfiguration {
  return freezeConfiguration(validateDocument(document).configuration);
}
export function mapSandboxOperationToRunParameters(
  document: SandboxOperationDocument,
): SandboxMillingRunParameters {
  const valid = validateDocument(document);
  const operation = valid.operation;
  if (operation.feed.mode !== "per-minute") {
    throw new SandboxOperationControllerError(
      "sandbox.operation.invalid",
      "Face milling requires per-minute feed.",
    );
  }
  return Object.freeze({
    fixture: "milling",
    projectId: SANDBOX_FACE_MILLING_ENTITY_IDS.projectId,
    machineId: SANDBOX_FACE_MILLING_ENTITY_IDS.machineId,
    materialId: SANDBOX_FACE_MILLING_ENTITY_IDS.materialId,
    stockId:
      valid.configuration.stockPreset === "standard"
        ? SANDBOX_FACE_MILLING_ENTITY_IDS.standardStockId
        : SANDBOX_FACE_MILLING_ENTITY_IDS.compactStockId,
    setupId: SANDBOX_FACE_MILLING_ENTITY_IDS.setupId,
    toolAssemblyId: SANDBOX_FACE_MILLING_ENTITY_IDS.toolAssemblyId,
    operationId: operation.id,
    millingConfiguration: freezeConfiguration(valid.configuration),
    feedMmPerMin: operation.feed.feedMmPerMin,
    spindleSpeedRpm: operation.spindleSpeedRpm,
    depthOfCutMm: operation.depthOfCutMm,
    widthOfCutMm: operation.widthOfCutMm,
  });
}

export class SandboxOperationController {
  readonly #ports: SandboxOperationControllerPorts;
  #revisions: SandboxOperationRevision[] = [];
  #cursor = -1;
  #draft: SandboxOperationDocument | null = null;
  #dirty = false;

  constructor(ports: SandboxOperationControllerPorts) {
    if (
      typeof ports.createUuid !== "function" ||
      typeof ports.nowUtc !== "function"
    ) {
      throw new TypeError("Sandbox operation controller ports are required.");
    }
    this.#ports = ports;
  }

  createFaceMilling(
    input: SandboxOperationCreateInput = {},
  ): SandboxOperationSnapshot {
    if (this.#revisions.length > 0) {
      throw new SandboxOperationControllerError(
        "sandbox.operation.already-created",
        "A sandbox operation has already been created.",
      );
    }
    const configuration: SandboxMillingConfiguration = {
      stockPreset: input.stockPreset ?? DEFAULT_CONFIGURATION.stockPreset,
      cutDirection: input.cutDirection ?? DEFAULT_CONFIGURATION.cutDirection,
    };
    const document = validateDocument({
      presetId: SANDBOX_FACE_MILLING_PRESET_ID,
      configuration,
      operation: {
        schemaVersion: 1,
        id: portValue(UuidSchema, this.#ports.createUuid(), "createUuid"),
        name: input.name ?? "E2 sandbox face milling",
        operationType: "milling",
        setupId: SANDBOX_FACE_MILLING_ENTITY_IDS.setupId,
        toolAssemblyId: SANDBOX_FACE_MILLING_ENTITY_IDS.toolAssemblyId,
        strategy: strategyFor(configuration.cutDirection),
        feed: { mode: "per-minute", feedMmPerMin: 2_400 },
        spindleSpeedRpm: 6_000,
        spindleDirection: "clockwise",
        depthOfCutMm: 4,
        widthOfCutMm: 20,
        targetGeometryResourceId: null,
        generatedToolpathId: null,
      },
    });
    this.#revisions = [
      freezeRevision({
        sequence: 1,
        committedAt: portValue(
          UtcDateTimeSchema,
          this.#ports.nowUtc(),
          "nowUtc",
        ),
        operation: document.operation,
        configuration: document.configuration,
      }),
    ];
    this.#cursor = 0;
    this.#draft = document;
    this.#dirty = false;
    return this.getSnapshot();
  }

  edit(patch: SandboxOperationEdit): SandboxOperationSnapshot {
    const current = this.#requireDraft();
    const configuration: SandboxMillingConfiguration = {
      stockPreset: patch.stockPreset ?? current.configuration.stockPreset,
      cutDirection: patch.cutDirection ?? current.configuration.cutDirection,
    };
    const operation = cloneOperation(current.operation);
    if (patch.name !== undefined) operation.name = patch.name;
    if (patch.setupId !== undefined) operation.setupId = patch.setupId;
    if (patch.toolAssemblyId !== undefined) {
      operation.toolAssemblyId = patch.toolAssemblyId;
    }
    if (patch.feedMmPerMin !== undefined) {
      operation.feed = {
        mode: "per-minute",
        feedMmPerMin: patch.feedMmPerMin,
      };
    }
    if (patch.spindleSpeedRpm !== undefined) {
      operation.spindleSpeedRpm = patch.spindleSpeedRpm;
    }
    if (patch.spindleDirection !== undefined) {
      operation.spindleDirection = patch.spindleDirection;
    }
    if (patch.depthOfCutMm !== undefined) {
      operation.depthOfCutMm = patch.depthOfCutMm;
    }
    if (patch.widthOfCutMm !== undefined) {
      operation.widthOfCutMm = patch.widthOfCutMm;
    }
    operation.strategy = strategyFor(configuration.cutDirection);
    const candidate = validateDocument({
      presetId: SANDBOX_FACE_MILLING_PRESET_ID,
      operation,
      configuration,
    });
    this.#draft = candidate;
    this.#dirty = !sameDocument(
      candidate,
      documentFromRevision(this.#revisions[this.#cursor]!),
    );
    return this.getSnapshot();
  }

  commit(): SandboxOperationSnapshot {
    const draft = this.#requireDraft();
    if (!this.#dirty) return this.getSnapshot();

    const nextSequence =
      Math.max(...this.#revisions.map((revision) => revision.sequence)) + 1;
    const branch = this.#revisions.slice(0, this.#cursor + 1);
    branch.push(
      freezeRevision({
        sequence: nextSequence,
        committedAt: portValue(
          UtcDateTimeSchema,
          this.#ports.nowUtc(),
          "nowUtc",
        ),
        operation: draft.operation,
        configuration: draft.configuration,
      }),
    );
    this.#revisions = branch.slice(-SANDBOX_OPERATION_HISTORY_LIMIT);
    this.#cursor = this.#revisions.length - 1;
    this.#draft = documentFromRevision(this.#revisions[this.#cursor]!);
    this.#dirty = false;
    return this.getSnapshot();
  }

  discardEdit(): SandboxOperationSnapshot {
    this.#requireDraft();
    this.#draft = documentFromRevision(this.#revisions[this.#cursor]!);
    this.#dirty = false;
    return this.getSnapshot();
  }

  undo(): SandboxOperationSnapshot {
    this.#requireDraft();
    if (this.#dirty) this.discardEdit();
    if (this.#cursor > 0) {
      this.#cursor -= 1;
      this.#draft = documentFromRevision(this.#revisions[this.#cursor]!);
    }
    return this.getSnapshot();
  }

  redo(): SandboxOperationSnapshot {
    this.#requireDraft();
    if (this.#dirty) this.discardEdit();
    if (this.#cursor < this.#revisions.length - 1) {
      this.#cursor += 1;
      this.#draft = documentFromRevision(this.#revisions[this.#cursor]!);
    }
    return this.getSnapshot();
  }

  getActiveDocument(): SandboxOperationDocument {
    return freezeDocument(this.#requireDraft());
  }

  getCommittedDocument(): SandboxOperationDocument {
    this.#requireDraft();
    if (this.#dirty) {
      throw new SandboxOperationControllerError(
        "sandbox.operation.draft-uncommitted",
        "Commit or discard the edit before saving.",
      );
    }
    return documentFromRevision(this.#revisions[this.#cursor]!);
  }

  serializeJournal(): string {
    if (this.#dirty) {
      throw new SandboxOperationControllerError(
        "sandbox.operation.draft-uncommitted",
        "Commit or discard the edit before saving its journal.",
      );
    }
    return canonicalJson(this.#journal() as unknown as JsonValue);
  }

  restoreJournal(input: string | unknown): SandboxOperationSnapshot {
    if (this.#dirty) {
      throw new SandboxOperationControllerError(
        "sandbox.operation.draft-uncommitted",
        "Commit or discard the edit before restoring a journal.",
      );
    }
    const journal = parseSandboxOperationJournal(input);
    this.#revisions = journal.revisions.map(freezeRevision);
    this.#cursor = journal.cursor;
    this.#draft = documentFromRevision(this.#revisions[this.#cursor]!);
    this.#dirty = false;
    return this.getSnapshot();
  }

  getSnapshot(): SandboxOperationSnapshot {
    if (this.#draft === null || this.#cursor < 0) {
      return Object.freeze({
        status: "empty",
        presetId: SANDBOX_FACE_MILLING_PRESET_ID,
        projectId: SANDBOX_FACE_MILLING_ENTITY_IDS.projectId,
        revision: null,
        committedAt: null,
        operation: null,
        configuration: null,
        dirty: false,
        canCommit: false,
        canUndo: false,
        canRedo: false,
        retainedRevisionCount: 0,
      });
    }
    const active = this.#revisions[this.#cursor]!;
    return Object.freeze({
      status: "ready",
      presetId: SANDBOX_FACE_MILLING_PRESET_ID,
      projectId: SANDBOX_FACE_MILLING_ENTITY_IDS.projectId,
      revision: active.sequence,
      committedAt: active.committedAt,
      operation: freezeOperation(this.#draft.operation),
      configuration: freezeConfiguration(this.#draft.configuration),
      dirty: this.#dirty,
      canCommit: this.#dirty,
      canUndo: this.#cursor > 0,
      canRedo: this.#cursor < this.#revisions.length - 1,
      retainedRevisionCount: this.#revisions.length,
    });
  }

  #requireDraft(): SandboxOperationDocument {
    if (this.#draft === null || this.#cursor < 0) {
      throw new SandboxOperationControllerError(
        "sandbox.operation.not-created",
        "Create a sandbox operation first.",
      );
    }
    return this.#draft;
  }

  #journal(): SandboxOperationJournal {
    this.#requireDraft();
    return Object.freeze({
      schemaVersion: SANDBOX_OPERATION_JOURNAL_SCHEMA_VERSION,
      presetId: SANDBOX_FACE_MILLING_PRESET_ID,
      projectId: SANDBOX_FACE_MILLING_ENTITY_IDS.projectId,
      cursor: this.#cursor,
      revisions: Object.freeze(
        this.#revisions.map((revision) => ({
          sequence: revision.sequence,
          committedAt: revision.committedAt,
          operation: cloneOperation(revision.operation),
          configuration: { ...revision.configuration },
        })),
      ),
    });
  }
}

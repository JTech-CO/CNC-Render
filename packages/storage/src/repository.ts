import {
  CheckpointIndexSchema,
  DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES,
  MAX_PROJECT_CONTAINER_ENTRIES,
  PersistedStateSnapshotSchema,
  Sha256HexSchema,
  UuidSchema,
  canonicalJson,
  isSafeResourcePath,
  type CheckpointIndex,
  type JsonValue,
  type PersistedComponentHashes,
  type PersistedStateSnapshot,
} from "@cnc-render/contracts";

import {
  canonicalJsonBytes,
  cloneBytes,
  parseJsonBytes,
  sha256Hex,
} from "./bytes";
import {
  ProjectPersistenceError,
  persistenceFailure,
} from "./errors";

export const GENERATION_COMMIT_MARKER_PATH = "generation.json" as const;

export interface GenerationFileDescriptor {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface GenerationCommitMarker {
  readonly schemaVersion: 1;
  readonly engineVersion: string;
  readonly projectId: string;
  readonly generationId: string;
  readonly stateSnapshot: PersistedStateSnapshot;
  readonly checkpointIndex: CheckpointIndex;
  readonly files: readonly GenerationFileDescriptor[];
}

export interface GenerationSourceFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface SaveProjectGenerationInput {
  readonly projectId: string;
  readonly generationId: string;
  readonly engineVersion: string;
  readonly stateSnapshot: PersistedStateSnapshot;
  readonly checkpointIndex: CheckpointIndex;
  readonly files: readonly GenerationSourceFile[];
}

export interface StagingGenerationRecord {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly generationId: string;
  readonly sequence: number;
  readonly markerSha256: string;
  readonly componentHashes: PersistedComponentHashes;
  readonly checkpointIndex: CheckpointIndex;
  readonly stateSemanticHashSha256: string;
}

export type CurrentGenerationRecord = StagingGenerationRecord;

export interface QuarantinedGenerationRecord
  extends StagingGenerationRecord {
  readonly diagnosticCode: string;
}

export interface GenerationMetadataPort {
  beginGeneration(
    input: Omit<StagingGenerationRecord, "sequence">,
  ): Promise<StagingGenerationRecord>;
  commitGeneration(record: StagingGenerationRecord): Promise<void>;
  currentGeneration(projectId: string): Promise<CurrentGenerationRecord | null>;
  listStagingGenerations(): Promise<readonly StagingGenerationRecord[]>;
  quarantineGeneration(
    record: StagingGenerationRecord,
    diagnosticCode: string,
  ): Promise<void>;
  listQuarantinedGenerations(): Promise<
    readonly QuarantinedGenerationRecord[]
  >;
}

export interface GenerationFilePort {
  writeImmutable(
    projectId: string,
    generationId: string,
    path: string,
    bytes: Uint8Array,
  ): Promise<void>;
  read(
    projectId: string,
    generationId: string,
    path: string,
  ): Promise<Uint8Array>;
}

export interface SaveGenerationHooks {
  readonly afterFileWrite?: (
    path: string,
    completedFileCount: number,
  ) => void | Promise<void>;
  readonly beforeMetadataCommit?: () => void | Promise<void>;
}

export interface LoadedProjectGeneration {
  readonly metadata: CurrentGenerationRecord;
  readonly marker: GenerationCommitMarker;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export interface RecoveryResult {
  readonly projectId: string;
  readonly generationId: string;
  readonly outcome: "recovered" | "quarantined";
  readonly diagnosticCode: string | null;
}

function normalizedPathKey(path: string): string {
  return path.normalize("NFC").toLocaleLowerCase("en-US");
}

function assertGenerationIdentity(
  projectId: string,
  generationId: string,
  engineVersion: string,
): void {
  if (!UuidSchema.safeParse(projectId).success) {
    throw persistenceFailure(
      "storage.save.project-id-invalid",
      "save",
      "projectId must be a UUID",
    );
  }
  if (!UuidSchema.safeParse(generationId).success) {
    throw persistenceFailure(
      "storage.save.generation-id-invalid",
      "save",
      "generationId must be a UUID",
    );
  }
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u.test(engineVersion)) {
    throw persistenceFailure(
      "storage.save.engine-version-invalid",
      "save",
      "engineVersion must be a normalized semantic version",
    );
  }
}

async function describeFiles(
  files: readonly GenerationSourceFile[],
): Promise<readonly GenerationFileDescriptor[]> {
  if (files.length === 0 || files.length > MAX_PROJECT_CONTAINER_ENTRIES) {
    throw persistenceFailure(
      "storage.save.file-count-invalid",
      "save",
      "a generation must contain at least one file within the entry limit",
    );
  }
  let totalBytes = 0;
  const paths = new Set<string>();
  const descriptors = await Promise.all(
    files.map(async (file) => {
      if (
        !isSafeResourcePath(file.path) ||
        file.path === GENERATION_COMMIT_MARKER_PATH
      ) {
        throw persistenceFailure(
          "storage.save.path-invalid",
          "save",
          `generation file path is invalid: ${file.path}`,
        );
      }
      const key = normalizedPathKey(file.path);
      if (paths.has(key)) {
        throw persistenceFailure(
          "storage.save.path-duplicate",
          "save",
          `generation file paths collide: ${file.path}`,
        );
      }
      paths.add(key);
      totalBytes += file.bytes.byteLength;
      if (totalBytes > DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES) {
        throw persistenceFailure(
          "storage.save.byte-limit",
          "save",
          "generation content exceeds the default 100 MiB limit",
        );
      }
      return {
        path: file.path,
        byteLength: file.bytes.byteLength,
        sha256: await sha256Hex(file.bytes),
      };
    }),
  );
  return descriptors.sort((left, right) =>
    left.path.localeCompare(right.path, "en-US"),
  );
}

function assertStateLinks(
  input: SaveProjectGenerationInput,
  descriptors: readonly GenerationFileDescriptor[],
): void {
  const stateResult = PersistedStateSnapshotSchema.safeParse(input.stateSnapshot);
  const checkpointResult = CheckpointIndexSchema.safeParse(input.checkpointIndex);
  if (!stateResult.success) {
    throw persistenceFailure(
      "storage.save.state-invalid",
      "save",
      "state snapshot does not satisfy the persistence contract",
      { cause: stateResult.error },
    );
  }
  if (!checkpointResult.success) {
    throw persistenceFailure(
      "storage.save.checkpoint-index-invalid",
      "save",
      "checkpoint index does not satisfy the persistence contract",
      { cause: checkpointResult.error },
    );
  }
  if (
    input.stateSnapshot.projectId !== input.projectId ||
    input.stateSnapshot.engineVersion !== input.engineVersion ||
    input.checkpointIndex.projectId !== input.projectId ||
    input.checkpointIndex.engineVersion !== input.engineVersion
  ) {
    throw persistenceFailure(
      "storage.save.identity-mismatch",
      "save",
      "state and checkpoint identities must match the generation",
    );
  }
  const descriptorByPath = new Map(
    descriptors.map((descriptor) => [descriptor.path, descriptor]),
  );
  const stock = descriptorByPath.get(input.stateSnapshot.stock.payloadPath);
  if (
    !stock ||
    stock.byteLength !== input.stateSnapshot.stock.payloadByteLength ||
    stock.sha256 !== input.stateSnapshot.stock.payloadSha256
  ) {
    throw persistenceFailure(
      "storage.save.stock-payload-mismatch",
      "save",
      "stock payload bytes must match the persisted state snapshot",
    );
  }
  for (const checkpoint of input.checkpointIndex.checkpoints) {
    const descriptor = descriptorByPath.get(checkpoint.payloadPath);
    if (
      !descriptor ||
      descriptor.byteLength !== checkpoint.byteLength ||
      descriptor.sha256 !== checkpoint.sha256
    ) {
      throw persistenceFailure(
        "storage.save.checkpoint-payload-mismatch",
        "save",
        `checkpoint payload bytes do not match: ${checkpoint.payloadPath}`,
      );
    }
  }
}

function markerJson(marker: GenerationCommitMarker): JsonValue {
  return marker as unknown as JsonValue;
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseFileDescriptors(value: JsonValue): readonly GenerationFileDescriptor[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw persistenceFailure(
      "storage.load.marker-files-invalid",
      "load",
      "generation marker must list its immutable files",
    );
  }
  const paths = new Set<string>();
  const descriptors: GenerationFileDescriptor[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      throw persistenceFailure(
        "storage.load.marker-file-invalid",
        "load",
        "generation marker contains an invalid file descriptor",
      );
    }
    const keys = Object.keys(item).sort();
    if (keys.join(",") !== "byteLength,path,sha256") {
      throw persistenceFailure(
        "storage.load.marker-file-invalid",
        "load",
        "generation file descriptor contains unknown fields",
      );
    }
    const { path, byteLength, sha256 } = item;
    if (
      typeof path !== "string" ||
      !isSafeResourcePath(path) ||
      path === GENERATION_COMMIT_MARKER_PATH ||
      typeof byteLength !== "number" ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      typeof sha256 !== "string" ||
      !Sha256HexSchema.safeParse(sha256).success
    ) {
      throw persistenceFailure(
        "storage.load.marker-file-invalid",
        "load",
        "generation marker contains an invalid file descriptor",
      );
    }
    const key = normalizedPathKey(path);
    if (paths.has(key)) {
      throw persistenceFailure(
        "storage.load.marker-path-duplicate",
        "load",
        "generation marker contains colliding paths",
      );
    }
    paths.add(key);
    descriptors.push({ path, byteLength, sha256 });
  }
  const sorted = [...descriptors].sort((left, right) =>
    left.path.localeCompare(right.path, "en-US"),
  );
  if (canonicalJson(descriptors as unknown as JsonValue) !== canonicalJson(sorted as unknown as JsonValue)) {
    throw persistenceFailure(
      "storage.load.marker-files-unsorted",
      "load",
      "generation marker file descriptors must be sorted",
    );
  }
  return descriptors;
}

export function parseGenerationCommitMarker(
  bytes: Uint8Array,
): GenerationCommitMarker {
  const document = parseJsonBytes(bytes, "load", 64);
  if (!isRecord(document)) {
    throw persistenceFailure(
      "storage.load.marker-invalid",
      "load",
      "generation commit marker must be a JSON object",
    );
  }
  const keys = Object.keys(document).sort();
  if (
    keys.join(",") !==
    "checkpointIndex,engineVersion,files,generationId,projectId,schemaVersion,stateSnapshot"
  ) {
    throw persistenceFailure(
      "storage.load.marker-invalid",
      "load",
      "generation commit marker contains missing or unknown fields",
    );
  }
  const stateResult = PersistedStateSnapshotSchema.safeParse(
    document.stateSnapshot,
  );
  const checkpointResult = CheckpointIndexSchema.safeParse(
    document.checkpointIndex,
  );
  if (
    document.schemaVersion !== 1 ||
    typeof document.engineVersion !== "string" ||
    typeof document.projectId !== "string" ||
    typeof document.generationId !== "string" ||
    !UuidSchema.safeParse(document.projectId).success ||
    !UuidSchema.safeParse(document.generationId).success ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u.test(document.engineVersion) ||
    !stateResult.success ||
    !checkpointResult.success
  ) {
    throw persistenceFailure(
      "storage.load.marker-invalid",
      "load",
      "generation commit marker does not satisfy its contract",
    );
  }
  const files = parseFileDescriptors(document.files);
  const marker: GenerationCommitMarker = {
    schemaVersion: 1,
    engineVersion: document.engineVersion,
    projectId: document.projectId,
    generationId: document.generationId,
    stateSnapshot: stateResult.data,
    checkpointIndex: checkpointResult.data,
    files,
  };
  assertStateLinks(
    {
      projectId: marker.projectId,
      generationId: marker.generationId,
      engineVersion: marker.engineVersion,
      stateSnapshot: marker.stateSnapshot,
      checkpointIndex: marker.checkpointIndex,
      files: files.map((file) => ({
        path: file.path,
        bytes: new Uint8Array(file.byteLength),
      })),
    },
    files,
  );
  return marker;
}

async function readVerifiedGeneration(
  files: GenerationFilePort,
  record: StagingGenerationRecord,
): Promise<LoadedProjectGeneration> {
  let markerBytes: Uint8Array;
  try {
    markerBytes = await files.read(
      record.projectId,
      record.generationId,
      GENERATION_COMMIT_MARKER_PATH,
    );
  } catch (error) {
    throw persistenceFailure(
      "storage.recovery.marker-missing",
      "recovery",
      "staged generation has no complete commit marker",
      { cause: error },
    );
  }
  if ((await sha256Hex(markerBytes)) !== record.markerSha256) {
    throw persistenceFailure(
      "storage.recovery.marker-hash-mismatch",
      "recovery",
      "generation commit marker hash does not match metadata",
    );
  }
  let marker: GenerationCommitMarker;
  try {
    marker = parseGenerationCommitMarker(markerBytes);
  } catch (error) {
    throw persistenceFailure(
      "storage.recovery.marker-invalid",
      "recovery",
      "generation commit marker is invalid",
      { cause: error },
    );
  }
  if (
    marker.projectId !== record.projectId ||
    marker.generationId !== record.generationId
  ) {
    throw persistenceFailure(
      "storage.recovery.identity-mismatch",
      "recovery",
      "generation marker identity does not match metadata",
    );
  }
  if (
    canonicalJson(marker.stateSnapshot.componentHashes as unknown as JsonValue) !==
      canonicalJson(record.componentHashes as unknown as JsonValue) ||
    canonicalJson(marker.checkpointIndex as unknown as JsonValue) !==
      canonicalJson(record.checkpointIndex as unknown as JsonValue) ||
    marker.stateSnapshot.stateSemanticHashSha256 !==
      record.stateSemanticHashSha256
  ) {
    throw persistenceFailure(
      "storage.recovery.indexed-metadata-mismatch",
      "recovery",
      "IndexedDB metadata does not match the immutable generation marker",
    );
  }
  const loadedFiles = new Map<string, Uint8Array>();
  for (const descriptor of marker.files) {
    let bytes: Uint8Array;
    try {
      bytes = await files.read(
        record.projectId,
        record.generationId,
        descriptor.path,
      );
    } catch (error) {
      throw persistenceFailure(
        "storage.recovery.file-missing",
        "recovery",
        `generation file is missing: ${descriptor.path}`,
        { cause: error },
      );
    }
    if (
      bytes.byteLength !== descriptor.byteLength ||
      (await sha256Hex(bytes)) !== descriptor.sha256
    ) {
      throw persistenceFailure(
        "storage.recovery.file-hash-mismatch",
        "recovery",
        `generation file is corrupt: ${descriptor.path}`,
      );
    }
    loadedFiles.set(descriptor.path, bytes);
  }
  return {
    metadata: record,
    marker,
    files: loadedFiles,
  };
}

export class ProjectRepository {
  constructor(
    private readonly metadata: GenerationMetadataPort,
    private readonly files: GenerationFilePort,
  ) {}

  async save(
    input: SaveProjectGenerationInput,
    hooks: SaveGenerationHooks = {},
  ): Promise<CurrentGenerationRecord> {
    assertGenerationIdentity(
      input.projectId,
      input.generationId,
      input.engineVersion,
    );
    const descriptors = await describeFiles(input.files);
    assertStateLinks(input, descriptors);
    const marker: GenerationCommitMarker = {
      schemaVersion: 1,
      engineVersion: input.engineVersion,
      projectId: input.projectId,
      generationId: input.generationId,
      stateSnapshot: input.stateSnapshot,
      checkpointIndex: input.checkpointIndex,
      files: descriptors,
    };
    const markerBytes = canonicalJsonBytes(markerJson(marker));
    const record = await this.metadata.beginGeneration({
      schemaVersion: 1,
      projectId: input.projectId,
      generationId: input.generationId,
      markerSha256: await sha256Hex(markerBytes),
      componentHashes: input.stateSnapshot.componentHashes,
      checkpointIndex: input.checkpointIndex,
      stateSemanticHashSha256: input.stateSnapshot.stateSemanticHashSha256,
    });
    const sourceByPath = new Map(
      input.files.map((file) => [file.path, cloneBytes(file.bytes)]),
    );
    let completed = 0;
    for (const descriptor of descriptors) {
      const bytes = sourceByPath.get(descriptor.path);
      if (!bytes) {
        throw persistenceFailure(
          "storage.save.file-missing",
          "save",
          `generation source file disappeared: ${descriptor.path}`,
        );
      }
      await this.files.writeImmutable(
        input.projectId,
        input.generationId,
        descriptor.path,
        bytes,
      );
      completed += 1;
      await hooks.afterFileWrite?.(descriptor.path, completed);
    }
    await this.files.writeImmutable(
      input.projectId,
      input.generationId,
      GENERATION_COMMIT_MARKER_PATH,
      markerBytes,
    );
    await hooks.afterFileWrite?.(GENERATION_COMMIT_MARKER_PATH, completed + 1);
    await hooks.beforeMetadataCommit?.();
    await this.metadata.commitGeneration(record);
    return record;
  }

  async load(projectId: string): Promise<LoadedProjectGeneration | null> {
    const current = await this.metadata.currentGeneration(projectId);
    if (!current) {
      return null;
    }
    try {
      return await readVerifiedGeneration(this.files, current);
    } catch (error) {
      if (error instanceof ProjectPersistenceError) {
        throw persistenceFailure(
          error.diagnosticCode.replace("storage.recovery", "storage.load"),
          "load",
          error.message,
          { cause: error },
        );
      }
      throw error;
    }
  }

  async recoverInterruptedSaves(): Promise<readonly RecoveryResult[]> {
    const staging = await this.metadata.listStagingGenerations();
    const results: RecoveryResult[] = [];
    for (const record of staging) {
      const current = await this.metadata.currentGeneration(record.projectId);
      if (current && current.sequence >= record.sequence) {
        const diagnosticCode = "storage.recovery.generation-superseded";
        await this.metadata.quarantineGeneration(record, diagnosticCode);
        results.push({
          projectId: record.projectId,
          generationId: record.generationId,
          outcome: "quarantined",
          diagnosticCode,
        });
        continue;
      }
      try {
        await readVerifiedGeneration(this.files, record);
        await this.metadata.commitGeneration(record);
        results.push({
          projectId: record.projectId,
          generationId: record.generationId,
          outcome: "recovered",
          diagnosticCode: null,
        });
      } catch (error) {
        const diagnosticCode =
          error instanceof ProjectPersistenceError
            ? error.diagnosticCode
            : "storage.recovery.unknown";
        await this.metadata.quarantineGeneration(record, diagnosticCode);
        results.push({
          projectId: record.projectId,
          generationId: record.generationId,
          outcome: "quarantined",
          diagnosticCode,
        });
      }
    }
    return results;
  }
}

function generationKey(projectId: string, generationId: string): string {
  return `${projectId}:${generationId}`;
}

export class InMemoryGenerationMetadataPort
  implements GenerationMetadataPort
{
  private readonly heads = new Map<string, CurrentGenerationRecord>();
  private readonly staging = new Map<string, StagingGenerationRecord>();
  private readonly quarantined = new Map<string, QuarantinedGenerationRecord>();
  private readonly nextSequences = new Map<string, number>();

  async beginGeneration(
    input: Omit<StagingGenerationRecord, "sequence">,
  ): Promise<StagingGenerationRecord> {
    const key = generationKey(input.projectId, input.generationId);
    if (
      this.staging.has(key) ||
      this.quarantined.has(key) ||
      this.heads.get(input.projectId)?.generationId === input.generationId
    ) {
      throw persistenceFailure(
        "storage.save.generation-not-immutable",
        "save",
        "generation IDs cannot be reused",
      );
    }
    const sequence = (this.nextSequences.get(input.projectId) ?? 0) + 1;
    this.nextSequences.set(input.projectId, sequence);
    const record = { ...input, sequence };
    this.staging.set(key, record);
    return { ...record };
  }

  async commitGeneration(record: StagingGenerationRecord): Promise<void> {
    const key = generationKey(record.projectId, record.generationId);
    const staged = this.staging.get(key);
    if (!staged || canonicalJson(staged as unknown as JsonValue) !== canonicalJson(record as unknown as JsonValue)) {
      throw persistenceFailure(
        "storage.save.staging-mismatch",
        "save",
        "staging metadata changed before commit",
      );
    }
    const current = this.heads.get(record.projectId);
    if (current && current.sequence >= record.sequence) {
      throw persistenceFailure(
        "storage.save.sequence-regression",
        "save",
        "generation sequence cannot replace a newer project head",
      );
    }
    this.heads.set(record.projectId, { ...record });
    this.staging.delete(key);
  }

  async currentGeneration(
    projectId: string,
  ): Promise<CurrentGenerationRecord | null> {
    const record = this.heads.get(projectId);
    return record ? { ...record } : null;
  }

  async listStagingGenerations(): Promise<
    readonly StagingGenerationRecord[]
  > {
    return [...this.staging.values()]
      .map((record) => ({ ...record }))
      .sort((left, right) => left.sequence - right.sequence);
  }

  async quarantineGeneration(
    record: StagingGenerationRecord,
    diagnosticCode: string,
  ): Promise<void> {
    const key = generationKey(record.projectId, record.generationId);
    const staged = this.staging.get(key);
    if (!staged) {
      throw persistenceFailure(
        "storage.recovery.staging-missing",
        "recovery",
        "generation is no longer staged",
      );
    }
    this.quarantined.set(key, { ...staged, diagnosticCode });
    this.staging.delete(key);
  }

  async listQuarantinedGenerations(): Promise<
    readonly QuarantinedGenerationRecord[]
  > {
    return [...this.quarantined.values()]
      .map((record) => ({ ...record }))
      .sort((left, right) => left.sequence - right.sequence);
  }
}

export class InMemoryGenerationFilePort implements GenerationFilePort {
  private readonly files = new Map<string, Uint8Array>();

  async writeImmutable(
    projectId: string,
    generationId: string,
    path: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const key = `${generationKey(projectId, generationId)}/${path}`;
    if (this.files.has(key)) {
      throw persistenceFailure(
        "storage.save.file-not-immutable",
        "save",
        `immutable generation file already exists: ${path}`,
      );
    }
    this.files.set(key, cloneBytes(bytes));
  }

  async read(
    projectId: string,
    generationId: string,
    path: string,
  ): Promise<Uint8Array> {
    const bytes = this.files.get(
      `${generationKey(projectId, generationId)}/${path}`,
    );
    if (!bytes) {
      throw persistenceFailure(
        "storage.load.file-missing",
        "load",
        `generation file does not exist: ${path}`,
      );
    }
    return cloneBytes(bytes);
  }
}

import { cloneBytes } from "./bytes";
import { persistenceFailure } from "./errors";
import {
  ProjectRepository,
  type CurrentGenerationRecord,
  type GenerationFilePort,
  type GenerationMetadataPort,
  type QuarantinedGenerationRecord,
  type StagingGenerationRecord,
} from "./repository";

const DATABASE_NAME = "cnc-render-project-metadata";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";
const STAGING_STORE = "staging";
const QUARANTINE_STORE = "quarantine";

interface StoredProjectHead {
  readonly projectId: string;
  readonly nextSequence: number;
  readonly current: CurrentGenerationRecord | null;
}

interface StoredStaging extends StagingGenerationRecord {
  readonly key: string;
}

interface StoredQuarantine extends QuarantinedGenerationRecord {
  readonly key: string;
}

function generationKey(projectId: string, generationId: string): string {
  return `${projectId}:${generationId}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed")),
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
  });
}

function openMetadataDatabase(indexedDb: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener(
      "upgradeneeded",
      () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(PROJECT_STORE)) {
          database.createObjectStore(PROJECT_STORE, { keyPath: "projectId" });
        }
        if (!database.objectStoreNames.contains(STAGING_STORE)) {
          database.createObjectStore(STAGING_STORE, { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains(QUARANTINE_STORE)) {
          database.createObjectStore(QUARANTINE_STORE, { keyPath: "key" });
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB open failed")),
      { once: true },
    );
    request.addEventListener(
      "blocked",
      () => reject(new Error("IndexedDB upgrade is blocked by another tab")),
      { once: true },
    );
  });
}

export class IndexedDbGenerationMetadataPort
  implements GenerationMetadataPort
{
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly indexedDb: IDBFactory = globalThis.indexedDB) {
    if (!indexedDb) {
      throw persistenceFailure(
        "storage.indexeddb.unsupported",
        "load",
        "IndexedDB is required for project metadata persistence",
      );
    }
  }

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= openMetadataDatabase(this.indexedDb).catch(
      (error: unknown) => {
        this.databasePromise = null;
        throw persistenceFailure(
          "storage.indexeddb.open-failed",
          "load",
          "project metadata database could not be opened",
          { cause: error },
        );
      },
    );
    return this.databasePromise;
  }

  async beginGeneration(
    input: Omit<StagingGenerationRecord, "sequence">,
  ): Promise<StagingGenerationRecord> {
    const database = await this.database();
    const transaction = database.transaction(
      [PROJECT_STORE, STAGING_STORE, QUARANTINE_STORE],
      "readwrite",
    );
    const completed = transactionComplete(transaction);
    const projectStore = transaction.objectStore(PROJECT_STORE);
    const stagingStore = transaction.objectStore(STAGING_STORE);
    const quarantineStore = transaction.objectStore(QUARANTINE_STORE);
    const key = generationKey(input.projectId, input.generationId);
    const [head, staged, quarantined] = await Promise.all([
      requestResult(projectStore.get(input.projectId)) as Promise<
        StoredProjectHead | undefined
      >,
      requestResult(stagingStore.get(key)) as Promise<StoredStaging | undefined>,
      requestResult(quarantineStore.get(key)) as Promise<
        StoredQuarantine | undefined
      >,
    ]);
    if (
      staged ||
      quarantined ||
      head?.current?.generationId === input.generationId
    ) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw persistenceFailure(
        "storage.save.generation-not-immutable",
        "save",
        "generation IDs cannot be reused",
      );
    }
    const sequence = (head?.nextSequence ?? 0) + 1;
    const record: StagingGenerationRecord = { ...input, sequence };
    projectStore.put({
      projectId: input.projectId,
      nextSequence: sequence,
      current: head?.current ?? null,
    } satisfies StoredProjectHead);
    stagingStore.put({ ...record, key } satisfies StoredStaging);
    await completed;
    return record;
  }

  async commitGeneration(record: StagingGenerationRecord): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(
      [PROJECT_STORE, STAGING_STORE],
      "readwrite",
    );
    const completed = transactionComplete(transaction);
    const projectStore = transaction.objectStore(PROJECT_STORE);
    const stagingStore = transaction.objectStore(STAGING_STORE);
    const key = generationKey(record.projectId, record.generationId);
    const [head, staged] = await Promise.all([
      requestResult(projectStore.get(record.projectId)) as Promise<
        StoredProjectHead | undefined
      >,
      requestResult(stagingStore.get(key)) as Promise<StoredStaging | undefined>,
    ]);
    if (
      !head ||
      !staged ||
      staged.sequence !== record.sequence ||
      staged.markerSha256 !== record.markerSha256
    ) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw persistenceFailure(
        "storage.save.staging-mismatch",
        "save",
        "staging metadata changed before commit",
      );
    }
    if (head.current && head.current.sequence >= record.sequence) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw persistenceFailure(
        "storage.save.sequence-regression",
        "save",
        "generation sequence cannot replace a newer project head",
      );
    }
    projectStore.put({ ...head, current: record } satisfies StoredProjectHead);
    stagingStore.delete(key);
    await completed;
  }

  async currentGeneration(
    projectId: string,
  ): Promise<CurrentGenerationRecord | null> {
    const database = await this.database();
    const transaction = database.transaction(PROJECT_STORE, "readonly");
    const head = (await requestResult(
      transaction.objectStore(PROJECT_STORE).get(projectId),
    )) as StoredProjectHead | undefined;
    await transactionComplete(transaction);
    return head?.current ? { ...head.current } : null;
  }

  async listStagingGenerations(): Promise<
    readonly StagingGenerationRecord[]
  > {
    const database = await this.database();
    const transaction = database.transaction(STAGING_STORE, "readonly");
    const stored = (await requestResult(
      transaction.objectStore(STAGING_STORE).getAll(),
    )) as StoredStaging[];
    await transactionComplete(transaction);
    return stored
      .map((record) => ({
        schemaVersion: record.schemaVersion,
        projectId: record.projectId,
        generationId: record.generationId,
        sequence: record.sequence,
        markerSha256: record.markerSha256,
        componentHashes: record.componentHashes,
        checkpointIndex: record.checkpointIndex,
        stateSemanticHashSha256: record.stateSemanticHashSha256,
      }))
      .sort((left, right) => left.sequence - right.sequence);
  }

  async quarantineGeneration(
    record: StagingGenerationRecord,
    diagnosticCode: string,
  ): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(
      [STAGING_STORE, QUARANTINE_STORE],
      "readwrite",
    );
    const completed = transactionComplete(transaction);
    const stagingStore = transaction.objectStore(STAGING_STORE);
    const quarantineStore = transaction.objectStore(QUARANTINE_STORE);
    const key = generationKey(record.projectId, record.generationId);
    const staged = (await requestResult(
      stagingStore.get(key),
    )) as StoredStaging | undefined;
    if (!staged) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw persistenceFailure(
        "storage.recovery.staging-missing",
        "recovery",
        "generation is no longer staged",
      );
    }
    quarantineStore.put({
      ...record,
      diagnosticCode,
      key,
    } satisfies StoredQuarantine);
    stagingStore.delete(key);
    await completed;
  }

  async listQuarantinedGenerations(): Promise<
    readonly QuarantinedGenerationRecord[]
  > {
    const database = await this.database();
    const transaction = database.transaction(QUARANTINE_STORE, "readonly");
    const stored = (await requestResult(
      transaction.objectStore(QUARANTINE_STORE).getAll(),
    )) as StoredQuarantine[];
    await transactionComplete(transaction);
    return stored
      .map((record) => ({
        schemaVersion: record.schemaVersion,
        projectId: record.projectId,
        generationId: record.generationId,
        sequence: record.sequence,
        markerSha256: record.markerSha256,
        componentHashes: record.componentHashes,
        checkpointIndex: record.checkpointIndex,
        stateSemanticHashSha256: record.stateSemanticHashSha256,
        diagnosticCode: record.diagnosticCode,
      }))
      .sort((left, right) => left.sequence - right.sequence);
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

async function directory(
  parent: FileSystemDirectoryHandle,
  name: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create });
}

export class OpfsGenerationFilePort implements GenerationFilePort {
  constructor(
    private readonly storageManager: StorageManager = navigator.storage,
  ) {
    if (!storageManager || typeof storageManager.getDirectory !== "function") {
      throw persistenceFailure(
        "storage.opfs.unsupported",
        "load",
        "OPFS is required for binary project persistence",
      );
    }
  }

  private async generationDirectory(
    projectId: string,
    generationId: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    try {
      let current = await this.storageManager.getDirectory();
      for (const segment of [
        "cnc-render",
        "projects",
        projectId,
        "generations",
        generationId,
      ]) {
        current = await directory(current, segment, create);
      }
      return current;
    } catch (error) {
      throw persistenceFailure(
        create ? "storage.opfs.create-failed" : "storage.opfs.read-failed",
        create ? "save" : "load",
        "OPFS project generation directory could not be accessed",
        { cause: error },
      );
    }
  }

  private async parentDirectory(
    projectId: string,
    generationId: string,
    path: string,
    create: boolean,
  ): Promise<{
    readonly directory: FileSystemDirectoryHandle;
    readonly fileName: string;
  }> {
    const segments = path.split("/");
    const fileName = segments.pop();
    if (!fileName) {
      throw persistenceFailure(
        "storage.opfs.path-invalid",
        create ? "save" : "load",
        "OPFS file path is invalid",
      );
    }
    let current = await this.generationDirectory(
      projectId,
      generationId,
      create,
    );
    for (const segment of segments) {
      current = await directory(current, segment, create);
    }
    return { directory: current, fileName };
  }

  async writeImmutable(
    projectId: string,
    generationId: string,
    path: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const parent = await this.parentDirectory(
      projectId,
      generationId,
      path,
      true,
    );
    try {
      await parent.directory.getFileHandle(parent.fileName, { create: false });
      throw persistenceFailure(
        "storage.save.file-not-immutable",
        "save",
        `immutable generation file already exists: ${path}`,
      );
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
    try {
      const handle = await parent.directory.getFileHandle(parent.fileName, {
        create: true,
      });
      const writable = await handle.createWritable();
      await writable.write(Uint8Array.from(bytes).buffer);
      await writable.close();
    } catch (error) {
      throw persistenceFailure(
        "storage.opfs.write-failed",
        "save",
        `OPFS generation file could not be written: ${path}`,
        { cause: error },
      );
    }
  }

  async read(
    projectId: string,
    generationId: string,
    path: string,
  ): Promise<Uint8Array> {
    try {
      const parent = await this.parentDirectory(
        projectId,
        generationId,
        path,
        false,
      );
      const handle = await parent.directory.getFileHandle(parent.fileName, {
        create: false,
      });
      const file = await handle.getFile();
      return cloneBytes(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      throw persistenceFailure(
        "storage.opfs.file-missing",
        "load",
        `OPFS generation file could not be read: ${path}`,
        { cause: error },
      );
    }
  }
}

export function createBrowserProjectRepository(): ProjectRepository {
  return new ProjectRepository(
    new IndexedDbGenerationMetadataPort(),
    new OpfsGenerationFilePort(),
  );
}

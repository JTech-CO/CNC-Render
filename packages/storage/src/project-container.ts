import {
  DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES,
  MAX_PROJECT_JSON_DEPTH,
  PROJECT_CONTAINER_EXTENSION,
  PROJECT_CONTAINER_MANIFEST_PATH,
  PROJECT_CONTAINER_MEDIA_TYPE,
  PROJECT_CONTAINER_PROJECT_PATH,
  ProjectContainerManifestSchema,
  ProjectSchema,
  canonicalJson,
  type JsonValue,
  type Project,
  type ProjectContainerEntry,
  type ProjectContainerManifest,
} from "@cnc-render/contracts";

import {
  canonicalJsonBytes,
  cloneBytes,
  parseJsonBytes,
  sha256Hex,
} from "./bytes";
import { persistenceFailure } from "./errors";
import { migrateProjectBytes } from "./migrations";
import { decodeZip, encodeDeterministicZip } from "./zip";

export interface ProjectContainerResource {
  readonly path: string;
  readonly role: Exclude<ProjectContainerEntry["role"], "project">;
  readonly mediaType: string;
  readonly authoritative: boolean;
  readonly bytes: Uint8Array;
}

export interface ExportProjectContainerInput {
  readonly project: Project;
  readonly engineVersion: string;
  readonly resources: readonly ProjectContainerResource[];
  readonly uploadLimitBytes?: number;
}

export interface ImportProjectContainerOptions {
  readonly fileName?: string;
  readonly mediaType?: string;
  readonly uploadLimitBytes?: number;
}

export interface ImportedProjectContainer {
  readonly manifest: ProjectContainerManifest;
  readonly project: Project;
  readonly resources: ReadonlyMap<string, Uint8Array>;
  readonly originalProjectBytes: Uint8Array;
  readonly migratedFromSchemaVersion: number | null;
}

type JsonRecord = { readonly [key: string]: JsonValue };

function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function isJsonRecord(value: JsonValue): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function authoritativeProjectDocument(project: JsonValue): JsonValue {
  if (!isJsonRecord(project) || !Array.isArray(project.resources)) {
    throw persistenceFailure(
      "storage.import.project-shape-invalid",
      "import",
      "project must contain a resource descriptor array",
    );
  }
  const authoritativeResources = project.resources.filter((resource) => {
    if (!isJsonRecord(resource)) {
      return false;
    }
    return resource.authoritative === true;
  });
  return { ...project, resources: authoritativeResources };
}

type ManifestWithoutChecksum = Omit<
  ProjectContainerManifest,
  "manifestChecksumSha256"
>;

export async function projectManifestChecksum(
  manifest: ManifestWithoutChecksum,
): Promise<string> {
  return sha256Hex(canonicalJsonBytes(asJsonValue(manifest)));
}

function validateUploadLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("uploadLimitBytes must be a positive safe integer");
  }
  return limit;
}

async function resourceDescriptor(
  resource: ProjectContainerResource,
): Promise<ProjectContainerEntry> {
  return {
    path: resource.path,
    role: resource.role,
    mediaType: resource.mediaType,
    byteLength: resource.bytes.byteLength,
    sha256: await sha256Hex(resource.bytes),
    authoritative: resource.authoritative,
  };
}

function assertResourceAgreement(
  project: Project,
  resources: readonly ProjectContainerResource[],
  entries: readonly ProjectContainerEntry[],
): void {
  const byPath = new Map(resources.map((resource) => [resource.path, resource]));
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  if (
    byPath.size !== resources.length ||
    project.resources.length !== resources.length
  ) {
    throw persistenceFailure(
      "storage.export.resource-set-mismatch",
      "export",
      "project descriptors and supplied resource bytes must form the same set",
    );
  }
  for (const descriptor of project.resources) {
    const source = byPath.get(descriptor.path);
    const entry = entryByPath.get(descriptor.path);
    if (
      !source ||
      !entry ||
      descriptor.role !== source.role ||
      descriptor.mediaType !== source.mediaType ||
      descriptor.authoritative !== source.authoritative ||
      descriptor.byteLength !== entry.byteLength ||
      descriptor.sha256 !== entry.sha256
    ) {
      throw persistenceFailure(
        "storage.export.resource-descriptor-mismatch",
        "export",
        `resource bytes do not match the project descriptor: ${descriptor.path}`,
      );
    }
  }
}

export async function exportProjectContainer(
  input: ExportProjectContainerInput,
): Promise<Uint8Array> {
  const projectResult = ProjectSchema.safeParse(input.project);
  if (!projectResult.success) {
    throw persistenceFailure(
      "storage.export.project-invalid",
      "export",
      "only a valid current-schema project can be exported",
      { cause: projectResult.error },
    );
  }
  const project = projectResult.data;
  const projectDocument = asJsonValue(project);
  const projectBytes = canonicalJsonBytes(projectDocument);
  const resourceEntries = await Promise.all(
    input.resources.map((resource) => resourceDescriptor(resource)),
  );
  assertResourceAgreement(project, input.resources, resourceEntries);
  const projectEntry: ProjectContainerEntry = {
    path: PROJECT_CONTAINER_PROJECT_PATH,
    role: "project",
    mediaType: "application/json",
    byteLength: projectBytes.byteLength,
    sha256: await sha256Hex(projectBytes),
    authoritative: true,
  };
  const entries = [projectEntry, ...resourceEntries].sort((left, right) =>
    left.path.localeCompare(right.path, "en-US"),
  );
  const withoutChecksum: ManifestWithoutChecksum = {
    schemaVersion: 1,
    engineVersion: input.engineVersion,
    unitSystem: project.unitSystem,
    projectSchemaVersion: project.schemaVersion,
    projectSemanticHashSha256: await sha256Hex(
      canonicalJsonBytes(projectDocument),
    ),
    authoritativeProjectSemanticHashSha256: await sha256Hex(
      canonicalJsonBytes(authoritativeProjectDocument(projectDocument)),
    ),
    entries,
  };
  const manifest: ProjectContainerManifest = {
    ...withoutChecksum,
    manifestChecksumSha256: await projectManifestChecksum(withoutChecksum),
  };
  const manifestResult = ProjectContainerManifestSchema.safeParse(manifest);
  if (!manifestResult.success) {
    throw persistenceFailure(
      "storage.export.manifest-invalid",
      "export",
      "generated project manifest does not satisfy its contract",
      { cause: manifestResult.error },
    );
  }
  const resourceBytes = new Map(
    input.resources.map((resource) => [resource.path, cloneBytes(resource.bytes)]),
  );
  const archive = encodeDeterministicZip([
    {
      path: PROJECT_CONTAINER_MANIFEST_PATH,
      bytes: canonicalJsonBytes(asJsonValue(manifestResult.data)),
    },
    { path: PROJECT_CONTAINER_PROJECT_PATH, bytes: projectBytes },
    ...resourceEntries.map((entry) => ({
      path: entry.path,
      bytes: resourceBytes.get(entry.path) ?? new Uint8Array(),
    })),
  ]);
  const uploadLimit = validateUploadLimit(
    input.uploadLimitBytes ?? DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES,
  );
  if (archive.byteLength > uploadLimit) {
    throw persistenceFailure(
      "storage.export.upload-limit",
      "export",
      `project container exceeds the ${uploadLimit}-byte export limit`,
    );
  }
  return archive;
}

function validateFileIdentity(options: ImportProjectContainerOptions): void {
  if (
    options.fileName !== undefined &&
    !options.fileName.toLocaleLowerCase("en-US").endsWith(PROJECT_CONTAINER_EXTENSION)
  ) {
    throw persistenceFailure(
      "storage.import.extension-invalid",
      "import",
      `project file name must end with ${PROJECT_CONTAINER_EXTENSION}`,
    );
  }
  if (
    options.mediaType !== undefined &&
    options.mediaType !== PROJECT_CONTAINER_MEDIA_TYPE
  ) {
    throw persistenceFailure(
      "storage.import.media-type-invalid",
      "import",
      `project file media type must be ${PROJECT_CONTAINER_MEDIA_TYPE}`,
    );
  }
}

function withoutManifestChecksum(
  manifest: ProjectContainerManifest,
): ManifestWithoutChecksum {
  return {
    schemaVersion: manifest.schemaVersion,
    engineVersion: manifest.engineVersion,
    unitSystem: manifest.unitSystem,
    projectSchemaVersion: manifest.projectSchemaVersion,
    projectSemanticHashSha256: manifest.projectSemanticHashSha256,
    authoritativeProjectSemanticHashSha256:
      manifest.authoritativeProjectSemanticHashSha256,
    entries: manifest.entries,
  };
}

async function verifyManifestEntries(
  manifest: ProjectContainerManifest,
  archiveEntries: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  if (archiveEntries.size !== manifest.entries.length + 1) {
    throw persistenceFailure(
      "storage.import.entry-set-mismatch",
      "import",
      "ZIP entries must exactly match the manifest",
    );
  }
  for (const entry of manifest.entries) {
    const bytes = archiveEntries.get(entry.path);
    if (!bytes) {
      throw persistenceFailure(
        "storage.import.entry-missing",
        "import",
        `manifest entry is missing from the ZIP: ${entry.path}`,
      );
    }
    if (bytes.byteLength !== entry.byteLength) {
      throw persistenceFailure(
        "storage.import.entry-size-mismatch",
        "import",
        `manifest byte length does not match: ${entry.path}`,
      );
    }
    if ((await sha256Hex(bytes)) !== entry.sha256) {
      throw persistenceFailure(
        "storage.import.entry-hash-mismatch",
        "import",
        `manifest SHA-256 does not match: ${entry.path}`,
      );
    }
  }
  for (const path of archiveEntries.keys()) {
    if (
      path !== PROJECT_CONTAINER_MANIFEST_PATH &&
      !manifest.entries.some((entry) => entry.path === path)
    ) {
      throw persistenceFailure(
        "storage.import.entry-undeclared",
        "import",
        `ZIP entry is not declared by the manifest: ${path}`,
      );
    }
  }
}

function assertImportedResourceAgreement(
  project: Project,
  manifest: ProjectContainerManifest,
): void {
  const manifestResources = manifest.entries.filter(
    (entry) => entry.path !== PROJECT_CONTAINER_PROJECT_PATH,
  );
  const manifestByPath = new Map(
    manifestResources.map((entry) => [entry.path, entry]),
  );
  if (
    manifestByPath.size !== manifestResources.length ||
    project.resources.length !== manifestResources.length
  ) {
    throw persistenceFailure(
      "storage.import.resource-set-mismatch",
      "import",
      "project descriptors and manifest resources must form the same set",
    );
  }
  for (const descriptor of project.resources) {
    const entry = manifestByPath.get(descriptor.path);
    if (
      !entry ||
      descriptor.role !== entry.role ||
      descriptor.mediaType !== entry.mediaType ||
      descriptor.authoritative !== entry.authoritative ||
      descriptor.byteLength !== entry.byteLength ||
      descriptor.sha256 !== entry.sha256
    ) {
      throw persistenceFailure(
        "storage.import.resource-descriptor-mismatch",
        "import",
        `project resource descriptor does not match the manifest: ${descriptor.path}`,
      );
    }
  }
}

export async function importProjectContainer(
  inputBytes: Uint8Array,
  options: ImportProjectContainerOptions = {},
): Promise<ImportedProjectContainer> {
  validateFileIdentity(options);
  const uploadLimit = validateUploadLimit(
    options.uploadLimitBytes ?? DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES,
  );
  if (inputBytes.byteLength > uploadLimit) {
    throw persistenceFailure(
      "storage.import.upload-limit",
      "import",
      `uploaded project exceeds the ${uploadLimit}-byte limit`,
    );
  }
  const decodedEntries = await decodeZip(inputBytes, {
    uncompressedByteLimit: uploadLimit,
  });
  const archiveEntries = new Map(
    decodedEntries.map((entry) => [entry.path, entry.bytes]),
  );
  const manifestBytes = archiveEntries.get(PROJECT_CONTAINER_MANIFEST_PATH);
  if (!manifestBytes) {
    throw persistenceFailure(
      "storage.import.manifest-missing",
      "import",
      "project container is missing manifest.json",
    );
  }
  const manifestDocument = parseJsonBytes(
    manifestBytes,
    "import",
    MAX_PROJECT_JSON_DEPTH,
  );
  const manifestResult = ProjectContainerManifestSchema.safeParse(manifestDocument);
  if (!manifestResult.success) {
    throw persistenceFailure(
      "storage.import.manifest-invalid",
      "import",
      "project manifest does not satisfy its contract",
      { cause: manifestResult.error },
    );
  }
  const manifest = manifestResult.data;
  const expectedChecksum = await projectManifestChecksum(
    withoutManifestChecksum(manifest),
  );
  if (expectedChecksum !== manifest.manifestChecksumSha256) {
    throw persistenceFailure(
      "storage.import.manifest-checksum-mismatch",
      "import",
      "project manifest checksum verification failed",
    );
  }
  await verifyManifestEntries(manifest, archiveEntries);
  const projectBytes = archiveEntries.get(PROJECT_CONTAINER_PROJECT_PATH);
  if (!projectBytes) {
    throw persistenceFailure(
      "storage.import.project-missing",
      "import",
      "project container is missing project.json",
    );
  }
  const rawProject = parseJsonBytes(
    projectBytes,
    "import",
    MAX_PROJECT_JSON_DEPTH,
  );
  const semanticHash = await sha256Hex(canonicalJsonBytes(rawProject));
  const authoritativeHash = await sha256Hex(
    canonicalJsonBytes(authoritativeProjectDocument(rawProject)),
  );
  if (semanticHash !== manifest.projectSemanticHashSha256) {
    throw persistenceFailure(
      "storage.import.project-semantic-hash-mismatch",
      "import",
      "project semantic hash does not match its manifest",
    );
  }
  if (authoritativeHash !== manifest.authoritativeProjectSemanticHashSha256) {
    throw persistenceFailure(
      "storage.import.authoritative-hash-mismatch",
      "import",
      "authoritative project hash does not match its manifest",
    );
  }
  const migration = migrateProjectBytes(
    projectBytes,
    manifest.projectSchemaVersion,
  );
  assertImportedResourceAgreement(migration.project, manifest);
  const resources = new Map<string, Uint8Array>();
  for (const entry of manifest.entries) {
    if (entry.path !== PROJECT_CONTAINER_PROJECT_PATH) {
      const bytes = archiveEntries.get(entry.path);
      if (bytes) {
        resources.set(entry.path, cloneBytes(bytes));
      }
    }
  }
  return {
    manifest,
    project: migration.project,
    resources,
    originalProjectBytes: migration.originalProjectBytes,
    migratedFromSchemaVersion: migration.migrated
      ? migration.fromSchemaVersion
      : null,
  };
}

export function projectContainerDebugJson(
  manifest: ProjectContainerManifest,
): string {
  return canonicalJson(asJsonValue(manifest));
}

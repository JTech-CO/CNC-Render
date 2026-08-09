import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  MAX_PROJECT_JSON_DEPTH,
  PROJECT_SCHEMA_ID,
  ProjectSchema,
  type JsonValue,
  type Project,
} from "@cnc-render/contracts";

import { cloneBytes, parseJsonBytes } from "./bytes";
import { persistenceFailure } from "./errors";

export interface ProjectMigrationResult {
  readonly project: Project;
  readonly originalProjectBytes: Uint8Array;
  readonly fromSchemaVersion: number;
  readonly toSchemaVersion: number;
  readonly migrated: boolean;
}

type Migration = (document: JsonValue) => JsonValue;

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function migrateV0ToV1(document: JsonValue): JsonValue {
  if (!isRecord(document) || document.schemaVersion !== 0) {
    throw persistenceFailure(
      "storage.migration.source-invalid",
      "migration",
      "schema v0 migration requires a v0 project object",
    );
  }
  if ("settings" in document) {
    throw persistenceFailure(
      "storage.migration.source-ambiguous",
      "migration",
      "schema v0 projects cannot already contain v1 settings",
    );
  }
  return {
    ...document,
    $schema: PROJECT_SCHEMA_ID,
    schemaVersion: 1,
    settings: {
      accuracyPreset: "balanced",
      deterministicSeed: 0,
      displayDecimalPlaces: 3,
      schemaVersion: 1,
    },
  };
}

const MIGRATIONS = new Map<number, Migration>([[0, migrateV0ToV1]]);

function documentSchemaVersion(document: JsonValue): number | undefined {
  if (!isRecord(document)) {
    return undefined;
  }
  const version = document.schemaVersion;
  return typeof version === "number" && Number.isSafeInteger(version)
    ? version
    : undefined;
}

export function migrateProjectBytes(
  bytes: Uint8Array,
  declaredSchemaVersion: number,
): ProjectMigrationResult {
  const originalProjectBytes = cloneBytes(bytes);
  let document = parseJsonBytes(bytes, "migration", MAX_PROJECT_JSON_DEPTH);
  const embeddedVersion = documentSchemaVersion(document);
  if (embeddedVersion !== declaredSchemaVersion) {
    throw persistenceFailure(
      "storage.migration.version-mismatch",
      "migration",
      "manifest and project schema versions do not match",
    );
  }
  if (
    declaredSchemaVersion < 0 ||
    declaredSchemaVersion > CURRENT_PROJECT_SCHEMA_VERSION
  ) {
    throw persistenceFailure(
      "storage.migration.version-unsupported",
      "migration",
      `project schema v${declaredSchemaVersion} is not supported`,
    );
  }

  let version = declaredSchemaVersion;
  while (version < CURRENT_PROJECT_SCHEMA_VERSION) {
    const migration = MIGRATIONS.get(version);
    if (!migration) {
      throw persistenceFailure(
        "storage.migration.path-missing",
        "migration",
        `no migration is registered from project schema v${version}`,
      );
    }
    document = migration(document);
    version += 1;
  }

  const parsed = ProjectSchema.safeParse(document);
  if (!parsed.success) {
    throw persistenceFailure(
      "storage.migration.project-invalid",
      "migration",
      "project does not satisfy the current schema after migration",
      { cause: parsed.error },
    );
  }
  return {
    project: parsed.data,
    originalProjectBytes,
    fromSchemaVersion: declaredSchemaVersion,
    toSchemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    migrated: declaredSchemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION,
  };
}

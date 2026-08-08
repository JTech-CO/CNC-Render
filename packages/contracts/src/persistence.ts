import * as z from "zod";

import {
  FiniteNumberSchema,
  NonNegativeNumberSchema,
  ResourceRoleSchema,
  SafeSequenceSchema,
  SchemaVersionSchema,
  UuidSchema,
  Vec3MmSchema,
  isSafeResourcePath,
} from "./primitives";
import { DotCodeSchema } from "./wire-text";

export const PROJECT_CONTAINER_EXTENSION = ".cncrender" as const;
export const PROJECT_CONTAINER_MEDIA_TYPE =
  "application/vnd.cnc-render.project+zip" as const;
export const PROJECT_CONTAINER_MANIFEST_PATH = "manifest.json" as const;
export const PROJECT_CONTAINER_PROJECT_PATH = "project.json" as const;
export const DEFAULT_PROJECT_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;
export const MAX_PROJECT_CONTAINER_ENTRIES = 4_096;
export const MAX_PROJECT_JSON_DEPTH = 64;
export const DEFAULT_AUTOSAVE_INTERVAL_S = 30;
export const DEFAULT_CHECKPOINT_INTERVAL_S = 3;

export const Sha256HexSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/u);

export const EngineVersionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/u);

export const ProjectContainerEntryRoleSchema = z.union([
  z.literal("project"),
  ResourceRoleSchema,
]);

export const ProjectContainerEntrySchema = z
  .strictObject({
    path: z.string().min(1).max(512),
    role: ProjectContainerEntryRoleSchema,
    mediaType: z.string().min(3).max(255),
    byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sha256: Sha256HexSchema,
    authoritative: z.boolean(),
  })
  .superRefine((entry, context) => {
    if (!isSafeResourcePath(entry.path)) {
      context.addIssue({
        code: "custom",
        path: ["path"],
        message: "container entry path must be safe and normalized",
      });
    }
    if (entry.path === PROJECT_CONTAINER_MANIFEST_PATH) {
      context.addIssue({
        code: "custom",
        path: ["path"],
        message: "manifest.json is self-describing and cannot be an entry",
      });
    }
  });

export const ProjectContainerManifestSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    engineVersion: EngineVersionSchema,
    unitSystem: z.enum(["metric", "imperial"]),
    projectSchemaVersion: SafeSequenceSchema,
    projectSemanticHashSha256: Sha256HexSchema,
    authoritativeProjectSemanticHashSha256: Sha256HexSchema,
    entries: z
      .array(ProjectContainerEntrySchema)
      .min(1)
      .max(MAX_PROJECT_CONTAINER_ENTRIES),
    manifestChecksumSha256: Sha256HexSchema,
  })
  .superRefine((manifest, context) => {
    const normalizedPaths = new Map<string, number>();
    let projectEntryCount = 0;
    for (let index = 0; index < manifest.entries.length; index += 1) {
      const entry = manifest.entries[index];
      const normalized = entry.path
        .normalize("NFC")
        .toLocaleLowerCase("en-US");
      if (normalizedPaths.has(normalized)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "path"],
          message: "container paths must be unique after normalization",
        });
      } else {
        normalizedPaths.set(normalized, index);
      }

      if (entry.path === PROJECT_CONTAINER_PROJECT_PATH) {
        projectEntryCount += 1;
        if (
          entry.role !== "project" ||
          entry.mediaType !== "application/json" ||
          !entry.authoritative
        ) {
          context.addIssue({
            code: "custom",
            path: ["entries", index],
            message: "project.json must be an authoritative project JSON entry",
          });
        }
      } else if (entry.role === "project") {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "role"],
          message: "only project.json may use the project role",
        });
      }

      if (index > 0 && manifest.entries[index - 1].path >= entry.path) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "path"],
          message: "container entries must be strictly sorted by path",
        });
      }
    }
    if (projectEntryCount !== 1) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "container manifest must contain exactly one project.json entry",
      });
    }
  });

export const PersistedComponentHashesSchema = z.strictObject({
  projectSha256: Sha256HexSchema,
  machineSha256: Sha256HexSchema,
  toolSha256: Sha256HexSchema,
  operationSha256: Sha256HexSchema,
  gcodeSha256: Sha256HexSchema,
  stockSha256: Sha256HexSchema,
  diagnosticsSha256: Sha256HexSchema,
  measurementsSha256: Sha256HexSchema,
});

export const PersistedDiagnosticSchema = z.strictObject({
  code: DotCodeSchema,
  severity: z.enum(["info", "advisory", "warning", "critical"]),
  sourceLine: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  messageKey: DotCodeSchema,
});

const LengthMeasurementSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  id: UuidSchema,
  quantity: z.enum(["length", "diameter"]),
  valueMm: FiniteNumberSchema,
  representationResolutionMm: NonNegativeNumberSchema,
});

const VolumeMeasurementSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  id: UuidSchema,
  quantity: z.literal("volume"),
  valueMm3: FiniteNumberSchema,
  representationResolutionMm: NonNegativeNumberSchema,
});

export const PersistedMeasurementSchema = z.union([
  LengthMeasurementSchema,
  VolumeMeasurementSchema,
]);

export const PersistedStateSnapshotSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  engineVersion: EngineVersionSchema,
  projectId: UuidSchema,
  machineId: UuidSchema,
  toolAssemblyId: UuidSchema,
  operationId: UuidSchema,
  gcodeResourcePath: z.string().refine(isSafeResourcePath),
  logicalTimeS: NonNegativeNumberSchema,
  stock: z.strictObject({
    representation: z.enum(["milling-dexel", "lathe-radius-field"]),
    revision: SafeSequenceSchema,
    stockHashSha256: Sha256HexSchema,
    payloadPath: z.string().refine(isSafeResourcePath),
    payloadByteLength: SafeSequenceSchema,
    payloadSha256: Sha256HexSchema,
  }),
  diagnostics: z.array(PersistedDiagnosticSchema).max(100_000),
  measurements: z.array(PersistedMeasurementSchema).max(100_000),
  componentHashes: PersistedComponentHashesSchema,
  stateSemanticHashSha256: Sha256HexSchema,
});

export const SimulationCheckpointHeaderSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    engineVersion: EngineVersionSchema,
    projectId: UuidSchema,
    projectSemanticHashSha256: Sha256HexSchema,
    runId: UuidSchema,
    currentStep: SafeSequenceSchema,
    totalSteps: SafeSequenceSchema,
    logicalTimeS: NonNegativeNumberSchema,
    toolPositionMm: Vec3MmSchema,
    stockRevision: SafeSequenceSchema,
    stateSemanticHashSha256: Sha256HexSchema,
    stockHashSha256: Sha256HexSchema,
    diagnosticCodes: z.array(DotCodeSchema).max(100_000),
    completed: z.boolean(),
    stopped: z.boolean(),
    payloadKind: z.enum(["milling-surface", "turning-profile"]),
    payloadByteLength: SafeSequenceSchema,
    payloadSha256: Sha256HexSchema,
  })
  .superRefine((header, context) => {
    if (header.currentStep > header.totalSteps) {
      context.addIssue({
        code: "custom",
        path: ["currentStep"],
        message: "checkpoint currentStep cannot exceed totalSteps",
      });
    }
    if (header.completed && header.stopped) {
      context.addIssue({
        code: "custom",
        path: ["completed"],
        message: "completed and stopped are mutually exclusive",
      });
    }
  });

export const CheckpointDescriptorSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  id: UuidSchema,
  projectId: UuidSchema,
  engineVersion: EngineVersionSchema,
  sequence: SafeSequenceSchema,
  logicalTimeS: NonNegativeNumberSchema,
  boundary: z.enum(["interval", "operation", "terminal"]),
  payloadPath: z
    .string()
    .refine(
      (path) => isSafeResourcePath(path) && path.startsWith("checkpoints/"),
      "checkpoint payload must be below checkpoints/",
    ),
  byteLength: SafeSequenceSchema,
  sha256: Sha256HexSchema,
  stateSemanticHashSha256: Sha256HexSchema,
  stockHashSha256: Sha256HexSchema,
});

export const CheckpointIndexSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    projectId: UuidSchema,
    engineVersion: EngineVersionSchema,
    checkpointIntervalS: z.number().min(2).max(5),
    checkpoints: z.array(CheckpointDescriptorSchema).max(100_000),
  })
  .superRefine((index, context) => {
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (let position = 0; position < index.checkpoints.length; position += 1) {
      const checkpoint = index.checkpoints[position];
      if (
        checkpoint.projectId !== index.projectId ||
        checkpoint.engineVersion !== index.engineVersion
      ) {
        context.addIssue({
          code: "custom",
          path: ["checkpoints", position],
          message: "checkpoint identity must match its index",
        });
      }
      if (ids.has(checkpoint.id) || paths.has(checkpoint.payloadPath)) {
        context.addIssue({
          code: "custom",
          path: ["checkpoints", position],
          message: "checkpoint IDs and payload paths must be unique",
        });
      }
      ids.add(checkpoint.id);
      paths.add(checkpoint.payloadPath);
      const previous = index.checkpoints[position - 1];
      if (
        previous &&
        (previous.logicalTimeS > checkpoint.logicalTimeS ||
          previous.sequence >= checkpoint.sequence)
      ) {
        context.addIssue({
          code: "custom",
          path: ["checkpoints", position],
          message: "checkpoints must have increasing time and sequence",
        });
      }
    }
  });

export const StorageTelemetryEventSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  eventName: z.literal("storage.operation"),
  operation: z.enum([
    "save",
    "load",
    "export",
    "import",
    "checkpoint",
    "migration",
    "recovery",
  ]),
  outcome: z.enum(["success", "rejected", "quarantined"]),
  projectIdHashSha256: Sha256HexSchema.nullable(),
  byteLength: SafeSequenceSchema,
  durationMs: NonNegativeNumberSchema,
  userContentConsent: z.boolean(),
  containsSourceContent: z.literal(false),
  diagnosticCode: DotCodeSchema.nullable(),
});

export const CloudPersistencePlanSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  enabled: z.literal(false),
  reason: z.literal("user-consent-required"),
  d1Binding: z.null(),
  r2Binding: z.null(),
  containsProjectBytes: z.literal(false),
});

export type ProjectContainerEntry = z.infer<
  typeof ProjectContainerEntrySchema
>;
export type ProjectContainerManifest = z.infer<
  typeof ProjectContainerManifestSchema
>;
export type PersistedComponentHashes = z.infer<
  typeof PersistedComponentHashesSchema
>;
export type PersistedDiagnostic = z.infer<typeof PersistedDiagnosticSchema>;
export type PersistedMeasurement = z.infer<typeof PersistedMeasurementSchema>;
export type PersistedStateSnapshot = z.infer<
  typeof PersistedStateSnapshotSchema
>;
export type SimulationCheckpointHeader = z.infer<
  typeof SimulationCheckpointHeaderSchema
>;
export type CheckpointDescriptor = z.infer<typeof CheckpointDescriptorSchema>;
export type CheckpointIndex = z.infer<typeof CheckpointIndexSchema>;
export type StorageTelemetryEvent = z.infer<typeof StorageTelemetryEventSchema>;
export type CloudPersistencePlan = z.infer<typeof CloudPersistencePlanSchema>;

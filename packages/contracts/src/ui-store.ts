import * as z from "zod";

import {
  SafeSequenceSchema,
  UuidSchema,
  Vec3MmSchema,
} from "./primitives";

export const UiStoreSnapshotSchema = z.strictObject({
  projectId: UuidSchema.nullable(),
  machineId: UuidSchema.nullable(),
  selectedToolAssemblyId: UuidSchema.nullable(),
  activeRunId: UuidSchema.nullable(),
  playback: z.strictObject({
    status: z.enum(["idle", "running", "paused", "stopped"]),
    speedRatio: z.number().positive().max(100),
    timeS: z.number().nonnegative(),
  }),
  summary: z.strictObject({
    sequence: SafeSequenceSchema,
    toolPositionMm: Vec3MmSchema.nullable(),
    stockRevision: SafeSequenceSchema,
    progressRatio: z.number().min(0).max(1),
  }),
  diagnosticCodes: z.array(z.string()).max(100),
  binaryHandleIds: z.array(UuidSchema).max(128),
});

export type UiStoreSnapshot = z.infer<typeof UiStoreSnapshotSchema>;

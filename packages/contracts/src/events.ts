import * as z from "zod";

import {
  NonNegativeNumberSchema,
  PositiveNumberSchema,
  SafeSequenceSchema,
  SchemaVersionSchema,
  UuidSchema,
  Vec3MmSchema,
} from "./primitives";
import { DotCodeSchema } from "./wire-text";

const SimulationEventBaseShape = {
  schemaVersion: SchemaVersionSchema,
  runId: UuidSchema,
  sequence: SafeSequenceSchema,
  timeS: NonNegativeNumberSchema,
};

export const SimulationInitializedEventSchema = z.strictObject({
  ...SimulationEventBaseShape,
  eventType: z.literal("simulation.initialized"),
  projectId: UuidSchema,
});

export const SimulationProgressEventSchema = z.strictObject({
  ...SimulationEventBaseShape,
  eventType: z.literal("simulation.progress"),
  progressRatio: z.number().min(0).max(1),
  toolpathSegmentIndex: SafeSequenceSchema,
  stockRevision: SafeSequenceSchema,
  toolPositionMm: Vec3MmSchema,
});

export const SimulationDiagnosticEventSchema = z.strictObject({
  ...SimulationEventBaseShape,
  eventType: z.literal("simulation.diagnostic"),
  severity: z.enum(["info", "warning", "error"]),
  code: DotCodeSchema,
  messageKey: DotCodeSchema,
  sourceLine: z.number().int().positive().nullable(),
});

export const SimulationCollisionEventSchema = z.strictObject({
  ...SimulationEventBaseShape,
  eventType: z.literal("simulation.collision"),
  severity: z.enum(["warning", "stop"]),
  objectAId: UuidSchema,
  objectBId: UuidSchema,
  positionMm: Vec3MmSchema,
  penetrationEstimateMm: PositiveNumberSchema,
  sourceLine: z.number().int().positive().nullable(),
});

export const SimulationCompletedEventSchema = z.strictObject({
  ...SimulationEventBaseShape,
  eventType: z.literal("simulation.completed"),
  durationS: NonNegativeNumberSchema,
  stockRevision: SafeSequenceSchema,
});

export const SimulationFailedEventSchema = z.strictObject({
  ...SimulationEventBaseShape,
  eventType: z.literal("simulation.failed"),
  code: DotCodeSchema,
  messageKey: DotCodeSchema,
  recoverable: z.boolean(),
});

export const SimulationEventSchema = z.discriminatedUnion("eventType", [
  SimulationInitializedEventSchema,
  SimulationProgressEventSchema,
  SimulationDiagnosticEventSchema,
  SimulationCollisionEventSchema,
  SimulationCompletedEventSchema,
  SimulationFailedEventSchema,
]);

export type SimulationEvent = z.infer<typeof SimulationEventSchema>;

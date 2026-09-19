import * as z from "zod";

import { WORKER_PROTOCOL_VERSION } from "./constants";
import { SourceLineMapEntrySchema } from "./domain";
import { SchemaVersionSchema, UuidSchema } from "./primitives";
const GcodeProtocolCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/);

const Sha256Schema = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const SourcePositionSchema = z.strictObject({
  line: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  column: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export const GcodeAnalysisRequestSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  dialect: z.literal("common-v1"),
  source: z.string().min(1).max(16 * 1024 * 1024),
});

export const GcodeAnalysisDiagnosticSchema = z
  .strictObject({
    id: z.string().regex(/^gcode-[a-f0-9]{64}$/),
    code: GcodeProtocolCodeSchema,
    origin: z.literal("parser"),
    severity: z.enum(["warning", "error"]),
    recoverable: z.boolean(),
    message: z.string().min(1).max(4_096),
    range: z.strictObject({
      start: SourcePositionSchema,
      end: SourcePositionSchema,
    }),
    token: z.string().min(1).max(1_024).nullable(),
    supportLevel: z.enum([
      "supported",
      "recognized-unsupported",
      "unsupported",
    ]),
    replacementAvailability: z.literal("unavailable"),
    helpKey: GcodeProtocolCodeSchema,
  })
  .superRefine((diagnostic, context) => {
    const { start, end } = diagnostic.range;
    if (
      end.line < start.line ||
      (end.line === start.line && end.column <= start.column)
    ) {
      context.addIssue({
        code: "custom",
        path: ["range", "end"],
        message: "diagnostic range end must be after its start",
      });
    }
  });

export const GcodeProgramControlEventSchema = z.strictObject({
  sourceLine: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  control: z.enum(["none", "m0", "m1", "m2", "m30"]),
});

export const GcodeAnalysisResultSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  coreVersion: z.string().min(1).max(64),
  wasm: z.literal(true),
  phase: z.literal("analysis"),
  dialect: z.literal("common-v1"),
  accepted: z.boolean(),
  sourceHashSha256: Sha256Schema,
  diagnostics: z.array(GcodeAnalysisDiagnosticSchema).max(10_000),
  toolpathId: UuidSchema.nullable(),
  sourceLineMap: z.array(SourceLineMapEntrySchema).max(400_000),
  programControlEvents: z.array(GcodeProgramControlEventSchema).max(250_000),
});

const AnalysisEnvelopeShape = {
  protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
  messageId: UuidSchema,
};

export const GcodeAnalysisWorkerCommandSchema = z.strictObject({
  ...AnalysisEnvelopeShape,
  replyTo: z.null(),
  kind: z.literal("command"),
  type: z.literal("gcode.analysis.request"),
  payload: GcodeAnalysisRequestSchema,
});

export const GcodeAnalysisWorkerResultEventSchema = z.strictObject({
  ...AnalysisEnvelopeShape,
  replyTo: UuidSchema,
  kind: z.literal("event"),
  type: z.literal("gcode.analysis.result"),
  payload: GcodeAnalysisResultSchema,
});

export const GcodeAnalysisWorkerErrorEventSchema = z.strictObject({
  ...AnalysisEnvelopeShape,
  replyTo: UuidSchema,
  kind: z.literal("event"),
  type: z.literal("gcode.analysis.error"),
  payload: z.strictObject({
    code: GcodeProtocolCodeSchema,
    message: z.string().min(1).max(4_096),
  }),
});

export const GcodeAnalysisWorkerEventSchema = z.discriminatedUnion("type", [
  GcodeAnalysisWorkerResultEventSchema,
  GcodeAnalysisWorkerErrorEventSchema,
]);

export type GcodeAnalysisRequest = z.infer<typeof GcodeAnalysisRequestSchema>;
export type GcodeAnalysisDiagnostic = z.infer<
  typeof GcodeAnalysisDiagnosticSchema
>;
export type GcodeAnalysisResult = z.infer<typeof GcodeAnalysisResultSchema>;
export type GcodeAnalysisWorkerCommand = z.infer<
  typeof GcodeAnalysisWorkerCommandSchema
>;
export type GcodeAnalysisWorkerEvent = z.infer<
  typeof GcodeAnalysisWorkerEventSchema
>;

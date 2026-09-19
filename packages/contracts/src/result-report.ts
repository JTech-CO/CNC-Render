import { z } from "zod";
import { UuidSchema } from "./primitives";

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const identity = z.string().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().max(1_000_000);
export const ResultProvenanceSchema = z.strictObject({ runId: UuidSchema, fixtureId: identity, stateHash: hash, stockHash: hash, logicalTimeS: nonnegative,
  outcome: z.enum(["completed", "stopped"]), collisionCount: count, warningCount: count, diagnosticCount: count });

export const GeometricMeasurementSchema = z.strictObject({
  kind: z.enum(["distance", "diameter", "radius", "angle", "depth", "wall-thickness"]),
  canonicalValue: nonnegative,
  canonicalUnit: z.enum(["mm", "rad"]),
}).superRefine((value, context) => {
  if ((value.kind === "angle") !== (value.canonicalUnit === "rad")) {
    context.addIssue({ code: "custom", message: "Angles use rad; lengths use mm." });
  }
  if (value.kind === "angle" && value.canonicalValue > Math.PI) {
    context.addIssue({ code: "custom", message: "Included angle must not exceed pi." });
  }
});

export const ResultReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  accuracyGrade: z.literal("E2"),
  runId: UuidSchema,
  fixtureId: identity,
  stateHash: hash,
  stockHash: hash,
  targetId: identity,
  process: z.enum(["milling", "od-turning", "drilling"]),
  logicalTimeS: nonnegative,
  outcome: z.enum(["completed", "stopped"]),
  collisionCount: count,
  warningCount: count,
  diagnosticCount: count,
  comparedCells: z.number().int().positive().max(4_194_304),
  representationResolutionMm: finite.positive(),
  numericToleranceMm: finite.positive(),
  maxDeviationMm: nonnegative,
  meanAbsoluteDeviationMm: nonnegative,
  p95AbsoluteDeviationMm: nonnegative,
  quantileMethod: z.literal("nearest-rank-cell-absolute"),
  overcutVolumeMm3: nonnegative,
  undercutVolumeMm3: nonnegative,
  actualRemovedVolumeMm3: nonnegative,
  targetRemovedVolumeMm3: nonnegative,
  measurements: z.array(GeometricMeasurementSchema).max(100),
}).superRefine((report, context) => {
  if (report.collisionCount > report.diagnosticCount || report.warningCount > report.diagnosticCount) {
    context.addIssue({ code: "custom", message: "Event counts cannot exceed diagnostic count." });
  }
  if (report.meanAbsoluteDeviationMm > report.maxDeviationMm + report.numericToleranceMm ||
      report.p95AbsoluteDeviationMm > report.maxDeviationMm + report.numericToleranceMm) {
    context.addIssue({ code: "custom", message: "Mean and quantile must not exceed maximum deviation." });
  }
});

export type GeometricMeasurement = z.infer<typeof GeometricMeasurementSchema>;
export type ResultReport = z.infer<typeof ResultReportSchema>;

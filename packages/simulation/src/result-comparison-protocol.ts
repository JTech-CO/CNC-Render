import { ResultProvenanceSchema, ResultReportSchema } from "../../contracts/src/result-report";
import type { ResultComparison, ResultComparisonInput, ResultProvenance } from "./result-comparison";

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid result comparison object.");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some((key) => !(key in result))) throw new TypeError("Unexpected result comparison fields.");
  return result;
}
function requestId(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new TypeError("Invalid result comparison request ID.");
}
export function validateResultComparisonRequest(value: unknown): { readonly protocolVersion: 1; readonly requestId: number; readonly input: ResultComparisonInput } {
  const envelope = record(value, ["protocolVersion", "requestId", "input"]);
  if (envelope.protocolVersion !== 1) throw new TypeError("Unsupported result comparison protocol.");
  requestId(envelope.requestId);
  const input = record(envelope.input, ["surface", "target", "provenance"]);
  ResultProvenanceSchema.parse(input.provenance);
  for (const field of [input.surface, input.target]) if (!field || typeof field !== "object" || Array.isArray(field)) throw new TypeError("Missing Stock or target geometry.");
  // Full surface bounds, dimensions, finite radii/heights and authored target
  // validation remain in the shared Stock measurement adapters in this Worker.
  return value as { protocolVersion: 1; requestId: number; input: ResultComparisonInput };
}
export function validateResultComparisonResponse(value: unknown, expected: ResultProvenance, expectedId: number): ResultComparison {
  const candidate = value as { error?: unknown };
  const envelope = record(value, candidate?.error === undefined ? ["protocolVersion", "requestId", "result"] : ["protocolVersion", "requestId", "error"]);
  if (envelope.protocolVersion !== 1 || envelope.requestId !== expectedId) throw new TypeError("Mismatched result comparison response.");
  if ("error" in envelope) { if (typeof envelope.error !== "string" || envelope.error.length > 4096) throw new TypeError("Invalid result comparison error."); throw new Error(envelope.error); }
  const result = record(envelope.result, ["report", "field"]);
  const report = ResultReportSchema.parse(result.report);
  for (const key of ["runId", "fixtureId", "stateHash", "stockHash", "logicalTimeS", "outcome", "collisionCount", "warningCount", "diagnosticCount"] as const) if (report[key] !== expected[key]) throw new TypeError("Result provenance does not match the captured Stock.");
  const field = record(result.field, ["kind", "columns", "rows", "coordinatesMm", "actualMm", "targetMm", "signedDeviationMm"]);
  if ((field.kind !== "milling" && field.kind !== "turning") || (field.kind === "milling") !== (report.process === "milling")) throw new TypeError("Invalid result field representation.");
  if (!Number.isSafeInteger(field.columns) || !Number.isSafeInteger(field.rows) || Number(field.columns) < 1 || Number(field.rows) < 1) throw new TypeError("Invalid result field dimensions.");
  const count = Number(field.columns) * Number(field.rows);
  if (count !== report.comparedCells * (field.kind === "turning" ? 2 : 1) || (field.kind === "turning" && field.rows !== 2)) throw new TypeError("Inconsistent result field dimensions.");
  for (const key of ["actualMm", "targetMm", "signedDeviationMm", "coordinatesMm"] as const) {
    const array = field[key];
    if (!(array instanceof Float64Array) || array.length !== count * (key === "coordinatesMm" ? 3 : 1) || !array.every(Number.isFinite)) throw new TypeError("Invalid result field buffer.");
  }
  return { report, field: field as unknown as ResultComparison["field"] };
}

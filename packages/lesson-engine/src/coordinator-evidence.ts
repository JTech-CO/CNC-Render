import type { CoordinatorCoreSummary } from "@cnc-render/contracts";

import {
  LESSON_EVENTS,
  LessonEvidenceSchema,
  type LessonEvidence,
} from "./schema";

type CoordinatorOwnedMetric =
  | "logicalTimeS"
  | "removedVolumeMm3"
  | "collisionCount";

export type LessonExternalMetrics = Omit<
  LessonEvidence["metrics"],
  CoordinatorOwnedMetric
>;

export interface CoordinatorLessonEvidenceInput {
  readonly summary: CoordinatorCoreSummary;
  readonly selections: LessonEvidence["selections"];
  readonly completedEvents?: readonly Exclude<
    LessonEvidence["events"][number],
    "simulation.completed"
  >[];
  readonly metrics: LessonExternalMetrics;
}

export interface CoordinatorLessonEvidence {
  readonly source: "worker-wasm";
  readonly runId: string;
  readonly fixtureId: string;
  readonly processType: CoordinatorCoreSummary["processType"];
  readonly finalSemanticHashSha256: string;
  readonly stockHashSha256: string;
  readonly evidence: LessonEvidence;
}

export type CoordinatorLessonEvidenceErrorCode =
  | "lesson.evidence.run-not-terminal"
  | "lesson.evidence.final-hash-missing";

export class CoordinatorLessonEvidenceError extends Error {
  readonly code: CoordinatorLessonEvidenceErrorCode;

  constructor(code: CoordinatorLessonEvidenceErrorCode, message: string) {
    super(message);
    this.name = "CoordinatorLessonEvidenceError";
    this.code = code;
  }
}

export function createCoordinatorLessonEvidence(
  input: CoordinatorLessonEvidenceInput,
): CoordinatorLessonEvidence {
  const { summary } = input;
  const completedRun = summary.phase === "completed" && summary.completed;
  const collisionStop =
    summary.phase === "stopped" &&
    summary.stopped &&
    summary.collision !== null;
  if (!completedRun && !collisionStop) {
    throw new CoordinatorLessonEvidenceError(
      "lesson.evidence.run-not-terminal",
      "lesson evidence requires a completed run or collision stop",
    );
  }
  if (summary.finalSemanticHashSha256 === null) {
    throw new CoordinatorLessonEvidenceError(
      "lesson.evidence.final-hash-missing",
      "terminal lesson evidence requires a final semantic hash",
    );
  }

  const suppliedEvents = new Set(input.completedEvents ?? []);
  const events = LESSON_EVENTS.filter(
    (event) =>
      (event === "simulation.completed" && completedRun) ||
      (event !== "simulation.completed" && suppliedEvents.has(event)),
  );
  const evidence = LessonEvidenceSchema.parse({
    selections: input.selections,
    events,
    metrics: {
      ...input.metrics,
      logicalTimeS: summary.logicalTimeS,
      removedVolumeMm3: summary.removedVolumeMm3,
      collisionCount: summary.collision === null ? 0 : 1,
    },
  });

  return {
    source: "worker-wasm",
    runId: summary.runId,
    fixtureId: summary.fixtureId,
    processType: summary.processType,
    finalSemanticHashSha256: summary.finalSemanticHashSha256,
    stockHashSha256: summary.stockHashSha256,
    evidence,
  };
}

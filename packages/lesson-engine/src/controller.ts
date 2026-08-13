import {
  LESSON_EVENTS,
  LessonEvidenceSchema,
  type Lesson,
  type LessonAction,
  type LessonEvidence,
  type LessonStep,
} from "./schema";
import {
  decideLessonAction,
  evaluateLessonStep,
  parseLesson,
  type LessonActionDecision,
  type LessonStepEvaluation,
} from "./rules";
import { scoreLesson, type LessonScoreResult } from "./scoring";

export type LessonControllerStatus = "active" | "failed" | "completed";

export interface LessonEvidencePatch {
  readonly selections?: Partial<LessonEvidence["selections"]>;
  readonly events?: readonly LessonEvidence["events"][number][];
  readonly metrics?: Partial<LessonEvidence["metrics"]>;
}

export interface LessonControllerGuidance {
  readonly kind: "off-sequence" | "failure";
  readonly action: LessonAction | null;
  readonly reason: string;
  readonly recovery: LessonStep["offSequenceGuidance"]["recovery"];
}

export interface LessonControllerSnapshot {
  readonly lesson: Lesson;
  readonly status: LessonControllerStatus;
  readonly currentStepIndex: number;
  readonly currentStep: LessonStep;
  readonly completedStepIds: readonly string[];
  readonly evidence: LessonEvidence;
  readonly lastEvaluation: LessonStepEvaluation | null;
  readonly guidance: LessonControllerGuidance | null;
  readonly score: LessonScoreResult | null;
}

export interface LessonControllerTransition {
  readonly decision: LessonActionDecision;
  readonly snapshot: LessonControllerSnapshot;
}

export type LessonControllerErrorCode = "lesson.controller.completed";

export class LessonControllerError extends Error {
  readonly code: LessonControllerErrorCode;

  constructor(code: LessonControllerErrorCode, message: string) {
    super(message);
    this.name = "LessonControllerError";
    this.code = code;
  }
}

function emptyEvidence(): LessonEvidence {
  return LessonEvidenceSchema.parse({
    selections: {},
    events: [],
    metrics: {},
  });
}

function cloneEvidence(evidence: LessonEvidence): LessonEvidence {
  return {
    selections: { ...evidence.selections },
    events: [...evidence.events],
    metrics: { ...evidence.metrics },
  };
}

function mergeEvidence(
  evidence: LessonEvidence,
  patch: LessonEvidencePatch,
): LessonEvidence {
  const parsed = LessonEvidenceSchema.parse({
    selections: {
      ...evidence.selections,
      ...patch.selections,
    },
    events: [...evidence.events, ...(patch.events ?? [])],
    metrics: {
      ...evidence.metrics,
      ...patch.metrics,
    },
  });
  const eventSet = new Set(parsed.events);
  return {
    ...parsed,
    events: LESSON_EVENTS.filter((event) => eventSet.has(event)),
  };
}

export class LessonController {
  readonly #lesson: Lesson;

  #status: LessonControllerStatus = "active";
  #currentStepIndex = 0;
  #completedStepIds: string[] = [];
  #evidence = emptyEvidence();
  #stepCheckpoint = emptyEvidence();
  #lastEvaluation: LessonStepEvaluation | null = null;
  #guidance: LessonControllerGuidance | null = null;
  #score: LessonScoreResult | null = null;

  constructor(lessonInput: unknown) {
    this.#lesson = parseLesson(lessonInput);
  }

  dispatch(
    action: LessonAction,
    patch: LessonEvidencePatch = {},
  ): LessonControllerTransition {
    if (this.#status === "completed") {
      throw new LessonControllerError(
        "lesson.controller.completed",
        "reset the completed lesson before dispatching another action",
      );
    }

    const step = this.#lesson.steps[this.#currentStepIndex];
    const decision = decideLessonAction(this.#lesson, step.id, action);
    if (decision.outcome === "guided-warning") {
      this.#guidance = {
        kind: "off-sequence",
        action,
        reason: decision.reason!,
        recovery: decision.recovery!,
      };
      return { decision, snapshot: this.getSnapshot() };
    }

    const nextEvidence = mergeEvidence(this.#evidence, patch);
    const evaluation = evaluateLessonStep(
      this.#lesson,
      step.id,
      nextEvidence,
    );
    if (evaluation.status === "failed") {
      this.#evidence = nextEvidence;
      this.#status = "failed";
      this.#lastEvaluation = evaluation;
      this.#guidance = {
        kind: "failure",
        action,
        reason: evaluation.failureReason!,
        recovery: step.offSequenceGuidance.recovery,
      };
      return { decision, snapshot: this.getSnapshot() };
    }

    if (evaluation.status === "incomplete") {
      this.#evidence = nextEvidence;
      this.#status = "active";
      this.#lastEvaluation = evaluation;
      this.#guidance = null;
      return { decision, snapshot: this.getSnapshot() };
    }

    const isFinalStep =
      this.#currentStepIndex === this.#lesson.steps.length - 1;
    const score = isFinalStep
      ? scoreLesson(this.#lesson, nextEvidence)
      : null;
    this.#evidence = nextEvidence;
    this.#completedStepIds = [...this.#completedStepIds, step.id];
    this.#lastEvaluation = evaluation;
    this.#guidance = null;
    if (isFinalStep) {
      this.#status = "completed";
      this.#score = score;
    } else {
      this.#status = "active";
      this.#currentStepIndex += 1;
      this.#stepCheckpoint = cloneEvidence(nextEvidence);
    }
    return { decision, snapshot: this.getSnapshot() };
  }

  restoreStepCheckpoint(): LessonControllerSnapshot {
    this.#evidence = cloneEvidence(this.#stepCheckpoint);
    this.#status = "active";
    this.#lastEvaluation = null;
    this.#guidance = null;
    this.#score = null;
    return this.getSnapshot();
  }

  reset(): LessonControllerSnapshot {
    this.#status = "active";
    this.#currentStepIndex = 0;
    this.#completedStepIds = [];
    this.#evidence = emptyEvidence();
    this.#stepCheckpoint = emptyEvidence();
    this.#lastEvaluation = null;
    this.#guidance = null;
    this.#score = null;
    return this.getSnapshot();
  }

  getSnapshot(): LessonControllerSnapshot {
    return {
      lesson: structuredClone(this.#lesson),
      status: this.#status,
      currentStepIndex: this.#currentStepIndex,
      currentStep: structuredClone(
        this.#lesson.steps[this.#currentStepIndex],
      ),
      completedStepIds: [...this.#completedStepIds],
      evidence: cloneEvidence(this.#evidence),
      lastEvaluation:
        this.#lastEvaluation === null
          ? null
          : structuredClone(this.#lastEvaluation),
      guidance:
        this.#guidance === null ? null : structuredClone(this.#guidance),
      score: this.#score === null ? null : structuredClone(this.#score),
    };
  }
}

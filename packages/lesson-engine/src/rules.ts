import {
  LessonActionSchema,
  LessonEvidenceSchema,
  LessonSchema,
  type Lesson,
  type LessonEvidence,
  type LessonRule,
  type LessonStep,
} from "./schema";

export type LessonRuleErrorCode = "lesson.step.not-found";

export class LessonRuleError extends Error {
  readonly code: LessonRuleErrorCode;

  constructor(code: LessonRuleErrorCode, message: string) {
    super(message);
    this.name = "LessonRuleError";
    this.code = code;
  }
}

export interface LessonActionDecision {
  lessonId: string;
  stepId: string;
  outcome: "allowed" | "guided-warning";
  action: string;
  reason: string | null;
  recovery: LessonStep["offSequenceGuidance"]["recovery"] | null;
}

export interface LessonStepEvaluation {
  lessonId: string;
  stepId: string;
  status: "completed" | "failed" | "incomplete";
  matchedFailureRuleId: string | null;
  failureReason: string | null;
  unmetSuccessRuleIds: string[];
}

export function parseLesson(input: unknown): Lesson {
  return LessonSchema.parse(input);
}

function findStep(lesson: Lesson, stepId: string): LessonStep {
  const step = lesson.steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw new LessonRuleError(
      "lesson.step.not-found",
      "lesson step was not found: " + stepId,
    );
  }
  return step;
}

function matchesRule(rule: LessonRule, evidence: LessonEvidence): boolean {
  if (rule.kind === "selection.matches") {
    const selectedId = evidence.selections[rule.field];
    if (selectedId === undefined) {
      return false;
    }
    return rule.operator === "equals"
      ? selectedId === rule.expectedId
      : selectedId !== rule.expectedId;
  }

  if (rule.kind === "event.occurred") {
    return evidence.events.includes(rule.event);
  }

  const metricValue = evidence.metrics[rule.metric];
  if (metricValue === undefined) {
    return false;
  }
  if (rule.minimum !== undefined && metricValue < rule.minimum) {
    return false;
  }
  if (rule.maximum !== undefined && metricValue > rule.maximum) {
    return false;
  }
  return true;
}

export function decideLessonAction(
  lessonInput: unknown,
  stepId: string,
  actionInput: unknown,
): LessonActionDecision {
  const lesson = parseLesson(lessonInput);
  const step = findStep(lesson, stepId);
  const action = LessonActionSchema.parse(actionInput);

  if (step.allowedActions.includes(action)) {
    return {
      lessonId: lesson.id,
      stepId,
      outcome: "allowed",
      action,
      reason: null,
      recovery: null,
    };
  }

  return {
    lessonId: lesson.id,
    stepId,
    outcome: "guided-warning",
    action,
    reason: step.offSequenceGuidance.reason,
    recovery: step.offSequenceGuidance.recovery,
  };
}

export function evaluateLessonStep(
  lessonInput: unknown,
  stepId: string,
  evidenceInput: unknown,
): LessonStepEvaluation {
  const lesson = parseLesson(lessonInput);
  const step = findStep(lesson, stepId);
  const evidence = LessonEvidenceSchema.parse(evidenceInput);
  const matchedFailure = step.failureRules.find((rule) =>
    matchesRule(rule, evidence),
  );

  if (matchedFailure) {
    return {
      lessonId: lesson.id,
      stepId,
      status: "failed",
      matchedFailureRuleId: matchedFailure.id,
      failureReason: matchedFailure.message,
      unmetSuccessRuleIds: [],
    };
  }

  const unmetSuccessRuleIds = step.successRules
    .filter((rule) => !matchesRule(rule, evidence))
    .map((rule) => rule.id);

  return {
    lessonId: lesson.id,
    stepId,
    status: unmetSuccessRuleIds.length === 0 ? "completed" : "incomplete",
    matchedFailureRuleId: null,
    failureReason: null,
    unmetSuccessRuleIds,
  };
}

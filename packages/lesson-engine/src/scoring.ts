import {
  LessonEvidenceSchema,
  type LessonEvidence,
  type LessonScoreMetric,
  type LessonScoringPolicy,
} from "./schema";
import { parseLesson } from "./rules";

export type LessonScoreErrorCode = "lesson.score.metric-missing";

export class LessonScoreError extends Error {
  readonly code: LessonScoreErrorCode;
  readonly metric: LessonScoreMetric;

  constructor(metric: LessonScoreMetric) {
    super("lesson score requires metric: " + metric);
    this.name = "LessonScoreError";
    this.code = "lesson.score.metric-missing";
    this.metric = metric;
  }
}

export interface LessonScoreCriterionResult {
  readonly id: string;
  readonly metric: LessonScoreMetric;
  readonly value: number;
  readonly points: number;
  readonly maximumPoints: number;
}

export interface LessonScoreResult {
  readonly lessonId: string;
  readonly score: number;
  readonly maximumScore: 100;
  readonly passingScore: number;
  readonly passed: boolean;
  readonly criteria: readonly LessonScoreCriterionResult[];
}

function round(value: number, precisionDigits: number): number {
  const scale = 10 ** precisionDigits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function scoreCriterion(
  policy: LessonScoringPolicy,
  criterion: LessonScoringPolicy["criteria"][number],
  evidence: LessonEvidence,
): LessonScoreCriterionResult {
  const value = evidence.metrics[criterion.metric];
  if (value === undefined) {
    throw new LessonScoreError(criterion.metric);
  }

  const ratio =
    value <= criterion.fullPointsAtOrBelow
      ? 1
      : value >= criterion.zeroPointsAtOrAbove
        ? 0
        : 1 -
          (value - criterion.fullPointsAtOrBelow) /
            (criterion.zeroPointsAtOrAbove - criterion.fullPointsAtOrBelow);

  return {
    id: criterion.id,
    metric: criterion.metric,
    value,
    points: round(criterion.weight * ratio, policy.precisionDigits),
    maximumPoints: criterion.weight,
  };
}

export function scoreLesson(
  lessonInput: unknown,
  evidenceInput: unknown,
): LessonScoreResult {
  const lesson = parseLesson(lessonInput);
  const evidence = LessonEvidenceSchema.parse(evidenceInput);
  const criteria = lesson.scoring.criteria.map((criterion) =>
    scoreCriterion(lesson.scoring, criterion, evidence),
  );
  const score = round(
    criteria.reduce((total, criterion) => total + criterion.points, 0),
    lesson.scoring.precisionDigits,
  );

  return {
    lessonId: lesson.id,
    score,
    maximumScore: lesson.scoring.maximumScore,
    passingScore: lesson.scoring.passingScore,
    passed: score >= lesson.scoring.passingScore,
    criteria,
  };
}

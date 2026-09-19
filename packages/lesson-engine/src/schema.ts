import * as z from "zod";

const StableIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u);
const ShortTextSchema = z.string().min(1).max(160);
const LongTextSchema = z.string().min(1).max(640);
const FiniteNumberSchema = z.number().finite();
const NonNegativeNumberSchema = FiniteNumberSchema.nonnegative();

export const LESSON_PHASES = [
  "prepare",
  "setup",
  "execute",
  "measure",
  "assess",
] as const;

export const LessonPhaseSchema = z.enum(LESSON_PHASES);

export const LESSON_ACTIONS = [
  "machine.select",
  "stock.configure",
  "material.select",
  "fixture.select",
  "tool.select",
  "operation.configure",
  "simulation.run",
  "measurement.record",
  "result.review",
] as const;

export const LessonActionSchema = z.enum(LESSON_ACTIONS);

export const LESSON_EVENTS = [
  "setup.completed",
  "simulation.completed",
  "measurement.recorded",
  "result.reviewed",
] as const;

export const LessonEventSchema = z.enum(LESSON_EVENTS);

export const LessonMetricSchema = z.enum([
  "logicalTimeS",
  "removedVolumeMm3",
  "collisionCount",
  "toolCount",
  "maxDeviationMm",
  "overcutVolumeMm3",
  "undercutVolumeMm3",
  "cutDepthMm",
]);

export const LESSON_SCORE_METRICS = [
  "maxDeviationMm",
  "collisionCount",
  "logicalTimeS",
  "toolCount",
  "overcutVolumeMm3",
  "undercutVolumeMm3",
] as const;

export const LessonScoreMetricSchema = z.enum(LESSON_SCORE_METRICS);

export const LessonScoreCriterionSchema = z
  .strictObject({
    id: StableIdSchema,
    metric: LessonScoreMetricSchema,
    weight: FiniteNumberSchema.positive().max(100),
    fullPointsAtOrBelow: NonNegativeNumberSchema,
    zeroPointsAtOrAbove: NonNegativeNumberSchema,
  })
  .superRefine((criterion, context) => {
    if (criterion.zeroPointsAtOrAbove <= criterion.fullPointsAtOrBelow) {
      context.addIssue({
        code: "custom",
        path: ["zeroPointsAtOrAbove"],
        message: "zero-point boundary must be greater than the full-point boundary",
      });
    }
  });

export const LessonScoringPolicySchema = z
  .strictObject({
    maximumScore: z.literal(100),
    passingScore: FiniteNumberSchema.min(0).max(100),
    precisionDigits: z.literal(2),
    criteria: z
      .array(LessonScoreCriterionSchema)
      .length(LESSON_SCORE_METRICS.length),
  })
  .superRefine((policy, context) => {
    const criterionIds = new Set<string>();
    const metrics = new Set<string>();
    let totalWeight = 0;

    policy.criteria.forEach((criterion, index) => {
      if (criterionIds.has(criterion.id)) {
        context.addIssue({
          code: "custom",
          path: ["criteria", index, "id"],
          message: "score criterion IDs must be unique",
        });
      }
      if (metrics.has(criterion.metric)) {
        context.addIssue({
          code: "custom",
          path: ["criteria", index, "metric"],
          message: "each score metric must be declared exactly once",
        });
      }
      criterionIds.add(criterion.id);
      metrics.add(criterion.metric);
      totalWeight += criterion.weight;
    });

    LESSON_SCORE_METRICS.forEach((metric) => {
      if (!metrics.has(metric)) {
        context.addIssue({
          code: "custom",
          path: ["criteria"],
          message: "score policy is missing metric: " + metric,
        });
      }
    });

    if (Math.abs(totalWeight - policy.maximumScore) > 1e-9) {
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "score criterion weights must sum to maximumScore",
      });
    }
  });

export const LessonSelectionFieldSchema = z.enum([
  "machineId",
  "stockId",
  "materialId",
  "fixtureId",
  "toolId",
  "operationId",
]);

const SelectionRuleSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.literal("selection.matches"),
  field: LessonSelectionFieldSchema,
  operator: z.enum(["equals", "not-equals"]),
  expectedId: StableIdSchema,
  message: LongTextSchema,
});

const EventRuleSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.literal("event.occurred"),
  event: LessonEventSchema,
  message: LongTextSchema,
});

const MetricRangeRuleSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.literal("metric.range"),
  metric: LessonMetricSchema,
  minimum: FiniteNumberSchema.optional(),
  maximum: FiniteNumberSchema.optional(),
  message: LongTextSchema,
});

export const LessonRuleSchema = z
  .discriminatedUnion("kind", [
    SelectionRuleSchema,
    EventRuleSchema,
    MetricRangeRuleSchema,
  ])
  .superRefine((rule, context) => {
    if (rule.kind !== "metric.range") {
      return;
    }

    if (rule.minimum === undefined && rule.maximum === undefined) {
      context.addIssue({
        code: "custom",
        path: ["minimum"],
        message: "metric range must define at least one inclusive bound",
      });
    }

    if (
      rule.minimum !== undefined &&
      rule.maximum !== undefined &&
      rule.minimum > rule.maximum
    ) {
      context.addIssue({
        code: "custom",
        path: ["minimum"],
        message: "metric minimum must not exceed maximum",
      });
    }
  });

const RecoverySchema = z.strictObject({
  kind: z.literal("restore-step-checkpoint"),
  label: ShortTextSchema,
});

export const LessonStepSchema = z.strictObject({
  id: StableIdSchema,
  phase: LessonPhaseSchema,
  title: ShortTextSchema,
  instruction: LongTextSchema,
  allowedActions: z.array(LessonActionSchema).min(1),
  offSequenceGuidance: z.strictObject({
    reason: LongTextSchema,
    recovery: RecoverySchema,
  }),
  successRules: z.array(LessonRuleSchema).min(1),
  failureRules: z.array(LessonRuleSchema),
});

const phaseOrder = new Map(
  LESSON_PHASES.map((phase, index) => [phase, index] as const),
);

export const LessonSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: StableIdSchema,
    locale: z.literal("ko-KR"),
    title: ShortTextSchema,
    process: z.enum(["face-milling", "od-turning", "drilling"]),
    accuracy: z.strictObject({
      grade: z.literal("E2"),
      limitations: z.array(LongTextSchema).min(1),
    }),
    prerequisites: z.array(StableIdSchema),
    estimatedDurationMin: FiniteNumberSchema.positive(),
    scoring: LessonScoringPolicySchema,
    steps: z.array(LessonStepSchema).min(5),
  })
  .superRefine((lesson, context) => {
    const prerequisiteIds = new Set<string>();
    lesson.prerequisites.forEach((prerequisiteId, index) => {
      if (
        prerequisiteId === lesson.id ||
        prerequisiteIds.has(prerequisiteId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["prerequisites", index],
          message: "lesson prerequisites must be unique and cannot be self-references",
        });
      }
      prerequisiteIds.add(prerequisiteId);
    });

    const stepIds = new Set<string>();
    const ruleIds = new Set<string>();
    const seenPhases = new Set<string>();
    let previousPhaseIndex = -1;

    lesson.steps.forEach((step, stepIndex) => {
      if (stepIds.has(step.id)) {
        context.addIssue({
          code: "custom",
          path: ["steps", stepIndex, "id"],
          message: "lesson step IDs must be unique",
        });
      }
      stepIds.add(step.id);

      const currentPhaseIndex = phaseOrder.get(step.phase) ?? -1;
      if (currentPhaseIndex < previousPhaseIndex) {
        context.addIssue({
          code: "custom",
          path: ["steps", stepIndex, "phase"],
          message: "lesson phases must follow prepare, setup, execute, measure, assess",
        });
      }
      previousPhaseIndex = currentPhaseIndex;
      seenPhases.add(step.phase);

      const actions = new Set<string>();
      step.allowedActions.forEach((action, actionIndex) => {
        if (actions.has(action)) {
          context.addIssue({
            code: "custom",
            path: ["steps", stepIndex, "allowedActions", actionIndex],
            message: "allowed actions must be unique within a step",
          });
        }
        actions.add(action);
      });

      (
        [
          ["successRules", step.successRules],
          ["failureRules", step.failureRules],
        ] as const
      ).forEach(([ruleCollectionName, rules]) => {
        rules.forEach((rule, ruleIndex) => {
          if (ruleIds.has(rule.id)) {
            context.addIssue({
              code: "custom",
              path: [
                "steps",
                stepIndex,
                ruleCollectionName,
                ruleIndex,
                "id",
              ],
              message: "lesson rule IDs must be unique",
            });
          }
          ruleIds.add(rule.id);
        });
      });
    });

    LESSON_PHASES.forEach((phase) => {
      if (!seenPhases.has(phase)) {
        context.addIssue({
          code: "custom",
          path: ["steps"],
          message: "lesson must include every tutorial phase: " + phase,
        });
      }
    });
  });

const SelectionEvidenceSchema = z.strictObject({
  machineId: StableIdSchema.optional(),
  stockId: StableIdSchema.optional(),
  materialId: StableIdSchema.optional(),
  fixtureId: StableIdSchema.optional(),
  toolId: StableIdSchema.optional(),
  operationId: StableIdSchema.optional(),
});

const MetricEvidenceSchema = z.strictObject({
  logicalTimeS: NonNegativeNumberSchema.optional(),
  removedVolumeMm3: NonNegativeNumberSchema.optional(),
  collisionCount: NonNegativeNumberSchema.int().optional(),
  toolCount: NonNegativeNumberSchema.int().optional(),
  maxDeviationMm: NonNegativeNumberSchema.optional(),
  overcutVolumeMm3: NonNegativeNumberSchema.optional(),
  undercutVolumeMm3: NonNegativeNumberSchema.optional(),
  cutDepthMm: NonNegativeNumberSchema.optional(),
});

export const LessonEvidenceSchema = z.strictObject({
  selections: SelectionEvidenceSchema,
  events: z.array(LessonEventSchema),
  metrics: MetricEvidenceSchema,
});

export type Lesson = z.infer<typeof LessonSchema>;
export type LessonAction = z.infer<typeof LessonActionSchema>;
export type LessonEvidence = z.infer<typeof LessonEvidenceSchema>;
export type LessonRule = z.infer<typeof LessonRuleSchema>;
export type LessonScoreMetric = z.infer<typeof LessonScoreMetricSchema>;
export type LessonScoringPolicy = z.infer<typeof LessonScoringPolicySchema>;
export type LessonStep = z.infer<typeof LessonStepSchema>;

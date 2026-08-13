import { readFileSync } from "node:fs";

import type { CoordinatorCoreSummary } from "@cnc-render/contracts";
import {
  LESSON_EVENTS,
  LESSON_PHASES,
  LessonRuleSchema,
  LessonSchema,
  createCoordinatorLessonEvidence,
  decideLessonAction,
  evaluateLessonStep,
  parseLesson,
  scoreLesson,
} from "@cnc-render/lesson-engine";
import { describe, expect, it } from "vitest";

const HASH = "a".repeat(64);
const faceMillingDocument = JSON.parse(
  readFileSync(
    new URL("../../content/lessons/ko/face-milling.lesson.json", import.meta.url),
    "utf8",
  ),
) as unknown;

const completeEvidence = {
  selections: {
    machineId: "machine.vmc-3x-edu",
    stockId: "stock.face-milling-360x200x88",
    materialId: "material.aluminum-6061",
    fixtureId: "fixture.vise-150",
    toolId: "tool.flat-end-mill-20",
    operationId: "operation.face-milling-balanced",
  },
  events: [
    "setup.completed",
    "simulation.completed",
    "measurement.recorded",
    "result.reviewed",
  ],
  metrics: {
    logicalTimeS: 52.26,
    removedVolumeMm3: 357_888,
    collisionCount: 0,
    toolCount: 1,
    maxDeviationMm: 0.2,
    overcutVolumeMm3: 0,
    undercutVolumeMm3: 0,
    cutDepthMm: 2,
  },
} as const;
const completedSummary = {
  schemaVersion: 1,
  coreVersion: "0.9.0",
  wasm: true,
  phase: "completed",
  runId: "a0000000-0000-4000-8000-000000000001",
  fixtureId: "m7-milling",
  processType: "milling",
  toolpathId: "a0000000-0000-4000-8000-000000000002",
  parseSemanticHashSha256: HASH,
  stateSemanticHashSha256: HASH,
  finalSemanticHashSha256: HASH,
  stockHashSha256: HASH,
  currentStep: 12,
  totalSteps: 12,
  logicalTimeS: 52.26,
  toolPositionMm: { xMm: 170, yMm: 80, zMm: 370 },
  stockRevision: 12,
  removedVolumeMm3: 357_888,
  diagnosticCodes: [],
  collision: null,
  completed: true,
  stopped: false,
  render: null,
  binaryLayout: [],
  binaryByteLength: 0,
} satisfies CoordinatorCoreSummary;
const externalMetrics = {
  toolCount: 1,
  maxDeviationMm: 0.2,
  overcutVolumeMm3: 0,
  undercutVolumeMm3: 0,
  cutDepthMm: 2,
} as const;

describe("M10 tutorial rules", () => {
  it("parses the Korean face-milling fixture with every ordered E2 phase", () => {
    const lesson = parseLesson(faceMillingDocument);

    expect(lesson.accuracy.grade).toBe("E2");
    expect(lesson.accuracy.limitations).toHaveLength(2);
    expect(lesson.steps.map((step) => step.phase)).toEqual(LESSON_PHASES);
  });

  it("rejects duplicate actions, missing phases, and non-finite metric bounds", () => {
    const duplicateAction = parseLesson(faceMillingDocument);
    duplicateAction.steps[0].allowedActions.push("machine.select");
    expect(LessonSchema.safeParse(duplicateAction).success).toBe(false);

    const missingPhase = parseLesson(faceMillingDocument);
    missingPhase.steps = missingPhase.steps.filter(
      (step) => step.phase !== "measure",
    );
    expect(LessonSchema.safeParse(missingPhase).success).toBe(false);

    expect(
      LessonRuleSchema.safeParse({
        id: "invalid.metric",
        kind: "metric.range",
        metric: "logicalTimeS",
        maximum: Number.NaN,
        message: "유한한 값만 허용합니다.",
      }).success,
    ).toBe(false);
  });

  it("allows authored actions and guides off-sequence actions without blocking", () => {
    const lesson = parseLesson(faceMillingDocument);

    expect(decideLessonAction(lesson, "execute-cut", "simulation.run")).toEqual({
      lessonId: lesson.id,
      stepId: "execute-cut",
      outcome: "allowed",
      action: "simulation.run",
      reason: null,
      recovery: null,
    });

    const warning = decideLessonAction(
      lesson,
      "execute-cut",
      "operation.configure",
    );
    expect(warning.outcome).toBe("guided-warning");
    expect(warning.reason).toContain("실행");
    expect(warning.recovery).toEqual({
      kind: "restore-step-checkpoint",
      label: "실행 단계 체크포인트로 되돌리기",
    });
  });

  it("completes all five phases from explicit engine evidence", () => {
    const lesson = parseLesson(faceMillingDocument);

    for (const step of lesson.steps) {
      expect(evaluateLessonStep(lesson, step.id, completeEvidence)).toMatchObject(
        {
          lessonId: lesson.id,
          stepId: step.id,
          status: "completed",
          matchedFailureRuleId: null,
          unmetSuccessRuleIds: [],
        },
      );
    }
  });

  it("reports wrong tool, excessive depth, and collision by authored precedence", () => {
    const lesson = parseLesson(faceMillingDocument);
    const wrongToolAndDepth = {
      ...completeEvidence,
      selections: {
        ...completeEvidence.selections,
        toolId: "tool.ball-end-mill-10",
      },
      metrics: {
        ...completeEvidence.metrics,
        cutDepthMm: 8,
      },
    };

    expect(
      evaluateLessonStep(lesson, "setup-face-milling", wrongToolAndDepth),
    ).toMatchObject({
      status: "failed",
      matchedFailureRuleId: "setup.wrong-tool",
    });

    expect(
      evaluateLessonStep(lesson, "setup-face-milling", {
        ...completeEvidence,
        metrics: {
          ...completeEvidence.metrics,
          cutDepthMm: 8,
        },
      }),
    ).toMatchObject({
      status: "failed",
      matchedFailureRuleId: "setup.excessive-depth",
    });

    expect(
      evaluateLessonStep(lesson, "execute-cut", {
        ...completeEvidence,
        metrics: {
          ...completeEvidence.metrics,
          collisionCount: 1,
        },
      }),
    ).toMatchObject({
      status: "failed",
      matchedFailureRuleId: "execute.collision",
    });
  });

  it("returns unmet success rules deterministically without mutating evidence", () => {
    const lesson = parseLesson(faceMillingDocument);
    const incompleteEvidence = {
      selections: completeEvidence.selections,
      events: [],
      metrics: {
        collisionCount: 0,
      },
    };
    const before = structuredClone(incompleteEvidence);

    const first = evaluateLessonStep(
      lesson,
      "execute-cut",
      incompleteEvidence,
    );
    const second = evaluateLessonStep(
      lesson,
      "execute-cut",
      incompleteEvidence,
    );

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "incomplete",
      matchedFailureRuleId: null,
      unmetSuccessRuleIds: ["execute.completed", "execute.removal"],
    });
    expect(incompleteEvidence).toEqual(before);
  });

  it("maps terminal Worker/WASM summaries to ordered explicit lesson evidence", () => {
    const mapped = createCoordinatorLessonEvidence({
      summary: completedSummary,
      selections: completeEvidence.selections,
      completedEvents: [
        "result.reviewed",
        "setup.completed",
        "measurement.recorded",
        "setup.completed",
      ],
      metrics: externalMetrics,
    });

    expect(mapped).toMatchObject({
      source: "worker-wasm",
      runId: completedSummary.runId,
      fixtureId: "m7-milling",
      processType: "milling",
      finalSemanticHashSha256: HASH,
      stockHashSha256: HASH,
    });
    expect(mapped.evidence.events).toEqual(LESSON_EVENTS);
    expect(mapped.evidence.metrics).toEqual(completeEvidence.metrics);
    expect(scoreLesson(faceMillingDocument, mapped.evidence)).toMatchObject({
      lessonId: "tutorial.face-milling",
      score: 100,
      maximumScore: 100,
      passingScore: 80,
      passed: true,
    });
  });

  it("maps a collision stop without claiming simulation completion", () => {
    const collision = createCoordinatorLessonEvidence({
      summary: {
        ...completedSummary,
        phase: "stopped",
        collision: {
          code: "collision.fixture-stop",
          objectAId: "a0000000-0000-4000-8000-000000000003",
          objectBId: "a0000000-0000-4000-8000-000000000004",
          positionMm: { xMm: 0, yMm: 0, zMm: 0 },
          penetrationEstimateMm: 1,
          sourceLine: 4,
        },
        completed: false,
        stopped: true,
      },
      selections: completeEvidence.selections,
      metrics: externalMetrics,
    });

    expect(collision.evidence.events).not.toContain("simulation.completed");
    expect(collision.evidence.metrics.collisionCount).toBe(1);
    expect(
      evaluateLessonStep(
        faceMillingDocument,
        "execute-cut",
        collision.evidence,
      ),
    ).toMatchObject({
      status: "failed",
      matchedFailureRuleId: "execute.collision",
    });
  });

  it("rejects progress summaries and missing score metrics", () => {
    expect(() =>
      createCoordinatorLessonEvidence({
        summary: {
          ...completedSummary,
          phase: "progress",
          finalSemanticHashSha256: null,
          completed: false,
        },
        selections: completeEvidence.selections,
        metrics: externalMetrics,
      }),
    ).toThrowError("lesson evidence requires a completed run or collision stop");

    expect(() =>
      createCoordinatorLessonEvidence({
        summary: {
          ...completedSummary,
          phase: "stopped",
          completed: false,
          stopped: true,
          collision: null,
        },
        selections: completeEvidence.selections,
        metrics: externalMetrics,
      }),
    ).toThrowError("lesson evidence requires a completed run or collision stop");

    expect(() =>
      scoreLesson(faceMillingDocument, {
        ...completeEvidence,
        metrics: {
          logicalTimeS: 52.26,
          removedVolumeMm3: 357_888,
          collisionCount: 0,
        },
      }),
    ).toThrowError("lesson score requires metric: maxDeviationMm");
  });

  it("calculates every documented score component deterministically", () => {
    const evidence = {
      ...completeEvidence,
      metrics: {
        ...completeEvidence.metrics,
        maxDeviationMm: 0.6,
        collisionCount: 1,
        logicalTimeS: 82.5,
        toolCount: 2,
        overcutVolumeMm3: 17_894.4,
        undercutVolumeMm3: 35_788.8,
      },
    };
    const before = structuredClone(evidence);
    const first = scoreLesson(faceMillingDocument, evidence);
    const second = scoreLesson(faceMillingDocument, evidence);

    expect(first).toEqual(second);
    expect(first.score).toBe(32.5);
    expect(first.passed).toBe(false);
    expect(first.criteria.map(({ points }) => points)).toEqual([
      15, 0, 7.5, 5, 5, 0,
    ]);
    expect(evidence).toEqual(before);
  });
});

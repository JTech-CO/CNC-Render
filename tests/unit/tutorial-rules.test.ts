import { readFileSync } from "node:fs";

import type { CoordinatorCoreSummary } from "@cnc-render/contracts";
import {
  LESSON_EVENTS,
  LESSON_PHASES,
  LessonController,
  LessonRuleSchema,
  LessonSchema,
  createCoordinatorLessonEvidence,
  decideLessonAction,
  evaluateLessonStep,
  parseLesson,
  scoreLesson,
} from "@cnc-render/lesson-engine";
import {
  DrillingLessonController,
  FaceMillingLessonController,
  OdTurningLessonController,
} from "@cnc-render/web/foundation";
import type { TurningTargetMeasurement } from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";

const HASH = "a".repeat(64);
const faceMillingDocument = JSON.parse(
  readFileSync(
    new URL("../../content/lessons/ko/face-milling.lesson.json", import.meta.url),
    "utf8",
  ),
) as unknown;
const odTurningDocument = JSON.parse(
  readFileSync(
    new URL("../../content/lessons/ko/od-turning.lesson.json", import.meta.url),
    "utf8",
  ),
) as unknown;
const drillingDocument = JSON.parse(
  readFileSync(
    new URL("../../content/lessons/ko/drilling.lesson.json", import.meta.url),
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
    cutDepthMm: 4,
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
  cutDepthMm: 4,
} as const;

describe("M10 tutorial rules", () => {
  it("parses the Korean face-milling fixture with every ordered E2 phase", () => {
    const lesson = parseLesson(faceMillingDocument);

    expect(lesson.accuracy.grade).toBe("E2");
    expect(lesson.accuracy.limitations).toHaveLength(3);
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

  it("advances, guides, restores, and scores through the generic five-step controller", () => {
    const controller = new LessonController(faceMillingDocument);
    const warning = controller.dispatch("simulation.run");
    expect(warning.decision.outcome).toBe("guided-warning");
    expect(warning.snapshot.currentStep.phase).toBe("prepare");
    expect(warning.snapshot.evidence.events).toEqual([]);
    expect(controller.restoreStepCheckpoint().guidance).toBeNull();

    controller.dispatch("machine.select", {
      selections: {
        machineId: completeEvidence.selections.machineId,
        stockId: completeEvidence.selections.stockId,
        materialId: completeEvidence.selections.materialId,
      },
    });
    controller.dispatch("operation.configure", {
      selections: {
        fixtureId: completeEvidence.selections.fixtureId,
        toolId: completeEvidence.selections.toolId,
        operationId: completeEvidence.selections.operationId,
      },
      events: ["setup.completed"],
      metrics: { cutDepthMm: 4, toolCount: 1 },
    });
    controller.dispatch("simulation.run", {
      events: ["simulation.completed"],
      metrics: {
        logicalTimeS: completedSummary.logicalTimeS,
        removedVolumeMm3: completedSummary.removedVolumeMm3,
        collisionCount: 0,
      },
    });
    controller.dispatch("measurement.record", {
      events: ["measurement.recorded"],
      metrics: {
        maxDeviationMm: 0,
        overcutVolumeMm3: 0,
        undercutVolumeMm3: 0,
      },
    });
    const completed = controller.dispatch("result.review", {
      events: ["result.reviewed"],
    }).snapshot;

    expect(completed.status).toBe("completed");
    expect(completed.completedStepIds).toEqual(
      parseLesson(faceMillingDocument).steps.map((step) => step.id),
    );
    expect(completed.evidence.events).toEqual(LESSON_EVENTS);
    expect(completed.score).toMatchObject({ score: 100, passed: true });
  });

  it("connects the face-milling session to terminal and measured evidence without Stock arrays", () => {
    const session = new FaceMillingLessonController(faceMillingDocument);
    expect(session.beginExecution().decision.outcome).toBe("guided-warning");
    expect(session.getSnapshot().running).toBe(false);
    session.restoreStepCheckpoint();

    session.prepare();
    session.setup();
    expect(session.beginExecution().decision.outcome).toBe("allowed");
    expect(session.getSnapshot().running).toBe(true);
    session.completeExecution(completedSummary);
    session.recordMeasurement({
      targetId: "m7.face-milling.standard.x",
      comparedCells: 1_125,
      targetCutCells: 699,
      representationResolutionMm: 8,
      numericToleranceMm: 0.000001,
      maxDeviationMm: 0,
      meanAbsoluteDeviationMm: 0,
      overcutVolumeMm3: 0,
      undercutVolumeMm3: 0,
      actualRemovedVolumeMm3: 357_888,
      targetRemovedVolumeMm3: 357_888,
    });
    const completed = session.assess().snapshot;
    const snapshot = session.getSnapshot();

    expect(completed.status).toBe("completed");
    expect(completed.score).toMatchObject({ score: 100, passed: true });
    expect(snapshot.evidenceSource).toBe("worker-wasm");
    expect(snapshot.measurement).toMatchObject({
      targetId: "m7.face-milling.standard.x",
      maxDeviationMm: 0,
      actualRemovedVolumeMm3: 357_888,
    });
    expect(snapshot.measurement).not.toHaveProperty("topZMm");
    expect(snapshot.run).toMatchObject({
      runId: completedSummary.runId,
      finalSemanticHashSha256: HASH,
      collisionCount: 0,
    });
  });

  it("surfaces an authored setup failure and restores the step checkpoint", () => {
    const session = new FaceMillingLessonController(faceMillingDocument);
    session.prepare();

    const failure = session.setup({
      toolId: "tool.ball-end-mill-12",
    }).snapshot;
    expect(failure.status).toBe("failed");
    expect(failure.lastEvaluation).toMatchObject({
      matchedFailureRuleId: "setup.wrong-tool",
      failureReason: "이 실습에는 20 mm 평엔드밀이 필요합니다.",
    });
    expect(failure.guidance).toMatchObject({
      kind: "failure",
      recovery: { kind: "restore-step-checkpoint" },
    });

    const restored = session.restoreStepCheckpoint();
    expect(restored.controller.status).toBe("active");
    expect(restored.controller.currentStep.phase).toBe("setup");
    expect(() => session.setup({ cutDepthMm: Number.NaN })).toThrowError(
      "lesson setup requires a finite positive cut depth and tool count",
    );
  });
});

function turningMeasurement(input: {
  readonly targetId: string;
  readonly process: "drilling" | "od-turning";
  readonly targetCutCells: number;
  readonly actualRemovedVolumeMm3: number;
  readonly targetRemovedVolumeMm3?: number;
  readonly feature: TurningTargetMeasurement["feature"];
}): TurningTargetMeasurement {
  const common = {
    targetId: input.targetId,
    comparedCells: 120,
    targetCutCells: input.targetCutCells,
    representationResolutionMm: 1,
    numericToleranceMm: 0.000001,
    maxDeviationMm: 0,
    meanAbsoluteDeviationMm: 0,
    overcutVolumeMm3: 0,
    undercutVolumeMm3: 0,
    actualRemovedVolumeMm3: input.actualRemovedVolumeMm3,
    targetRemovedVolumeMm3:
      input.targetRemovedVolumeMm3 ?? input.actualRemovedVolumeMm3,
  };
  if (
    input.process === "od-turning" &&
    input.feature.kind === "outer-diameter"
  ) {
    return {
      ...common,
      process: input.process,
      feature: input.feature,
    };
  }
  if (
    input.process === "drilling" &&
    input.feature.kind === "drilled-hole"
  ) {
    return {
      ...common,
      process: input.process,
      feature: input.feature,
    };
  }
  throw new TypeError("Turning measurement process and feature must match.");
}
describe.each([
  {
    name: "OD turning",
    Controller: OdTurningLessonController,
    document: odTurningDocument,
    fixtureId: "m7-turning",
    process: "od-turning",
    targetId: "m7.od-turning.balanced",
    targetCutCells: 101,
    actualRemovedVolumeMm3: Math.PI * (40 ** 2 - 32 ** 2) * 101,
    feature: {
      kind: "outer-diameter",
      sampleZMm: 300,
      actualDiameterMm: 64,
      targetDiameterMm: 64,
    },
  },
  {
    name: "drilling",
    Controller: DrillingLessonController,
    document: drillingDocument,
    fixtureId: "m7-drilling",
    process: "drilling",
    targetId: "m7.drilling-16x80.balanced",
    targetCutCells: 80,
    actualRemovedVolumeMm3: Math.PI * 8 ** 2 * 80,
    feature: {
      kind: "drilled-hole",
      sampleZMm: 320,
      actualDiameterMm: 16,
      targetDiameterMm: 16,
      actualDepthMm: 80,
      targetDepthMm: 80,
      freeEnd: "positive-z",
    },
  },
] as const)("M10 $name Lesson controller", ({
  Controller,
  document,
  fixtureId,
  process,
  targetId,
  targetCutCells,
  actualRemovedVolumeMm3,
  feature,
}) => {
  it("parses every ordered E2 phase", () => {
    const lesson = parseLesson(document);
    expect(lesson.process).toBe(process);
    expect(lesson.steps.map((step) => step.phase)).toEqual(LESSON_PHASES);
    expect(lesson.accuracy.limitations).toHaveLength(3);
  });

  it("connects terminal evidence and a scalar Stock measurement", () => {
    const controller = new Controller(document);
    controller.prepare();
    controller.setup();
    controller.beginExecution();
    controller.completeExecution({
      ...completedSummary,
      processType: "turning",
      fixtureId,
      removedVolumeMm3: actualRemovedVolumeMm3,
      logicalTimeS: 12,
    });
    controller.recordMeasurement(turningMeasurement({
      targetId,
      process,
      targetCutCells,
      actualRemovedVolumeMm3,
      feature,
    }));
    const completed = controller.assess().snapshot;
    const snapshot = controller.getSnapshot();

    expect(completed.status).toBe("completed");
    expect(completed.score).toMatchObject({ score: 100, passed: true });
    expect(snapshot.evidenceSource).toBe("worker-wasm");
    expect(snapshot.measurement).toMatchObject({ targetId, process, feature });
    expect(JSON.stringify(snapshot)).not.toContain("RadiusMm\":[");
    expect(snapshot.run).toMatchObject({
      fixtureId,
      removedVolumeMm3: actualRemovedVolumeMm3,
      collisionCount: 0,
    });
  });

  it("rejects another fixture and a measurement from another run", () => {
    const controller = new Controller(document);
    controller.prepare();
    controller.setup();
    controller.beginExecution();
    expect(() =>
      controller.completeExecution({
        ...completedSummary,
        processType: "turning",
        fixtureId: fixtureId === "m7-turning" ? "m7-drilling" : "m7-turning",
      }),
    ).toThrowError("does not match the selected lesson");

    controller.abortExecution();
    controller.beginExecution();
    controller.completeExecution({
      ...completedSummary,
      processType: "turning",
      fixtureId,
      removedVolumeMm3: actualRemovedVolumeMm3,
    });
    expect(() =>
      controller.recordMeasurement(turningMeasurement({
        targetId,
        process,
        targetCutCells,
        actualRemovedVolumeMm3: actualRemovedVolumeMm3 + 100_000,
        targetRemovedVolumeMm3: actualRemovedVolumeMm3,
        feature,
      })),
    ).toThrowError("does not belong to the terminal lesson run");
  });
});

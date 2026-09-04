import type { CoordinatorCoreSummary } from "@cnc-render/contracts";
import {
  LessonController,
  createCoordinatorLessonEvidence,
  type CoordinatorLessonEvidence,
  type LessonControllerSnapshot,
  type LessonControllerTransition,
} from "@cnc-render/lesson-engine";
import {
  DEFAULT_M7_MILLING_CONFIGURATION,
  createM7FaceMillingTarget,
  type M7MillingConfiguration,
  type MillingTargetMeasurement,
} from "@cnc-render/simulation";

const FACE_MILLING_SELECTIONS = {
  machineId: "machine.vmc-3x-edu",
  stockId: "stock.face-milling-360x200x88",
  materialId: "material.aluminum-6061",
  fixtureId: "fixture.vise-150",
  toolId: "tool.flat-end-mill-20",
  operationId: "operation.face-milling-balanced",
} as const;

export interface FaceMillingLessonRunSummary {
  readonly runId: string;
  readonly finalSemanticHashSha256: string;
  readonly stockHashSha256: string;
  readonly logicalTimeS: number;
  readonly removedVolumeMm3: number;
  readonly collisionCount: number;
}

export interface FaceMillingLessonSetupInput {
  readonly fixtureId?: string;
  readonly toolId?: string;
  readonly operationId?: string;
  readonly cutDepthMm?: number;
  readonly toolCount?: number;
}

export interface FaceMillingLessonSnapshot {
  readonly controller: LessonControllerSnapshot;
  readonly configuration: M7MillingConfiguration;
  readonly running: boolean;
  readonly run: FaceMillingLessonRunSummary | null;
  readonly measurement: MillingTargetMeasurement | null;
  readonly evidenceSource: CoordinatorLessonEvidence["source"] | null;
}

export type FaceMillingLessonControllerErrorCode =
  | "lesson.face-milling.execution-not-started"
  | "lesson.face-milling.execution-not-terminal"
  | "lesson.face-milling.setup-invalid"
  | "lesson.face-milling.measurement-missing"
  | "lesson.face-milling.measurement-invalid"
  | "lesson.face-milling.measurement-run-mismatch";

export class FaceMillingLessonControllerError extends Error {
  readonly code: FaceMillingLessonControllerErrorCode;

  constructor(code: FaceMillingLessonControllerErrorCode, message: string) {
    super(message);
    this.name = "FaceMillingLessonControllerError";
    this.code = code;
  }
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new FaceMillingLessonControllerError(
      "lesson.face-milling.measurement-invalid",
      `${label} must be a finite non-negative value.`,
    );
  }
  return value;
}

function cloneMeasurement(
  measurement: MillingTargetMeasurement,
): MillingTargetMeasurement {
  return { ...measurement };
}

function runSummary(
  summary: CoordinatorCoreSummary,
): FaceMillingLessonRunSummary {
  return {
    runId: summary.runId,
    finalSemanticHashSha256: summary.finalSemanticHashSha256!,
    stockHashSha256: summary.stockHashSha256,
    logicalTimeS: summary.logicalTimeS,
    removedVolumeMm3: summary.removedVolumeMm3,
    collisionCount: summary.collision === null ? 0 : 1,
  };
}

export class FaceMillingLessonController {
  readonly #controller: LessonController;
  readonly #configuration = { ...DEFAULT_M7_MILLING_CONFIGURATION };
  readonly #target = createM7FaceMillingTarget(this.#configuration);

  #running = false;
  #terminalSummary: CoordinatorCoreSummary | null = null;
  #measurement: MillingTargetMeasurement | null = null;
  #evidenceSource: CoordinatorLessonEvidence["source"] | null = null;

  constructor(lessonInput: unknown) {
    this.#controller = new LessonController(lessonInput);
  }

  prepare(): LessonControllerTransition {
    return this.#controller.dispatch("machine.select", {
      selections: {
        machineId: FACE_MILLING_SELECTIONS.machineId,
        stockId: FACE_MILLING_SELECTIONS.stockId,
        materialId: FACE_MILLING_SELECTIONS.materialId,
      },
    });
  }

  setup(
    input: FaceMillingLessonSetupInput = {},
  ): LessonControllerTransition {
    const cutDepthMm = input.cutDepthMm ?? this.#target.commandedCutDepthMm;
    const toolCount = input.toolCount ?? 1;
    if (
      !Number.isFinite(cutDepthMm) ||
      cutDepthMm <= 0 ||
      Object.is(cutDepthMm, -0) ||
      !Number.isSafeInteger(toolCount) ||
      toolCount <= 0
    ) {
      throw new FaceMillingLessonControllerError(
        "lesson.face-milling.setup-invalid",
        "lesson setup requires a finite positive cut depth and tool count",
      );
    }
    return this.#controller.dispatch("operation.configure", {
      selections: {
        fixtureId: input.fixtureId ?? FACE_MILLING_SELECTIONS.fixtureId,
        toolId: input.toolId ?? FACE_MILLING_SELECTIONS.toolId,
        operationId:
          input.operationId ?? FACE_MILLING_SELECTIONS.operationId,
      },
      events: ["setup.completed"],
      metrics: {
        cutDepthMm,
        toolCount,
      },
    });
  }

  beginExecution(): LessonControllerTransition {
    const transition = this.#controller.dispatch("simulation.run");
    if (
      transition.decision.outcome === "allowed" &&
      transition.snapshot.status !== "failed"
    ) {
      this.#running = true;
      this.#terminalSummary = null;
      this.#measurement = null;
      this.#evidenceSource = null;
    }
    return transition;
  }

  completeExecution(
    summary: CoordinatorCoreSummary,
  ): LessonControllerTransition {
    if (!this.#running) {
      throw new FaceMillingLessonControllerError(
        "lesson.face-milling.execution-not-started",
        "the face-milling lesson execution was not started",
      );
    }
    const isCompleted = summary.phase === "completed" && summary.completed;
    const isCollisionStop =
      summary.phase === "stopped" &&
      summary.stopped &&
      summary.collision !== null;
    if (!isCompleted && !isCollisionStop) {
      throw new FaceMillingLessonControllerError(
        "lesson.face-milling.execution-not-terminal",
        "the face-milling lesson requires a terminal Worker/WASM summary",
      );
    }
    this.#running = false;
    this.#terminalSummary = structuredClone(summary);
    return this.#controller.dispatch("simulation.run", {
      events: isCompleted ? ["simulation.completed"] : [],
      metrics: {
        logicalTimeS: summary.logicalTimeS,
        removedVolumeMm3: summary.removedVolumeMm3,
        collisionCount: summary.collision === null ? 0 : 1,
      },
    });
  }

  recordMeasurement(
    measurement: MillingTargetMeasurement,
  ): LessonControllerTransition {
    if (this.#terminalSummary === null) {
      throw new FaceMillingLessonControllerError(
        "lesson.face-milling.execution-not-terminal",
        "recording a measurement requires a terminal Worker/WASM run",
      );
    }
    const targetId = this.#target.targetId;
    const numericFields = [
      "comparedCells",
      "targetCutCells",
      "representationResolutionMm",
      "numericToleranceMm",
      "maxDeviationMm",
      "meanAbsoluteDeviationMm",
      "overcutVolumeMm3",
      "undercutVolumeMm3",
      "actualRemovedVolumeMm3",
      "targetRemovedVolumeMm3",
    ] as const;
    numericFields.forEach((field) => finite(measurement[field], field));
    if (
      measurement.targetId !== targetId ||
      !Number.isSafeInteger(measurement.comparedCells) ||
      measurement.comparedCells <= 0 ||
      !Number.isSafeInteger(measurement.targetCutCells) ||
      measurement.targetCutCells < 0 ||
      measurement.targetCutCells > measurement.comparedCells ||
      measurement.representationResolutionMm <= 0 ||
      measurement.numericToleranceMm <= 0
    ) {
      throw new FaceMillingLessonControllerError(
        "lesson.face-milling.measurement-invalid",
        "the measurement does not match the authored E2 target contract",
      );
    }
    const stockWidthMm =
      this.#target.stockBoundsMm.maximum.xMm -
      this.#target.stockBoundsMm.minimum.xMm;
    const stockHeightMm =
      this.#target.stockBoundsMm.maximum.yMm -
      this.#target.stockBoundsMm.minimum.yMm;
    const volumeToleranceMm3 = Math.max(
      1e-6,
      measurement.numericToleranceMm * stockWidthMm * stockHeightMm,
    );
    if (
      Math.abs(
        measurement.actualRemovedVolumeMm3 -
          this.#terminalSummary.removedVolumeMm3,
      ) > volumeToleranceMm3
    ) {
      throw new FaceMillingLessonControllerError(
        "lesson.face-milling.measurement-run-mismatch",
        "the measured Stock does not belong to the terminal lesson run",
      );
    }
    const transition = this.#controller.dispatch("measurement.record", {
      events: ["measurement.recorded"],
      metrics: {
        maxDeviationMm: measurement.maxDeviationMm,
        overcutVolumeMm3: measurement.overcutVolumeMm3,
        undercutVolumeMm3: measurement.undercutVolumeMm3,
      },
    });
    if (transition.decision.outcome === "allowed") {
      this.#measurement = cloneMeasurement(measurement);
    }
    return transition;
  }

  assess(): LessonControllerTransition {
    if (this.#terminalSummary === null) {
      throw new FaceMillingLessonControllerError(
        "lesson.face-milling.execution-not-terminal",
        "assessment requires a terminal Worker/WASM run",
      );
    }
    if (this.#measurement === null) {
      throw new FaceMillingLessonControllerError(
        "lesson.face-milling.measurement-missing",
        "assessment requires an actual Stock-to-target measurement",
      );
    }
    const mapped = createCoordinatorLessonEvidence({
      summary: this.#terminalSummary,
      selections: FACE_MILLING_SELECTIONS,
      completedEvents: [
        "setup.completed",
        "measurement.recorded",
        "result.reviewed",
      ],
      metrics: {
        toolCount: 1,
        maxDeviationMm: this.#measurement.maxDeviationMm,
        overcutVolumeMm3: this.#measurement.overcutVolumeMm3,
        undercutVolumeMm3: this.#measurement.undercutVolumeMm3,
        cutDepthMm: this.#target.commandedCutDepthMm,
      },
    });
    const transition = this.#controller.dispatch(
      "result.review",
      mapped.evidence,
    );
    if (transition.decision.outcome === "allowed") {
      this.#evidenceSource = mapped.source;
    }
    return transition;
  }

  abortExecution(): FaceMillingLessonSnapshot {
    this.#running = false;
    this.#terminalSummary = null;
    this.#measurement = null;
    this.#evidenceSource = null;
    this.#controller.restoreStepCheckpoint();
    return this.getSnapshot();
  }

  restoreStepCheckpoint(): FaceMillingLessonSnapshot {
    const currentStepIndex = this.#controller.getSnapshot().currentStepIndex;
    this.#running = false;
    if (currentStepIndex <= 2) {
      this.#terminalSummary = null;
    }
    if (currentStepIndex <= 3) {
      this.#measurement = null;
    }
    this.#evidenceSource = null;
    this.#controller.restoreStepCheckpoint();
    return this.getSnapshot();
  }

  reset(): FaceMillingLessonSnapshot {
    this.#running = false;
    this.#terminalSummary = null;
    this.#measurement = null;
    this.#evidenceSource = null;
    this.#controller.reset();
    return this.getSnapshot();
  }

  getSnapshot(): FaceMillingLessonSnapshot {
    return {
      controller: this.#controller.getSnapshot(),
      configuration: { ...this.#configuration },
      running: this.#running,
      run:
        this.#terminalSummary === null
          ? null
          : runSummary(this.#terminalSummary),
      measurement:
        this.#measurement === null
          ? null
          : cloneMeasurement(this.#measurement),
      evidenceSource: this.#evidenceSource,
    };
  }
}

import type { CoordinatorCoreSummary } from "@cnc-render/contracts";
import {
  LessonController,
  createCoordinatorLessonEvidence,
  type CoordinatorLessonEvidence,
  type LessonControllerSnapshot,
  type LessonControllerTransition,
} from "@cnc-render/lesson-engine";
import {
  createM7DrillingTarget,
  createM7OdTurningTarget,
  type M7DrillingTarget,
  type M7OdTurningTarget,
  type M7PipelineFixture,
  type TurningTargetMeasurement,
} from "@cnc-render/simulation";

type TurningLessonProcess = "drilling" | "od-turning";
type TurningLessonTarget = M7DrillingTarget | M7OdTurningTarget;

interface TurningLessonDefinition {
  readonly process: TurningLessonProcess;
  readonly fixture: Extract<M7PipelineFixture, "drilling" | "turning">;
  readonly fixtureId: "m7-drilling" | "m7-turning";
  readonly selections: {
    readonly machineId: string;
    readonly stockId: string;
    readonly materialId: string;
    readonly fixtureId: string;
    readonly toolId: string;
    readonly operationId: string;
  };
  readonly target: TurningLessonTarget;
}

const COMMON_SELECTIONS = {
  machineId: "machine.cnc-lathe-2x-edu",
  stockId: "stock.turning-cylinder-80x120",
  materialId: "material.aluminum-6061",
  fixtureId: "fixture.three-jaw-chuck",
} as const;

const OD_TURNING_DEFINITION: TurningLessonDefinition = {
  process: "od-turning",
  fixture: "turning",
  fixtureId: "m7-turning",
  selections: {
    ...COMMON_SELECTIONS,
    toolId: "tool.od-turning-insert",
    operationId: "operation.od-turning-balanced",
  },
  target: createM7OdTurningTarget(),
};

const DRILLING_DEFINITION: TurningLessonDefinition = {
  process: "drilling",
  fixture: "drilling",
  fixtureId: "m7-drilling",
  selections: {
    ...COMMON_SELECTIONS,
    toolId: "tool.twist-drill-16",
    operationId: "operation.drilling-16x80",
  },
  target: createM7DrillingTarget(),
};

export interface TurningProfileLessonRunSummary {
  readonly runId: string;
  readonly fixtureId: string;
  readonly finalSemanticHashSha256: string;
  readonly stockHashSha256: string;
  readonly logicalTimeS: number;
  readonly removedVolumeMm3: number;
  readonly collisionCount: number;
}

export interface TurningProfileLessonSnapshot {
  readonly controller: LessonControllerSnapshot;
  readonly process: TurningLessonProcess;
  readonly fixture: Extract<M7PipelineFixture, "drilling" | "turning">;
  readonly running: boolean;
  readonly run: TurningProfileLessonRunSummary | null;
  readonly measurement: TurningTargetMeasurement | null;
  readonly evidenceSource: CoordinatorLessonEvidence["source"] | null;
}

export type TurningProfileLessonControllerErrorCode =
  | "lesson.turning-profile.execution-not-started"
  | "lesson.turning-profile.execution-not-terminal"
  | "lesson.turning-profile.execution-run-mismatch"
  | "lesson.turning-profile.measurement-missing"
  | "lesson.turning-profile.measurement-invalid"
  | "lesson.turning-profile.measurement-run-mismatch";

export class TurningProfileLessonControllerError extends Error {
  readonly code: TurningProfileLessonControllerErrorCode;

  constructor(
    code: TurningProfileLessonControllerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TurningProfileLessonControllerError";
    this.code = code;
  }
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TurningProfileLessonControllerError(
      "lesson.turning-profile.measurement-invalid",
      label + " must be a finite non-negative value.",
    );
  }
  return value;
}

function cloneMeasurement(
  measurement: TurningTargetMeasurement,
): TurningTargetMeasurement {
  if (measurement.process === "od-turning") {
    return {
      ...measurement,
      feature: { ...measurement.feature },
    };
  }
  return {
    ...measurement,
    feature: { ...measurement.feature },
  };
}

function runSummary(
  summary: CoordinatorCoreSummary,
): TurningProfileLessonRunSummary {
  return {
    runId: summary.runId,
    fixtureId: summary.fixtureId,
    finalSemanticHashSha256: summary.finalSemanticHashSha256!,
    stockHashSha256: summary.stockHashSha256,
    logicalTimeS: summary.logicalTimeS,
    removedVolumeMm3: summary.removedVolumeMm3,
    collisionCount: summary.collision === null ? 0 : 1,
  };
}

export class TurningProfileLessonController {
  readonly #controller: LessonController;
  readonly #definition: TurningLessonDefinition;

  #running = false;
  #terminalSummary: CoordinatorCoreSummary | null = null;
  #measurement: TurningTargetMeasurement | null = null;
  #evidenceSource: CoordinatorLessonEvidence["source"] | null = null;

  protected constructor(
    lessonInput: unknown,
    definition: TurningLessonDefinition,
  ) {
    this.#controller = new LessonController(lessonInput);
    this.#definition = definition;
  }

  prepare(): LessonControllerTransition {
    const selections = this.#definition.selections;
    return this.#controller.dispatch("machine.select", {
      selections: {
        machineId: selections.machineId,
        stockId: selections.stockId,
        materialId: selections.materialId,
      },
    });
  }

  setup(): LessonControllerTransition {
    const selections = this.#definition.selections;
    return this.#controller.dispatch("operation.configure", {
      selections: {
        fixtureId: selections.fixtureId,
        toolId: selections.toolId,
        operationId: selections.operationId,
      },
      events: ["setup.completed"],
      metrics: {
        cutDepthMm: this.#definition.target.commandedCutDepthMm,
        toolCount: 1,
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
      throw new TurningProfileLessonControllerError(
        "lesson.turning-profile.execution-not-started",
        "the radius-field lesson execution was not started",
      );
    }
    const isCompleted = summary.phase === "completed" && summary.completed;
    const isCollisionStop =
      summary.phase === "stopped" &&
      summary.stopped &&
      summary.collision !== null;
    if (!isCompleted && !isCollisionStop) {
      throw new TurningProfileLessonControllerError(
        "lesson.turning-profile.execution-not-terminal",
        "the radius-field lesson requires a terminal Worker/WASM summary",
      );
    }
    if (
      summary.processType !== "turning" ||
      summary.fixtureId !== this.#definition.fixtureId
    ) {
      throw new TurningProfileLessonControllerError(
        "lesson.turning-profile.execution-run-mismatch",
        "the terminal Worker/WASM run does not match the selected lesson",
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
    measurement: TurningTargetMeasurement,
  ): LessonControllerTransition {
    if (this.#terminalSummary === null) {
      throw new TurningProfileLessonControllerError(
        "lesson.turning-profile.execution-not-terminal",
        "recording a measurement requires a terminal Worker/WASM run",
      );
    }
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
    finite(measurement.feature.sampleZMm, "feature.sampleZMm");
    finite(
      measurement.feature.actualDiameterMm,
      "feature.actualDiameterMm",
    );
    finite(
      measurement.feature.targetDiameterMm,
      "feature.targetDiameterMm",
    );
    if (measurement.feature.kind === "drilled-hole") {
      finite(measurement.feature.actualDepthMm, "feature.actualDepthMm");
      finite(measurement.feature.targetDepthMm, "feature.targetDepthMm");
    }
    if (
      measurement.targetId !== this.#definition.target.targetId ||
      measurement.process !== this.#definition.process ||
      !Number.isSafeInteger(measurement.comparedCells) ||
      measurement.comparedCells <= 0 ||
      !Number.isSafeInteger(measurement.targetCutCells) ||
      measurement.targetCutCells < 0 ||
      measurement.targetCutCells > measurement.comparedCells ||
      measurement.representationResolutionMm <= 0 ||
      measurement.numericToleranceMm <= 0 ||
      (this.#definition.process === "od-turning" &&
        measurement.feature.kind !== "outer-diameter") ||
      (this.#definition.process === "drilling" &&
        measurement.feature.kind !== "drilled-hole")
    ) {
      throw new TurningProfileLessonControllerError(
        "lesson.turning-profile.measurement-invalid",
        "the measurement does not match the authored E2 target contract",
      );
    }

    const target = this.#definition.target;
    const stockLengthMm = target.maximumZMm - target.minimumZMm;
    const stockCrossSectionMm2 =
      Math.PI * target.initialOuterRadiusMm ** 2;
    const volumeToleranceMm3 = Math.max(
      1e-6,
      measurement.numericToleranceMm *
        stockCrossSectionMm2 *
        stockLengthMm,
    );
    if (
      Math.abs(
        measurement.actualRemovedVolumeMm3 -
          this.#terminalSummary.removedVolumeMm3,
      ) > volumeToleranceMm3
    ) {
      throw new TurningProfileLessonControllerError(
        "lesson.turning-profile.measurement-run-mismatch",
        "the measured radius field does not belong to the terminal lesson run",
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
      throw new TurningProfileLessonControllerError(
        "lesson.turning-profile.execution-not-terminal",
        "assessment requires a terminal Worker/WASM run",
      );
    }
    if (this.#measurement === null) {
      throw new TurningProfileLessonControllerError(
        "lesson.turning-profile.measurement-missing",
        "assessment requires an actual Stock-to-target measurement",
      );
    }
    const mapped = createCoordinatorLessonEvidence({
      summary: this.#terminalSummary,
      selections: this.#definition.selections,
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
        cutDepthMm: this.#definition.target.commandedCutDepthMm,
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

  abortExecution(): TurningProfileLessonSnapshot {
    this.#running = false;
    this.#terminalSummary = null;
    this.#measurement = null;
    this.#evidenceSource = null;
    this.#controller.restoreStepCheckpoint();
    return this.getSnapshot();
  }

  restoreStepCheckpoint(): TurningProfileLessonSnapshot {
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

  reset(): TurningProfileLessonSnapshot {
    this.#running = false;
    this.#terminalSummary = null;
    this.#measurement = null;
    this.#evidenceSource = null;
    this.#controller.reset();
    return this.getSnapshot();
  }

  getSnapshot(): TurningProfileLessonSnapshot {
    return {
      controller: this.#controller.getSnapshot(),
      process: this.#definition.process,
      fixture: this.#definition.fixture,
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

export class OdTurningLessonController extends TurningProfileLessonController {
  constructor(lessonInput: unknown) {
    super(lessonInput, OD_TURNING_DEFINITION);
  }
}

export class DrillingLessonController extends TurningProfileLessonController {
  constructor(lessonInput: unknown) {
    super(lessonInput, DRILLING_DEFINITION);
  }
}

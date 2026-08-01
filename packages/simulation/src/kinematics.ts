import type {
  KinematicAxis,
  MachineDefinition,
  Vec3Mm,
} from "@cnc-render/contracts";

const NUMERIC_EPSILON = 1e-9;
const MAX_INTERPOLATION_STEPS = 1_000_000;

type LinearAxis = Extract<KinematicAxis, { kind: "linear" }>;

export type AxisPositionMmMap = Readonly<Record<string, number>>;
export type MotionKind = "rapid" | "feed";

export type KinematicsConfigurationErrorCode =
  | "kinematics.machine.type-unsupported"
  | "kinematics.axis.count"
  | "kinematics.axis.kind-unsupported"
  | "kinematics.axis.root-count"
  | "kinematics.axis.chain-invalid"
  | "kinematics.axis.direction-invalid"
  | "kinematics.tcp-home.invalid";

export type KinematicsDiagnosticCode =
  | "kinematics.axis.position-missing"
  | "kinematics.axis.position-nonfinite"
  | "kinematics.axis.position-unknown"
  | "kinematics.axis.limit-min"
  | "kinematics.axis.limit-max"
  | "kinematics.axis.velocity"
  | "kinematics.axis.acceleration"
  | "kinematics.feed.velocity"
  | "kinematics.sample.time-invalid";

export type KinematicsDiagnosticUnit = "mm" | "mm/min" | "mm/s2" | "s";

export interface KinematicsDiagnostic {
  readonly code: KinematicsDiagnosticCode;
  readonly severity: "error";
  readonly axisId: string | null;
  readonly timeS: number | null;
  readonly sourceLine: number | null;
  readonly actual: number | null;
  readonly limit: number | null;
  readonly unit: KinematicsDiagnosticUnit;
  readonly message: string;
}

export interface ThreeAxisPose {
  readonly tcpPositionMm: Vec3Mm;
  readonly axisPositionsMm: AxisPositionMmMap;
}

export interface ForwardKinematicsResult {
  readonly pose: ThreeAxisPose | null;
  readonly diagnostics: readonly KinematicsDiagnostic[];
}

export interface AxisMotionSample {
  readonly timeS: number;
  readonly positionsMm: AxisPositionMmMap;
  readonly motion: MotionKind;
  readonly sourceLine: number | null;
}

export interface TrajectoryEvaluation {
  readonly poses: readonly (ThreeAxisPose | null)[];
  readonly diagnostics: readonly KinematicsDiagnostic[];
}

export class KinematicsConfigurationError extends Error {
  readonly code: KinematicsConfigurationErrorCode;

  constructor(code: KinematicsConfigurationErrorCode, message: string) {
    super(message);
    this.name = "KinematicsConfigurationError";
    this.code = code;
  }
}

function normalizedZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function finiteVec3(value: Vec3Mm): boolean {
  return (
    Number.isFinite(value.xMm) &&
    Number.isFinite(value.yMm) &&
    Number.isFinite(value.zMm)
  );
}

function dot(left: LinearAxis, right: LinearAxis): number {
  return (
    left.directionUnit.x * right.directionUnit.x +
    left.directionUnit.y * right.directionUnit.y +
    left.directionUnit.z * right.directionUnit.z
  );
}

function orderLinearAxes(machine: MachineDefinition): readonly LinearAxis[] {
  if (machine.machineType !== "vertical-machining-center") {
    throw new KinematicsConfigurationError(
      "kinematics.machine.type-unsupported",
      "M4 three-axis kinematics supports vertical machining centers only.",
    );
  }
  if (machine.axes.length !== 3) {
    throw new KinematicsConfigurationError(
      "kinematics.axis.count",
      "M4 three-axis kinematics requires exactly three axes.",
    );
  }
  if (machine.axes.some((axis) => axis.kind !== "linear")) {
    throw new KinematicsConfigurationError(
      "kinematics.axis.kind-unsupported",
      "M4 three-axis kinematics accepts linear axes only.",
    );
  }
  if (machine.kinematicRootAxisIds.length !== 1) {
    throw new KinematicsConfigurationError(
      "kinematics.axis.root-count",
      "M4 three-axis kinematics requires one kinematic root.",
    );
  }

  const axes = machine.axes as readonly LinearAxis[];
  const byId = new Map(axes.map((axis) => [axis.id, axis]));
  const root = byId.get(machine.kinematicRootAxisIds[0]);
  if (!root || root.parentId !== null) {
    throw new KinematicsConfigurationError(
      "kinematics.axis.chain-invalid",
      "The declared kinematic root must reference a parentless linear axis.",
    );
  }

  const ordered: LinearAxis[] = [root];
  while (ordered.length < axes.length) {
    const parentId = ordered[ordered.length - 1].id;
    const children = axes.filter((axis) => axis.parentId === parentId);
    if (children.length !== 1) {
      throw new KinematicsConfigurationError(
        "kinematics.axis.chain-invalid",
        "M4 three-axis axes must form one unbranched parent-child chain.",
      );
    }
    ordered.push(children[0]);
  }
  if (new Set(ordered.map((axis) => axis.id)).size !== axes.length) {
    throw new KinematicsConfigurationError(
      "kinematics.axis.chain-invalid",
      "M4 three-axis axes must form one connected parent-child chain.",
    );
  }

  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < ordered.length;
      rightIndex += 1
    ) {
      if (
        Math.abs(dot(ordered[leftIndex], ordered[rightIndex])) >
        NUMERIC_EPSILON
      ) {
        throw new KinematicsConfigurationError(
          "kinematics.axis.direction-invalid",
          "M4 three-axis directions must be mutually orthogonal.",
        );
      }
    }
  }

  return ordered;
}

function diagnostic(
  code: KinematicsDiagnosticCode,
  options: Omit<KinematicsDiagnostic, "code" | "severity" | "message">,
  message: string,
): KinematicsDiagnostic {
  return {
    code,
    severity: "error",
    ...options,
    message,
  };
}

function distanceMm(left: Vec3Mm, right: Vec3Mm): number {
  return Math.hypot(
    right.xMm - left.xMm,
    right.yMm - left.yMm,
    right.zMm - left.zMm,
  );
}

export class ThreeAxisKinematics {
  readonly #machine: MachineDefinition;
  readonly #axes: readonly LinearAxis[];
  readonly #tcpAtHomeMm: Vec3Mm;

  constructor(machine: MachineDefinition, tcpAtHomeMm: Vec3Mm) {
    this.#axes = orderLinearAxes(machine);
    if (!finiteVec3(tcpAtHomeMm)) {
      throw new KinematicsConfigurationError(
        "kinematics.tcp-home.invalid",
        "TCP-at-home coordinates must contain finite millimetre values.",
      );
    }
    this.#machine = machine;
    this.#tcpAtHomeMm = { ...tcpAtHomeMm };
  }

  get axisOrder(): readonly string[] {
    return this.#axes.map((axis) => axis.id);
  }

  solve(
    positionsMm: AxisPositionMmMap,
    context: {
      readonly timeS?: number | null;
      readonly sourceLine?: number | null;
    } = {},
  ): ForwardKinematicsResult {
    const timeS = context.timeS ?? null;
    const sourceLine = context.sourceLine ?? null;
    const diagnostics: KinematicsDiagnostic[] = [];
    const knownAxisIds = new Set(this.#axes.map((axis) => axis.id));

    for (const axisId of Object.keys(positionsMm).sort((left, right) =>
      left.localeCompare(right, "en-US"),
    )) {
      if (!knownAxisIds.has(axisId)) {
        diagnostics.push(
          diagnostic(
            "kinematics.axis.position-unknown",
            {
              axisId,
              timeS,
              sourceLine,
              actual: null,
              limit: null,
              unit: "mm",
            },
            `Unknown axis position "${axisId}".`,
          ),
        );
      }
    }

    for (const axis of this.#axes) {
      const position = positionsMm[axis.id];
      if (position === undefined) {
        diagnostics.push(
          diagnostic(
            "kinematics.axis.position-missing",
            {
              axisId: axis.id,
              timeS,
              sourceLine,
              actual: null,
              limit: null,
              unit: "mm",
            },
            `Axis "${axis.name}" is missing a position.`,
          ),
        );
        continue;
      }
      if (!Number.isFinite(position)) {
        diagnostics.push(
          diagnostic(
            "kinematics.axis.position-nonfinite",
            {
              axisId: axis.id,
              timeS,
              sourceLine,
              actual: null,
              limit: null,
              unit: "mm",
            },
            `Axis "${axis.name}" position must be finite.`,
          ),
        );
        continue;
      }
      if (position < axis.minMm - NUMERIC_EPSILON) {
        diagnostics.push(
          diagnostic(
            "kinematics.axis.limit-min",
            {
              axisId: axis.id,
              timeS,
              sourceLine,
              actual: position,
              limit: axis.minMm,
              unit: "mm",
            },
            `Axis "${axis.name}" is below its minimum travel.`,
          ),
        );
      }
      if (position > axis.maxMm + NUMERIC_EPSILON) {
        diagnostics.push(
          diagnostic(
            "kinematics.axis.limit-max",
            {
              axisId: axis.id,
              timeS,
              sourceLine,
              actual: position,
              limit: axis.maxMm,
              unit: "mm",
            },
            `Axis "${axis.name}" is above its maximum travel.`,
          ),
        );
      }
    }

    if (
      diagnostics.some(
        ({ code }) =>
          code === "kinematics.axis.position-missing" ||
          code === "kinematics.axis.position-nonfinite" ||
          code === "kinematics.axis.position-unknown",
      )
    ) {
      return { pose: null, diagnostics };
    }

    const tcpPositionMm = this.#axes.reduce<Vec3Mm>(
      (tcp, axis) => {
        const displacementMm = positionsMm[axis.id] - axis.homeMm;
        return {
          xMm: normalizedZero(
            tcp.xMm + axis.directionUnit.x * displacementMm,
          ),
          yMm: normalizedZero(
            tcp.yMm + axis.directionUnit.y * displacementMm,
          ),
          zMm: normalizedZero(
            tcp.zMm + axis.directionUnit.z * displacementMm,
          ),
        };
      },
      { ...this.#tcpAtHomeMm },
    );
    const orderedPositions = Object.fromEntries(
      this.#axes.map((axis) => [
        axis.id,
        normalizedZero(positionsMm[axis.id]),
      ]),
    );

    return {
      pose: {
        tcpPositionMm,
        axisPositionsMm: orderedPositions,
      },
      diagnostics,
    };
  }

  evaluateTrajectory(
    samples: readonly AxisMotionSample[],
  ): TrajectoryEvaluation {
    const poses: (ThreeAxisPose | null)[] = [];
    const diagnostics: KinematicsDiagnostic[] = [];
    const segmentVelocitiesMmPerS: number[][] = [];

    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      const sample = samples[sampleIndex];
      const timeValid =
        Number.isFinite(sample.timeS) &&
        sample.timeS >= 0 &&
        (sampleIndex === 0 ||
          sample.timeS > samples[sampleIndex - 1].timeS);

      if (!timeValid) {
        diagnostics.push(
          diagnostic(
            "kinematics.sample.time-invalid",
            {
              axisId: null,
              timeS: Number.isFinite(sample.timeS) ? sample.timeS : null,
              sourceLine: sample.sourceLine,
              actual: Number.isFinite(sample.timeS) ? sample.timeS : null,
              limit:
                sampleIndex === 0 ? 0 : samples[sampleIndex - 1].timeS,
              unit: "s",
            },
            "Trajectory sample time must be finite, non-negative and strictly increasing.",
          ),
        );
      }

      const result = this.solve(sample.positionsMm, {
        timeS: Number.isFinite(sample.timeS) ? sample.timeS : null,
        sourceLine: sample.sourceLine,
      });
      poses.push(result.pose);
      diagnostics.push(...result.diagnostics);

      if (sampleIndex === 0 || !timeValid) {
        continue;
      }

      const previous = samples[sampleIndex - 1];
      const previousPose = poses[sampleIndex - 1];
      const durationS = sample.timeS - previous.timeS;
      const velocities = this.#axes.map((axis) => {
        const previousPosition = previous.positionsMm[axis.id];
        const currentPosition = sample.positionsMm[axis.id];
        if (
          !Number.isFinite(previousPosition) ||
          !Number.isFinite(currentPosition)
        ) {
          return Number.NaN;
        }

        const signedVelocityMmPerS =
          (currentPosition - previousPosition) / durationS;
        const speedMmPerMin = Math.abs(signedVelocityMmPerS) * 60;
        if (
          speedMmPerMin >
          axis.maxVelocityMmPerMin + NUMERIC_EPSILON
        ) {
          diagnostics.push(
            diagnostic(
              "kinematics.axis.velocity",
              {
                axisId: axis.id,
                timeS: sample.timeS,
                sourceLine: sample.sourceLine,
                actual: speedMmPerMin,
                limit: axis.maxVelocityMmPerMin,
                unit: "mm/min",
              },
              `Axis "${axis.name}" exceeds its velocity limit.`,
            ),
          );
        }
        return signedVelocityMmPerS;
      });
      segmentVelocitiesMmPerS.push(velocities);

      if (sample.motion === "feed" && previousPose && result.pose) {
        const feedMmPerMin =
          (distanceMm(
            previousPose.tcpPositionMm,
            result.pose.tcpPositionMm,
          ) /
            durationS) *
          60;
        if (
          feedMmPerMin >
          this.#machine.maxFeedMmPerMin + NUMERIC_EPSILON
        ) {
          diagnostics.push(
            diagnostic(
              "kinematics.feed.velocity",
              {
                axisId: null,
                timeS: sample.timeS,
                sourceLine: sample.sourceLine,
                actual: feedMmPerMin,
                limit: this.#machine.maxFeedMmPerMin,
                unit: "mm/min",
              },
              "TCP feed exceeds the machine feed limit.",
            ),
          );
        }
      }

      if (sampleIndex < 2 || segmentVelocitiesMmPerS.length < 2) {
        continue;
      }

      const previousDurationS =
        previous.timeS - samples[sampleIndex - 2].timeS;
      const velocityDeltaTimeS = (previousDurationS + durationS) / 2;
      const priorVelocities =
        segmentVelocitiesMmPerS[segmentVelocitiesMmPerS.length - 2];

      this.#axes.forEach((axis, axisIndex) => {
        const previousVelocity = priorVelocities[axisIndex];
        const currentVelocity = velocities[axisIndex];
        if (
          !Number.isFinite(previousVelocity) ||
          !Number.isFinite(currentVelocity)
        ) {
          return;
        }
        const accelerationMmPerS2 =
          Math.abs(currentVelocity - previousVelocity) /
          velocityDeltaTimeS;
        if (
          accelerationMmPerS2 >
          axis.maxAccelerationMmPerS2 + NUMERIC_EPSILON
        ) {
          diagnostics.push(
            diagnostic(
              "kinematics.axis.acceleration",
              {
                axisId: axis.id,
                timeS: sample.timeS,
                sourceLine: sample.sourceLine,
                actual: accelerationMmPerS2,
                limit: axis.maxAccelerationMmPerS2,
                unit: "mm/s2",
              },
              `Axis "${axis.name}" exceeds its acceleration limit.`,
            ),
          );
        }
      });
    }

    return { poses, diagnostics };
  }

  interpolateSegment(
    start: AxisMotionSample,
    end: AxisMotionSample,
    maximumAxisStepMm: number,
  ): readonly AxisMotionSample[] {
    if (
      !Number.isFinite(maximumAxisStepMm) ||
      maximumAxisStepMm <= 0
    ) {
      throw new RangeError(
        "maximumAxisStepMm must be a finite positive millimetre value.",
      );
    }
    if (
      !Number.isFinite(start.timeS) ||
      !Number.isFinite(end.timeS) ||
      start.timeS < 0 ||
      end.timeS <= start.timeS
    ) {
      throw new RangeError(
        "Interpolation endpoints require increasing finite sample times.",
      );
    }

    let maximumTravelMm = 0;
    for (const axis of this.#axes) {
      const startPosition = start.positionsMm[axis.id];
      const endPosition = end.positionsMm[axis.id];
      if (
        !Number.isFinite(startPosition) ||
        !Number.isFinite(endPosition)
      ) {
        throw new RangeError(
          `Interpolation requires finite positions for axis "${axis.id}".`,
        );
      }
      maximumTravelMm = Math.max(
        maximumTravelMm,
        Math.abs(endPosition - startPosition),
      );
    }

    const stepCount = Math.max(
      1,
      Math.ceil(maximumTravelMm / maximumAxisStepMm),
    );
    if (stepCount > MAX_INTERPOLATION_STEPS) {
      throw new RangeError(
        `Interpolation requires ${stepCount} steps, above the ${MAX_INTERPOLATION_STEPS} safety limit.`,
      );
    }

    return Array.from({ length: stepCount + 1 }, (_, stepIndex) => {
      const ratio = stepIndex / stepCount;
      return {
        timeS: normalizedZero(
          start.timeS + (end.timeS - start.timeS) * ratio,
        ),
        positionsMm: Object.fromEntries(
          this.#axes.map((axis) => [
            axis.id,
            normalizedZero(
              start.positionsMm[axis.id] +
                (end.positionsMm[axis.id] -
                  start.positionsMm[axis.id]) *
                  ratio,
            ),
          ]),
        ),
        motion: stepIndex === 0 ? start.motion : end.motion,
        sourceLine: stepIndex === 0 ? start.sourceLine : end.sourceLine,
      };
    });
  }
}

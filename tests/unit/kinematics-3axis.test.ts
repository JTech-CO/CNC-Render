import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MachineDefinitionSchema, type Vec3Mm } from "@cnc-render/contracts";
import {
  KinematicsConfigurationError,
  ThreeAxisKinematics,
  type AxisMotionSample,
  type AxisPositionMmMap,
} from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";

interface GoldenPose {
  readonly id: string;
  readonly axisPositionsMm: AxisPositionMmMap;
  readonly expectedTcpPositionMm: Vec3Mm;
}

interface GoldenPoseFixture {
  readonly fixtureVersion: number;
  readonly units: "mm";
  readonly poseToleranceMm: number;
  readonly machine: unknown;
  readonly tcpAtHomeMm: Vec3Mm;
  readonly poses: readonly GoldenPose[];
}

const fixturePath = fileURLToPath(
  new URL(
    "../fixtures/machines/vmc-3axis/golden-poses.json",
    import.meta.url,
  ),
);
const fixture = JSON.parse(
  readFileSync(fixturePath, "utf8"),
) as GoldenPoseFixture;
const machine = MachineDefinitionSchema.parse(fixture.machine);
const kinematics = new ThreeAxisKinematics(
  machine,
  fixture.tcpAtHomeMm,
);
const [xAxisId, yAxisId, zAxisId] = kinematics.axisOrder;

function positions(
  xMm: number,
  yMm: number,
  zMm: number,
): AxisPositionMmMap {
  return {
    [xAxisId]: xMm,
    [yAxisId]: yMm,
    [zAxisId]: zMm,
  };
}

function sample(
  timeS: number,
  axisPositionsMm: AxisPositionMmMap,
  motion: "rapid" | "feed" = "rapid",
  sourceLine = 1,
): AxisMotionSample {
  return {
    timeS,
    positionsMm: axisPositionsMm,
    motion,
    sourceLine,
  };
}

describe("M4 three-axis linear kinematics", () => {
  it("matches every VMC Golden Pose within the approved tolerance", () => {
    expect(fixture.fixtureVersion).toBe(1);
    expect(fixture.units).toBe("mm");

    for (const golden of fixture.poses) {
      const result = kinematics.solve(golden.axisPositionsMm);
      expect(result.diagnostics, golden.id).toEqual([]);
      expect(result.pose, golden.id).not.toBeNull();
      const actual = result.pose?.tcpPositionMm;
      expect(
        Math.abs(
          (actual?.xMm ?? Number.POSITIVE_INFINITY) -
            golden.expectedTcpPositionMm.xMm,
        ),
        `${golden.id} x`,
      ).toBeLessThanOrEqual(fixture.poseToleranceMm);
      expect(
        Math.abs(
          (actual?.yMm ?? Number.POSITIVE_INFINITY) -
            golden.expectedTcpPositionMm.yMm,
        ),
        `${golden.id} y`,
      ).toBeLessThanOrEqual(fixture.poseToleranceMm);
      expect(
        Math.abs(
          (actual?.zMm ?? Number.POSITIVE_INFINITY) -
            golden.expectedTcpPositionMm.zMm,
        ),
        `${golden.id} z`,
      ).toBeLessThanOrEqual(fixture.poseToleranceMm);
    }
  });

  it("treats home, minimum and maximum travel as inclusive boundaries", () => {
    for (const poseId of ["home", "minimum-travel", "maximum-travel"]) {
      const golden = fixture.poses.find((pose) => pose.id === poseId);
      expect(golden, poseId).toBeDefined();
      expect(
        kinematics.solve(golden?.axisPositionsMm ?? {}).diagnostics,
        poseId,
      ).toEqual([]);
    }
  });

  it("diagnoses travel outside either inclusive boundary", () => {
    const below = kinematics.solve(positions(-300.000_001, 0, 0), {
      timeS: 0.5,
      sourceLine: 12,
    });
    const above = kinematics.solve(positions(0, 200.000_001, 0), {
      timeS: 0.75,
      sourceLine: 13,
    });

    expect(below.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "kinematics.axis.limit-min",
        axisId: xAxisId,
        timeS: 0.5,
        sourceLine: 12,
        limit: -300,
        unit: "mm",
      }),
    );
    expect(above.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "kinematics.axis.limit-max",
        axisId: yAxisId,
        timeS: 0.75,
        sourceLine: 13,
        limit: 200,
        unit: "mm",
      }),
    );
  });

  it("fails closed on missing, unknown or non-finite axis inputs", () => {
    const missing = kinematics.solve({
      [xAxisId]: 0,
      [yAxisId]: 0,
    });
    const unknown = kinematics.solve({
      ...positions(0, 0, 0),
      unknown: 1,
    });
    const nonfinite = kinematics.solve(positions(Number.NaN, 0, 0));

    expect(missing.pose).toBeNull();
    expect(missing.diagnostics[0].code).toBe(
      "kinematics.axis.position-missing",
    );
    expect(unknown.pose).toBeNull();
    expect(unknown.diagnostics[0].code).toBe(
      "kinematics.axis.position-unknown",
    );
    expect(nonfinite.pose).toBeNull();
    expect(nonfinite.diagnostics[0]).toMatchObject({
      code: "kinematics.axis.position-nonfinite",
      actual: null,
    });
    expect(JSON.stringify(nonfinite)).not.toContain("NaN");
  });

  it("guards rapid axis velocity at, then immediately above, the limit", () => {
    const atLimit = kinematics.evaluateTrajectory([
      sample(0, positions(0, 0, 0)),
      sample(1, positions(200, 0, 0), "rapid", 20),
    ]);
    const overLimit = kinematics.evaluateTrajectory([
      sample(0, positions(0, 0, 0)),
      sample(1, positions(200.000_001, 0, 0), "rapid", 21),
    ]);

    expect(
      atLimit.diagnostics.filter(
        ({ code }) => code === "kinematics.axis.velocity",
      ),
    ).toEqual([]);
    expect(overLimit.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "kinematics.axis.velocity",
        axisId: xAxisId,
        sourceLine: 21,
        limit: 12000,
        unit: "mm/min",
      }),
    );
  });

  it("guards feed velocity independently from per-axis velocity", () => {
    const result = kinematics.evaluateTrajectory([
      sample(0, positions(0, 0, 0), "feed"),
      sample(1, positions(150, 150, 0), "feed", 30),
    ]);

    expect(
      result.diagnostics.filter(
        ({ code }) => code === "kinematics.axis.velocity",
      ),
    ).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "kinematics.feed.velocity",
        axisId: null,
        sourceLine: 30,
        limit: 12000,
        unit: "mm/min",
      }),
    );
  });

  it("guards acceleration at, then immediately above, the limit", () => {
    const atLimit = kinematics.evaluateTrajectory([
      sample(0, positions(0, 0, 0)),
      sample(0.01, positions(0, 0, 0)),
      sample(0.02, positions(0.1, 0, 0), "rapid", 40),
    ]);
    const overLimit = kinematics.evaluateTrajectory([
      sample(0, positions(0, 0, 0)),
      sample(0.01, positions(0, 0, 0)),
      sample(0.02, positions(0.100_001, 0, 0), "rapid", 41),
    ]);

    expect(
      atLimit.diagnostics.filter(
        ({ code }) => code === "kinematics.axis.acceleration",
      ),
    ).toEqual([]);
    expect(overLimit.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "kinematics.axis.acceleration",
        axisId: xAxisId,
        sourceLine: 41,
        limit: 1000,
        unit: "mm/s2",
      }),
    );
  });

  it("interpolates every axis with a bounded deterministic step", () => {
    const samples = kinematics.interpolateSegment(
      sample(0, positions(0, 0, 0), "rapid", 50),
      sample(1, positions(2.5, -1, -0.5), "feed", 51),
      1,
    );

    expect(samples).toHaveLength(4);
    expect(samples[0]).toEqual(
      sample(0, positions(0, 0, 0), "rapid", 50),
    );
    expect(samples[3]).toEqual(
      sample(1, positions(2.5, -1, -0.5), "feed", 51),
    );
    for (let index = 1; index < samples.length; index += 1) {
      expect(
        Math.abs(
          samples[index].positionsMm[xAxisId] -
            samples[index - 1].positionsMm[xAxisId],
        ),
      ).toBeLessThanOrEqual(1);
    }
  });

  it("returns byte-stable ordered results for repeated inputs", () => {
    const input = positions(125.5, -40.25, -275.125);
    const expected = JSON.stringify(kinematics.solve(input));

    for (let repetition = 0; repetition < 100; repetition += 1) {
      expect(JSON.stringify(kinematics.solve(input))).toBe(expected);
    }
  });

  it("rejects rotary definitions instead of approximating them", () => {
    const rotaryMachine = structuredClone(machine);
    rotaryMachine.axes[2] = {
      schemaVersion: 1,
      id: zAxisId,
      name: "C",
      kind: "rotary",
      parentId: yAxisId,
      directionUnit: { x: 0, y: 0, z: 1 },
      pivotMm: { xMm: 0, yMm: 0, zMm: 500 },
      minRad: -Math.PI,
      maxRad: Math.PI,
      maxVelocityRadPerS: 1,
      maxAccelerationRadPerS2: 1,
      homeRad: 0,
    };

    let thrown: unknown;
    try {
      new ThreeAxisKinematics(rotaryMachine, fixture.tcpAtHomeMm);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KinematicsConfigurationError);
    expect(thrown).toMatchObject({
      code: "kinematics.axis.kind-unsupported",
    });
  });
});

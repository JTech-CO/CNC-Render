import { MachineDefinitionSchema, type Vec3Mm } from "@cnc-render/contracts";
import {
  ThreeAxisKinematics,
  type AxisPositionMmMap,
} from "@cnc-render/simulation";
import { describe, expect, it } from "vitest";

import {
  loadGoldenPoseFixture,
  runSimulationCli,
} from "../helpers/simulation-cli.mjs";

interface GoldenPose {
  readonly id: string;
  readonly axisPositionsMm: AxisPositionMmMap;
  readonly expectedTcpPositionMm: Vec3Mm;
}

interface GoldenPoseFixture {
  readonly poseToleranceMm: number;
  readonly machine: unknown;
  readonly tcpAtHomeMm: Vec3Mm;
  readonly poses: readonly GoldenPose[];
}

interface RustPoseResult {
  readonly id: string;
  readonly pose: {
    readonly tcpPositionMm: Vec3Mm;
    readonly axisPositionsMm: AxisPositionMmMap;
  };
}

const fixture = loadGoldenPoseFixture() as GoldenPoseFixture;
const machine = MachineDefinitionSchema.parse(fixture.machine);
const kinematics = new ThreeAxisKinematics(
  machine,
  fixture.tcpAtHomeMm,
);
const request = {
  machine,
  tcpAtHomeMm: fixture.tcpAtHomeMm,
  poses: fixture.poses.map(({ id, axisPositionsMm }) => ({
    id,
    axisPositionsMm,
  })),
  repetitions: 100,
};

describe("M4 Golden poses TypeScript and Rust parity", () => {
  it(
    "matches every pose and remains stable for 100 Rust evaluations",
    () => {
      const response = runSimulationCli(request) as {
        readonly stable: boolean;
        readonly results: readonly RustPoseResult[];
      };

      expect(response.stable).toBe(true);
      expect(response.results).toHaveLength(fixture.poses.length);

      for (const rustResult of response.results) {
        const golden = fixture.poses.find(
          ({ id }) => id === rustResult.id,
        );
        expect(golden, rustResult.id).toBeDefined();
        const typescript = kinematics.solve(
          golden?.axisPositionsMm ?? {},
        ).pose;
        expect(typescript, rustResult.id).not.toBeNull();

        for (const coordinate of ["xMm", "yMm", "zMm"] as const) {
          expect(
            Math.abs(
              rustResult.pose.tcpPositionMm[coordinate] -
                (typescript?.tcpPositionMm[coordinate] ??
                  Number.POSITIVE_INFINITY),
            ),
            `${rustResult.id} ${coordinate}`,
          ).toBeLessThanOrEqual(fixture.poseToleranceMm);
        }
        expect(rustResult.pose.axisPositionsMm).toEqual(
          typescript?.axisPositionsMm,
        );
      }
    },
    120_000,
  );

  it("returns byte-equivalent pose results in separate processes", () => {
    expect(JSON.stringify(runSimulationCli(request))).toBe(
      JSON.stringify(runSimulationCli(request)),
    );
  }, 120_000);
});

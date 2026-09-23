import { describe, expect, it } from "vitest";
import { FiveAxisInverseKinematics, FiveAxisKinematics, IK_ORIENTATION_TOLERANCE_RAD, IK_POSITION_TOLERANCE_MM } from "@cnc-render/simulation";
import { fiveAxisGolden, goldenInput, poseErrors } from "../helpers/five-axis-fixtures";
import { machinePluginFixture, machineStateFixture } from "../fixtures/machine-plugins";

describe("M13 kinematics-5axis IK and TCP", () => {
  it.each(fiveAxisGolden.poses)("independent Golden target -> IK -> FK: $id", (row) => {
    const { plugin,state } = goldenInput(row);
    for (const p of state.positions) {
      const axis = plugin.machine.axes.find((a) => a.id === p.axisId)!;
      if (p.kind === "rotary" && axis.kind === "rotary") p.positionRad = Math.min(axis.maxRad,Math.max(axis.minRad,p.positionRad-0.13));
      if (p.kind === "linear") p.positionMm = 0;
    }
    const [xMm,yMm,zMm] = row.point, [x,y,z] = row.direction;
    const target = { tcpPositionMm: { xMm,yMm,zMm }, toolAxisUnit: { x,y,z } };
    const before = JSON.stringify({ plugin,state,target });
    const ik = new FiveAxisInverseKinematics(plugin), result = ik.inverse(target,state);
    expect(result.status,row.id+JSON.stringify(result)).toBe("solved");
    if (result.status !== "solved") return;
    expect(result.iterations).toBeGreaterThan(0);
    const errors = poseErrors(new FiveAxisKinematics(plugin).solve(result.state),row.point,row.direction);
    expect(errors.positionMm).toBeLessThanOrEqual(IK_POSITION_TOLERANCE_MM);
    expect(errors.orientationRad).toBeLessThanOrEqual(IK_ORIENTATION_TOLERANCE_RAD);
    expect(JSON.stringify({ plugin,state,target })).toBe(before);
    expect(ik.inverse(target,{ ...state, positions: [...state.positions].reverse() })).toEqual(result);
    expect(ik.inverse(target,state)).toEqual(result);
  });

  it.each(["table-table","head-table","head-head"] as const)("TCP holds the tip and computes independent XYZ compensation: %s", (architecture) => {
    const plugin = machinePluginFixture(architecture), start = machineStateFixture(plugin), command = structuredClone(start);
    const a = command.positions[3];
    if (a.kind === "rotary") a.positionRad = Math.PI/2;
    const original = JSON.stringify({ start,command });
    const ik = new FiveAxisInverseKinematics(plugin);
    const result = ik.compensateTcp(start,command);
    expect(result.status).toBe("solved");
    if (result.status !== "solved") return;
    const expected = architecture === "table-table" ? [0,220,220] : [0,-220,-220];
    result.state.positions.filter((p) => p.kind === "linear").forEach((p,i) => expect(Math.abs(p.positionMm-expected[i])).toBeLessThanOrEqual(1e-9));
    const fk = new FiveAxisKinematics(plugin), old = fk.solve(start), rotated = fk.solve(command);
    expect(poseErrors(result.pose,Object.values(old.tcpPositionMm),Object.values(rotated.toolAxisUnit)).positionMm).toBeLessThanOrEqual(1e-9);
    expect(result.state.positions.filter((p) => p.kind === "rotary")).toEqual(command.positions.filter((p) => p.kind === "rotary"));
    expect(JSON.stringify({ start,command })).toBe(original);
  });

  it("separates unsupported input, disabled TCP, limit, singular-linear and nonconvergence failures", () => {
    const plugin = machinePluginFixture("head-head"), state = machineStateFixture(plugin);
    const target = new FiveAxisKinematics(plugin).solve(state), ik = new FiveAxisInverseKinematics(plugin);
    expect(ik.inverse(target,{ ...state,tcpEnabled: false })).toEqual({ status: "failed",code: "tcp-disabled",iterations: 0 });
    expect(ik.inverse({ ...target,tcpPositionMm: { xMm: 10000,yMm: 0,zMm: 0 } },state)).toMatchObject({ status: "failed",code: "linear-limit" });
    expect(ik.inverse({ ...target,toolAxisUnit: { x: 0,y: 0,z: -1 } },state)).toMatchObject({ status: "failed",code: "orientation-not-converged" });
    expect(() => ik.inverse({ ...target,tcpPositionMm: { xMm: NaN,yMm: 0,zMm: 0 } },state)).toThrow();
    expect(() => ik.inverse({ ...target,toolAxisUnit: { x: 0,y: 0,z: 0 } },state)).toThrow();
    expect(() => ik.compensateTcp(state,{ ...state,mode: "simultaneous-5axis" })).toThrow();
    plugin.machine.axes[1].directionUnit = { x: 1,y: 0,z: 0 };
    expect(new FiveAxisInverseKinematics(plugin).inverse(target,state)).toMatchObject({ status: "failed",code: "linear-singular" });
    plugin.capabilities.tcp = "unsupported";
    expect(() => new FiveAxisInverseKinematics(plugin).inverse(target,state)).toThrow();
  });

  it.each(["table-table","head-table","head-head"] as const)("inclusive linear boundaries and both TCP modes: %s", (architecture) => {
    const plugin = machinePluginFixture(architecture), fk = new FiveAxisKinematics(plugin), ik = new FiveAxisInverseKinematics(plugin);
    for (const edge of [-500,500]) {
      const state = machineStateFixture(plugin);
      state.positions.forEach((p) => { if (p.kind === "linear") p.positionMm = edge; else p.positionRad = 0.5; });
      const target = fk.solve(state);
      state.positions.forEach((p) => { if (p.kind === "linear") p.positionMm = 0; else p.positionRad += 0.07; });
      const result = ik.inverse(target,state);
      expect(result.status,JSON.stringify(result)).toBe("solved");
    }
    for (const mode of ["3plus2","simultaneous-5axis"] as const) {
      const reference = { ...machineStateFixture(plugin),mode };
      for (let i = 1; i <= 5; i++) {
        const commanded = structuredClone(reference);
        commanded.positions.forEach((p) => { if (p.kind === "rotary") p.positionRad = i*0.08; });
        expect(ik.compensateTcp(reference,commanded).status).toBe("solved");
      }
    }
  });
});

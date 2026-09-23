import { describe, expect, it } from "vitest";
import { FiveAxisInverseKinematics, FiveAxisKinematics, type FiveAxisInverseResult } from "@cnc-render/simulation";
import type { FiveAxisTarget, MachinePlugin, MachinePluginState } from "@cnc-render/contracts";
import { fiveAxisGolden, goldenInput, poseErrors } from "../helpers/five-axis-fixtures";
import { machinePluginFixture, machineStateFixture } from "../fixtures/machine-plugins";
import { runSimulationCli } from "../helpers/simulation-cli.mjs";

type Operation = { kind: "ik"; target: FiveAxisTarget; seed: MachinePluginState } | { kind: "tcp"; reference: MachinePluginState; commanded: MachinePluginState };
function run(plugin: MachinePlugin, operations: Operation[], repetitions = 10) {
  const result = runSimulationCli({ requestType: "five-axis-inverse",plugin,operations,repetitions }) as { stable: boolean; results: FiveAxisInverseResult[] };
  expect(result.stable).toBe(true);
  expect(result.results).toHaveLength(operations.length);
  return result;
}
function checkSolved(plugin: MachinePlugin, result: FiveAxisInverseResult, target: FiveAxisTarget) {
  expect(result.status,JSON.stringify(result)).toBe("solved");
  if (result.status !== "solved") throw new Error("expected solution");
  const errors = poseErrors(new FiveAxisKinematics(plugin).solve(result.state),Object.values(target.tcpPositionMm),Object.values(target.toolAxisUnit));
  expect(errors.positionMm).toBeLessThanOrEqual(1e-9);
  expect(errors.orientationRad).toBeLessThanOrEqual(1e-9);
  expect(result.positionErrorMm).toBeLessThanOrEqual(1e-9);
  expect(result.orientationErrorRad).toBeLessThanOrEqual(1e-9);
  expect(result.iterations).toBeLessThanOrEqual(80);
  return result;
}

describe("M13 fk-ik inverse native parity", () => {
  it("independent Golden targets -> IK -> FK in both languages", () => {
    for (const row of fiveAxisGolden.poses) {
      const { plugin,state } = goldenInput(row);
      state.positions.forEach((p) => {
        const axis = plugin.machine.axes.find((a) => a.id === p.axisId)!;
        if (p.kind === "rotary" && axis.kind === "rotary") p.positionRad = Math.max(axis.minRad,p.positionRad-0.13);
        if (p.kind === "linear") p.positionMm = 0;
      });
      const [xMm,yMm,zMm] = row.point, [x,y,z] = row.direction;
      const target = { tcpPositionMm: { xMm,yMm,zMm }, toolAxisUnit: { x,y,z } };
      const ts = checkSolved(plugin,new FiveAxisInverseKinematics(plugin).inverse(target,state),target);
      const rust = checkSolved(plugin,run(plugin,[{ kind: "ik",target,seed: state }]).results[0],target);
      // Same local branch; positions can differ by tiny solver rounding, not by a new branch.
      ts.state.positions.forEach((p,i) => {
        const r = rust.state.positions[i];
        expect(r.axisId).toBe(p.axisId);
        if (r.kind === "linear" && p.kind === "linear") expect(Math.abs(r.positionMm-p.positionMm)).toBeLessThanOrEqual(1e-6);
        if (r.kind === "rotary" && p.kind === "rotary") expect(Math.abs(r.positionRad-p.positionRad)).toBeLessThanOrEqual(1e-8);
      });
    }
  },180_000);

  it.each(["table-table","head-table","head-head"] as const)("100 seeded local IK round trips and stable subprocesses: %s", (architecture) => {
    const plugin = machinePluginFixture(architecture);
    if (architecture === "head-head") plugin.toolMount.toolAxisUnit = { x: 0.6,y: 0,z: 0.8 };
    const fk = new FiveAxisKinematics(plugin), ik = new FiveAxisInverseKinematics(plugin);
    let seed = 0x13002410;
    const random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed/0x100000000; };
    const operations: Operation[] = Array.from({ length: 100 }, () => {
      const state = machineStateFixture(plugin);
      state.positions.forEach((p) => { if (p.kind === "linear") p.positionMm = random()*200-100; else p.positionRad = random()*2.4-1.2; });
      const target = fk.solve(state);
      state.positions.forEach((p) => { if (p.kind === "linear") p.positionMm = 0; else p.positionRad += 0.07; });
      return { kind: "ik",target,seed: state };
    });
    const result = run(plugin,operations,2);
    expect(JSON.stringify(run(plugin,operations,2))).toBe(JSON.stringify(result));
    operations.forEach((operation,i) => {
      if (operation.kind !== "ik") throw new Error("unexpected TCP");
      checkSolved(plugin,result.results[i],operation.target);
      checkSolved(plugin,ik.inverse(operation.target,operation.seed),operation.target);
    });
  },180_000);

  it("TCP independent compensation and 100-repeat stability on each architecture", () => {
    for (const architecture of ["table-table","head-table","head-head"] as const) {
      const plugin = machinePluginFixture(architecture), reference = machineStateFixture(plugin), commanded = structuredClone(reference);
      if (commanded.positions[3].kind === "rotary") commanded.positions[3].positionRad = Math.PI/2;
      const fk = new FiveAxisKinematics(plugin);
      const target = { tcpPositionMm: fk.solve(reference).tcpPositionMm,toolAxisUnit: fk.solve(commanded).toolAxisUnit };
      const result = run(plugin,[{ kind: "tcp",reference,commanded }],100);
      expect(JSON.stringify(run(plugin,[{ kind: "tcp",reference,commanded }],100))).toBe(JSON.stringify(result));
      const rust = checkSolved(plugin,result.results[0],target);
      checkSolved(plugin,new FiveAxisInverseKinematics(plugin).compensateTcp(reference,commanded),target);
      const expected = architecture === "table-table" ? [0,220,220] : [0,-220,-220];
      rust.state.positions.filter((p) => p.kind === "linear").forEach((p,i) => expect(Math.abs(p.positionMm-expected[i])).toBeLessThanOrEqual(1e-9));
      expect(rust.state.positions.filter((p) => p.kind === "rotary")).toEqual(commanded.positions.filter((p) => p.kind === "rotary"));
    }
  },180_000);

  it("matching explicit failure results, never a fabricated pose", () => {
    const plugin = machinePluginFixture("head-head"), seed = machineStateFixture(plugin), target = new FiveAxisKinematics(plugin).solve(seed);
    const operations: Operation[] = [
      { kind: "ik",target,seed: { ...seed,tcpEnabled: false } },
      { kind: "ik",target: { ...target,tcpPositionMm: { xMm: 10000,yMm: 0,zMm: 0 } },seed },
      { kind: "ik",target: { ...target,toolAxisUnit: { x: 0,y: 0,z: -1 } },seed },
    ];
    const rust = run(plugin,operations).results, ik = new FiveAxisInverseKinematics(plugin);
    operations.forEach((op,i) => { if (op.kind === "ik") expect(rust[i]).toEqual(ik.inverse(op.target,op.seed)); });
    expect(rust.map((r) => r.status === "failed" ? r.code : "unexpected")).toEqual(["tcp-disabled","linear-limit","orientation-not-converged"]);
    plugin.machine.axes[1].directionUnit = { x: 1,y: 0,z: 0 };
    expect(run(plugin,[{ kind: "ik",target,seed }]).results[0]).toEqual({ status: "failed",code: "linear-singular",iterations: 0 });
    expect(() => run(plugin,[{ kind: "ik",target: { ...target,toolAxisUnit: { x: 0,y: 0,z: 0 } },seed }])).toThrow();
    expect(() => run(plugin,[{ kind: "tcp",reference: seed,commanded: { ...seed,mode: "simultaneous-5axis" } }])).toThrow();
    expect(() => run(plugin,[{ kind: "ik",target,seed }],101)).toThrow();
  },180_000);

  it("inclusive XYZ boundaries and both TCP operation modes agree", () => {
    for (const architecture of ["table-table","head-table","head-head"] as const) {
      const plugin = machinePluginFixture(architecture), fk = new FiveAxisKinematics(plugin);
      const operations: Operation[] = [];
      const targets: FiveAxisTarget[] = [];
      for (const edge of [-500,500]) {
        const seed = machineStateFixture(plugin);
        seed.positions.forEach((p) => { if (p.kind === "linear") p.positionMm = edge; else p.positionRad = 0.5; });
        const target = fk.solve(seed);
        seed.positions.forEach((p) => { if (p.kind === "linear") p.positionMm = 0; else p.positionRad += 0.07; });
        operations.push({ kind: "ik",target,seed }); targets.push(target);
      }
      for (const mode of ["3plus2","simultaneous-5axis"] as const) {
        const reference = { ...machineStateFixture(plugin),mode };
        for (let i = 1; i <= 5; i++) {
          const commanded = structuredClone(reference);
          commanded.positions.forEach((p) => { if (p.kind === "rotary") p.positionRad = i*0.08; });
          operations.push({ kind: "tcp",reference,commanded });
          targets.push({ tcpPositionMm: fk.solve(reference).tcpPositionMm,toolAxisUnit: fk.solve(commanded).toolAxisUnit });
        }
      }
      const result = run(plugin,operations);
      const ik = new FiveAxisInverseKinematics(plugin);
      result.results.forEach((r,i) => {
        checkSolved(plugin,r,targets[i]);
        const op = operations[i];
        checkSolved(plugin,op.kind === "ik" ? ik.inverse(op.target,op.seed) : ik.compensateTcp(op.reference,op.commanded),targets[i]);
      });
    }
  },180_000);
});

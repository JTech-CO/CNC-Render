import { describe, expect, it } from "vitest";
import type { MachinePlugin, MachinePluginState, RewindRequest } from "@cnc-render/contracts";
import { FiveAxisKinematics, FiveAxisMotionGuard, type FiveAxisDiagnostic, type FiveAxisRewindPlan, type FiveAxisTransitionReport } from "@cnc-render/simulation";
import { guardFixture, setGuardAxis } from "../helpers/five-axis-diagnostics";
import { poseErrors } from "../helpers/five-axis-fixtures";
import { runSimulationCli } from "../helpers/simulation-cli.mjs";

type Operation = { kind: "transition"; from: MachinePluginState; to: MachinePluginState } | { kind: "rewind"; reference: MachinePluginState; request: RewindRequest };
function run<T>(plugin: MachinePlugin,operation: Operation,repetitions = 1): T {
  const response = runSimulationCli({ requestType: "five-axis-guard",plugin,operation,repetitions }) as { stable: boolean; result: T };
  expect(response.stable).toBe(true); return response.result;
}
function diagnostics(ts: FiveAxisDiagnostic[],rust: FiveAxisDiagnostic[]) {
  expect(rust).toHaveLength(ts.length);
  ts.forEach((d,i) => {
    expect({ ...rust[i],value: null }).toEqual({ ...d,value: null });
    if (d.value === null) expect(rust[i].value).toBeNull();
    else expect(Math.abs(rust[i].value!-d.value)).toBeLessThanOrEqual(1e-9);
  });
}
function transition(plugin: MachinePlugin,from: MachinePluginState,to: MachinePluginState) {
  const ts = new FiveAxisMotionGuard(plugin).analyzeTransition(from,to), rust = run<FiveAxisTransitionReport>(plugin,{ kind: "transition",from,to },2);
  expect({ ...rust,diagnostics: [] }).toEqual({ ...ts,diagnostics: [] }); diagnostics(ts.diagnostics,rust.diagnostics);
  return rust;
}
function rewind(plugin: MachinePlugin,reference: MachinePluginState,request: RewindRequest,repetitions = 1) {
  const ts = new FiveAxisMotionGuard(plugin).planRewind(reference,request), rust = run<FiveAxisRewindPlan>(plugin,{ kind: "rewind",reference,request },repetitions);
  expect({ ...rust,steps: [],diagnostics: [] }).toEqual({ ...ts,steps: [],diagnostics: [] });
  diagnostics(ts.diagnostics,rust.diagnostics);
  expect(rust.steps).toHaveLength(ts.steps.length);
  const fk = new FiveAxisKinematics(plugin);
  rust.steps.forEach((step,i) => {
    expect(step.kind).toBe(ts.steps[i].kind); expect(step.cuttingEnabled).toBe(false);
    const actual = fk.solve(step.state), expected = ts.steps[i].pose;
    for (const pose of [actual,step.pose]) {
      const errors = poseErrors(pose,Object.values(expected.tcpPositionMm),Object.values(expected.toolAxisUnit));
      expect(errors.positionMm).toBeLessThanOrEqual(1e-9); expect(errors.orientationRad).toBeLessThanOrEqual(1e-9);
    }
  }); return rust;
}
describe("M13 fk-ik motion diagnostics and rewind native parity", () => {
  it.each(["table-table","head-table","head-head"] as const)("singular/regular samples, limits and winding jumps match: %s", (architecture) => {
    const { plugin,state } = guardFixture(architecture), to = structuredClone(state);
    setGuardAxis(state,3,-Math.PI/18); setGuardAxis(to,3,Math.PI/18);
    transition(plugin,state,to);
    setGuardAxis(state,3,Math.PI/2); setGuardAxis(to,3,Math.PI/2);
    setGuardAxis(state,4,1.98*Math.PI); setGuardAxis(to,4,1.99*Math.PI);
    expect(transition(plugin,state,to).diagnostics.some((d) => d.code === "rewind-required")).toBe(true);
    expect(transition(plugin,to,state).diagnostics.some((d) => d.code === "rewind-required")).toBe(false);
    setGuardAxis(state,3,Math.PI/2); setGuardAxis(to,3,Math.PI/2);
    setGuardAxis(state,4,Math.PI-0.01); setGuardAxis(to,4,-Math.PI+0.01);
    transition(plugin,state,to);
    setGuardAxis(state,0,490); setGuardAxis(to,0,500); setGuardAxis(to,4,2*Math.PI);
    transition(plugin,state,to);
    plugin.machine.axes.reverse(); state.positions.reverse(); to.positions.reverse();
    expect(JSON.stringify(run(plugin,{ kind: "transition",from: state,to },100))).toBe(JSON.stringify(run(plugin,{ kind: "transition",from: state,to },100)));
  },180_000);

  it.each(["table-table","head-table","head-head"] as const)("TCP rewind endpoints/intermediates and both modes/directions match: %s", (architecture) => {
    const { plugin,state } = guardFixture(architecture);
    for (const mode of ["3plus2","simultaneous-5axis"] as const) for (const direction of ["positive","negative"] as const) {
      const reference: MachinePluginState = { ...structuredClone(state),mode }; setGuardAxis(reference,3,(direction === "positive" ? 1 : -1)*2*Math.PI);
      const request: RewindRequest = { axisId: state.positions[3].axisId,direction,retractDistanceMm: 20 };
      const result = rewind(plugin,reference,request,2);
      expect(result.status).toBe("review-required");
      expect(result.steps).toHaveLength(75);
      if (mode === "3plus2" && direction === "positive") expect(JSON.stringify(run(plugin,{ kind: "rewind",reference,request },100))).toBe(JSON.stringify(run(plugin,{ kind: "rewind",reference,request },100)));
    }
    if (architecture === "head-head") plugin.toolMount.toolAxisUnit = { x: 0.6,y: 0,z: 0.8 };
    setGuardAxis(state,3,0.6); setGuardAxis(state,4,2*Math.PI);
    expect(rewind(plugin,state,{ axisId: state.positions[4].axisId,direction: "positive",retractDistanceMm: 20 },2).status).toBe("review-required");
  },180_000);

  it("bounded failures and strict requests agree without partial rewind paths", () => {
    const { plugin,state } = guardFixture("head-table");
    const request: RewindRequest = { axisId: state.positions[3].axisId,direction: "positive",retractDistanceMm: 20 };
    setGuardAxis(state,3,-2*Math.PI); expect(rewind(plugin,state,request).code).toBe("rewind-axis-limit");
    setGuardAxis(state,3,2*Math.PI); setGuardAxis(state,2,500); expect(rewind(plugin,state,request).code).toBe("retract-linear-limit");
    setGuardAxis(state,2,0); const y = plugin.machine.axes[1]; if (y.kind === "linear") { y.minMm = -100; y.maxMm = 100; }
    expect(rewind(plugin,state,request).code).toBe("rewind-linear-limit");
    expect(rewind(plugin,{ ...state,tcpEnabled: false },request).code).toBe("tcp-disabled");
    for (const bad of [{ ...request,retractDistanceMm: 0 },{ ...request,retractDistanceMm: 501 },{ ...request,axisId: state.positions[0].axisId }]) {
      expect(() => run(plugin,{ kind: "rewind",reference: state,request: bad })).toThrow();
      expect(() => new FiveAxisMotionGuard(plugin).planRewind(state,bad)).toThrow();
    }
    expect(() => run(plugin,{ kind: "transition",from: state,to: { ...state,mode: "simultaneous-5axis" } })).toThrow();
    expect(() => run(plugin,{ kind: "rewind",reference: state,request },101)).toThrow();
    const a = plugin.machine.axes[3]; if (a.kind === "rotary") { a.minRad = -100; a.maxRad = 100; }
    const to = structuredClone(state); setGuardAxis(to,3,30);
    expect(transition(plugin,state,to).diagnostics.some((d) => d.code === "sampling-budget-exceeded")).toBe(true);
    if (a.kind === "rotary") { a.minRad = 1e20; a.maxRad = 1e20+1e6; a.homeRad = 1e20; }
    setGuardAxis(state,3,1e20); expect(transition(plugin,state,state).diagnostics.some((d) => d.code === "numeric-unavailable")).toBe(true);
  },180_000);
});

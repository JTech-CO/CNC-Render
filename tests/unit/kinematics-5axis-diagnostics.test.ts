import { describe, expect, it } from "vitest";
import { createMachinePluginStateSchema, type MachinePluginState } from "@cnc-render/contracts";
import { FiveAxisKinematics, FiveAxisMotionGuard } from "@cnc-render/simulation";
import { guardFixture, setGuardAxis } from "../helpers/five-axis-diagnostics";
import { poseErrors } from "../helpers/five-axis-fixtures";

describe("M13 singularity, discontinuity and rewind", () => {
  it("detects an interior table pole between regular endpoints", () => {
    const { plugin,state } = guardFixture(), to = structuredClone(state);
    setGuardAxis(state,3,-Math.PI/18); setGuardAxis(to,3,Math.PI/18);
    const guard = new FiveAxisMotionGuard(plugin);
    expect(guard.analyzeTransition(state,state).status).toBe("clear");
    expect(guard.analyzeTransition(to,to).status).toBe("clear");
    const report = guard.analyzeTransition(state,to);
    const pole = report.diagnostics.find((d) => d.code === "rotary-singularity")!;
    expect(report.status).toBe("attention-required");
    expect(pole.sampleIndex).toBeGreaterThan(0);
    expect(pole.sampleIndex).toBeLessThan(report.samplesChecked-1);
    expect(pole.value).toBeLessThanOrEqual(1e-6);
    expect(report.diagnostics.some((d) => d.code === "rotary-near-singularity")).toBe(true);
  });
  it("reports linear and rotary inclusive limit margins and rejects exceeded input", () => {
    const { plugin,state } = guardFixture(); setGuardAxis(state,3,Math.PI/2); setGuardAxis(state,0,490);
    const to = structuredClone(state); setGuardAxis(to,0,500); setGuardAxis(to,4,2*Math.PI);
    const guard = new FiveAxisMotionGuard(plugin), report = guard.analyzeTransition(state,to);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: "axis-limit-near",axisId: state.positions[0].axisId,value: 0.01,unit: "ratio" }));
    expect(report.diagnostics.filter((d) => d.code === "axis-limit-reached")).toHaveLength(2);
    setGuardAxis(to,0,500.00001);
    expect(() => guard.analyzeTransition(state,to)).toThrow();
  });
  it("does not hide +/-pi winding jumps behind a small endpoint orientation change", () => {
    const { plugin,state } = guardFixture(); setGuardAxis(state,3,Math.PI/2); setGuardAxis(state,4,Math.PI-0.01);
    const to = structuredClone(state); setGuardAxis(to,4,-Math.PI+0.01);
    const report = new FiveAxisMotionGuard(plugin).analyzeTransition(state,to);
    expect(report.diagnostics.some((d) => d.code === "rewind-required")).toBe(true);
    expect(report.diagnostics.some((d) => d.code === "rotary-axis-jump")).toBe(true);
    expect(report.diagnostics.some((d) => d.code === "tool-axis-jump")).toBe(false);
    expect(to.positions[4]).toMatchObject({ positionRad: -Math.PI+0.01 });
  });
  it("reports abrupt tool-axis orientation separately from joint travel", () => {
    const { plugin,state } = guardFixture(); setGuardAxis(state,3,Math.PI/2);
    const to = structuredClone(state); setGuardAxis(to,4,1);
    const report = new FiveAxisMotionGuard(plugin).analyzeTransition(state,to);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: "tool-axis-jump",unit: "rad" }));
    expect(report.diagnostics.some((d) => d.code === "rotary-axis-jump")).toBe(false);
  });
  it("requests rewind review on approach to a rotary stop, but not while moving away", () => {
    const { plugin,state } = guardFixture(); setGuardAxis(state,3,Math.PI/2); setGuardAxis(state,4,1.98*Math.PI);
    const to = structuredClone(state); setGuardAxis(to,4,1.99*Math.PI);
    const guard = new FiveAxisMotionGuard(plugin);
    expect(guard.analyzeTransition(state,to).diagnostics.some((d) => d.code === "rewind-required")).toBe(true);
    expect(guard.analyzeTransition(to,state).diagnostics.some((d) => d.code === "rewind-required")).toBe(false);
  });
  it("fails closed on sampling budget exhaustion and unrepresentable derivative", () => {
    const { plugin,state } = guardFixture();
    const a = plugin.machine.axes[3]; if (a.kind === "rotary") { a.minRad = -100; a.maxRad = 100; }
    const to = structuredClone(state); setGuardAxis(to,3,30);
    const report = new FiveAxisMotionGuard(plugin).analyzeTransition(state,to);
    expect(report.samplesChecked).toBe(0);
    expect(report.diagnostics.some((d) => d.code === "sampling-budget-exceeded")).toBe(true);
    if (a.kind === "rotary") { a.minRad = 1e20; a.maxRad = 1e20+1e6; a.homeRad = 1e20; }
    setGuardAxis(state,3,1e20);
    const numeric = new FiveAxisMotionGuard(plugin).analyzeTransition(state,state);
    expect(numeric.diagnostics.some((d) => d.code === "numeric-unavailable")).toBe(true);
    expect(numeric.status).toBe("attention-required");
  });
  it.each(["table-table","head-table","head-head"] as const)("builds bounded, non-cutting TCP rewind in both modes and directions: %s", (architecture) => {
    const { plugin,state } = guardFixture(architecture), guard = new FiveAxisMotionGuard(plugin), fk = new FiveAxisKinematics(plugin);
    for (const mode of ["3plus2","simultaneous-5axis"] as const) for (const direction of ["positive","negative"] as const) {
      const reference: MachinePluginState = { ...structuredClone(state),mode };
      setGuardAxis(reference,3,(direction === "positive" ? 1 : -1)*2*Math.PI);
      const before = JSON.stringify(reference), original = fk.solve(reference);
      const plan = guard.planRewind(reference,{ axisId: state.positions[3].axisId,direction,retractDistanceMm: 20 });
      expect(plan.status,plan.code).toBe("review-required");
      expect(plan.executionAllowed).toBe(false);
      expect(plan.collisionEvaluation).toBe("not-evaluated");
      expect(plan.steps).toHaveLength(75);
      expect(plan.steps.slice(0,2).map((s) => s.kind)).toEqual(["stop","retract"]);
      expect(plan.steps.at(-1)?.kind).toBe("return");
      expect(plan.steps.every((s) => !s.cuttingEnabled)).toBe(true);
      for (const step of plan.steps) createMachinePluginStateSchema(plugin).parse(step.state);
      const raised = plan.steps[1].pose.tcpPositionMm;
      const quarter = plan.steps[19].state.positions.filter((p) => p.kind === "linear").map((p) => p.positionMm);
      const sign = direction === "positive" ? 1 : -1;
      const expectedQuarter = architecture === "table-table" ? [0,-200*sign,220] : [0,220*sign,-200];
      quarter.forEach((q,i) => expect(Math.abs(q-expectedQuarter[i])).toBeLessThanOrEqual(1e-9));
      for (const step of plan.steps.filter((s) => s.kind === "rewind")) {
        const p = fk.solve(step.state).tcpPositionMm;
        expect(Math.hypot(p.xMm-raised.xMm,p.yMm-raised.yMm,p.zMm-raised.zMm)).toBeLessThanOrEqual(1e-9);
      }
      const last = plan.steps.at(-1)!;
      expect(last.state.positions[3]).toMatchObject({ positionRad: 0 });
      const errors = poseErrors(fk.solve(last.state),Object.values(original.tcpPositionMm),Object.values(original.toolAxisUnit));
      expect(errors.positionMm).toBeLessThanOrEqual(1e-9);
      expect(errors.orientationRad).toBeLessThanOrEqual(1e-9);
      expect(JSON.stringify(reference)).toBe(before);
    }
  });
  it("rejects impossible unwind, retract and intermediate TCP travel with no partial plan", () => {
    const { plugin,state } = guardFixture("head-table");
    const axisId = state.positions[3].axisId, request = { axisId,direction: "positive",retractDistanceMm: 20 };
    setGuardAxis(state,3,-2*Math.PI);
    expect(new FiveAxisMotionGuard(plugin).planRewind(state,request)).toMatchObject({ status: "failed",code: "rewind-axis-limit",steps: [] });
    setGuardAxis(state,3,2*Math.PI); setGuardAxis(state,2,500);
    expect(new FiveAxisMotionGuard(plugin).planRewind(state,request)).toMatchObject({ status: "failed",code: "retract-linear-limit",steps: [] });
    setGuardAxis(state,2,0);
    const y = plugin.machine.axes[1]; if (y.kind === "linear") { y.minMm = -100; y.maxMm = 100; }
    expect(new FiveAxisMotionGuard(plugin).planRewind(state,request)).toMatchObject({ status: "failed",code: "rewind-linear-limit",steps: [] });
    expect(new FiveAxisMotionGuard(plugin).planRewind({ ...state,tcpEnabled: false },request)).toMatchObject({ status: "failed",code: "tcp-disabled",steps: [] });
  });
  it.each(["table-table","head-table","head-head"] as const)("rewinds the second rotary axis while preserving tilt: %s", (architecture) => {
    const { plugin,state } = guardFixture(architecture);
    if (architecture === "head-head") plugin.toolMount.toolAxisUnit = { x: 0.6,y: 0,z: 0.8 };
    setGuardAxis(state,3,0.6); setGuardAxis(state,4,2*Math.PI);
    const fk = new FiveAxisKinematics(plugin), original = fk.solve(state);
    const plan = new FiveAxisMotionGuard(plugin).planRewind(state,{ axisId: state.positions[4].axisId,direction: "positive",retractDistanceMm: 20 });
    expect(plan.status,plan.code).toBe("review-required");
    expect(plan.steps.every((s) => s.state.positions[3].kind === "rotary" && s.state.positions[3].positionRad === 0.6)).toBe(true);
    expect(plan.steps.at(-1)!.state.positions[4]).toMatchObject({ positionRad: 0 });
    const error = poseErrors(plan.steps.at(-1)!.pose,Object.values(original.tcpPositionMm),Object.values(original.toolAxisUnit));
    expect(error.positionMm).toBeLessThanOrEqual(1e-9); expect(error.orientationRad).toBeLessThanOrEqual(1e-9);
  });
  it("validates settings and reproduces reports/plans under repeated and reordered input", () => {
    const { plugin,state } = guardFixture(); setGuardAxis(state,3,2*Math.PI);
    const guard = new FiveAxisMotionGuard(plugin), request = { axisId: state.positions[3].axisId,direction: "positive",retractDistanceMm: 20 };
    const report = guard.analyzeTransition(state,state), plan = guard.planRewind(state,request);
    for (let i = 0; i < 5; i++) { expect(guard.analyzeTransition(state,state)).toEqual(report); expect(guard.planRewind(state,request)).toEqual(plan); }
    plugin.machine.axes.reverse(); state.positions.reverse();
    expect(new FiveAxisMotionGuard(plugin).analyzeTransition(state,state)).toEqual(report);
    expect(new FiveAxisMotionGuard(plugin).planRewind(state,request)).toEqual(plan);
    expect(() => guard.analyzeTransition(state,{ ...state,mode: "simultaneous-5axis" })).toThrow();
    expect(() => guard.analyzeTransition(state,{ ...state,tcpEnabled: false })).toThrow();
    for (const retractDistanceMm of [0,-0,-1,501,NaN,Infinity]) expect(() => guard.planRewind(state,{ ...request,retractDistanceMm })).toThrow();
    expect(() => guard.planRewind(state,{ ...request,axisId: plugin.machine.axes.find((a) => a.kind === "linear")!.id })).toThrow();
    expect(() => guard.planRewind(state,{ ...request,direction: "automatic" })).toThrow();
    expect(() => guard.planRewind(state,{ ...request,allowUnsafe: true })).toThrow();
  });
});

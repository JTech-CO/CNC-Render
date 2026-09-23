import { describe, expect, it } from "vitest";
import { createMachinePluginStateSchema, SolutionWeightsSchema } from "@cnc-render/contracts";
import { DEFAULT_SOLUTION_WEIGHTS, FiveAxisKinematics, FiveAxisSolutionSelector } from "@cnc-render/simulation";
import { machinePluginFixture, machineStateFixture } from "../fixtures/machine-plugins";
import { fiveAxisGolden, goldenInput, poseErrors } from "../helpers/five-axis-fixtures";

describe("M13 deterministic multi-solution selection", () => {
  it.each(["table-table","head-table","head-head"] as const)("finds multiple feasible candidates, ranks all costs and keeps input immutable: %s", (architecture) => {
    const plugin = machinePluginFixture(architecture), reference = machineStateFixture(plugin);
    if (reference.positions[3].kind === "rotary") reference.positions[3].positionRad = 0.6;
    if (reference.positions[4].kind === "rotary") reference.positions[4].positionRad = 0.4;
    const target = new FiveAxisKinematics(plugin).solve(reference);
    const before = JSON.stringify({ plugin,reference,target });
    const selector = new FiveAxisSolutionSelector(plugin), result = selector.select(target,reference);
    expect(result.status).toBe("selected");
    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.attemptedSeeds).toBe(27);
    expect(result.collisionEvaluation).toBe("not-evaluated");
    expect(result.selectedSeedIndex).toBe(result.candidates[0].sourceSeedIndex);
    result.candidates.forEach((candidate,i) => {
      createMachinePluginStateSchema(plugin).parse(candidate.state);
      const error = poseErrors(new FiveAxisKinematics(plugin).solve(candidate.state),Object.values(target.tcpPositionMm),Object.values(target.toolAxisUnit));
      expect(error.positionMm).toBeLessThanOrEqual(1e-9);
      expect(error.orientationRad).toBeLessThanOrEqual(1e-9);
      const cost = candidate.cost;
      expect(cost.totalUnits).toBe(cost.axisTravelUnits*10+cost.limitPenaltyUnits+cost.singularityRiskUnits*2);
      expect(Object.values(cost).every(Number.isSafeInteger)).toBe(true);
      if (i > 0) {
        const previous = result.candidates[i-1];
        expect(cost.totalUnits).toBeGreaterThanOrEqual(previous.cost.totalUnits);
        if (cost.totalUnits === previous.cost.totalUnits) expect(candidate.sourceSeedIndex).toBeGreaterThan(previous.sourceSeedIndex);
      }
    });
    const travel = selector.select(target,reference,{ axisTravel: 1,limitPenalty: 0,singularityRisk: 0 });
    expect(travel.selectedSeedIndex).toBe(0);
    expect(travel.candidates[0].cost.axisTravelUnits).toBe(0);
    expect(JSON.stringify({ plugin,reference,target })).toBe(before);
    plugin.machine.axes.reverse(); reference.positions.reverse();
    expect(new FiveAxisSolutionSelector(plugin).select(target,reference)).toEqual(result);
  });

  it("cost weights change the chosen solution; singular cost ties use seed order", () => {
    const plugin = machinePluginFixture("head-head"), reference = machineStateFixture(plugin);
    if (reference.positions[4].kind === "rotary") reference.positions[4].positionRad = Math.PI;
    const target = new FiveAxisKinematics(plugin).solve(reference), selector = new FiveAxisSolutionSelector(plugin);
    expect(selector.select(target,reference,{ axisTravel: 1,limitPenalty: 0,singularityRisk: 0 }).selectedSeedIndex).toBe(0);
    const center = selector.select(target,reference,{ axisTravel: 0,limitPenalty: 1,singularityRisk: 0 });
    expect(center.selectedSeedIndex).toBe(1);
    expect(center.candidates[0].cost.limitPenaltyUnits).toBe(0);
    const singular = selector.select(target,reference,{ axisTravel: 0,limitPenalty: 0,singularityRisk: 1 });
    expect(singular.selectedSeedIndex).toBe(0);
    expect(singular.candidates.every((c) => c.cost.singularityRiskUnits === 100_000_000)).toBe(true);
    expect(singular.candidates.map((c) => c.sourceSeedIndex)).toEqual(singular.candidates.map((c) => c.sourceSeedIndex).sort((a,b) => a-b));
    for (let i = 0; i < 10; i++) expect(selector.select(target,reference)).toEqual(selector.select(target,reference));
  });

  it("orientation Jacobian risk distinguishes a table pole from a regular pose", () => {
    const plugin = machinePluginFixture("table-table"), reference = machineStateFixture(plugin), fk = new FiveAxisKinematics(plugin), selector = new FiveAxisSolutionSelector(plugin);
    const pole = selector.select(fk.solve(reference),reference).candidates.find((c) => c.sourceSeedIndex === 0)!;
    if (reference.positions[3].kind === "rotary") reference.positions[3].positionRad = Math.PI/2;
    const regular = selector.select(fk.solve(reference),reference).candidates.find((c) => c.sourceSeedIndex === 0)!;
    expect(pole.cost.singularityRiskUnits).toBe(100_000_000);
    expect(regular.cost.singularityRiskUnits).toBe(0);
  });

  it("all independent Golden poses retain a feasible branch", () => {
    for (const row of fiveAxisGolden.poses) {
      const { plugin,state } = goldenInput(row), [xMm,yMm,zMm] = row.point, [x,y,z] = row.direction;
      const result = new FiveAxisSolutionSelector(plugin).select({ tcpPositionMm: { xMm,yMm,zMm },toolAxisUnit: { x,y,z } },state);
      expect(result.status,row.id).toBe("selected");
      for (const candidate of result.candidates) {
        const error = poseErrors(candidate.pose,row.point,row.direction);
        expect(error.positionMm).toBeLessThanOrEqual(1e-9);
        expect(error.orientationRad).toBeLessThanOrEqual(1e-9);
      }
    }
  },60_000);

  it("reports bounded-search failure and disabled TCP without a fabricated selection", () => {
    const plugin = machinePluginFixture("head-head"), reference = machineStateFixture(plugin), selector = new FiveAxisSolutionSelector(plugin), target = new FiveAxisKinematics(plugin).solve(reference);
    const result = selector.select({ ...target,tcpPositionMm: { xMm: 10000,yMm: 0,zMm: 0 } },reference);
    expect(result).toMatchObject({ status: "failed",code: "no-candidate-found",selectedSeedIndex: null,candidates: [],attemptedSeeds: 27 });
    expect(result.rejectedSeeds).toHaveLength(27);
    expect(selector.select(target,{ ...reference,tcpEnabled: false })).toMatchObject({ code: "tcp-disabled",attemptedSeeds: 0,candidates: [] });
  });

  it("strict weights and target validation", () => {
    const plugin = machinePluginFixture("table-table"), reference = machineStateFixture(plugin), selector = new FiveAxisSolutionSelector(plugin), target = new FiveAxisKinematics(plugin).solve(reference);
    expect(SolutionWeightsSchema.parse(DEFAULT_SOLUTION_WEIGHTS)).toEqual(DEFAULT_SOLUTION_WEIGHTS);
    for (const weights of [{ axisTravel: 0,limitPenalty: 0,singularityRisk: 0 },{ ...DEFAULT_SOLUTION_WEIGHTS,axisTravel: -1 },{ ...DEFAULT_SOLUTION_WEIGHTS,limitPenalty: 0.5 },{ ...DEFAULT_SOLUTION_WEIGHTS,singularityRisk: 1001 },{ ...DEFAULT_SOLUTION_WEIGHTS,axisTravel: Infinity },{ ...DEFAULT_SOLUTION_WEIGHTS,collisionRisk: 0 }]) expect(() => selector.select(target,reference,weights)).toThrow();
    expect(() => selector.select({ ...target,toolAxisUnit: { x: 0,y: 0,z: 0 } },reference)).toThrow();
  });

  it("recovers both analytic table-table tilt branches without modulo wrapping", () => {
    const plugin = machinePluginFixture("table-table"), reference = machineStateFixture(plugin);
    const a = 0.6, c = 0.4;
    const direction = { x: Math.sin(c)*Math.sin(a),y: Math.cos(c)*Math.sin(a),z: Math.cos(a) };
    const target = { tcpPositionMm: { xMm: -220*direction.x,yMm: -220*direction.y,zMm: -220*direction.z },toolAxisUnit: direction };
    const result = new FiveAxisSolutionSelector(plugin).select(target,reference);
    const pairs = result.candidates.map((candidate) => candidate.state.positions.filter((p) => p.kind === "rotary").map((p) => p.positionRad));
    expect(pairs.some(([qa,qc]) => Math.abs(qa-a) <= 1e-8 && Math.abs(qc-c) <= 1e-8)).toBe(true);
    expect(pairs.some(([qa,qc]) => Math.abs(qa+a) <= 1e-8 && Math.abs(qc-(c-Math.PI)) <= 1e-8)).toBe(true);
    expect(pairs.every((pair) => pair.every((q) => q >= -Math.PI && q <= Math.PI))).toBe(true);
  });

  it("asymmetric rotary boundaries use exact inclusive grid endpoints", () => {
    const plugin = machinePluginFixture("head-head");
    plugin.machine.axes.forEach((axis) => { if (axis.kind === "rotary") { axis.minRad = -0.123; axis.maxRad = 0.987; } });
    const reference = machineStateFixture(plugin);
    if (reference.positions[3].kind === "rotary") reference.positions[3].positionRad = 0.987;
    const target = new FiveAxisKinematics(plugin).solve(reference);
    const result = new FiveAxisSolutionSelector(plugin).select(target,reference);
    expect(result.status).toBe("selected");
    expect(result.attemptedSeeds).toBe(27);
    result.candidates.forEach((c) => createMachinePluginStateSchema(plugin).parse(c.state));
  });
});

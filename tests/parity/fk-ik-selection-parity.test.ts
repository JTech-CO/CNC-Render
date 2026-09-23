import { describe, expect, it } from "vitest";
import { DEFAULT_SOLUTION_WEIGHTS, FiveAxisKinematics, FiveAxisSolutionSelector, type FiveAxisSelection } from "@cnc-render/simulation";
import type { FiveAxisTarget, MachinePlugin, MachinePluginState, SolutionWeights } from "@cnc-render/contracts";
import { machinePluginFixture, machineStateFixture } from "../fixtures/machine-plugins";
import { poseErrors } from "../helpers/five-axis-fixtures";
import { runSimulationCli } from "../helpers/simulation-cli.mjs";

function run(plugin: MachinePlugin,target: FiveAxisTarget,reference: MachinePluginState,weights: SolutionWeights = DEFAULT_SOLUTION_WEIGHTS,repetitions = 1) {
  const response = runSimulationCli({ requestType: "five-axis-select",plugin,target,reference,weights,repetitions }) as { stable: boolean; result: FiveAxisSelection };
  expect(response.stable).toBe(true);
  return response.result;
}
function compare(plugin: MachinePlugin,target: FiveAxisTarget,ts: FiveAxisSelection,rust: FiveAxisSelection) {
  expect(rust.status).toBe(ts.status);
  expect(rust.code).toBe(ts.code);
  expect(rust.selectedSeedIndex).toBe(ts.selectedSeedIndex);
  expect(rust.attemptedSeeds).toBe(ts.attemptedSeeds);
  expect(rust.collisionEvaluation).toBe("not-evaluated");
  expect(rust.rejectedSeeds).toEqual(ts.rejectedSeeds);
  expect(rust.candidates).toHaveLength(ts.candidates.length);
  rust.candidates.forEach((candidate,i) => {
    expect(candidate.sourceSeedIndex).toBe(ts.candidates[i].sourceSeedIndex);
    expect(candidate.cost).toEqual(ts.candidates[i].cost);
    const error = poseErrors(new FiveAxisKinematics(plugin).solve(candidate.state),Object.values(target.tcpPositionMm),Object.values(target.toolAxisUnit));
    expect(error.positionMm).toBeLessThanOrEqual(1e-9);
    expect(error.orientationRad).toBeLessThanOrEqual(1e-9);
  });
}
describe("M13 fk-ik solution selection native parity", () => {
  it.each(["table-table","head-table","head-head"] as const)("seeded multi-branch targets, costs and ordering agree: %s", (architecture) => {
    const plugin = machinePluginFixture(architecture), fk = new FiveAxisKinematics(plugin), selector = new FiveAxisSolutionSelector(plugin);
    let randomSeed = 0x13002421;
    const random = () => { randomSeed = (Math.imul(randomSeed,1664525)+1013904223) >>> 0; return randomSeed/0x100000000; };
    for (let i = 0; i < 12; i++) {
      const reference = machineStateFixture(plugin);
      reference.positions.forEach((p) => { if (p.kind === "linear") p.positionMm = random()*100-50; else p.positionRad = random()*2-1; });
      const target = fk.solve(reference);
      // The starting pose is not already the target; grid starts must recover branches too.
      reference.positions.forEach((p) => { if (p.kind === "linear") p.positionMm = 0; else p.positionRad += 0.1; });
      const ts = selector.select(target,reference), rust = run(plugin,target,reference);
      expect(ts.candidates.length).toBeGreaterThan(1);
      compare(plugin,target,ts,rust);
    }
  },180_000);

  it("weight-dependent selection, exact ties and 100-repeat/native process stability", () => {
    const plugin = machinePluginFixture("head-head"), reference = machineStateFixture(plugin), selector = new FiveAxisSolutionSelector(plugin);
    if (reference.positions[4].kind === "rotary") reference.positions[4].positionRad = Math.PI;
    const target = new FiveAxisKinematics(plugin).solve(reference);
    for (const weights of [DEFAULT_SOLUTION_WEIGHTS,{ axisTravel: 1,limitPenalty: 0,singularityRisk: 0 },{ axisTravel: 0,limitPenalty: 1,singularityRisk: 0 },{ axisTravel: 0,limitPenalty: 0,singularityRisk: 1 },{ axisTravel: 1000,limitPenalty: 1000,singularityRisk: 1000 }]) {
      const rust = run(plugin,target,reference,weights,100);
      compare(plugin,target,selector.select(target,reference,weights),rust);
      expect(JSON.stringify(run(plugin,target,reference,weights,100))).toBe(JSON.stringify(rust));
    }
  },180_000);

  it("failure and malformed input contracts match", () => {
    const plugin = machinePluginFixture("head-head"), reference = machineStateFixture(plugin), selector = new FiveAxisSolutionSelector(plugin), target = new FiveAxisKinematics(plugin).solve(reference);
    const unreachable = { ...target,tcpPositionMm: { xMm: 10000,yMm: 0,zMm: 0 } };
    compare(plugin,unreachable,selector.select(unreachable,reference),run(plugin,unreachable,reference));
    const disabled = { ...reference,tcpEnabled: false };
    compare(plugin,target,selector.select(target,disabled),run(plugin,target,disabled));
    for (const weights of [{ axisTravel: 0,limitPenalty: 0,singularityRisk: 0 },{ ...DEFAULT_SOLUTION_WEIGHTS,axisTravel: -1 },{ ...DEFAULT_SOLUTION_WEIGHTS,limitPenalty: 0.5 },{ ...DEFAULT_SOLUTION_WEIGHTS,singularityRisk: 1001 }]) {
      expect(() => selector.select(target,reference,weights)).toThrow();
      expect(() => run(plugin,target,reference,weights)).toThrow();
    }
    expect(() => run(plugin,target,reference,DEFAULT_SOLUTION_WEIGHTS,101)).toThrow();
    const linear = plugin.machine.axes[0];
    if (linear.kind === "linear") { linear.minMm = -1e308; linear.maxMm = 1e308; }
    const unsupported = selector.select(target,reference);
    expect(unsupported.status).toBe("selected"); // Selector owns a copy of the pre-mutation plugin.
    const bounded = new FiveAxisSolutionSelector(plugin).select(target,reference);
    expect(bounded).toMatchObject({ code: "numeric-range-unsupported",attemptedSeeds: 0,candidates: [] });
    compare(plugin,target,bounded,run(plugin,target,reference));
  },180_000);
});

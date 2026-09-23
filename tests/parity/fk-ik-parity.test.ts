import { describe, expect, it } from "vitest";
import { FiveAxisKinematics, type FiveAxisPose } from "@cnc-render/simulation";
import { machinePluginFixture, machineStateFixture } from "../fixtures/machine-plugins";
import { fiveAxisGolden, goldenInput, poseErrors } from "../helpers/five-axis-fixtures";
import { runSimulationCli } from "../helpers/simulation-cli.mjs";

// M13 FK stage only. IK round trips are deliberately not claimed by this suite.
describe("M13 fk-ik parity — FK stage", () => {
  it("matches independent Golden positions and tool axes for all three architectures", () => {
    for (const row of fiveAxisGolden.poses) {
      const { plugin,state } = goldenInput(row);
      const response = runSimulationCli({ requestType: "five-axis-fk", plugin, states: [state], repetitions: 100 }) as { stable: boolean; results: FiveAxisPose[] };
      expect(response.stable, row.id).toBe(true);
      expect(response.results).toHaveLength(1);
      const rust = response.results[0];
      const ts = new FiveAxisKinematics(plugin).solve(state);
      for (const result of [rust,ts]) {
        const error = poseErrors(result,row.point,row.direction);
        expect(error.positionMm,row.id).toBeLessThanOrEqual(fiveAxisGolden.positionToleranceMm);
        expect(error.orientationRad,row.id).toBeLessThanOrEqual(fiveAxisGolden.orientationToleranceRad);
        expect(error.unitError,row.id).toBeLessThanOrEqual(1e-12);
      }
      const error = poseErrors(rust,Object.values(ts.tcpPositionMm),Object.values(ts.toolAxisUnit));
      expect(error.positionMm,row.id).toBeLessThanOrEqual(fiveAxisGolden.positionToleranceMm);
      expect(error.orientationRad,row.id).toBeLessThanOrEqual(fiveAxisGolden.orientationToleranceRad);
    }
  }, 180_000);

  it.each(["table-table", "head-table", "head-head"] as const)("seeded sweep, axis boundaries and process byte stability: %s", (architecture) => {
    const plugin = machinePluginFixture(architecture);
    const fk = new FiveAxisKinematics(plugin);
    let seed = 0x13002409;
    const random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed/0x100000000; };
    const states = Array.from({ length: 102 }, (_,i) => {
      const state = machineStateFixture(plugin);
      state.positions.forEach((p) => {
        const scale = i === 0 ? -1 : i === 1 ? 1 : random()*2-1;
        if (p.kind === "linear") p.positionMm = scale*500; else p.positionRad = scale*Math.PI;
      });
      return state;
    });
    const request = { requestType: "five-axis-fk", plugin, states, repetitions: 100 };
    const first = runSimulationCli(request) as { stable: boolean; results: FiveAxisPose[] };
    expect(first.stable).toBe(true);
    expect(first.results).toHaveLength(states.length);
    expect(JSON.stringify(runSimulationCli(request))).toBe(JSON.stringify(first));
    first.results.forEach((rust,i) => {
      const ts = fk.solve(states[i]);
      const error = poseErrors(rust,Object.values(ts.tcpPositionMm),Object.values(ts.toolAxisUnit));
      expect(error.positionMm).toBeLessThanOrEqual(fiveAxisGolden.positionToleranceMm);
      expect(error.orientationRad).toBeLessThanOrEqual(fiveAxisGolden.orientationToleranceRad);
      expect(error.unitError).toBeLessThanOrEqual(1e-12);
    });
  },180_000);

  it("both implementations fail closed for invalid topology and numeric configuration", () => {
    const mutations = [
      (p: ReturnType<typeof machinePluginFixture>) => { p.pluginVersion += "\n"; },
      (p: ReturnType<typeof machinePluginFixture>) => { p.architecture = "head-head"; },
      (p: ReturnType<typeof machinePluginFixture>) => { p.toolChainAxisIds.reverse(); },
      (p: ReturnType<typeof machinePluginFixture>) => { p.workpieceChainAxisIds.push(p.toolChainAxisIds[0]); },
      (p: ReturnType<typeof machinePluginFixture>) => { p.machine.axes[0].parentId = p.machine.axes[2].id; },
      (p: ReturnType<typeof machinePluginFixture>) => { p.machine.kinematicRootAxisIds.pop(); },
      (p: ReturnType<typeof machinePluginFixture>) => { p.toolMount.toolAxisUnit.z = 2; },
      (p: ReturnType<typeof machinePluginFixture>) => { p.machine.workEnvelope.minMm.xMm = 501; },
      (p: ReturnType<typeof machinePluginFixture>) => { Object.assign(p.machine.axes[3],{ homeRad: 4 }); },
    ];
    for (const mutate of mutations) {
      const plugin = machinePluginFixture("table-table");
      const state = machineStateFixture(plugin);
      mutate(plugin);
      expect(() => new FiveAxisKinematics(plugin)).toThrow();
      expect(() => runSimulationCli({ requestType: "five-axis-fk", plugin, states: [state], repetitions: 1 })).toThrow();
    }
  },180_000);

  it("both implementations reject state identity, unit, limit, capability and overflow errors", () => {
    const plugin = machinePluginFixture("table-table");
    plugin.capabilities = { modes: ["3plus2"], tcp: "unsupported" };
    const state = { ...machineStateFixture(plugin), tcpEnabled: false };
    const cases = [
      { ...state, pluginVersion: "2.0.0" }, { ...state, tcpEnabled: true }, { ...state, mode: "simultaneous-5axis" },
      { ...state, positions: state.positions.slice(1) },
      { ...state, positions: [state.positions[1], ...state.positions.slice(1)] },
      { ...state, positions: [{ axisId: state.positions[0].axisId, kind: "rotary", positionRad: 0 }, ...state.positions.slice(1)] },
      { ...state, positions: [{ ...state.positions[0], positionMm: 501 }, ...state.positions.slice(1)] },
    ];
    const fk = new FiveAxisKinematics(plugin);
    for (const input of cases) {
      expect(() => fk.solve(input)).toThrow();
      expect(() => runSimulationCli({ requestType: "five-axis-fk", plugin, states: [input], repetitions: 1 })).toThrow();
    }
    plugin.machine.axes.forEach((axis) => { if (axis.kind === "linear") { axis.minMm = -Number.MAX_VALUE; axis.maxMm = Number.MAX_VALUE; axis.homeMm = -Number.MAX_VALUE; } });
    state.positions.forEach((p) => { if (p.kind === "linear") p.positionMm = Number.MAX_VALUE; });
    expect(() => new FiveAxisKinematics(plugin).solve(state)).toThrow();
    expect(() => runSimulationCli({ requestType: "five-axis-fk", plugin, states: [state], repetitions: 1 })).toThrow();
  },180_000);
});

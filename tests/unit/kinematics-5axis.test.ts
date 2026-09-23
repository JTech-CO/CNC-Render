import { describe, expect, it } from "vitest";
import { canonicalJson } from "@cnc-render/contracts";
import { FiveAxisKinematics } from "@cnc-render/simulation";
import { fiveAxisGolden, goldenInput, poseErrors } from "../helpers/five-axis-fixtures";

describe("M13 kinematics-5axis FK", () => {
  it.each(fiveAxisGolden.poses)("Golden $id", (row) => {
    const { plugin, state } = goldenInput(row);
    const before = JSON.stringify({ plugin, state });
    const fk = new FiveAxisKinematics(plugin);
    const pose = fk.solve(state);
    const error = poseErrors(pose,row.point,row.direction);
    expect(error.positionMm).toBeLessThanOrEqual(fiveAxisGolden.positionToleranceMm);
    expect(error.orientationRad).toBeLessThanOrEqual(fiveAxisGolden.orientationToleranceRad);
    expect(error.unitError).toBeLessThanOrEqual(1e-12);
    for (let i = 0; i < 100; i++) expect(canonicalJson({ ...fk.solve(state) })).toBe(canonicalJson({ ...pose }));
    expect(JSON.stringify({ plugin,state })).toBe(before);
    expect(fk.solve({ ...state, positions: [...state.positions].reverse(), mode: "simultaneous-5axis" })).toEqual(pose);
  });
  it("rejects invalid states and definitions, preserves captured configuration", () => {
    const { plugin,state } = goldenInput(fiveAxisGolden.poses[0]);
    const fk = new FiveAxisKinematics(plugin);
    const before = fk.solve(state);
    plugin.toolMount.positionMm.xMm = 100;
    expect(fk.solve(state)).toEqual(before);
    expect(() => fk.solve({ ...state, positions: [] })).toThrow();
    expect(() => fk.solve({ ...state, pluginVersion: "9.0.0" })).toThrow();
    expect(() => new FiveAxisKinematics({ ...plugin, architecture: "head-head" })).toThrow();
  });
  it("fails closed on finite input whose intermediate arithmetic overflows", () => {
    const { plugin,state } = goldenInput(fiveAxisGolden.poses[0]);
    plugin.machine.axes.forEach((axis) => { if (axis.kind === "linear") { axis.minMm = -Number.MAX_VALUE; axis.maxMm = Number.MAX_VALUE; axis.homeMm = -Number.MAX_VALUE; } });
    state.positions.forEach((p) => { if (p.kind === "linear") p.positionMm = Number.MAX_VALUE; });
    expect(() => new FiveAxisKinematics(plugin).solve(state)).toThrow(/nonfinite/);
  });
});

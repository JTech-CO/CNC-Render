import { describe, expect, it } from "vitest";
import { canonicalJson, createMachinePluginStateSchema, MachinePluginSchema, type MachinePlugin } from "@cnc-render/contracts";
import { machinePluginFixture, machineStateFixture } from "../fixtures/machine-plugins";

describe("M13 machine plugin contract", () => {
  it.each(["table-table", "head-table", "head-head"] as const)("round-trips %s without input mutation", (architecture) => {
    const fixture = machinePluginFixture(architecture);
    const before = JSON.stringify(fixture);
    for (let iteration = 0; iteration < 100; iteration += 1) {
      expect(canonicalJson(MachinePluginSchema.parse(JSON.parse(before)))).toBe(canonicalJson(fixture));
      expect(createMachinePluginStateSchema(fixture).safeParse(machineStateFixture(fixture)).success).toBe(true);
    }
    expect(JSON.stringify(fixture)).toBe(before);
  });

  const invalidDefinitions: [string, (plugin: MachinePlugin) => void][] = [
    ["newline in plugin ID", (p) => { p.pluginId += "\n"; }],
    ["newline in plugin version", (p) => { p.pluginVersion += "\n"; }],
    ["unsupported version", (p) => Object.assign(p, { contractVersion: 2 })],
    ["executable payload", (p) => Object.assign(p, { execute: "https://example.invalid/plugin.js" })],
    ["wrong architecture", (p) => { p.architecture = "head-head"; }],
    ["missing chain member", (p) => { p.toolChainAxisIds.pop(); }],
    ["unknown chain member", (p) => { p.toolChainAxisIds[1] = p.machine.id; }],
    ["reordered chain", (p) => { p.toolChainAxisIds.reverse(); }],
    ["shared axis", (p) => { p.workpieceChainAxisIds.push(p.toolChainAxisIds[0]); }],
    ["duplicate axis", (p) => { p.machine.axes[1].id = p.machine.axes[0].id; }],
    ["cycle", (p) => { p.machine.axes[0].parentId = p.machine.axes[2].id; }],
    ["orphan parent", (p) => { p.machine.axes[1].parentId = p.machine.id; }],
    ["missing root", (p) => { p.machine.kinematicRootAxisIds = []; }],
    ["wrong axis count", (p) => { p.machine.axes.pop(); }],
    ["wrong machine type", (p) => { p.machine.machineType = "lathe"; }],
    ["duplicate mode", (p) => { p.capabilities.modes = ["3plus2", "3plus2"]; }],
    ["zero tool vector", (p) => { p.toolMount.toolAxisUnit.z = 0; }],
    ["infinite pivot", (p) => { p.machine.axes[3].pivotMm.zMm = Infinity; }],
    ["nonfinite mount", (p) => { p.toolMount.positionMm.zMm = NaN; }],
    ["negative zero", (p) => { p.workpieceMount.rotationRad.xRad = -0; }],
    ["rotary invalid home", (p) => Object.assign(p.machine.axes[3], { homeRad: 4 })],
    ["rotary inverted limits", (p) => Object.assign(p.machine.axes[3], { minRad: 4 })],
    ["nonpositive velocity", (p) => Object.assign(p.machine.axes[3], { maxVelocityRadPerS: 0 })],
  ];
  it.each(invalidDefinitions)("rejects %s", (_name, mutate) => {
    const plugin = machinePluginFixture("table-table");
    mutate(plugin);
    expect(MachinePluginSchema.safeParse(plugin).success).toBe(false);
  });

  it("rejects duplicate, unknown, missing and mixed-unit state entries", () => {
    const plugin = machinePluginFixture("table-table");
    const schema = createMachinePluginStateSchema(plugin);
    const state = machineStateFixture(plugin);
    expect(schema.safeParse({ ...state, positions: state.positions.slice(1) }).success).toBe(false);
    for (const replacement of [state.positions[1], { ...state.positions[0], axisId: plugin.machine.id },
      { axisId: state.positions[0].axisId, kind: "rotary", positionRad: 0 },
      { axisId: state.positions[3].axisId, kind: "rotary", positionMm: 0 }]) {
      expect(schema.safeParse({ ...state, positions: [replacement, ...state.positions.slice(1)] }).success).toBe(false);
    }
  });

  it.each(["min", "max"] as const)("accepts inclusive %s but rejects out-of-range and nonfinite values", (boundary) => {
    const plugin = machinePluginFixture("head-table");
    const schema = createMachinePluginStateSchema(plugin);
    const state = machineStateFixture(plugin);
    plugin.machine.axes.forEach((axis, index) => {
      const position = axis.kind === "linear" ? (boundary === "min" ? axis.minMm : axis.maxMm) : (boundary === "min" ? axis.minRad : axis.maxRad);
      const field = axis.kind === "linear" ? "positionMm" : "positionRad";
      const positions = structuredClone(state.positions);
      Object.assign(positions[index], { [field]: position });
      expect(schema.safeParse({ ...state, positions }).success).toBe(true);
      for (const invalid of [position + (boundary === "min" ? -1e-6 : 1e-6), Infinity, NaN, -0]) {
        Object.assign(positions[index], { [field]: invalid });
        expect(schema.safeParse({ ...state, positions }).success).toBe(false);
      }
    });
  });

  it("binds state to exact plugin version, machine, mode and TCP capability", () => {
    const plugin = machinePluginFixture("head-head");
    plugin.capabilities = { modes: ["3plus2"], tcp: "unsupported" };
    const schema = createMachinePluginStateSchema(plugin);
    const state = { ...machineStateFixture(plugin), tcpEnabled: false };
    expect(schema.safeParse(state).success).toBe(true);
    for (const override of [{ pluginVersion: "2.0.0" }, { pluginId: "other" }, { machineId: plugin.machine.axes[0].id },
      { mode: "simultaneous-5axis" }, { tcpEnabled: true }, { contractVersion: 2 }]) {
      expect(schema.safeParse({ ...state, ...override }).success).toBe(false);
    }
    plugin.capabilities.tcp = "supported";
    expect(schema.safeParse({ ...state, tcpEnabled: true }).success).toBe(false);
  });
});

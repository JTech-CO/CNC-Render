import type { MachinePlugin, MachinePluginState } from "@cnc-render/contracts";
import { machinePluginFixture, machineStateFixture } from "../fixtures/machine-plugins";

export function guardFixture(architecture: MachinePlugin["architecture"] = "table-table") {
  const plugin = machinePluginFixture(architecture);
  plugin.machine.axes.forEach((a) => { if (a.kind === "rotary") { a.minRad = -2*Math.PI; a.maxRad = 2*Math.PI; } });
  return { plugin,state: machineStateFixture(plugin) };
}
export function setGuardAxis(state: MachinePluginState,index: number,q: number) {
  const p = state.positions[index];
  if (p.kind === "linear") p.positionMm = q; else p.positionRad = q;
}

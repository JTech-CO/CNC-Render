import { MachinePluginSchema } from "@cnc-render/contracts";
import data from "../fixtures/machines/five-axis/golden-poses.json";
import { machinePluginFixture, machineStateFixture } from "../fixtures/machine-plugins";

export const fiveAxisGolden = data;
export function goldenInput(row: typeof data.poses[number]) {
  if (row.architecture !== "table-table" && row.architecture !== "head-table" && row.architecture !== "head-head") throw new Error("unknown fixture architecture");
  const plugin = machinePluginFixture(row.architecture);
  if (row.variant === "offset" || row.variant === "diagonal") plugin.toolMount.positionMm.xMm = 40;
  if (row.variant === "diagonal") plugin.machine.axes[3].directionUnit = { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 };
  if (row.variant === "mount-rotation") plugin.workpieceMount.rotationRad = { xRad: Math.PI/2, yRad: Math.PI/2, zRad: Math.PI/2 };
  if (row.variant === "home") plugin.machine.axes.forEach((axis, i) => {
    if (axis.kind === "linear") axis.homeMm = row.positions[i]; else axis.homeRad = row.positions[i];
  });
  if (row.variant === "linear-table") {
    plugin.toolChainAxisIds = [];
    plugin.workpieceChainAxisIds = plugin.machine.axes.map((axis) => axis.id);
    plugin.machine.axes[3].parentId = plugin.machine.axes[2].id;
    plugin.machine.kinematicRootAxisIds = [plugin.machine.axes[0].id];
  }
  const state = machineStateFixture(plugin);
  state.positions.forEach((position, i) => {
    if (position.kind === "linear") position.positionMm = row.positions[i]; else position.positionRad = row.positions[i];
  });
  return { plugin: MachinePluginSchema.parse(plugin), state };
}

export function poseErrors(actual: { tcpPositionMm: { xMm: number; yMm: number; zMm: number }; toolAxisUnit: { x: number; y: number; z: number } }, point: number[], direction: number[]) {
  const p = actual.tcpPositionMm, d = actual.toolAxisUnit;
  const cross = [d.y*direction[2]-d.z*direction[1], d.z*direction[0]-d.x*direction[2], d.x*direction[1]-d.y*direction[0]];
  return {
    positionMm: Math.hypot(p.xMm-point[0], p.yMm-point[1], p.zMm-point[2]),
    orientationRad: Math.atan2(Math.hypot(...cross), d.x*direction[0]+d.y*direction[1]+d.z*direction[2]),
    unitError: Math.abs(Math.hypot(d.x,d.y,d.z)-1),
  };
}

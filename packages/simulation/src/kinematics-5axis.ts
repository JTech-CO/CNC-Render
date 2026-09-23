import { createMachinePluginStateSchema, MachinePluginSchema, type MachinePlugin, type Vec3Mm } from "@cnc-render/contracts";

type V = readonly [number, number, number];
export interface FiveAxisPose {
  readonly tcpPositionMm: Vec3Mm;
  /** Tool tip towards holder, expressed in the workpiece coordinate frame. */
  readonly toolAxisUnit: { readonly x: number; readonly y: number; readonly z: number };
}

const xyz = (p: Vec3Mm): V => [p.xMm, p.yMm, p.zMm];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a: V, b: V): V => add(a, scale(b, -1));
const zero = (n: number) => Object.is(n, -0) ? 0 : n;

function rotate(v: V, axis: V, angle: number): V {
  const length = Math.hypot(...axis);
  const [x, y, z] = scale(axis, 1 / length);
  const c = Math.cos(angle), s = Math.sin(angle);
  const dot = x * v[0] + y * v[1] + z * v[2];
  return add(add(scale(v, c), scale([y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0]], s)), scale([x, y, z], dot * (1 - c)));
}

/** FK only; does not perform TCP compensation, IK, collision or material removal. */
export class FiveAxisKinematics {
  private readonly plugin: MachinePlugin;
  private readonly stateSchema: ReturnType<typeof createMachinePluginStateSchema>;

  constructor(definition: unknown) {
    this.plugin = MachinePluginSchema.parse(definition);
    this.stateSchema = createMachinePluginStateSchema(this.plugin);
  }

  solve(input: unknown): FiveAxisPose {
    const state = this.stateSchema.parse(input);
    const axes = new Map(this.plugin.machine.axes.map((axis) => [axis.id, axis]));
    const positions = new Map(state.positions.map((position) => [position.axisId, position]));
    let point = xyz(this.plugin.toolMount.positionMm);
    const tool = this.plugin.toolMount.toolAxisUnit;
    let direction: V = [tool.x, tool.y, tool.z];
    const apply = (id: string, inverse: boolean) => {
      const axis = axes.get(id)!;
      const position = positions.get(id)!;
      const unit: V = [axis.directionUnit.x, axis.directionUnit.y, axis.directionUnit.z];
      const sign = inverse ? -1 : 1;
      if (axis.kind === "linear" && position.kind === "linear") {
        point = add(point, scale(unit, sign * (position.positionMm - axis.homeMm)));
      } else if (axis.kind === "rotary" && position.kind === "rotary") {
        const angle = sign * (position.positionRad - axis.homeRad);
        const pivot = xyz(axis.pivotMm);
        point = add(pivot, rotate(sub(point, pivot), unit, angle));
        direction = rotate(direction, unit, angle);
      }
    };
    for (const id of [...this.plugin.toolChainAxisIds].reverse()) apply(id, false);
    for (const id of this.plugin.workpieceChainAxisIds) apply(id, true);
    const mount = this.plugin.workpieceMount;
    point = sub(point, xyz(mount.positionMm));
    const { xRad, yRad, zRad } = mount.rotationRad;
    for (const [axis, angle] of [[[0, 0, 1], -zRad], [[0, 1, 0], -yRad], [[1, 0, 0], -xRad]] as const) {
      point = rotate(point, axis, angle);
      direction = rotate(direction, axis, angle);
    }
    const length = Math.hypot(...direction);
    if (![...point, ...direction, length].every(Number.isFinite) || length === 0) {
      throw new RangeError("five-axis FK produced a nonfinite or degenerate pose");
    }
    direction = scale(direction, 1 / length);
    return {
      tcpPositionMm: { xMm: zero(point[0]), yMm: zero(point[1]), zMm: zero(point[2]) },
      toolAxisUnit: { x: zero(direction[0]), y: zero(direction[1]), z: zero(direction[2]) },
    };
  }
}

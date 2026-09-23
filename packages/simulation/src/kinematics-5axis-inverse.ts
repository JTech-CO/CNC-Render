import { createMachinePluginStateSchema, FiveAxisTargetSchema, MachinePluginSchema, type FiveAxisTarget, type MachinePluginState } from "@cnc-render/contracts";
import { FiveAxisKinematics, type FiveAxisPose } from "./kinematics-5axis";

export const IK_POSITION_TOLERANCE_MM = 1e-9;
export const IK_ORIENTATION_TOLERANCE_RAD = 1e-9;
const ITERATIONS = 80;
// Refine orientation below the public gate before solving translation at travel limits.
const ORIENTATION_SOLVE_TOLERANCE_RAD = 1e-12;
type V = number[];
type FailureCode = "tcp-disabled" | "orientation-not-converged" | "linear-singular" | "linear-limit" | "nonfinite" | "residual-exceeded";
export type FiveAxisInverseResult =
  | { status: "solved"; state: MachinePluginState; pose: FiveAxisPose; iterations: number; positionErrorMm: number; orientationErrorRad: number }
  | { status: "failed"; code: FailureCode; iterations: number };
const fail = (code: FailureCode, iterations: number): FiveAxisInverseResult => ({ status: "failed", code, iterations });
const dot = (a: V, b: V) => a.reduce((sum, v, i) => sum + v*b[i],0);
const sub = (a: V, b: V) => a.map((v,i) => v-b[i]);
const position = (p: FiveAxisTarget): V => [p.tcpPositionMm.xMm,p.tcpPositionMm.yMm,p.tcpPositionMm.zMm];
const direction = (p: FiveAxisTarget): V => {
  const d = p.toolAxisUnit, length = Math.hypot(d.x,d.y,d.z);
  return [d.x/length,d.y/length,d.z/length];
};
const angle = (a: V, b: V) => Math.atan2(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]),dot(a,b));
function set(state: MachinePluginState, id: string, value: number) {
  const p = state.positions.find((entry) => entry.axisId === id)!;
  const clean = value === 0 ? 0 : value;
  if (p.kind === "linear") p.positionMm = clean; else p.positionRad = clean;
}
function get(state: MachinePluginState, id: string) {
  const p = state.positions.find((entry) => entry.axisId === id)!;
  return p.kind === "linear" ? p.positionMm : p.positionRad;
}
function solve3(columns: V[], rhs: V): V | null {
  const rows = rhs.map((v,i) => [...columns.map((column) => column[i]),v]);
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let j = i+1; j < 3; j++) if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
    if (!Number.isFinite(rows[pivot][i]) || Math.abs(rows[pivot][i]) < 1e-10) return null;
    [rows[i],rows[pivot]] = [rows[pivot],rows[i]];
    const divisor = rows[i][i];
    for (let j = i; j < 4; j++) rows[i][j] /= divisor;
    for (let k = 0; k < 3; k++) if (k !== i) {
      const factor = rows[k][i];
      for (let j = i; j < 4; j++) rows[k][j] -= factor*rows[i][j];
    }
  }
  return rows.map((row) => row[3]);
}

/** Bounded seed-local IK. No global branch selection, trajectory or collision guarantee. */
export class FiveAxisInverseKinematics {
  private readonly plugin;
  private readonly schema;
  private readonly fk;
  private readonly linear;
  private readonly rotary;
  constructor(definition: unknown) {
    this.plugin = MachinePluginSchema.parse(definition);
    this.schema = createMachinePluginStateSchema(this.plugin);
    this.fk = new FiveAxisKinematics(this.plugin);
    const axes = [...this.plugin.machine.axes].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    this.linear = axes.filter((axis) => axis.kind === "linear");
    this.rotary = axes.filter((axis) => axis.kind === "rotary");
  }
  private state(input: unknown) {
    const state = this.schema.parse(input);
    state.positions.sort((a,b) => a.axisId < b.axisId ? -1 : a.axisId > b.axisId ? 1 : 0);
    return state;
  }
  private translate(target: FiveAxisTarget, state: MachinePluginState, iterations: number): FiveAxisInverseResult {
    for (const axis of this.linear) set(state,axis.id,axis.homeMm);
    const base = position(this.fk.solve(state));
    const columns = this.linear.map((axis) => {
      const q = axis.homeMm;
      const probe = q < axis.maxMm ? Math.min(axis.maxMm,q+1) : Math.max(axis.minMm,q-1);
      if (probe === q) return [NaN,NaN,NaN];
      set(state,axis.id,probe);
      const shifted = position(this.fk.solve(state));
      set(state,axis.id,q);
      return sub(shifted,base).map((v) => v/(probe-q));
    });
    const delta = solve3(columns,sub(position(target),base));
    if (!delta) return fail("linear-singular",iterations);
    if (!delta.every(Number.isFinite)) return fail("nonfinite",iterations);
    for (let i = 0; i < this.linear.length; i++) {
      const axis = this.linear[i], q = axis.homeMm + delta[i];
      if (!Number.isFinite(q)) return fail("nonfinite",iterations);
      if (q < axis.minMm-IK_POSITION_TOLERANCE_MM || q > axis.maxMm+IK_POSITION_TOLERANCE_MM) return fail("linear-limit",iterations);
      set(state,axis.id,Math.max(axis.minMm,Math.min(axis.maxMm,q)));
    }
    const pose = this.fk.solve(state);
    const positionErrorMm = Math.hypot(...sub(position(pose),position(target)));
    const orientationErrorRad = angle(direction(pose),direction(target));
    if (positionErrorMm > IK_POSITION_TOLERANCE_MM || orientationErrorRad > IK_ORIENTATION_TOLERANCE_RAD) return fail("residual-exceeded",iterations);
    return { status: "solved", state, pose, iterations, positionErrorMm, orientationErrorRad };
  }
  inverse(input: unknown, seed: unknown): FiveAxisInverseResult {
    const target = FiveAxisTargetSchema.parse(input), state = this.state(seed);
    if (!state.tcpEnabled) return fail("tcp-disabled",0);
    const desired = direction(target);
    try {
      for (let iteration = 0; iteration <= ITERATIONS; iteration++) {
        const current = direction(this.fk.solve(state));
        if (angle(current,desired) <= ORIENTATION_SOLVE_TOLERANCE_RAD) return this.translate(target,state,iteration);
        if (iteration === ITERATIONS) break;
        const residual = sub(desired,current);
        const columns = this.rotary.map((axis) => {
          const q = get(state,axis.id), lo = Math.max(axis.minRad,q-1e-5), hi = Math.min(axis.maxRad,q+1e-5);
          if (hi === lo) return [0,0,0];
          set(state,axis.id,lo); const low = direction(this.fk.solve(state));
          set(state,axis.id,hi); const high = direction(this.fk.solve(state));
          set(state,axis.id,q);
          return sub(high,low).map((v) => v/(hi-lo));
        });
        const a = dot(columns[0],columns[0])+1e-8, b = dot(columns[0],columns[1]), c = dot(columns[1],columns[1])+1e-8;
        const u = dot(columns[0],residual), v = dot(columns[1],residual), determinant = a*c-b*b;
        const step = [(c*u-b*v)/determinant,(a*v-b*u)/determinant];
        if (!step.every(Number.isFinite)) return fail("nonfinite",iteration);
        const cap = Math.max(1,...step.map((value) => Math.abs(value)/0.35));
        const previous = this.rotary.map((axis) => get(state,axis.id));
        let accepted = false;
        for (let attempt = 0; attempt < 12; attempt++) {
          this.rotary.forEach((axis,i) => set(state,axis.id,Math.max(axis.minRad,Math.min(axis.maxRad,previous[i]+step[i]/cap/2**attempt))));
          const next = sub(desired,direction(this.fk.solve(state)));
          if (dot(next,next) < dot(residual,residual)) { accepted = true; break; }
        }
        if (!accepted) return fail("orientation-not-converged",iteration+1);
      }
      return fail("orientation-not-converged",ITERATIONS);
    } catch (error) {
      if (error instanceof RangeError) return fail("nonfinite",0);
      throw error;
    }
  }
  /** Holds the reference tip fixed while adopting the requested rotary positions. */
  compensateTcp(reference: unknown, commanded: unknown): FiveAxisInverseResult {
    const start = this.state(reference), state = this.state(commanded);
    if (!start.tcpEnabled || !state.tcpEnabled) return fail("tcp-disabled",0);
    if (start.mode !== state.mode) throw new RangeError("TCP compensation cannot change operation mode");
    try {
      const old = this.fk.solve(start), rotated = this.fk.solve(state);
      return this.translate({ tcpPositionMm: old.tcpPositionMm, toolAxisUnit: rotated.toolAxisUnit },state,0);
    } catch (error) {
      if (error instanceof RangeError) return fail("nonfinite",0);
      throw error;
    }
  }
}

import { createMachinePluginStateSchema, FiveAxisTargetSchema, MachinePluginSchema, SolutionWeightsSchema, type MachinePluginState, type SolutionWeights } from "@cnc-render/contracts";
import { FiveAxisKinematics, type FiveAxisPose } from "./kinematics-5axis";
import { FiveAxisInverseKinematics } from "./kinematics-5axis-inverse";

export const DEFAULT_SOLUTION_WEIGHTS: Readonly<SolutionWeights> = Object.freeze({ axisTravel: 10, limitPenalty: 1, singularityRisk: 2 });
const SCALE = 100_000_000;
export interface SolutionCost { axisTravelUnits: number; limitPenaltyUnits: number; singularityRiskUnits: number; totalUnits: number }
export interface FiveAxisCandidate { sourceSeedIndex: number; state: MachinePluginState; pose: FiveAxisPose; cost: SolutionCost }
export interface FiveAxisSelection {
  policyVersion: 1;
  status: "selected" | "failed";
  code: "candidate-minimum" | "tcp-disabled" | "numeric-range-unsupported" | "no-candidate-found";
  collisionEvaluation: "not-evaluated";
  attemptedSeeds: number;
  selectedSeedIndex: number | null;
  candidates: FiveAxisCandidate[];
  rejectedSeeds: { sourceSeedIndex: number; code: string }[];
}
const value = (s: MachinePluginState,id: string) => {
  const p = s.positions.find((p) => p.axisId === id)!;
  return p.kind === "linear" ? p.positionMm : p.positionRad;
};
function set(s: MachinePluginState,id: string,q: number) {
  const p = s.positions.find((p) => p.axisId === id)!;
  if (p.kind === "linear") p.positionMm = q === 0 ? 0 : q; else p.positionRad = q === 0 ? 0 : q;
}
const vector = (p: FiveAxisPose) => [p.toolAxisUnit.x,p.toolAxisUnit.y,p.toolAxisUnit.z];
const dot = (a: number[],b: number[]) => a.reduce((sum,v,i) => sum+v*b[i],0);
const units = (v: number) => Math.floor(Math.min(1,Math.max(0,v))*SCALE+0.5);

/** Minimum among a bounded 27-seed search, never a claim of global completeness/safety. */
export class FiveAxisSolutionSelector {
  private readonly plugin;
  private readonly schema;
  private readonly fk;
  private readonly ik;
  private readonly axes;
  private readonly rotary;
  constructor(definition: unknown) {
    this.plugin = MachinePluginSchema.parse(definition);
    this.schema = createMachinePluginStateSchema(this.plugin);
    this.fk = new FiveAxisKinematics(this.plugin);
    this.ik = new FiveAxisInverseKinematics(this.plugin);
    this.axes = [...this.plugin.machine.axes].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    this.rotary = this.axes.filter((a) => a.kind === "rotary");
  }
  private cost(state: MachinePluginState, reference: MachinePluginState, weights: SolutionWeights): SolutionCost {
    let travel = 0, limit = 0;
    for (const axis of this.axes) {
      const min = axis.kind === "linear" ? axis.minMm : axis.minRad, max = axis.kind === "linear" ? axis.maxMm : axis.maxRad;
      const q = value(state,axis.id), span = max-min;
      travel += ((q-value(reference,axis.id))/span)**2 / 5;
      const margin = Math.min(q-min,max-q)/span;
      limit += (1-2*margin)**2 / 5;
    }
    const probe = structuredClone(state);
    const columns = this.rotary.map((axis) => {
      const q = value(probe,axis.id), lo = Math.max(axis.minRad,q-1e-5), hi = Math.min(axis.maxRad,q+1e-5);
      if (hi === lo) throw new RangeError("unrepresentable derivative");
      set(probe,axis.id,lo); const a = vector(this.fk.solve(probe));
      set(probe,axis.id,hi); const b = vector(this.fk.solve(probe));
      set(probe,axis.id,q);
      return b.map((v,i) => (v-a[i])/(hi-lo));
    });
    const [u,v] = columns, a = dot(u,u), b = dot(u,v), c = dot(v,v);
    const lambdaMax = (a+c+Math.hypot(a-c,2*b))/2;
    const cross = Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);
    const sigmaMin = lambdaMax <= 1e-20 ? 0 : cross/Math.sqrt(lambdaMax);
    const risk = 1-Math.min(1,sigmaMin);
    if (![travel,limit,a,b,c,lambdaMax,cross,sigmaMin,risk].every(Number.isFinite)) throw new RangeError("nonfinite cost");
    const axisTravelUnits = units(travel), limitPenaltyUnits = units(limit), singularityRiskUnits = units(risk);
    return { axisTravelUnits,limitPenaltyUnits,singularityRiskUnits,totalUnits: axisTravelUnits*weights.axisTravel+limitPenaltyUnits*weights.limitPenalty+singularityRiskUnits*weights.singularityRisk };
  }
  select(input: unknown, from: unknown, weightInput: unknown = DEFAULT_SOLUTION_WEIGHTS): FiveAxisSelection {
    const target = FiveAxisTargetSchema.parse(input), reference = this.schema.parse(from), weights = SolutionWeightsSchema.parse(weightInput);
    reference.positions.sort((a,b) => a.axisId < b.axisId ? -1 : a.axisId > b.axisId ? 1 : 0);
    const result: FiveAxisSelection = { policyVersion: 1,status: "failed",code: "no-candidate-found",collisionEvaluation: "not-evaluated",attemptedSeeds: 0,selectedSeedIndex: null,candidates: [],rejectedSeeds: [] };
    if (!reference.tcpEnabled) return { ...result,code: "tcp-disabled" };
    if (this.axes.some((a) => !Number.isFinite(a.kind === "linear" ? a.maxMm-a.minMm : a.maxRad-a.minRad))) return { ...result,code: "numeric-range-unsupported" };
    const home = structuredClone(reference);
    this.axes.forEach((axis) => set(home,axis.id,axis.kind === "linear" ? axis.homeMm : axis.homeRad));
    const seeds = [reference,home];
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      const seed = structuredClone(home);
      this.rotary.forEach((axis,k) => {
        const fraction = [i,j][k]/4;
        set(seed,axis.id,fraction === 0 ? axis.minRad : fraction === 1 ? axis.maxRad : Math.min(axis.maxRad,Math.max(axis.minRad,axis.minRad+(axis.maxRad-axis.minRad)*fraction)));
      });
      seeds.push(seed);
    }
    seeds.forEach((seed,sourceSeedIndex) => {
      result.attemptedSeeds++;
      const solved = this.ik.inverse(target,seed);
      if (solved.status === "failed") { result.rejectedSeeds.push({ sourceSeedIndex,code: solved.code }); return; }
      if (result.candidates.some((candidate) => this.axes.every((axis) => Math.abs(value(candidate.state,axis.id)-value(solved.state,axis.id)) <= (axis.kind === "linear" ? 1e-6 : 1e-8)))) return;
      try {
        result.candidates.push({ sourceSeedIndex,state: solved.state,pose: solved.pose,cost: this.cost(solved.state,reference,weights) });
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        result.rejectedSeeds.push({ sourceSeedIndex,code: "cost-unavailable" });
      }
    });
    result.candidates.sort((a,b) => a.cost.totalUnits-b.cost.totalUnits || a.sourceSeedIndex-b.sourceSeedIndex);
    if (result.candidates.length) { result.status = "selected"; result.code = "candidate-minimum"; result.selectedSeedIndex = result.candidates[0].sourceSeedIndex; }
    return result;
  }
}

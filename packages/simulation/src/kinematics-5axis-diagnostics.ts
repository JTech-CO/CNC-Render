import { createMachinePluginStateSchema, MachinePluginSchema, RewindRequestSchema, type MachinePluginState } from "@cnc-render/contracts";
import { FiveAxisKinematics, type FiveAxisPose } from "./kinematics-5axis";
import { FiveAxisInverseKinematics } from "./kinematics-5axis-inverse";

export const FIVE_AXIS_DIAGNOSTIC_POLICY = Object.freeze({ version: 1, sampleStepRad: Math.PI/180, maxIntervals: 720, singularSigma: 1e-6, nearSingularSigma: 0.05, limitMarginFraction: 0.01, toolAxisJumpRad: Math.PI/6, rotaryJumpRad: Math.PI/2, rewindIntervals: 72 });
type Code = "axis-limit-reached" | "axis-limit-near" | "rotary-singularity" | "rotary-near-singularity" | "tool-axis-jump" | "rotary-axis-jump" | "rewind-required" | "sampling-budget-exceeded" | "numeric-unavailable";
export interface FiveAxisDiagnostic { code: Code; axisId: string | null; sampleIndex: number; value: number | null; unit: "rad" | "ratio" | "count" | null }
export interface FiveAxisTransitionReport { policyVersion: 1; status: "clear" | "attention-required"; collisionEvaluation: "not-evaluated"; samplesChecked: number; diagnostics: FiveAxisDiagnostic[] }
export interface RewindStep { kind: "stop" | "retract" | "rewind" | "return"; cuttingEnabled: false; state: MachinePluginState; pose: FiveAxisPose }
export interface FiveAxisRewindPlan { policyVersion: 1; status: "review-required" | "failed"; code: string; executionAllowed: false; collisionEvaluation: "not-evaluated"; steps: RewindStep[]; diagnostics: FiveAxisDiagnostic[] }

const value = (s: MachinePluginState,id: string) => { const p = s.positions.find((p) => p.axisId === id)!; return p.kind === "linear" ? p.positionMm : p.positionRad; };
function set(s: MachinePluginState,id: string,q: number) { const p = s.positions.find((p) => p.axisId === id)!; q = q === 0 ? 0 : q; if (p.kind === "linear") p.positionMm = q; else p.positionRad = q; }
const vector = (p: FiveAxisPose) => [p.toolAxisUnit.x,p.toolAxisUnit.y,p.toolAxisUnit.z];
const dot = (a: number[],b: number[]) => a.reduce((s,v,i) => s+v*b[i],0);
const crossNorm = (a: number[],b: number[]) => Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]);
const angle = (a: FiveAxisPose,b: FiveAxisPose) => Math.atan2(crossNorm(vector(a),vector(b)),dot(vector(a),vector(b)));

/** Sampled joint-linear diagnostics and non-executable, collision-unchecked rewind proposals. */
export class FiveAxisMotionGuard {
  private readonly plugin;
  private readonly schema;
  private readonly axes;
  private readonly rotary;
  private readonly fk;
  private readonly ik;
  constructor(definition: unknown) {
    this.plugin = MachinePluginSchema.parse(definition);
    this.schema = createMachinePluginStateSchema(this.plugin);
    this.axes = [...this.plugin.machine.axes].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    this.rotary = this.axes.filter((a) => a.kind === "rotary");
    this.fk = new FiveAxisKinematics(this.plugin); this.ik = new FiveAxisInverseKinematics(this.plugin);
  }
  private state(input: unknown) {
    const s = this.schema.parse(input);
    s.positions.sort((a,b) => a.axisId < b.axisId ? -1 : a.axisId > b.axisId ? 1 : 0);
    return s;
  }
  private sigma(state: MachinePluginState) {
    const probe = structuredClone(state);
    const [u,v] = this.rotary.map((axis) => {
      const q = value(state,axis.id), lo = Math.max(axis.minRad,q-1e-5), hi = Math.min(axis.maxRad,q+1e-5);
      if (hi === lo) throw new RangeError("unrepresentable derivative");
      set(probe,axis.id,lo); const a = vector(this.fk.solve(probe));
      set(probe,axis.id,hi); const b = vector(this.fk.solve(probe)); set(probe,axis.id,q);
      return b.map((v,i) => (v-a[i])/(hi-lo));
    });
    const a = dot(u,u), b = dot(u,v), c = dot(v,v), lambda = (a+c+Math.hypot(a-c,2*b))/2;
    const cross = crossNorm(u,v), sigma = lambda <= 1e-20 ? 0 : cross/Math.sqrt(lambda);
    if (![a,b,c,lambda,cross,sigma].every(Number.isFinite)) throw new RangeError("nonfinite derivative");
    return sigma;
  }
  private inspect(state: MachinePluginState,index: number,emit: (d: FiveAxisDiagnostic) => void) {
    for (const axis of this.axes) {
      const min = axis.kind === "linear" ? axis.minMm : axis.minRad, max = axis.kind === "linear" ? axis.maxMm : axis.maxRad, q = value(state,axis.id);
      const margin = Math.min(q-min,max-q)/(max-min);
      if (!Number.isFinite(max-min) || !Number.isFinite(margin)) emit({ code: "numeric-unavailable",axisId: axis.id,sampleIndex: index,value: null,unit: null });
      else if (margin <= FIVE_AXIS_DIAGNOSTIC_POLICY.limitMarginFraction) emit({ code: margin === 0 ? "axis-limit-reached" : "axis-limit-near",axisId: axis.id,sampleIndex: index,value: margin,unit: "ratio" });
    }
    try {
      const sigma = this.sigma(state);
      if (sigma <= FIVE_AXIS_DIAGNOSTIC_POLICY.nearSingularSigma) emit({ code: sigma <= FIVE_AXIS_DIAGNOSTIC_POLICY.singularSigma ? "rotary-singularity" : "rotary-near-singularity",axisId: null,sampleIndex: index,value: sigma,unit: "ratio" });
    } catch (error) { if (!(error instanceof RangeError)) throw error; emit({ code: "numeric-unavailable",axisId: null,sampleIndex: index,value: null,unit: null }); }
  }
  analyzeTransition(fromInput: unknown,toInput: unknown): FiveAxisTransitionReport {
    const from = this.state(fromInput), to = this.state(toInput);
    if (from.mode !== to.mode || from.tcpEnabled !== to.tcpEnabled) throw new RangeError("transition must preserve mode and TCP setting");
    const report: FiveAxisTransitionReport = { policyVersion: 1,status: "clear",collisionEvaluation: "not-evaluated",samplesChecked: 0,diagnostics: [] };
    const emit = (d: FiveAxisDiagnostic) => { if (!report.diagnostics.some((v) => v.code === d.code && v.axisId === d.axisId)) report.diagnostics.push(d); };
    let total = 0;
    for (const axis of this.rotary) {
      const signed = value(to,axis.id)-value(from,axis.id), delta = Math.abs(signed); total += delta;
      if (!Number.isFinite(delta)) emit({ code: "numeric-unavailable",axisId: axis.id,sampleIndex: 0,value: null,unit: null });
      else {
        if (delta > FIVE_AXIS_DIAGNOSTIC_POLICY.rotaryJumpRad) emit({ code: "rotary-axis-jump",axisId: axis.id,sampleIndex: 0,value: delta,unit: "rad" });
        const span = axis.maxRad-axis.minRad;
        const approaching = Number.isFinite(span) && ((signed > 0 && (axis.maxRad-value(to,axis.id))/span <= 0.01) || (signed < 0 && (value(to,axis.id)-axis.minRad)/span <= 0.01));
        if (delta > Math.PI || approaching) emit({ code: "rewind-required",axisId: axis.id,sampleIndex: 0,value: delta,unit: "rad" });
      }
    }
    try {
      const change = angle(this.fk.solve(from),this.fk.solve(to));
      if (change > FIVE_AXIS_DIAGNOSTIC_POLICY.toolAxisJumpRad) emit({ code: "tool-axis-jump",axisId: null,sampleIndex: 0,value: change,unit: "rad" });
    } catch (error) { if (!(error instanceof RangeError)) throw error; emit({ code: "numeric-unavailable",axisId: null,sampleIndex: 0,value: null,unit: null }); }
    const intervals = Math.max(1,Math.ceil(total/FIVE_AXIS_DIAGNOSTIC_POLICY.sampleStepRad));
    if (!Number.isFinite(intervals) || intervals > FIVE_AXIS_DIAGNOSTIC_POLICY.maxIntervals) {
      emit({ code: "sampling-budget-exceeded",axisId: null,sampleIndex: 0,value: Number.isSafeInteger(intervals) ? intervals : null,unit: "count" });
    } else {
      for (let i = 0; i <= intervals; i++) {
        const sample = structuredClone(from), t = i/intervals;
        this.axes.forEach((a) => {
          const min = a.kind === "linear" ? a.minMm : a.minRad, max = a.kind === "linear" ? a.maxMm : a.maxRad;
          set(sample,a.id,i === 0 ? value(from,a.id) : i === intervals ? value(to,a.id) : Math.min(max,Math.max(min,value(from,a.id)*(1-t)+value(to,a.id)*t)));
        });
        this.inspect(sample,i,emit); report.samplesChecked++;
      }
    }
    report.diagnostics.sort((a,b) => { const x = a.code+(a.axisId ?? ""), y = b.code+(b.axisId ?? ""); return x < y ? -1 : x > y ? 1 : 0; });
    if (report.diagnostics.length) report.status = "attention-required";
    return report;
  }
  planRewind(referenceInput: unknown,requestInput: unknown): FiveAxisRewindPlan {
    const reference = this.state(referenceInput), request = RewindRequestSchema.parse(requestInput);
    const axis = this.rotary.find((a) => a.id === request.axisId);
    if (!axis) throw new RangeError("rewind requires a known rotary axis");
    const result: FiveAxisRewindPlan = { policyVersion: 1,status: "failed",code: "tcp-disabled",executionAllowed: false,collisionEvaluation: "not-evaluated",steps: [],diagnostics: [] };
    if (!reference.tcpEnabled) return result;
    const q = value(reference,axis.id), delta = (request.direction === "positive" ? -1 : 1)*2*Math.PI, end = q+delta;
    if (!Number.isFinite(end) || end === q || end < axis.minRad || end > axis.maxRad) return { ...result,code: "rewind-axis-limit" };
    try {
      const original = this.fk.solve(reference), p = original.tcpPositionMm, d = original.toolAxisUnit, distance = request.retractDistanceMm;
      const target = { ...original,tcpPositionMm: { xMm: p.xMm+d.x*distance,yMm: p.yMm+d.y*distance,zMm: p.zMm+d.z*distance } };
      if (!Object.values(target.tcpPositionMm).every(Number.isFinite)) return { ...result,code: "numeric-unavailable" };
      const retracted = this.ik.inverse(target,reference);
      if (retracted.status !== "solved") return { ...result,code: "retract-"+retracted.code };
      const steps: RewindStep[] = [{ kind: "stop",cuttingEnabled: false,state: reference,pose: original },{ kind: "retract",cuttingEnabled: false,state: retracted.state,pose: retracted.pose }];
      for (let i = 1; i <= FIVE_AXIS_DIAGNOSTIC_POLICY.rewindIntervals; i++) {
        const commanded = structuredClone(retracted.state);
        set(commanded,axis.id,i === FIVE_AXIS_DIAGNOSTIC_POLICY.rewindIntervals ? end : q+delta*(i/FIVE_AXIS_DIAGNOSTIC_POLICY.rewindIntervals));
        const solved = this.ik.compensateTcp(retracted.state,commanded);
        if (solved.status !== "solved") return { ...result,code: "rewind-"+solved.code };
        steps.push({ kind: "rewind",cuttingEnabled: false,state: solved.state,pose: solved.pose });
      }
      const restored = structuredClone(reference); set(restored,axis.id,end);
      const pose = this.fk.solve(restored);
      if (Math.hypot(pose.tcpPositionMm.xMm-p.xMm,pose.tcpPositionMm.yMm-p.yMm,pose.tcpPositionMm.zMm-p.zMm) > 1e-9 || angle(pose,original) > 1e-9) return { ...result,code: "rewind-residual-exceeded" };
      steps.push({ kind: "return",cuttingEnabled: false,state: restored,pose });
      // Inspect explicit TCP samples, not joint-linear interpolation between their endpoints.
      const diagnostics: FiveAxisDiagnostic[] = [];
      steps.forEach((step,index) => this.inspect(step.state,index,(d) => { if (!diagnostics.some((v) => v.code === d.code && v.axisId === d.axisId)) diagnostics.push(d); }));
      return { ...result,status: "review-required",code: "collision-review-required",steps,diagnostics };
    } catch (error) { if (!(error instanceof RangeError)) throw error; return { ...result,code: "numeric-unavailable" }; }
  }
}

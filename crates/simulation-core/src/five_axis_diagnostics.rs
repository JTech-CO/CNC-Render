use crate::{
    SimulationError,
    five_axis::{FiveAxisKinematics, FiveAxisPose},
    five_axis_inverse::{FiveAxisInverseKinematics, InverseResult},
};
use cnc_render_contracts::{
    ContractValidate,
    domain::{KinematicAxis, Vec3Mm},
    machine_plugin::{
        AxisPosition, FiveAxisTarget, MachinePlugin, MachinePluginState, RewindDirection,
        RewindRequest,
    },
};
use serde::Serialize;
use std::f64::consts::PI;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: &'static str,
    pub axis_id: Option<String>,
    pub sample_index: usize,
    pub value: Option<f64>,
    pub unit: Option<&'static str>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionReport {
    pub policy_version: u32,
    pub status: &'static str,
    pub collision_evaluation: &'static str,
    pub samples_checked: usize,
    pub diagnostics: Vec<Diagnostic>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindStep {
    pub kind: &'static str,
    pub cutting_enabled: bool,
    pub state: MachinePluginState,
    pub pose: FiveAxisPose,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindPlan {
    pub policy_version: u32,
    pub status: &'static str,
    pub code: String,
    pub execution_allowed: bool,
    pub collision_evaluation: &'static str,
    pub steps: Vec<RewindStep>,
    pub diagnostics: Vec<Diagnostic>,
}
fn failed(code: impl Into<String>) -> RewindPlan {
    RewindPlan {
        policy_version: 1,
        status: "failed",
        code: code.into(),
        execution_allowed: false,
        collision_evaluation: "not-evaluated",
        steps: vec![],
        diagnostics: vec![],
    }
}
fn get(s: &MachinePluginState, id: &str) -> f64 {
    s.positions
        .iter()
        .find(|p| p.id() == id)
        .expect("validated position")
        .value()
}
fn set(s: &mut MachinePluginState, id: &str, q: f64) {
    let q = if q == 0.0 { 0.0 } else { q };
    match s
        .positions
        .iter_mut()
        .find(|p| p.id() == id)
        .expect("validated position")
    {
        AxisPosition::Linear { position_mm, .. } => *position_mm = q,
        AxisPosition::Rotary { position_rad, .. } => *position_rad = q,
    }
}
fn bounds(a: &KinematicAxis) -> (f64, f64) {
    match a {
        KinematicAxis::Linear { min_mm, max_mm, .. } => (*min_mm, *max_mm),
        KinematicAxis::Rotary {
            min_rad, max_rad, ..
        } => (*min_rad, *max_rad),
    }
}
fn vector(p: &FiveAxisPose) -> [f64; 3] {
    [p.tool_axis_unit.x, p.tool_axis_unit.y, p.tool_axis_unit.z]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> f64 {
    (a[1] * b[2] - a[2] * b[1])
        .hypot(a[2] * b[0] - a[0] * b[2])
        .hypot(a[0] * b[1] - a[1] * b[0])
}
fn angle(a: &FiveAxisPose, b: &FiveAxisPose) -> f64 {
    cross(vector(a), vector(b)).atan2(dot(vector(a), vector(b)))
}
fn emit(
    list: &mut Vec<Diagnostic>,
    code: &'static str,
    id: Option<&str>,
    index: usize,
    value: Option<f64>,
    unit: Option<&'static str>,
) {
    if !list
        .iter()
        .any(|d| d.code == code && d.axis_id.as_deref() == id)
    {
        list.push(Diagnostic {
            code,
            axis_id: id.map(str::to_owned),
            sample_index: index,
            value,
            unit,
        });
    }
}
fn sort(list: &mut [Diagnostic]) {
    list.sort_by(|a, b| {
        (a.code, a.axis_id.as_deref().unwrap_or(""))
            .cmp(&(b.code, b.axis_id.as_deref().unwrap_or("")))
    });
}

/// Bounded sampled kinematics only. Rewind proposals always require external collision review.
pub struct FiveAxisMotionGuard {
    plugin: MachinePlugin,
    axes: Vec<KinematicAxis>,
    rotary: Vec<KinematicAxis>,
    fk: FiveAxisKinematics,
    ik: FiveAxisInverseKinematics,
}
impl FiveAxisMotionGuard {
    pub fn new(plugin: MachinePlugin) -> Result<Self, SimulationError> {
        let fk = FiveAxisKinematics::new(plugin.clone())?;
        let ik = FiveAxisInverseKinematics::new(plugin.clone())?;
        let mut axes = plugin.machine.axes.clone();
        axes.sort_by(|a, b| a.id().cmp(b.id()));
        let rotary = axes
            .iter()
            .filter(|a| matches!(a, KinematicAxis::Rotary { .. }))
            .cloned()
            .collect();
        Ok(Self {
            plugin,
            axes,
            rotary,
            fk,
            ik,
        })
    }
    fn state(&self, input: &MachinePluginState) -> Result<MachinePluginState, SimulationError> {
        input
            .validate_for(&self.plugin)
            .map_err(|e| SimulationError::new("kinematics.guard.state", e.to_string()))?;
        let mut s = input.clone();
        s.positions.sort_by(|a, b| a.id().cmp(b.id()));
        Ok(s)
    }
    fn sigma(&self, state: &MachinePluginState) -> Option<f64> {
        let mut probe = state.clone();
        let mut columns = [[0.0; 3]; 2];
        for (i, axis) in self.rotary.iter().enumerate() {
            let (min, max) = bounds(axis);
            let q = get(state, axis.id());
            let (lo, hi) = (min.max(q - 1e-5), max.min(q + 1e-5));
            if lo == hi {
                return None;
            }
            set(&mut probe, axis.id(), lo);
            let a = vector(&self.fk.solve(&probe).ok()?);
            set(&mut probe, axis.id(), hi);
            let b = vector(&self.fk.solve(&probe).ok()?);
            set(&mut probe, axis.id(), q);
            columns[i] = std::array::from_fn(|j| (b[j] - a[j]) / (hi - lo));
        }
        let [u, v] = columns;
        let (a, b, c) = (dot(u, u), dot(u, v), dot(v, v));
        let lambda = (a + c + (a - c).hypot(2.0 * b)) / 2.0;
        let cross = cross(u, v);
        let sigma = if lambda <= 1e-20 {
            0.0
        } else {
            cross / lambda.sqrt()
        };
        [a, b, c, lambda, cross, sigma]
            .iter()
            .all(|v| v.is_finite())
            .then_some(sigma)
    }
    fn inspect(&self, state: &MachinePluginState, index: usize, list: &mut Vec<Diagnostic>) {
        for axis in &self.axes {
            let (min, max) = bounds(axis);
            let q = get(state, axis.id());
            let margin = (q - min).min(max - q) / (max - min);
            if !(max - min).is_finite() || !margin.is_finite() {
                emit(
                    list,
                    "numeric-unavailable",
                    Some(axis.id()),
                    index,
                    None,
                    None,
                );
            } else if margin <= 0.01 {
                emit(
                    list,
                    if margin == 0.0 {
                        "axis-limit-reached"
                    } else {
                        "axis-limit-near"
                    },
                    Some(axis.id()),
                    index,
                    Some(margin),
                    Some("ratio"),
                );
            }
        }
        match self.sigma(state) {
            Some(sigma) if sigma <= 0.05 => emit(
                list,
                if sigma <= 1e-6 {
                    "rotary-singularity"
                } else {
                    "rotary-near-singularity"
                },
                None,
                index,
                Some(sigma),
                Some("ratio"),
            ),
            None => emit(list, "numeric-unavailable", None, index, None, None),
            _ => (),
        }
    }
    pub fn analyze_transition(
        &self,
        from: &MachinePluginState,
        to: &MachinePluginState,
    ) -> Result<TransitionReport, SimulationError> {
        let from = self.state(from)?;
        let to = self.state(to)?;
        if from.mode != to.mode || from.tcp_enabled != to.tcp_enabled {
            return Err(SimulationError::new(
                "kinematics.guard.transition",
                "transition must preserve mode and TCP setting",
            ));
        }
        let mut report = TransitionReport {
            policy_version: 1,
            status: "clear",
            collision_evaluation: "not-evaluated",
            samples_checked: 0,
            diagnostics: vec![],
        };
        let mut total = 0.0;
        for axis in &self.rotary {
            let signed = get(&to, axis.id()) - get(&from, axis.id());
            let delta = signed.abs();
            total += delta;
            if !delta.is_finite() {
                emit(
                    &mut report.diagnostics,
                    "numeric-unavailable",
                    Some(axis.id()),
                    0,
                    None,
                    None,
                );
            } else {
                if delta > PI / 2.0 {
                    emit(
                        &mut report.diagnostics,
                        "rotary-axis-jump",
                        Some(axis.id()),
                        0,
                        Some(delta),
                        Some("rad"),
                    );
                }
                let (min, max) = bounds(axis);
                let span = max - min;
                let approaching = span.is_finite()
                    && ((signed > 0.0 && (max - get(&to, axis.id())) / span <= 0.01)
                        || (signed < 0.0 && (get(&to, axis.id()) - min) / span <= 0.01));
                if delta > PI || approaching {
                    emit(
                        &mut report.diagnostics,
                        "rewind-required",
                        Some(axis.id()),
                        0,
                        Some(delta),
                        Some("rad"),
                    );
                }
            }
        }
        match (self.fk.solve(&from), self.fk.solve(&to)) {
            (Ok(a), Ok(b)) => {
                let change = angle(&a, &b);
                if change > PI / 6.0 {
                    emit(
                        &mut report.diagnostics,
                        "tool-axis-jump",
                        None,
                        0,
                        Some(change),
                        Some("rad"),
                    );
                }
            }
            _ => emit(
                &mut report.diagnostics,
                "numeric-unavailable",
                None,
                0,
                None,
                None,
            ),
        }
        let intervals = (total / (PI / 180.0)).ceil().max(1.0);
        if !intervals.is_finite() || intervals > 720.0 {
            let count = (intervals.is_finite() && intervals <= 9_007_199_254_740_991.0)
                .then_some(intervals);
            emit(
                &mut report.diagnostics,
                "sampling-budget-exceeded",
                None,
                0,
                count,
                Some("count"),
            );
        } else {
            for i in 0..=intervals as usize {
                let mut sample = from.clone();
                let t = i as f64 / intervals;
                for a in &self.axes {
                    let q = if i == 0 {
                        get(&from, a.id())
                    } else if i == intervals as usize {
                        get(&to, a.id())
                    } else {
                        let (min, max) = bounds(a);
                        (get(&from, a.id()) * (1.0 - t) + get(&to, a.id()) * t).clamp(min, max)
                    };
                    set(&mut sample, a.id(), q);
                }
                self.inspect(&sample, i, &mut report.diagnostics);
                report.samples_checked += 1;
            }
        }
        sort(&mut report.diagnostics);
        if !report.diagnostics.is_empty() {
            report.status = "attention-required";
        }
        Ok(report)
    }
    pub fn plan_rewind(
        &self,
        reference: &MachinePluginState,
        request: &RewindRequest,
    ) -> Result<RewindPlan, SimulationError> {
        let reference = self.state(reference)?;
        request
            .validate()
            .map_err(|e| SimulationError::new("kinematics.guard.rewind", e.to_string()))?;
        let axis = self
            .rotary
            .iter()
            .find(|a| a.id() == request.axis_id)
            .ok_or_else(|| {
                SimulationError::new(
                    "kinematics.guard.rewind",
                    "rewind requires a known rotary axis",
                )
            })?;
        if !reference.tcp_enabled {
            return Ok(failed("tcp-disabled"));
        }
        let q = get(&reference, axis.id());
        let delta = match request.direction {
            RewindDirection::Positive => -2.0 * PI,
            RewindDirection::Negative => 2.0 * PI,
        };
        let end = q + delta;
        let (min, max) = bounds(axis);
        if !end.is_finite() || end == q || end < min || end > max {
            return Ok(failed("rewind-axis-limit"));
        }
        let evaluate = || -> Result<RewindPlan, SimulationError> {
            let original = self.fk.solve(&reference)?;
            let p = &original.tcp_position_mm;
            let d = &original.tool_axis_unit;
            let distance = request.retract_distance_mm;
            let target = FiveAxisTarget {
                tcp_position_mm: Vec3Mm {
                    x_mm: p.x_mm + d.x * distance,
                    y_mm: p.y_mm + d.y * distance,
                    z_mm: p.z_mm + d.z * distance,
                },
                tool_axis_unit: d.clone(),
            };
            let retracted = self.ik.inverse(&target, &reference)?;
            let InverseResult::Solved {
                state: raised,
                pose: raised_pose,
                ..
            } = retracted
            else {
                let InverseResult::Failed { code, .. } = retracted else {
                    unreachable!()
                };
                return Ok(failed(format!("retract-{code}")));
            };
            let mut steps = vec![
                RewindStep {
                    kind: "stop",
                    cutting_enabled: false,
                    state: reference.clone(),
                    pose: original.clone(),
                },
                RewindStep {
                    kind: "retract",
                    cutting_enabled: false,
                    state: *raised.clone(),
                    pose: raised_pose,
                },
            ];
            for i in 1..=72 {
                let mut commanded = *raised.clone();
                set(
                    &mut commanded,
                    axis.id(),
                    if i == 72 {
                        end
                    } else {
                        q + delta * (f64::from(i) / 72.0)
                    },
                );
                match self.ik.compensate_tcp(&raised, &commanded)? {
                    InverseResult::Solved { state, pose, .. } => steps.push(RewindStep {
                        kind: "rewind",
                        cutting_enabled: false,
                        state: *state,
                        pose,
                    }),
                    InverseResult::Failed { code, .. } => {
                        return Ok(failed(format!("rewind-{code}")));
                    }
                }
            }
            let mut restored = reference.clone();
            set(&mut restored, axis.id(), end);
            let pose = self.fk.solve(&restored)?;
            let error = (pose.tcp_position_mm.x_mm - p.x_mm)
                .hypot(pose.tcp_position_mm.y_mm - p.y_mm)
                .hypot(pose.tcp_position_mm.z_mm - p.z_mm);
            if error > 1e-9 || angle(&pose, &original) > 1e-9 {
                return Ok(failed("rewind-residual-exceeded"));
            }
            steps.push(RewindStep {
                kind: "return",
                cutting_enabled: false,
                state: restored,
                pose,
            });
            let mut diagnostics = vec![];
            for (i, step) in steps.iter().enumerate() {
                self.inspect(&step.state, i, &mut diagnostics);
            }
            Ok(RewindPlan {
                policy_version: 1,
                status: "review-required",
                code: "collision-review-required".into(),
                execution_allowed: false,
                collision_evaluation: "not-evaluated",
                steps,
                diagnostics,
            })
        };
        Ok(evaluate().unwrap_or_else(|_| failed("numeric-unavailable")))
    }
}

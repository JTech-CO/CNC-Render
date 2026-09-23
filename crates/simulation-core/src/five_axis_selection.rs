use crate::{
    SimulationError,
    five_axis::{FiveAxisKinematics, FiveAxisPose},
    five_axis_inverse::{FiveAxisInverseKinematics, InverseResult},
};
use cnc_render_contracts::{
    ContractValidate,
    domain::KinematicAxis,
    machine_plugin::{
        AxisPosition, FiveAxisTarget, MachinePlugin, MachinePluginState, SolutionWeights,
    },
};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolutionCost {
    pub axis_travel_units: u64,
    pub limit_penalty_units: u64,
    pub singularity_risk_units: u64,
    pub total_units: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub source_seed_index: usize,
    pub state: MachinePluginState,
    pub pose: FiveAxisPose,
    pub cost: SolutionCost,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedSeed {
    pub source_seed_index: usize,
    pub code: &'static str,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub policy_version: u32,
    pub status: &'static str,
    pub code: &'static str,
    pub collision_evaluation: &'static str,
    pub attempted_seeds: usize,
    pub selected_seed_index: Option<usize>,
    pub candidates: Vec<Candidate>,
    pub rejected_seeds: Vec<RejectedSeed>,
}
fn get(state: &MachinePluginState, id: &str) -> f64 {
    state
        .positions
        .iter()
        .find(|p| p.id() == id)
        .expect("validated position")
        .value()
}
fn set(state: &mut MachinePluginState, id: &str, q: f64) {
    let q = if q == 0.0 { 0.0 } else { q };
    match state
        .positions
        .iter_mut()
        .find(|p| p.id() == id)
        .expect("validated position")
    {
        AxisPosition::Linear { position_mm, .. } => *position_mm = q,
        AxisPosition::Rotary { position_rad, .. } => *position_rad = q,
    }
}
fn bounds(axis: &KinematicAxis) -> (f64, f64, f64) {
    match axis {
        KinematicAxis::Linear {
            min_mm,
            max_mm,
            home_mm,
            ..
        } => (*min_mm, *max_mm, *home_mm),
        KinematicAxis::Rotary {
            min_rad,
            max_rad,
            home_rad,
            ..
        } => (*min_rad, *max_rad, *home_rad),
    }
}
fn direction(p: &FiveAxisPose) -> [f64; 3] {
    [p.tool_axis_unit.x, p.tool_axis_unit.y, p.tool_axis_unit.z]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn units(v: f64) -> u64 {
    (v.clamp(0.0, 1.0) * 100_000_000.0 + 0.5).floor() as u64
}

/// Bounded multistart search. Neither an exhaustive IK solver nor a collision safety check.
pub struct FiveAxisSolutionSelector {
    plugin: MachinePlugin,
    axes: Vec<KinematicAxis>,
    rotary: Vec<KinematicAxis>,
    fk: FiveAxisKinematics,
    ik: FiveAxisInverseKinematics,
}
impl FiveAxisSolutionSelector {
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
    fn cost(
        &self,
        state: &MachinePluginState,
        reference: &MachinePluginState,
        weights: &SolutionWeights,
    ) -> Option<SolutionCost> {
        let (mut travel, mut limit) = (0.0, 0.0);
        for axis in &self.axes {
            let (min, max, _) = bounds(axis);
            let q = get(state, axis.id());
            travel += ((q - get(reference, axis.id())) / (max - min)).powi(2) / 5.0;
            let margin = (q - min).min(max - q) / (max - min);
            limit += (1.0 - 2.0 * margin).powi(2) / 5.0;
        }
        let mut probe = state.clone();
        let mut columns = [[0.0; 3]; 2];
        for (i, axis) in self.rotary.iter().enumerate() {
            let (min, max, _) = bounds(axis);
            let q = get(state, axis.id());
            let (lo, hi) = (min.max(q - 1e-5), max.min(q + 1e-5));
            if hi == lo {
                return None;
            }
            set(&mut probe, axis.id(), lo);
            let a = direction(&self.fk.solve(&probe).ok()?);
            set(&mut probe, axis.id(), hi);
            let b = direction(&self.fk.solve(&probe).ok()?);
            set(&mut probe, axis.id(), q);
            columns[i] = std::array::from_fn(|k| (b[k] - a[k]) / (hi - lo));
        }
        let [u, v] = columns;
        let (a, b, c) = (dot(u, u), dot(u, v), dot(v, v));
        let lambda_max = (a + c + (a - c).hypot(2.0 * b)) / 2.0;
        let cross = (u[1] * v[2] - u[2] * v[1])
            .hypot(u[2] * v[0] - u[0] * v[2])
            .hypot(u[0] * v[1] - u[1] * v[0]);
        let sigma_min = if lambda_max <= 1e-20 {
            0.0
        } else {
            cross / lambda_max.sqrt()
        };
        let risk = 1.0 - sigma_min.min(1.0);
        if ![travel, limit, a, b, c, lambda_max, cross, sigma_min, risk]
            .iter()
            .all(|x| x.is_finite())
        {
            return None;
        }
        let (axis_travel_units, limit_penalty_units, singularity_risk_units) =
            (units(travel), units(limit), units(risk));
        let total_units = axis_travel_units * u64::from(weights.axis_travel)
            + limit_penalty_units * u64::from(weights.limit_penalty)
            + singularity_risk_units * u64::from(weights.singularity_risk);
        Some(SolutionCost {
            axis_travel_units,
            limit_penalty_units,
            singularity_risk_units,
            total_units,
        })
    }
    pub fn select(
        &self,
        target: &FiveAxisTarget,
        reference: &MachinePluginState,
        weights: &SolutionWeights,
    ) -> Result<Selection, SimulationError> {
        target
            .validate()
            .map_err(|e| SimulationError::new("kinematics.select.target", e.to_string()))?;
        reference
            .validate_for(&self.plugin)
            .map_err(|e| SimulationError::new("kinematics.select.state", e.to_string()))?;
        weights
            .validate()
            .map_err(|e| SimulationError::new("kinematics.select.weights", e.to_string()))?;
        let mut result = Selection {
            policy_version: 1,
            status: "failed",
            code: "no-candidate-found",
            collision_evaluation: "not-evaluated",
            attempted_seeds: 0,
            selected_seed_index: None,
            candidates: vec![],
            rejected_seeds: vec![],
        };
        if !reference.tcp_enabled {
            result.code = "tcp-disabled";
            return Ok(result);
        }
        if self.axes.iter().any(|a| {
            let (min, max, _) = bounds(a);
            !(max - min).is_finite()
        }) {
            result.code = "numeric-range-unsupported";
            return Ok(result);
        }
        let mut reference = reference.clone();
        reference.positions.sort_by(|a, b| a.id().cmp(b.id()));
        let mut home = reference.clone();
        for axis in &self.axes {
            set(&mut home, axis.id(), bounds(axis).2);
        }
        let mut seeds = vec![reference.clone(), home.clone()];
        for i in 0..=4 {
            for j in 0..=4 {
                let mut seed = home.clone();
                for (k, axis) in self.rotary.iter().enumerate() {
                    let (min, max, _) = bounds(axis);
                    let fraction = f64::from([i, j][k]) / 4.0;
                    let q = if fraction == 0.0 {
                        min
                    } else if fraction == 1.0 {
                        max
                    } else {
                        (min + (max - min) * fraction).clamp(min, max)
                    };
                    set(&mut seed, axis.id(), q);
                }
                seeds.push(seed);
            }
        }
        for (source_seed_index, seed) in seeds.iter().enumerate() {
            result.attempted_seeds += 1;
            match self.ik.inverse(target, seed)? {
                InverseResult::Failed { code, .. } => result.rejected_seeds.push(RejectedSeed {
                    source_seed_index,
                    code,
                }),
                InverseResult::Solved { state, pose, .. } => {
                    if result.candidates.iter().any(|candidate| {
                        self.axes.iter().all(|axis| {
                            let tolerance = if matches!(axis, KinematicAxis::Linear { .. }) {
                                1e-6
                            } else {
                                1e-8
                            };
                            (get(&candidate.state, axis.id()) - get(&state, axis.id())).abs()
                                <= tolerance
                        })
                    }) {
                        continue;
                    }
                    if let Some(cost) = self.cost(&state, &reference, weights) {
                        result.candidates.push(Candidate {
                            source_seed_index,
                            state: *state,
                            pose,
                            cost,
                        });
                    } else {
                        result.rejected_seeds.push(RejectedSeed {
                            source_seed_index,
                            code: "cost-unavailable",
                        });
                    }
                }
            }
        }
        result
            .candidates
            .sort_by_key(|c| (c.cost.total_units, c.source_seed_index));
        if let Some(first) = result.candidates.first() {
            result.status = "selected";
            result.code = "candidate-minimum";
            result.selected_seed_index = Some(first.source_seed_index);
        }
        Ok(result)
    }
}

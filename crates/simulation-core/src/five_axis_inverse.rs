use crate::{
    SimulationError,
    five_axis::{FiveAxisKinematics, FiveAxisPose},
};
use cnc_render_contracts::{
    ContractValidate,
    domain::{DirectionUnit, KinematicAxis, Vec3Mm},
    machine_plugin::{AxisPosition, FiveAxisTarget, MachinePlugin, MachinePluginState},
};
use serde::Serialize;

pub const POSITION_TOLERANCE_MM: f64 = 1e-9;
pub const ORIENTATION_TOLERANCE_RAD: f64 = 1e-9;
const ITERATIONS: u32 = 80;
const ORIENTATION_SOLVE_TOLERANCE_RAD: f64 = 1e-12;
type V = [f64; 3];
fn dot(a: V, b: V) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn sub(a: V, b: V) -> V {
    std::array::from_fn(|i| a[i] - b[i])
}
fn norm(a: V) -> f64 {
    a[0].hypot(a[1]).hypot(a[2])
}
fn position(p: &Vec3Mm) -> V {
    [p.x_mm, p.y_mm, p.z_mm]
}
fn direction(d: &DirectionUnit) -> V {
    let n = norm([d.x, d.y, d.z]);
    [d.x / n, d.y / n, d.z / n]
}
fn angle(a: V, b: V) -> f64 {
    norm([
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ])
    .atan2(dot(a, b))
}
fn set(state: &mut MachinePluginState, id: &str, value: f64) {
    let value = if value == 0.0 { 0.0 } else { value };
    match state
        .positions
        .iter_mut()
        .find(|p| p.id() == id)
        .expect("validated position")
    {
        AxisPosition::Linear { position_mm, .. } => *position_mm = value,
        AxisPosition::Rotary { position_rad, .. } => *position_rad = value,
    }
}
fn get(state: &MachinePluginState, id: &str) -> f64 {
    state
        .positions
        .iter()
        .find(|p| p.id() == id)
        .expect("validated position")
        .value()
}
fn solve3(columns: [V; 3], rhs: V) -> Option<V> {
    let mut rows: [[f64; 4]; 3] =
        std::array::from_fn(|i| [columns[0][i], columns[1][i], columns[2][i], rhs[i]]);
    for i in 0..3 {
        let mut pivot = i;
        for j in i + 1..3 {
            if rows[j][i].abs() > rows[pivot][i].abs() {
                pivot = j;
            }
        }
        if !rows[pivot][i].is_finite() || rows[pivot][i].abs() < 1e-10 {
            return None;
        }
        rows.swap(i, pivot);
        let divisor = rows[i][i];
        for cell in rows[i].iter_mut().skip(i) {
            *cell /= divisor;
        }
        let pivot_row = rows[i];
        for (k, row) in rows.iter_mut().enumerate() {
            if k != i {
                let factor = row[i];
                for (cell, pivot_cell) in row.iter_mut().zip(pivot_row).skip(i) {
                    *cell -= factor * pivot_cell;
                }
            }
        }
    }
    Some(rows.map(|row| row[3]))
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "status",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum InverseResult {
    Solved {
        state: Box<MachinePluginState>,
        pose: FiveAxisPose,
        iterations: u32,
        position_error_mm: f64,
        orientation_error_rad: f64,
    },
    Failed {
        code: &'static str,
        iterations: u32,
    },
}
fn fail(code: &'static str, iterations: u32) -> InverseResult {
    InverseResult::Failed { code, iterations }
}
pub struct FiveAxisInverseKinematics {
    plugin: MachinePlugin,
    fk: FiveAxisKinematics,
    linear: Vec<KinematicAxis>,
    rotary: Vec<KinematicAxis>,
}
impl FiveAxisInverseKinematics {
    pub fn new(plugin: MachinePlugin) -> Result<Self, SimulationError> {
        let fk = FiveAxisKinematics::new(plugin.clone())?;
        let mut axes = plugin.machine.axes.clone();
        axes.sort_by(|a, b| a.id().cmp(b.id()));
        let (linear, rotary) = axes
            .into_iter()
            .partition(|a| matches!(a, KinematicAxis::Linear { .. }));
        Ok(Self {
            plugin,
            fk,
            linear,
            rotary,
        })
    }
    fn state(&self, input: &MachinePluginState) -> Result<MachinePluginState, SimulationError> {
        input
            .validate_for(&self.plugin)
            .map_err(|e| SimulationError::new("kinematics.ik.state", e.to_string()))?;
        let mut state = input.clone();
        state.positions.sort_by(|a, b| a.id().cmp(b.id()));
        Ok(state)
    }
    fn translate(
        &self,
        target: &FiveAxisTarget,
        mut state: MachinePluginState,
        iterations: u32,
    ) -> Result<InverseResult, SimulationError> {
        for axis in &self.linear {
            if let KinematicAxis::Linear { home_mm, .. } = axis {
                set(&mut state, axis.id(), *home_mm);
            }
        }
        let base = position(&self.fk.solve(&state)?.tcp_position_mm);
        let mut columns = [[0.0; 3]; 3];
        for (i, axis) in self.linear.iter().enumerate() {
            if let KinematicAxis::Linear {
                home_mm: q,
                min_mm,
                max_mm,
                ..
            } = axis
            {
                let probe = if q < max_mm {
                    max_mm.min(q + 1.0)
                } else {
                    min_mm.max(q - 1.0)
                };
                if probe == *q {
                    return Ok(fail("linear-singular", iterations));
                }
                set(&mut state, axis.id(), probe);
                let shifted = position(&self.fk.solve(&state)?.tcp_position_mm);
                set(&mut state, axis.id(), *q);
                columns[i] = sub(shifted, base).map(|v| v / (probe - q));
            }
        }
        let Some(delta) = solve3(columns, sub(position(&target.tcp_position_mm), base)) else {
            return Ok(fail("linear-singular", iterations));
        };
        if !delta.iter().all(|v| v.is_finite()) {
            return Ok(fail("nonfinite", iterations));
        }
        for (i, axis) in self.linear.iter().enumerate() {
            if let KinematicAxis::Linear {
                home_mm,
                min_mm,
                max_mm,
                ..
            } = axis
            {
                let q = home_mm + delta[i];
                if !q.is_finite() {
                    return Ok(fail("nonfinite", iterations));
                }
                if q < min_mm - POSITION_TOLERANCE_MM || q > max_mm + POSITION_TOLERANCE_MM {
                    return Ok(fail("linear-limit", iterations));
                }
                set(&mut state, axis.id(), q.clamp(*min_mm, *max_mm));
            }
        }
        let pose = self.fk.solve(&state)?;
        let position_error_mm = norm(sub(
            position(&pose.tcp_position_mm),
            position(&target.tcp_position_mm),
        ));
        let orientation_error_rad = angle(
            direction(&pose.tool_axis_unit),
            direction(&target.tool_axis_unit),
        );
        if position_error_mm > POSITION_TOLERANCE_MM
            || orientation_error_rad > ORIENTATION_TOLERANCE_RAD
        {
            return Ok(fail("residual-exceeded", iterations));
        }
        Ok(InverseResult::Solved {
            state: Box::new(state),
            pose,
            iterations,
            position_error_mm,
            orientation_error_rad,
        })
    }
    pub fn inverse(
        &self,
        target: &FiveAxisTarget,
        seed: &MachinePluginState,
    ) -> Result<InverseResult, SimulationError> {
        target
            .validate()
            .map_err(|e| SimulationError::new("kinematics.ik.target", e.to_string()))?;
        let state = self.state(seed)?;
        if !state.tcp_enabled {
            return Ok(fail("tcp-disabled", 0));
        }
        Ok(self
            .iterate(target, state)
            .unwrap_or_else(|_| fail("nonfinite", 0)))
    }
    fn iterate(
        &self,
        target: &FiveAxisTarget,
        mut state: MachinePluginState,
    ) -> Result<InverseResult, SimulationError> {
        let desired = direction(&target.tool_axis_unit);
        for iteration in 0..=ITERATIONS {
            let current = direction(&self.fk.solve(&state)?.tool_axis_unit);
            if angle(current, desired) <= ORIENTATION_SOLVE_TOLERANCE_RAD {
                return self.translate(target, state, iteration);
            }
            if iteration == ITERATIONS {
                break;
            }
            let residual = sub(desired, current);
            let mut columns = [[0.0; 3]; 2];
            for (i, axis) in self.rotary.iter().enumerate() {
                if let KinematicAxis::Rotary {
                    min_rad, max_rad, ..
                } = axis
                {
                    let q = get(&state, axis.id());
                    let lo = min_rad.max(q - 1e-5);
                    let hi = max_rad.min(q + 1e-5);
                    if hi == lo {
                        continue;
                    }
                    set(&mut state, axis.id(), lo);
                    let low = direction(&self.fk.solve(&state)?.tool_axis_unit);
                    set(&mut state, axis.id(), hi);
                    let high = direction(&self.fk.solve(&state)?.tool_axis_unit);
                    set(&mut state, axis.id(), q);
                    columns[i] = sub(high, low).map(|v| v / (hi - lo));
                }
            }
            let a = dot(columns[0], columns[0]) + 1e-8;
            let b = dot(columns[0], columns[1]);
            let c = dot(columns[1], columns[1]) + 1e-8;
            let u = dot(columns[0], residual);
            let v = dot(columns[1], residual);
            let determinant = a * c - b * b;
            let step = [(c * u - b * v) / determinant, (a * v - b * u) / determinant];
            if !step.iter().all(|v| v.is_finite()) {
                return Ok(fail("nonfinite", iteration));
            }
            let cap = 1.0_f64.max(step[0].abs() / 0.35).max(step[1].abs() / 0.35);
            let previous: Vec<_> = self
                .rotary
                .iter()
                .map(|axis| get(&state, axis.id()))
                .collect();
            let mut accepted = false;
            for attempt in 0..12 {
                for (i, axis) in self.rotary.iter().enumerate() {
                    if let KinematicAxis::Rotary {
                        min_rad, max_rad, ..
                    } = axis
                    {
                        set(
                            &mut state,
                            axis.id(),
                            (previous[i] + step[i] / cap / 2.0_f64.powi(attempt))
                                .clamp(*min_rad, *max_rad),
                        );
                    }
                }
                let next = sub(desired, direction(&self.fk.solve(&state)?.tool_axis_unit));
                if dot(next, next) < dot(residual, residual) {
                    accepted = true;
                    break;
                }
            }
            if !accepted {
                return Ok(fail("orientation-not-converged", iteration + 1));
            }
        }
        Ok(fail("orientation-not-converged", ITERATIONS))
    }
    pub fn compensate_tcp(
        &self,
        reference: &MachinePluginState,
        commanded: &MachinePluginState,
    ) -> Result<InverseResult, SimulationError> {
        let start = self.state(reference)?;
        let state = self.state(commanded)?;
        if !start.tcp_enabled || !state.tcp_enabled {
            return Ok(fail("tcp-disabled", 0));
        }
        if start.mode != state.mode {
            return Err(SimulationError::new(
                "kinematics.tcp.mode",
                "TCP compensation cannot change operation mode",
            ));
        }
        let evaluate = || {
            let old = self.fk.solve(&start)?;
            let rotated = self.fk.solve(&state)?;
            self.translate(
                &FiveAxisTarget {
                    tcp_position_mm: old.tcp_position_mm,
                    tool_axis_unit: rotated.tool_axis_unit,
                },
                state,
                0,
            )
        };
        Ok(evaluate().unwrap_or_else(|_| fail("nonfinite", 0)))
    }
}

use crate::SimulationError;
use cnc_render_contracts::{
    ContractValidate,
    domain::{DirectionUnit, KinematicAxis, Vec3Mm},
    machine_plugin::{MachinePlugin, MachinePluginState},
};
use serde::Serialize;

type V = [f64; 3];
#[derive(Clone, Copy)]
struct Rigid {
    r: [[f64; 3]; 3],
    t: V,
}
fn dot(a: V, b: V) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn add(a: V, b: V) -> V {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn neg(a: V) -> V {
    [-a[0], -a[1], -a[2]]
}
fn xyz(v: &Vec3Mm) -> V {
    [v.x_mm, v.y_mm, v.z_mm]
}
impl Rigid {
    fn translation(t: V) -> Self {
        Self {
            r: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            t,
        }
    }
    fn rotation(axis: V, angle: f64) -> Self {
        let length = axis[0].hypot(axis[1]).hypot(axis[2]);
        let [x, y, z] = axis.map(|v| v / length);
        let c = angle.cos();
        let s = angle.sin();
        let k = 1.0 - c;
        Self {
            r: [
                [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
                [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
                [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
            ],
            t: [0.0; 3],
        }
    }
    fn vector(self, v: V) -> V {
        self.r.map(|row| dot(row, v))
    }
    fn point(self, v: V) -> V {
        add(self.vector(v), self.t)
    }
    fn compose(self, rhs: Self) -> Self {
        let mut r = [[0.0; 3]; 3];
        for (i, row) in r.iter_mut().enumerate() {
            for (j, cell) in row.iter_mut().enumerate() {
                *cell = dot(self.r[i], [rhs.r[0][j], rhs.r[1][j], rhs.r[2][j]]);
            }
        }
        Self {
            r,
            t: self.point(rhs.t),
        }
    }
    fn inverse(self) -> Self {
        let r = std::array::from_fn(|i| std::array::from_fn(|j| self.r[j][i]));
        let mut inverse = Self { r, t: [0.0; 3] };
        inverse.t = neg(inverse.vector(self.t));
        inverse
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiveAxisPose {
    pub tcp_position_mm: Vec3Mm,
    pub tool_axis_unit: DirectionUnit,
}

pub struct FiveAxisKinematics {
    plugin: MachinePlugin,
}
impl FiveAxisKinematics {
    pub fn new(plugin: MachinePlugin) -> Result<Self, SimulationError> {
        plugin.validate().map_err(|e| {
            SimulationError::new("kinematics.five-axis.configuration", e.to_string())
        })?;
        Ok(Self { plugin })
    }
    fn chain(&self, ids: &[String], state: &MachinePluginState) -> Rigid {
        let mut frame = Rigid::translation([0.0; 3]);
        for id in ids {
            // Constructor and state validation prove these references exist.
            let axis = self
                .plugin
                .machine
                .axes
                .iter()
                .find(|a| a.id() == id)
                .expect("validated axis");
            let position = state
                .positions
                .iter()
                .find(|p| p.id() == id)
                .expect("validated position")
                .value();
            let motion = match axis {
                KinematicAxis::Linear {
                    direction_unit: d,
                    home_mm,
                    ..
                } => Rigid::translation([d.x, d.y, d.z].map(|v| v * (position - home_mm))),
                KinematicAxis::Rotary {
                    direction_unit: d,
                    pivot_mm,
                    home_rad,
                    ..
                } => {
                    let pivot = xyz(pivot_mm);
                    Rigid::translation(pivot)
                        .compose(Rigid::rotation([d.x, d.y, d.z], position - home_rad))
                        .compose(Rigid::translation(neg(pivot)))
                }
            };
            frame = frame.compose(motion);
        }
        frame
    }
    pub fn solve(&self, state: &MachinePluginState) -> Result<FiveAxisPose, SimulationError> {
        state
            .validate_for(&self.plugin)
            .map_err(|e| SimulationError::new("kinematics.five-axis.state", e.to_string()))?;
        let mount = &self.plugin.workpiece_mount;
        let r = &mount.rotation_rad;
        let work = self
            .chain(&self.plugin.workpiece_chain_axis_ids, state)
            .compose(Rigid::translation(xyz(&mount.position_mm)))
            .compose(Rigid::rotation([0.0, 0.0, 1.0], r.z_rad))
            .compose(Rigid::rotation([0.0, 1.0, 0.0], r.y_rad))
            .compose(Rigid::rotation([1.0, 0.0, 0.0], r.x_rad));
        let relative = work
            .inverse()
            .compose(self.chain(&self.plugin.tool_chain_axis_ids, state));
        let point = relative.point(xyz(&self.plugin.tool_mount.position_mm));
        let d = &self.plugin.tool_mount.tool_axis_unit;
        let direction = relative.vector([d.x, d.y, d.z]);
        let length = direction[0].hypot(direction[1]).hypot(direction[2]);
        if !point.iter().chain(direction.iter()).all(|v| v.is_finite())
            || !length.is_finite()
            || length == 0.0
        {
            return Err(SimulationError::new(
                "kinematics.five-axis.nonfinite",
                "FK produced a nonfinite or degenerate pose",
            ));
        }
        let clean = |v: f64| if v == 0.0 { 0.0 } else { v };
        let [x, y, z] = direction.map(|v| clean(v / length));
        Ok(FiveAxisPose {
            tcp_position_mm: Vec3Mm {
                x_mm: clean(point[0]),
                y_mm: clean(point[1]),
                z_mm: clean(point[2]),
            },
            tool_axis_unit: DirectionUnit { x, y, z },
        })
    }
}

#![forbid(unsafe_code)]

use cnc_render_contracts::domain::{
    DirectionUnit, KinematicAxis, MachineDefinition, MachineType, Vec3Mm,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error,
    fmt,
};

const NUMERIC_EPSILON: f64 = 1e-9;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SimulationError {
    pub code: String,
    pub message: String,
}

impl SimulationError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
        }
    }
}

impl fmt::Display for SimulationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl Error for SimulationError {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreeAxisPose {
    pub tcp_position_mm: Vec3Mm,
    pub axis_positions_mm: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AxisLimitDiagnostic {
    pub code: String,
    pub axis_id: String,
    pub actual_mm: f64,
    pub limit_mm: f64,
}

#[derive(Debug, Clone)]
struct LinearAxis {
    id: String,
    name: String,
    parent_id: Option<String>,
    direction_unit: DirectionUnit,
    min_mm: f64,
    max_mm: f64,
    home_mm: f64,
}

#[derive(Debug, Clone)]
pub struct ThreeAxisKinematics {
    axes: Vec<LinearAxis>,
    tcp_at_home_mm: Vec3Mm,
}

impl ThreeAxisKinematics {
    pub fn new(
        machine: &MachineDefinition,
        tcp_at_home_mm: Vec3Mm,
    ) -> Result<Self, SimulationError> {
        if machine.machine_type != MachineType::VerticalMachiningCenter {
            return Err(SimulationError::new(
                "kinematics.machine.type-unsupported",
                "M4 three-axis kinematics supports vertical machining centers only.",
            ));
        }
        if machine.axes.len() != 3 {
            return Err(SimulationError::new(
                "kinematics.axis.count",
                "M4 three-axis kinematics requires exactly three axes.",
            ));
        }
        if machine.kinematic_root_axis_ids.len() != 1 {
            return Err(SimulationError::new(
                "kinematics.axis.root-count",
                "M4 three-axis kinematics requires one kinematic root.",
            ));
        }
        if !finite_vec3(&tcp_at_home_mm) {
            return Err(SimulationError::new(
                "kinematics.tcp-home.invalid",
                "TCP-at-home coordinates must contain finite millimetre values.",
            ));
        }

        let mut axes = Vec::with_capacity(3);
        for axis in &machine.axes {
            let KinematicAxis::Linear {
                id,
                name,
                parent_id,
                direction_unit,
                min_mm,
                max_mm,
                home_mm,
                ..
            } = axis
            else {
                return Err(SimulationError::new(
                    "kinematics.axis.kind-unsupported",
                    "M4 three-axis kinematics accepts linear axes only.",
                ));
            };
            let direction_magnitude = (direction_unit.x * direction_unit.x
                + direction_unit.y * direction_unit.y
                + direction_unit.z * direction_unit.z)
                .sqrt();
            if !direction_magnitude.is_finite()
                || (direction_magnitude - 1.0).abs() > NUMERIC_EPSILON
                || !min_mm.is_finite()
                || !max_mm.is_finite()
                || !home_mm.is_finite()
                || min_mm >= max_mm
                || home_mm < min_mm
                || home_mm > max_mm
            {
                return Err(SimulationError::new(
                    "kinematics.axis.contract-invalid",
                    format!(
                        "Axis \"{name}\" requires a finite unit direction and ordered travel range."
                    ),
                ));
            }
            axes.push(LinearAxis {
                id: id.clone(),
                name: name.clone(),
                parent_id: parent_id.clone(),
                direction_unit: direction_unit.clone(),
                min_mm: *min_mm,
                max_mm: *max_mm,
                home_mm: *home_mm,
            });
        }

        let root_id = &machine.kinematic_root_axis_ids[0];
        let Some(root) = axes
            .iter()
            .find(|axis| &axis.id == root_id && axis.parent_id.is_none())
            .cloned()
        else {
            return Err(SimulationError::new(
                "kinematics.axis.chain-invalid",
                "The declared root must reference a parentless linear axis.",
            ));
        };

        let mut ordered = vec![root];
        while ordered.len() < axes.len() {
            let parent_id = ordered
                .last()
                .expect("ordered axes always contains the root")
                .id
                .as_str();
            let children = axes
                .iter()
                .filter(|axis| axis.parent_id.as_deref() == Some(parent_id))
                .cloned()
                .collect::<Vec<_>>();
            if children.len() != 1 {
                return Err(SimulationError::new(
                    "kinematics.axis.chain-invalid",
                    "M4 three-axis axes must form one unbranched parent-child chain.",
                ));
            }
            ordered.push(children[0].clone());
        }

        let unique_ids = ordered
            .iter()
            .map(|axis| axis.id.as_str())
            .collect::<BTreeSet<_>>();
        if unique_ids.len() != axes.len() {
            return Err(SimulationError::new(
                "kinematics.axis.chain-invalid",
                "M4 three-axis axes must form one connected parent-child chain.",
            ));
        }

        for left_index in 0..ordered.len() {
            for right_index in left_index + 1..ordered.len() {
                if dot(&ordered[left_index], &ordered[right_index]).abs() > NUMERIC_EPSILON {
                    return Err(SimulationError::new(
                        "kinematics.axis.direction-invalid",
                        "M4 three-axis directions must be mutually orthogonal.",
                    ));
                }
            }
        }

        Ok(Self {
            axes: ordered,
            tcp_at_home_mm,
        })
    }

    pub fn axis_order(&self) -> Vec<&str> {
        self.axes.iter().map(|axis| axis.id.as_str()).collect()
    }

    pub fn solve(
        &self,
        positions_mm: &BTreeMap<String, f64>,
    ) -> Result<ThreeAxisPose, SimulationError> {
        for axis_id in positions_mm.keys() {
            if !self.axes.iter().any(|axis| &axis.id == axis_id) {
                return Err(SimulationError::new(
                    "kinematics.axis.position-unknown",
                    format!("Unknown axis position \"{axis_id}\"."),
                ));
            }
        }

        let mut tcp = self.tcp_at_home_mm.clone();
        let mut ordered_positions = BTreeMap::new();
        for axis in &self.axes {
            let Some(position_mm) = positions_mm.get(&axis.id).copied() else {
                return Err(SimulationError::new(
                    "kinematics.axis.position-missing",
                    format!("Axis \"{}\" is missing a position.", axis.name),
                ));
            };
            if !position_mm.is_finite() {
                return Err(SimulationError::new(
                    "kinematics.axis.position-nonfinite",
                    format!("Axis \"{}\" position must be finite.", axis.name),
                ));
            }

            let displacement_mm = position_mm - axis.home_mm;
            tcp.x_mm = normalized_zero(tcp.x_mm + axis.direction_unit.x * displacement_mm);
            tcp.y_mm = normalized_zero(tcp.y_mm + axis.direction_unit.y * displacement_mm);
            tcp.z_mm = normalized_zero(tcp.z_mm + axis.direction_unit.z * displacement_mm);
            ordered_positions.insert(axis.id.clone(), normalized_zero(position_mm));
        }

        Ok(ThreeAxisPose {
            tcp_position_mm: tcp,
            axis_positions_mm: ordered_positions,
        })
    }

    pub fn position_diagnostics(
        &self,
        positions_mm: &BTreeMap<String, f64>,
    ) -> Result<Vec<AxisLimitDiagnostic>, SimulationError> {
        self.solve(positions_mm)?;
        let mut diagnostics = Vec::new();
        for axis in &self.axes {
            let position_mm = positions_mm[&axis.id];
            if position_mm < axis.min_mm - NUMERIC_EPSILON {
                diagnostics.push(AxisLimitDiagnostic {
                    code: "kinematics.axis.limit-min".to_owned(),
                    axis_id: axis.id.clone(),
                    actual_mm: position_mm,
                    limit_mm: axis.min_mm,
                });
            }
            if position_mm > axis.max_mm + NUMERIC_EPSILON {
                diagnostics.push(AxisLimitDiagnostic {
                    code: "kinematics.axis.limit-max".to_owned(),
                    axis_id: axis.id.clone(),
                    actual_mm: position_mm,
                    limit_mm: axis.max_mm,
                });
            }
        }
        Ok(diagnostics)
    }
}

fn finite_vec3(value: &Vec3Mm) -> bool {
    value.x_mm.is_finite() && value.y_mm.is_finite() && value.z_mm.is_finite()
}

fn dot(left: &LinearAxis, right: &LinearAxis) -> f64 {
    left.direction_unit.x * right.direction_unit.x
        + left.direction_unit.y * right.direction_unit.y
        + left.direction_unit.z * right.direction_unit.z
}

fn normalized_zero(value: f64) -> f64 {
    if value == 0.0 { 0.0 } else { value }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixture {
        machine: MachineDefinition,
        tcp_at_home_mm: Vec3Mm,
        poses: Vec<GoldenPose>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenPose {
        axis_positions_mm: BTreeMap<String, f64>,
        expected_tcp_position_mm: Vec3Mm,
    }

    fn fixture() -> Fixture {
        serde_json::from_str(include_str!(
            "../../../tests/fixtures/machines/vmc-3axis/golden-poses.json"
        ))
        .expect("golden pose fixture must deserialize")
    }

    #[test]
    fn matches_all_golden_poses() {
        let fixture = fixture();
        let kinematics = ThreeAxisKinematics::new(&fixture.machine, fixture.tcp_at_home_mm)
            .expect("fixture machine must be supported");

        for golden in fixture.poses {
            let actual = kinematics
                .solve(&golden.axis_positions_mm)
                .expect("golden positions must solve");
            assert_eq!(actual.tcp_position_mm, golden.expected_tcp_position_mm);
            assert!(
                kinematics
                    .position_diagnostics(&golden.axis_positions_mm)
                    .expect("golden positions must validate")
                    .is_empty()
            );
        }
    }

    #[test]
    fn rejects_unknown_axis_fail_closed() {
        let fixture = fixture();
        let kinematics = ThreeAxisKinematics::new(&fixture.machine, fixture.tcp_at_home_mm)
            .expect("fixture machine must be supported");
        let mut positions = fixture.poses[0].axis_positions_mm.clone();
        positions.insert("unknown".to_owned(), 0.0);

        let error = kinematics
            .solve(&positions)
            .expect_err("unknown axes must fail closed");
        assert_eq!(error.code, "kinematics.axis.position-unknown");
    }
}

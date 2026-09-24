use crate::domain::{
    self, ContractValidate, DirectionUnit, KinematicAxis, MachineDefinition, MachineType,
    Transform, Vec3Mm,
};
use crate::{ContractError, ContractResult};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Architecture {
    TableTable,
    HeadTable,
    HeadHead,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FiveAxisMode {
    #[serde(rename = "3plus2")]
    Indexed,
    #[serde(rename = "simultaneous-5axis")]
    Simultaneous,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TcpSupport {
    Supported,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capabilities {
    pub modes: Vec<FiveAxisMode>,
    pub tcp: TcpSupport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolMount {
    pub position_mm: Vec3Mm,
    pub tool_axis_unit: DirectionUnit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiveAxisTarget {
    pub tcp_position_mm: Vec3Mm,
    pub tool_axis_unit: DirectionUnit,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RewindDirection {
    Positive,
    Negative,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RewindRequest {
    pub axis_id: String,
    pub direction: RewindDirection,
    pub retract_distance_mm: f64,
}
impl ContractValidate for RewindRequest {
    fn validate(&self) -> ContractResult<()> {
        domain::validate_uuid(&self.axis_id, "$.axisId")?;
        require(
            self.retract_distance_mm.is_finite()
                && self.retract_distance_mm > 0.0
                && self.retract_distance_mm <= 500.0,
            "retract distance must be in (0,500] mm",
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SolutionWeights {
    pub axis_travel: u32,
    pub limit_penalty: u32,
    pub singularity_risk: u32,
}
impl Default for SolutionWeights {
    fn default() -> Self {
        Self {
            axis_travel: 10,
            limit_penalty: 1,
            singularity_risk: 2,
        }
    }
}
impl ContractValidate for SolutionWeights {
    fn validate(&self) -> ContractResult<()> {
        require(
            self.axis_travel <= 1000 && self.limit_penalty <= 1000 && self.singularity_risk <= 1000,
            "weights must be integers in 0..=1000",
        )?;
        require(
            self.axis_travel + self.limit_penalty + self.singularity_risk > 0,
            "at least one weight must be positive",
        )
    }
}
impl ContractValidate for FiveAxisTarget {
    fn validate(&self) -> ContractResult<()> {
        domain::validate_vec3(&self.tcp_position_mm, "$.tcpPositionMm")?;
        domain::validate_direction(&self.tool_axis_unit, "$.toolAxisUnit")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MachinePlugin {
    pub contract_version: u32,
    pub plugin_id: String,
    pub plugin_version: String,
    pub architecture: Architecture,
    pub machine: MachineDefinition,
    pub capabilities: Capabilities,
    pub tool_chain_axis_ids: Vec<String>,
    pub workpiece_chain_axis_ids: Vec<String>,
    pub tool_mount: ToolMount,
    pub workpiece_mount: Transform,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AxisPosition {
    Linear { axis_id: String, position_mm: f64 },
    Rotary { axis_id: String, position_rad: f64 },
}
impl AxisPosition {
    pub fn id(&self) -> &str {
        match self {
            Self::Linear { axis_id, .. } | Self::Rotary { axis_id, .. } => axis_id,
        }
    }
    pub fn value(&self) -> f64 {
        match self {
            Self::Linear { position_mm, .. } => *position_mm,
            Self::Rotary { position_rad, .. } => *position_rad,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MachinePluginState {
    pub contract_version: u32,
    pub plugin_id: String,
    pub plugin_version: String,
    pub machine_id: String,
    pub mode: FiveAxisMode,
    pub tcp_enabled: bool,
    pub positions: Vec<AxisPosition>,
}

fn require(condition: bool, message: &str) -> ContractResult<()> {
    if condition {
        Ok(())
    } else {
        Err(ContractError {
            code: "machine-plugin.invalid",
            path: "$".into(),
            message: message.into(),
        })
    }
}

impl ContractValidate for MachinePlugin {
    fn validate(&self) -> ContractResult<()> {
        require(self.contract_version == 1, "unsupported contract version")?;
        require(
            !self.plugin_id.is_empty()
                && self.plugin_id.len() <= 128
                && self.plugin_id.split(['.', '-']).all(|part| {
                    !part.is_empty()
                        && part
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
                }),
            "invalid plugin ID",
        )?;
        let version: Vec<_> = self.plugin_version.split('.').collect();
        require(
            self.plugin_version.len() <= 32
                && version.len() == 3
                && version
                    .iter()
                    .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit())),
            "invalid plugin version",
        )?;
        domain::validate_machine(&self.machine, "$.machine")?;
        domain::validate_vec3(&self.tool_mount.position_mm, "$.toolMount.positionMm")?;
        domain::validate_direction(&self.tool_mount.tool_axis_unit, "$.toolMount.toolAxisUnit")?;
        domain::validate_transform(&self.workpiece_mount, "$.workpieceMount")?;
        require(
            matches!(
                self.machine.machine_type,
                MachineType::VerticalMachiningCenter | MachineType::HorizontalMachiningCenter
            ),
            "machining center required",
        )?;
        require(
            self.machine.axes.len() == 5
                && self
                    .machine
                    .axes
                    .iter()
                    .filter(|a| matches!(a, KinematicAxis::Rotary { .. }))
                    .count()
                    == 2,
            "three linear and two rotary axes required",
        )?;
        require(
            !self.capabilities.modes.is_empty()
                && self.capabilities.modes.len() <= 2
                && (self.capabilities.modes.len() == 1
                    || self.capabilities.modes[0] != self.capabilities.modes[1]),
            "invalid modes",
        )?;
        let axes: BTreeMap<_, _> = self.machine.axes.iter().map(|a| (a.id(), a)).collect();
        require(axes.len() == 5, "duplicate axes")?;
        let mut used = BTreeSet::new();
        for chain in [&self.tool_chain_axis_ids, &self.workpiece_chain_axis_ids] {
            require(chain.len() <= 5, "chain too long")?;
            let mut parent = None;
            for id in chain {
                let axis = axes.get(id.as_str()).ok_or_else(|| ContractError {
                    code: "machine-plugin.invalid",
                    path: "$".into(),
                    message: "unknown axis".into(),
                })?;
                require(
                    used.insert(id.as_str()) && axis.parent_id() == parent,
                    "invalid chain",
                )?;
                parent = Some(id.as_str());
            }
        }
        require(used.len() == 5, "missing axis")?;
        let roots: BTreeSet<_> = self
            .machine
            .axes
            .iter()
            .filter(|a| a.parent_id().is_none())
            .map(|a| a.id())
            .collect();
        let declared: BTreeSet<_> = self
            .machine
            .kinematic_root_axis_ids
            .iter()
            .map(String::as_str)
            .collect();
        require(
            roots == declared && declared.len() == self.machine.kinematic_root_axis_ids.len(),
            "invalid roots",
        )?;
        let heads = self
            .tool_chain_axis_ids
            .iter()
            .filter(|id| matches!(axes[id.as_str()], KinematicAxis::Rotary { .. }))
            .count();
        require(
            heads
                == match self.architecture {
                    Architecture::TableTable => 0,
                    Architecture::HeadTable => 1,
                    Architecture::HeadHead => 2,
                },
            "architecture mismatch",
        )?;
        let min = &self.machine.work_envelope.min_mm;
        let max = &self.machine.work_envelope.max_mm;
        require(
            min.x_mm < max.x_mm && min.y_mm < max.y_mm && min.z_mm < max.z_mm,
            "invalid envelope",
        )
    }
}

impl MachinePluginState {
    pub fn validate_for(&self, plugin: &MachinePlugin) -> ContractResult<()> {
        require(
            self.contract_version == 1
                && self.plugin_id == plugin.plugin_id
                && self.plugin_version == plugin.plugin_version
                && self.machine_id == plugin.machine.id,
            "state identity mismatch",
        )?;
        require(
            plugin.capabilities.modes.contains(&self.mode)
                && (!self.tcp_enabled || plugin.capabilities.tcp == TcpSupport::Supported),
            "unsupported mode or TCP",
        )?;
        require(self.positions.len() == 5, "five positions required")?;
        let mut used = BTreeSet::new();
        for position in &self.positions {
            let value = position.value();
            require(
                value.is_finite()
                    && !(value == 0.0 && value.is_sign_negative())
                    && used.insert(position.id()),
                "invalid or duplicate position",
            )?;
            let valid = match (
                plugin.machine.axes.iter().find(|a| a.id() == position.id()),
                position,
            ) {
                (
                    Some(KinematicAxis::Linear { min_mm, max_mm, .. }),
                    AxisPosition::Linear { .. },
                ) => value >= *min_mm && value <= *max_mm,
                (
                    Some(KinematicAxis::Rotary {
                        min_rad, max_rad, ..
                    }),
                    AxisPosition::Rotary { .. },
                ) => value >= *min_rad && value <= *max_rad,
                _ => false,
            };
            require(valid, "unknown axis, wrong unit or travel exceeded")?;
        }
        Ok(())
    }
}

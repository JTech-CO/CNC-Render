use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use unicode_normalization::UnicodeNormalization;

use crate::{
    PROJECT_SCHEMA_ID, SCHEMA_VERSION,
    canonical::semantic_hash,
    validation::{ContractError, ContractResult},
};

pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub trait ContractValidate {
    fn validate(&self) -> ContractResult<()>;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Vec3Mm {
    pub x_mm: f64,
    pub y_mm: f64,
    pub z_mm: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectionUnit {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RotationRad {
    pub x_rad: f64,
    pub y_rad: f64,
    pub z_rad: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Transform {
    pub position_mm: Vec3Mm,
    pub rotation_rad: RotationRad,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceRole {
    GcodeProgram,
    MachineModel,
    StockModel,
    TargetModel,
    Toolpath,
    Checkpoint,
    Preview,
    Report,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceDescriptor {
    pub schema_version: u32,
    pub id: String,
    pub path: String,
    pub role: ResourceRole,
    pub media_type: String,
    pub byte_length: u64,
    pub sha256: String,
    pub authoritative: bool,
}

impl ContractValidate for ResourceDescriptor {
    fn validate(&self) -> ContractResult<()> {
        validate_resource(self, "$")
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum KinematicAxis {
    Linear {
        schema_version: u32,
        id: String,
        name: String,
        #[serde(deserialize_with = "crate::required_nullable::deserialize")]
        parent_id: Option<String>,
        direction_unit: DirectionUnit,
        pivot_mm: Vec3Mm,
        min_mm: f64,
        max_mm: f64,
        max_velocity_mm_per_min: f64,
        max_acceleration_mm_per_s2: f64,
        home_mm: f64,
    },
    Rotary {
        schema_version: u32,
        id: String,
        name: String,
        #[serde(deserialize_with = "crate::required_nullable::deserialize")]
        parent_id: Option<String>,
        direction_unit: DirectionUnit,
        pivot_mm: Vec3Mm,
        min_rad: f64,
        max_rad: f64,
        max_velocity_rad_per_s: f64,
        max_acceleration_rad_per_s2: f64,
        home_rad: f64,
    },
}

impl KinematicAxis {
    pub fn id(&self) -> &str {
        match self {
            Self::Linear { id, .. } | Self::Rotary { id, .. } => id,
        }
    }

    pub fn parent_id(&self) -> Option<&str> {
        match self {
            Self::Linear { parent_id, .. } | Self::Rotary { parent_id, .. } => parent_id.as_deref(),
        }
    }

    fn validate_at(&self, path: &str) -> ContractResult<()> {
        match self {
            Self::Linear {
                schema_version,
                id,
                name,
                parent_id,
                direction_unit,
                pivot_mm,
                min_mm,
                max_mm,
                max_velocity_mm_per_min,
                max_acceleration_mm_per_s2,
                home_mm,
            } => {
                validate_schema_version(*schema_version, &field(path, "schemaVersion"))?;
                validate_uuid(id, &field(path, "id"))?;
                validate_text(name, 1, 64, &field(path, "name"))?;
                validate_optional_uuid(parent_id, &field(path, "parentId"))?;
                validate_direction(direction_unit, &field(path, "directionUnit"))?;
                validate_vec3(pivot_mm, &field(path, "pivotMm"))?;
                validate_finite(*min_mm, &field(path, "minMm"))?;
                validate_finite(*max_mm, &field(path, "maxMm"))?;
                validate_positive(
                    *max_velocity_mm_per_min,
                    &field(path, "maxVelocityMmPerMin"),
                )?;
                validate_positive(
                    *max_acceleration_mm_per_s2,
                    &field(path, "maxAccelerationMmPerS2"),
                )?;
                validate_finite(*home_mm, &field(path, "homeMm"))?;
                validate_ordered_range(*min_mm, *max_mm, *home_mm, path)
            }
            Self::Rotary {
                schema_version,
                id,
                name,
                parent_id,
                direction_unit,
                pivot_mm,
                min_rad,
                max_rad,
                max_velocity_rad_per_s,
                max_acceleration_rad_per_s2,
                home_rad,
            } => {
                validate_schema_version(*schema_version, &field(path, "schemaVersion"))?;
                validate_uuid(id, &field(path, "id"))?;
                validate_text(name, 1, 64, &field(path, "name"))?;
                validate_optional_uuid(parent_id, &field(path, "parentId"))?;
                validate_direction(direction_unit, &field(path, "directionUnit"))?;
                validate_vec3(pivot_mm, &field(path, "pivotMm"))?;
                validate_finite(*min_rad, &field(path, "minRad"))?;
                validate_finite(*max_rad, &field(path, "maxRad"))?;
                validate_positive(*max_velocity_rad_per_s, &field(path, "maxVelocityRadPerS"))?;
                validate_positive(
                    *max_acceleration_rad_per_s2,
                    &field(path, "maxAccelerationRadPerS2"),
                )?;
                validate_finite(*home_rad, &field(path, "homeRad"))?;
                validate_ordered_range(*min_rad, *max_rad, *home_rad, path)
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpindleDefinition {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub max_spindle_speed_rpm: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkEnvelope {
    pub min_mm: Vec3Mm,
    pub max_mm: Vec3Mm,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollisionGroup {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub member_resource_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MachineType {
    VerticalMachiningCenter,
    HorizontalMachiningCenter,
    Lathe,
    MillTurn,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MachineDefinition {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub machine_type: MachineType,
    pub kinematic_root_axis_ids: Vec<String>,
    pub axes: Vec<KinematicAxis>,
    pub spindles: Vec<SpindleDefinition>,
    pub work_envelope: WorkEnvelope,
    pub max_feed_mm_per_min: f64,
    #[serde(deserialize_with = "crate::required_nullable::deserialize")]
    pub model_asset_resource_id: Option<String>,
    pub collision_groups: Vec<CollisionGroup>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MaterialGroup {
    Aluminum,
    Steel,
    StainlessSteel,
    Titanium,
    Brass,
    Plastic,
    Wood,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialProfile {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub material_group: MaterialGroup,
    pub density_kg_per_m3: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Setup {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub work_offset_mm: Vec3Mm,
    pub rotation_rad: RotationRad,
    pub fixture_resource_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CutterGeometryType {
    FlatEndMill,
    BallEndMill,
    BullNoseEndMill,
    Drill,
    TurningInsert,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CutterGeometry {
    pub geometry_type: CutterGeometryType,
    pub diameter_mm: f64,
    pub corner_radius_mm: f64,
    pub flute_count: u64,
    pub cutting_length_mm: f64,
    pub overall_length_mm: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HolderGeometry {
    pub diameter_mm: f64,
    pub length_mm: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolType {
    MillingCutter,
    Drill,
    TurningTool,
    BoringBar,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolAssembly {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub tool_type: ToolType,
    pub cutter_geometry: CutterGeometry,
    pub holder_geometry: HolderGeometry,
    pub gauge_length_mm: f64,
    pub stickout_length_mm: f64,
    pub max_spindle_speed_rpm: f64,
    pub wear_ratio: f64,
    pub material_compatibility_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "primitiveType",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum StockGeometry {
    Box { size_mm: BoxSizeMm },
    Cylinder { diameter_mm: f64, length_mm: f64 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoxSizeMm {
    pub x_mm: f64,
    pub y_mm: f64,
    pub z_mm: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StockRepresentationType {
    Analytic,
    Mesh,
    Dexel,
    Voxel,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stock {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub geometry: StockGeometry,
    pub transform: Transform,
    pub material_id: String,
    pub representation_type: StockRepresentationType,
    pub resolution_mm: f64,
    #[serde(deserialize_with = "crate::required_nullable::deserialize")]
    pub source_model_resource_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FeedDefinition {
    PerMinute { feed_mm_per_min: f64 },
    PerRevolution { feed_mm_per_rev: f64 },
    PerTooth { feed_mm_per_tooth: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OperationType {
    Milling,
    Drilling,
    Turning,
    Facing,
    Boring,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpindleDirection {
    Clockwise,
    Counterclockwise,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Operation {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub operation_type: OperationType,
    pub setup_id: String,
    pub tool_assembly_id: String,
    pub strategy: String,
    pub feed: FeedDefinition,
    pub spindle_speed_rpm: f64,
    pub spindle_direction: SpindleDirection,
    pub depth_of_cut_mm: f64,
    pub width_of_cut_mm: f64,
    #[serde(deserialize_with = "crate::required_nullable::deserialize")]
    pub target_geometry_resource_id: Option<String>,
    #[serde(deserialize_with = "crate::required_nullable::deserialize")]
    pub generated_toolpath_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ArcPlane {
    Xy,
    Xz,
    Yz,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "segmentType",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ToolpathSegment {
    Rapid {
        schema_version: u32,
        id: String,
        sequence: u64,
        start_mm: Vec3Mm,
        end_mm: Vec3Mm,
    },
    Linear {
        schema_version: u32,
        id: String,
        sequence: u64,
        start_mm: Vec3Mm,
        end_mm: Vec3Mm,
        feed_mm_per_min: f64,
    },
    Arc {
        schema_version: u32,
        id: String,
        sequence: u64,
        start_mm: Vec3Mm,
        end_mm: Vec3Mm,
        center_offset_mm: Vec3Mm,
        plane: ArcPlane,
        clockwise: bool,
        feed_mm_per_min: f64,
    },
    Dwell {
        schema_version: u32,
        id: String,
        sequence: u64,
        position_mm: Vec3Mm,
        duration_s: f64,
    },
    ToolChange {
        schema_version: u32,
        id: String,
        sequence: u64,
        position_mm: Vec3Mm,
        tool_assembly_id: String,
    },
}

impl ToolpathSegment {
    pub fn id(&self) -> &str {
        match self {
            Self::Rapid { id, .. }
            | Self::Linear { id, .. }
            | Self::Arc { id, .. }
            | Self::Dwell { id, .. }
            | Self::ToolChange { id, .. } => id,
        }
    }

    fn validate_at(&self, path: &str) -> ContractResult<()> {
        match self {
            Self::Rapid {
                schema_version,
                id,
                sequence,
                start_mm,
                end_mm,
            } => {
                validate_segment_base(*schema_version, id, *sequence, path)?;
                validate_vec3(start_mm, &field(path, "startMm"))?;
                validate_vec3(end_mm, &field(path, "endMm"))
            }
            Self::Linear {
                schema_version,
                id,
                sequence,
                start_mm,
                end_mm,
                feed_mm_per_min,
            } => {
                validate_segment_base(*schema_version, id, *sequence, path)?;
                validate_vec3(start_mm, &field(path, "startMm"))?;
                validate_vec3(end_mm, &field(path, "endMm"))?;
                validate_positive(*feed_mm_per_min, &field(path, "feedMmPerMin"))
            }
            Self::Arc {
                schema_version,
                id,
                sequence,
                start_mm,
                end_mm,
                center_offset_mm,
                feed_mm_per_min,
                ..
            } => {
                validate_segment_base(*schema_version, id, *sequence, path)?;
                validate_vec3(start_mm, &field(path, "startMm"))?;
                validate_vec3(end_mm, &field(path, "endMm"))?;
                validate_vec3(center_offset_mm, &field(path, "centerOffsetMm"))?;
                validate_positive(*feed_mm_per_min, &field(path, "feedMmPerMin"))
            }
            Self::Dwell {
                schema_version,
                id,
                sequence,
                position_mm,
                duration_s,
            } => {
                validate_segment_base(*schema_version, id, *sequence, path)?;
                validate_vec3(position_mm, &field(path, "positionMm"))?;
                validate_positive(*duration_s, &field(path, "durationS"))
            }
            Self::ToolChange {
                schema_version,
                id,
                sequence,
                position_mm,
                tool_assembly_id,
            } => {
                validate_segment_base(*schema_version, id, *sequence, path)?;
                validate_vec3(position_mm, &field(path, "positionMm"))?;
                validate_uuid(tool_assembly_id, &field(path, "toolAssemblyId"))
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceLineMapEntry {
    pub segment_id: String,
    pub source_line: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CoordinateSystem {
    Machine,
    Work,
    Tool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolpathFeedMode {
    UnitsPerMinute,
    UnitsPerRevolution,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpindleMode {
    Rpm,
    SurfaceSpeed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolpathIr {
    pub schema_version: u32,
    pub id: String,
    pub operation_id: String,
    pub coordinate_system: CoordinateSystem,
    pub feed_mode: ToolpathFeedMode,
    pub spindle_mode: SpindleMode,
    pub segments: Vec<ToolpathSegment>,
    pub source_line_map: Vec<SourceLineMapEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AccuracyPreset {
    Preview,
    Balanced,
    Precision,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectSettings {
    pub schema_version: u32,
    pub accuracy_preset: AccuracyPreset,
    pub display_decimal_places: u64,
    pub deterministic_seed: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnitSystem {
    Metric,
    Imperial,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Project {
    #[serde(rename = "$schema")]
    pub schema: String,
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub unit_system: UnitSystem,
    pub machine_id: String,
    pub stock_id: String,
    pub operation_ids: Vec<String>,
    pub machines: Vec<MachineDefinition>,
    pub materials: Vec<MaterialProfile>,
    pub setups: Vec<Setup>,
    pub tool_assemblies: Vec<ToolAssembly>,
    pub stocks: Vec<Stock>,
    pub operations: Vec<Operation>,
    pub toolpaths: Vec<ToolpathIr>,
    pub resources: Vec<ResourceDescriptor>,
    pub settings: ProjectSettings,
}

impl Project {
    pub fn from_json_str(input: &str) -> ContractResult<Self> {
        let project: Self = serde_json::from_str(input)
            .map_err(|error| ContractError::new("project.deserialize", "$", error.to_string()))?;
        project.validate()?;
        Ok(project)
    }

    pub fn from_json_value(value: Value) -> ContractResult<Self> {
        let project: Self = serde_json::from_value(value)
            .map_err(|error| ContractError::new("project.deserialize", "$", error.to_string()))?;
        project.validate()?;
        Ok(project)
    }

    pub fn to_json_value(&self) -> ContractResult<Value> {
        serde_json::to_value(self)
            .map_err(|error| ContractError::new("project.serialize", "$", error.to_string()))
    }

    pub fn semantic_hash(&self) -> ContractResult<String> {
        self.validate()?;
        semantic_hash(&self.to_json_value()?)
    }
}

impl ContractValidate for Project {
    fn validate(&self) -> ContractResult<()> {
        if self.schema != PROJECT_SCHEMA_ID {
            return contract_error(
                "schema.id",
                "$.$schema",
                format!("expected {PROJECT_SCHEMA_ID}"),
            );
        }
        validate_schema_version(self.schema_version, "$.schemaVersion")?;
        validate_uuid(&self.id, "$.id")?;
        validate_text(&self.name, 1, 200, "$.name")?;
        validate_utc_datetime(&self.created_at, "$.createdAt")?;
        validate_utc_datetime(&self.updated_at, "$.updatedAt")?;
        validate_uuid(&self.machine_id, "$.machineId")?;
        validate_uuid(&self.stock_id, "$.stockId")?;
        validate_uuid_list(&self.operation_ids, "$.operationIds")?;

        if self.machines.is_empty() {
            return contract_error(
                "array.too_small",
                "$.machines",
                "machines must contain at least one entry",
            );
        }
        if self.materials.is_empty() {
            return contract_error(
                "array.too_small",
                "$.materials",
                "materials must contain at least one entry",
            );
        }
        if self.setups.is_empty() {
            return contract_error(
                "array.too_small",
                "$.setups",
                "setups must contain at least one entry",
            );
        }
        if self.tool_assemblies.is_empty() {
            return contract_error(
                "array.too_small",
                "$.toolAssemblies",
                "toolAssemblies must contain at least one entry",
            );
        }
        if self.stocks.is_empty() {
            return contract_error(
                "array.too_small",
                "$.stocks",
                "stocks must contain at least one entry",
            );
        }

        for (index, machine) in self.machines.iter().enumerate() {
            validate_machine(machine, &index_path("$.machines", index))?;
        }
        for (index, material) in self.materials.iter().enumerate() {
            validate_material(material, &index_path("$.materials", index))?;
        }
        for (index, setup) in self.setups.iter().enumerate() {
            validate_setup(setup, &index_path("$.setups", index))?;
        }
        for (index, tool) in self.tool_assemblies.iter().enumerate() {
            validate_tool(tool, &index_path("$.toolAssemblies", index))?;
        }
        for (index, stock) in self.stocks.iter().enumerate() {
            validate_stock(stock, &index_path("$.stocks", index))?;
        }
        for (index, operation) in self.operations.iter().enumerate() {
            validate_operation(operation, &index_path("$.operations", index))?;
        }
        for (index, toolpath) in self.toolpaths.iter().enumerate() {
            validate_toolpath(toolpath, &index_path("$.toolpaths", index))?;
        }
        for (index, resource) in self.resources.iter().enumerate() {
            validate_resource(resource, &index_path("$.resources", index))?;
        }
        validate_settings(&self.settings, "$.settings")?;
        crate::semantic::validate_project_semantics(self)?;

        self.validate_references()
    }
}

impl Project {
    fn validate_references(&self) -> ContractResult<()> {
        let resources = index_ids(
            self.resources
                .iter()
                .enumerate()
                .map(|(index, value)| (value.id.as_str(), index)),
            "$.resources",
        )?;
        let machines = index_ids(
            self.machines
                .iter()
                .enumerate()
                .map(|(index, value)| (value.id.as_str(), index)),
            "$.machines",
        )?;
        let materials = index_ids(
            self.materials
                .iter()
                .enumerate()
                .map(|(index, value)| (value.id.as_str(), index)),
            "$.materials",
        )?;
        let setups = index_ids(
            self.setups
                .iter()
                .enumerate()
                .map(|(index, value)| (value.id.as_str(), index)),
            "$.setups",
        )?;
        let tools = index_ids(
            self.tool_assemblies
                .iter()
                .enumerate()
                .map(|(index, value)| (value.id.as_str(), index)),
            "$.toolAssemblies",
        )?;
        let stocks = index_ids(
            self.stocks
                .iter()
                .enumerate()
                .map(|(index, value)| (value.id.as_str(), index)),
            "$.stocks",
        )?;
        let operations = index_ids(
            self.operations
                .iter()
                .enumerate()
                .map(|(index, value)| (value.id.as_str(), index)),
            "$.operations",
        )?;
        let toolpaths = index_ids(
            self.toolpaths
                .iter()
                .enumerate()
                .map(|(index, value)| (value.id.as_str(), index)),
            "$.toolpaths",
        )?;

        require_reference(&machines, &self.machine_id, "$.machineId", "machines")?;
        require_reference(&stocks, &self.stock_id, "$.stockId", "stocks")?;

        let mut ordered_operations = HashSet::new();
        for (index, operation_id) in self.operation_ids.iter().enumerate() {
            if !ordered_operations.insert(operation_id.as_str()) {
                return contract_error(
                    "id.duplicate",
                    index_path("$.operationIds", index),
                    "operationIds must be unique",
                );
            }
            require_reference(
                &operations,
                operation_id,
                &index_path("$.operationIds", index),
                "operations",
            )?;
        }

        for (machine_index, machine) in self.machines.iter().enumerate() {
            validate_axis_graph(machine, machine_index)?;
            if let Some(resource_id) = &machine.model_asset_resource_id {
                require_reference(
                    &resources,
                    resource_id,
                    &format!(
                        "{}.modelAssetResourceId",
                        index_path("$.machines", machine_index)
                    ),
                    "resources",
                )?;
            }
        }

        for (tool_index, tool) in self.tool_assemblies.iter().enumerate() {
            for material_id in &tool.material_compatibility_ids {
                require_reference(
                    &materials,
                    material_id,
                    &format!(
                        "{}.materialCompatibilityIds",
                        index_path("$.toolAssemblies", tool_index)
                    ),
                    "materials",
                )?;
            }
        }

        for (setup_index, setup) in self.setups.iter().enumerate() {
            for resource_id in &setup.fixture_resource_ids {
                require_reference(
                    &resources,
                    resource_id,
                    &format!("{}.fixtureResourceIds", index_path("$.setups", setup_index)),
                    "resources",
                )?;
            }
        }

        for (stock_index, stock) in self.stocks.iter().enumerate() {
            require_reference(
                &materials,
                &stock.material_id,
                &format!("{}.materialId", index_path("$.stocks", stock_index)),
                "materials",
            )?;
            if let Some(resource_id) = &stock.source_model_resource_id {
                require_reference(
                    &resources,
                    resource_id,
                    &format!(
                        "{}.sourceModelResourceId",
                        index_path("$.stocks", stock_index)
                    ),
                    "resources",
                )?;
            }
        }

        for (operation_index, operation) in self.operations.iter().enumerate() {
            let operation_path = index_path("$.operations", operation_index);
            require_reference(
                &setups,
                &operation.setup_id,
                &format!("{operation_path}.setupId"),
                "setups",
            )?;
            require_reference(
                &tools,
                &operation.tool_assembly_id,
                &format!("{operation_path}.toolAssemblyId"),
                "toolAssemblies",
            )?;
            if let Some(resource_id) = &operation.target_geometry_resource_id {
                require_reference(
                    &resources,
                    resource_id,
                    &format!("{operation_path}.targetGeometryResourceId"),
                    "resources",
                )?;
            }
            if let Some(toolpath_id) = &operation.generated_toolpath_id {
                require_reference(
                    &toolpaths,
                    toolpath_id,
                    &format!("{operation_path}.generatedToolpathId"),
                    "toolpaths",
                )?;
            }
        }

        for (toolpath_index, toolpath) in self.toolpaths.iter().enumerate() {
            let toolpath_path = index_path("$.toolpaths", toolpath_index);
            require_reference(
                &operations,
                &toolpath.operation_id,
                &format!("{toolpath_path}.operationId"),
                "operations",
            )?;
            let segments = index_ids(
                toolpath
                    .segments
                    .iter()
                    .enumerate()
                    .map(|(index, value)| (value.id(), index)),
                &format!("{toolpath_path}.segments"),
            )?;
            for (mapping_index, mapping) in toolpath.source_line_map.iter().enumerate() {
                require_reference(
                    &segments,
                    &mapping.segment_id,
                    &format!("{toolpath_path}.sourceLineMap[{mapping_index}].segmentId"),
                    "segments",
                )?;
            }
        }

        let mut normalized_paths = HashSet::new();
        for (resource_index, resource) in self.resources.iter().enumerate() {
            let path = format!("{}.path", index_path("$.resources", resource_index));
            if !is_safe_resource_path(&resource.path) {
                return contract_error(
                    "resource.path_unsafe",
                    path,
                    "resource path must be a safe normalized relative path",
                );
            }
            let normalized = resource
                .path
                .nfc()
                .flat_map(char::to_lowercase)
                .collect::<String>();
            if !normalized_paths.insert(normalized) {
                return contract_error(
                    "resource.path_collision",
                    path,
                    "resource paths must not collide after normalization",
                );
            }
            if matches!(
                resource.role,
                ResourceRole::Checkpoint | ResourceRole::Preview | ResourceRole::Report
            ) && resource.authoritative
            {
                return contract_error(
                    "resource.derived_authoritative",
                    format!(
                        "{}.authoritative",
                        index_path("$.resources", resource_index)
                    ),
                    "derived checkpoint, preview, and report resources are not authoritative",
                );
            }
        }

        Ok(())
    }
}

fn validate_machine(machine: &MachineDefinition, path: &str) -> ContractResult<()> {
    validate_schema_version(machine.schema_version, &field(path, "schemaVersion"))?;
    validate_uuid(&machine.id, &field(path, "id"))?;
    validate_text(&machine.name, 1, 128, &field(path, "name"))?;
    if machine.kinematic_root_axis_ids.is_empty() {
        return contract_error(
            "array.too_small",
            field(path, "kinematicRootAxisIds"),
            "kinematicRootAxisIds must contain at least one entry",
        );
    }
    validate_uuid_list(
        &machine.kinematic_root_axis_ids,
        &field(path, "kinematicRootAxisIds"),
    )?;
    if machine.axes.is_empty() {
        return contract_error(
            "array.too_small",
            field(path, "axes"),
            "axes must contain at least one entry",
        );
    }
    for (index, axis) in machine.axes.iter().enumerate() {
        axis.validate_at(&index_path(&field(path, "axes"), index))?;
    }
    if machine.spindles.is_empty() {
        return contract_error(
            "array.too_small",
            field(path, "spindles"),
            "spindles must contain at least one entry",
        );
    }
    for (index, spindle) in machine.spindles.iter().enumerate() {
        let spindle_path = index_path(&field(path, "spindles"), index);
        validate_schema_version(
            spindle.schema_version,
            &field(&spindle_path, "schemaVersion"),
        )?;
        validate_uuid(&spindle.id, &field(&spindle_path, "id"))?;
        validate_text(&spindle.name, 1, 64, &field(&spindle_path, "name"))?;
        validate_positive(
            spindle.max_spindle_speed_rpm,
            &field(&spindle_path, "maxSpindleSpeedRpm"),
        )?;
    }
    validate_vec3(
        &machine.work_envelope.min_mm,
        &format!("{path}.workEnvelope.minMm"),
    )?;
    validate_vec3(
        &machine.work_envelope.max_mm,
        &format!("{path}.workEnvelope.maxMm"),
    )?;
    validate_positive(machine.max_feed_mm_per_min, &field(path, "maxFeedMmPerMin"))?;
    validate_optional_uuid(
        &machine.model_asset_resource_id,
        &field(path, "modelAssetResourceId"),
    )?;
    for (index, group) in machine.collision_groups.iter().enumerate() {
        let group_path = index_path(&field(path, "collisionGroups"), index);
        validate_schema_version(group.schema_version, &field(&group_path, "schemaVersion"))?;
        validate_uuid(&group.id, &field(&group_path, "id"))?;
        validate_text(&group.name, 1, 64, &field(&group_path, "name"))?;
        validate_uuid_list(
            &group.member_resource_ids,
            &field(&group_path, "memberResourceIds"),
        )?;
    }
    Ok(())
}

fn validate_material(material: &MaterialProfile, path: &str) -> ContractResult<()> {
    validate_schema_version(material.schema_version, &field(path, "schemaVersion"))?;
    validate_uuid(&material.id, &field(path, "id"))?;
    validate_text(&material.name, 1, 128, &field(path, "name"))?;
    validate_positive(material.density_kg_per_m3, &field(path, "densityKgPerM3"))
}

fn validate_setup(setup: &Setup, path: &str) -> ContractResult<()> {
    validate_schema_version(setup.schema_version, &field(path, "schemaVersion"))?;
    validate_uuid(&setup.id, &field(path, "id"))?;
    validate_text(&setup.name, 1, 128, &field(path, "name"))?;
    validate_vec3(&setup.work_offset_mm, &field(path, "workOffsetMm"))?;
    validate_rotation(&setup.rotation_rad, &field(path, "rotationRad"))?;
    validate_uuid_list(
        &setup.fixture_resource_ids,
        &field(path, "fixtureResourceIds"),
    )
}

fn validate_tool(tool: &ToolAssembly, path: &str) -> ContractResult<()> {
    validate_schema_version(tool.schema_version, &field(path, "schemaVersion"))?;
    validate_uuid(&tool.id, &field(path, "id"))?;
    validate_text(&tool.name, 1, 128, &field(path, "name"))?;
    let cutter_path = field(path, "cutterGeometry");
    validate_positive(
        tool.cutter_geometry.diameter_mm,
        &field(&cutter_path, "diameterMm"),
    )?;
    validate_non_negative(
        tool.cutter_geometry.corner_radius_mm,
        &field(&cutter_path, "cornerRadiusMm"),
    )?;
    if tool.cutter_geometry.flute_count == 0 || tool.cutter_geometry.flute_count > 64 {
        return contract_error(
            "number.out_of_range",
            field(&cutter_path, "fluteCount"),
            "fluteCount must be between 1 and 64",
        );
    }
    validate_positive(
        tool.cutter_geometry.cutting_length_mm,
        &field(&cutter_path, "cuttingLengthMm"),
    )?;
    validate_positive(
        tool.cutter_geometry.overall_length_mm,
        &field(&cutter_path, "overallLengthMm"),
    )?;
    if tool.cutter_geometry.corner_radius_mm > tool.cutter_geometry.diameter_mm / 2.0 {
        return contract_error(
            "tool.corner_radius",
            field(&cutter_path, "cornerRadiusMm"),
            "corner radius must not exceed cutter radius",
        );
    }
    if tool.cutter_geometry.cutting_length_mm > tool.cutter_geometry.overall_length_mm {
        return contract_error(
            "tool.cutting_length",
            field(&cutter_path, "cuttingLengthMm"),
            "cutting length must not exceed overall length",
        );
    }
    let holder_path = field(path, "holderGeometry");
    validate_positive(
        tool.holder_geometry.diameter_mm,
        &field(&holder_path, "diameterMm"),
    )?;
    validate_positive(
        tool.holder_geometry.length_mm,
        &field(&holder_path, "lengthMm"),
    )?;
    validate_positive(tool.gauge_length_mm, &field(path, "gaugeLengthMm"))?;
    validate_positive(tool.stickout_length_mm, &field(path, "stickoutLengthMm"))?;
    validate_positive(
        tool.max_spindle_speed_rpm,
        &field(path, "maxSpindleSpeedRpm"),
    )?;
    validate_ratio(tool.wear_ratio, &field(path, "wearRatio"))?;
    validate_uuid_list(
        &tool.material_compatibility_ids,
        &field(path, "materialCompatibilityIds"),
    )
}

fn validate_stock(stock: &Stock, path: &str) -> ContractResult<()> {
    validate_schema_version(stock.schema_version, &field(path, "schemaVersion"))?;
    validate_uuid(&stock.id, &field(path, "id"))?;
    validate_text(&stock.name, 1, 128, &field(path, "name"))?;
    match &stock.geometry {
        StockGeometry::Box { size_mm } => {
            validate_positive(size_mm.x_mm, &format!("{path}.geometry.sizeMm.xMm"))?;
            validate_positive(size_mm.y_mm, &format!("{path}.geometry.sizeMm.yMm"))?;
            validate_positive(size_mm.z_mm, &format!("{path}.geometry.sizeMm.zMm"))?;
        }
        StockGeometry::Cylinder {
            diameter_mm,
            length_mm,
        } => {
            validate_positive(*diameter_mm, &format!("{path}.geometry.diameterMm"))?;
            validate_positive(*length_mm, &format!("{path}.geometry.lengthMm"))?;
        }
    }
    validate_transform(&stock.transform, &field(path, "transform"))?;
    validate_uuid(&stock.material_id, &field(path, "materialId"))?;
    validate_positive(stock.resolution_mm, &field(path, "resolutionMm"))?;
    validate_optional_uuid(
        &stock.source_model_resource_id,
        &field(path, "sourceModelResourceId"),
    )
}

fn validate_operation(operation: &Operation, path: &str) -> ContractResult<()> {
    validate_schema_version(operation.schema_version, &field(path, "schemaVersion"))?;
    validate_uuid(&operation.id, &field(path, "id"))?;
    validate_text(&operation.name, 1, 128, &field(path, "name"))?;
    validate_uuid(&operation.setup_id, &field(path, "setupId"))?;
    validate_uuid(&operation.tool_assembly_id, &field(path, "toolAssemblyId"))?;
    validate_text(&operation.strategy, 1, 128, &field(path, "strategy"))?;
    match &operation.feed {
        FeedDefinition::PerMinute { feed_mm_per_min } => {
            validate_positive(*feed_mm_per_min, &format!("{path}.feed.feedMmPerMin"))?
        }
        FeedDefinition::PerRevolution { feed_mm_per_rev } => {
            validate_positive(*feed_mm_per_rev, &format!("{path}.feed.feedMmPerRev"))?
        }
        FeedDefinition::PerTooth { feed_mm_per_tooth } => {
            validate_positive(*feed_mm_per_tooth, &format!("{path}.feed.feedMmPerTooth"))?
        }
    }
    validate_positive(operation.spindle_speed_rpm, &field(path, "spindleSpeedRpm"))?;
    validate_positive(operation.depth_of_cut_mm, &field(path, "depthOfCutMm"))?;
    validate_positive(operation.width_of_cut_mm, &field(path, "widthOfCutMm"))?;
    validate_optional_uuid(
        &operation.target_geometry_resource_id,
        &field(path, "targetGeometryResourceId"),
    )?;
    validate_optional_uuid(
        &operation.generated_toolpath_id,
        &field(path, "generatedToolpathId"),
    )
}

fn validate_toolpath(toolpath: &ToolpathIr, path: &str) -> ContractResult<()> {
    validate_schema_version(toolpath.schema_version, &field(path, "schemaVersion"))?;
    validate_uuid(&toolpath.id, &field(path, "id"))?;
    validate_uuid(&toolpath.operation_id, &field(path, "operationId"))?;
    for (index, segment) in toolpath.segments.iter().enumerate() {
        segment.validate_at(&index_path(&field(path, "segments"), index))?;
    }
    for (index, mapping) in toolpath.source_line_map.iter().enumerate() {
        let mapping_path = index_path(&field(path, "sourceLineMap"), index);
        validate_uuid(&mapping.segment_id, &field(&mapping_path, "segmentId"))?;
        if mapping.source_line == 0 {
            return contract_error(
                "number.not_positive",
                field(&mapping_path, "sourceLine"),
                "sourceLine must be greater than zero",
            );
        }
        validate_safe_sequence(mapping.source_line, &field(&mapping_path, "sourceLine"))?;
    }
    Ok(())
}

fn validate_resource(resource: &ResourceDescriptor, path: &str) -> ContractResult<()> {
    validate_schema_version(resource.schema_version, &field(path, "schemaVersion"))?;
    validate_uuid(&resource.id, &field(path, "id"))?;
    validate_text(&resource.path, 1, 512, &field(path, "path"))?;
    if !is_safe_resource_path(&resource.path) {
        return contract_error(
            "resource.path_unsafe",
            field(path, "path"),
            "resource path must be a safe normalized relative path",
        );
    }
    if matches!(
        resource.role,
        ResourceRole::Checkpoint | ResourceRole::Preview | ResourceRole::Report
    ) && resource.authoritative
    {
        return contract_error(
            "resource.derived_authoritative",
            field(path, "authoritative"),
            "derived checkpoint, preview, and report resources are not authoritative",
        );
    }
    if !is_normalized_media_type(&resource.media_type) {
        return contract_error(
            "resource.media_type",
            field(path, "mediaType"),
            "mediaType must be a normalized MIME type",
        );
    }
    validate_safe_sequence(resource.byte_length, &field(path, "byteLength"))?;
    validate_lower_hex(&resource.sha256, 64, &field(path, "sha256"))
}

fn validate_settings(settings: &ProjectSettings, path: &str) -> ContractResult<()> {
    validate_schema_version(settings.schema_version, &field(path, "schemaVersion"))?;
    if settings.display_decimal_places > 9 {
        return contract_error(
            "number.out_of_range",
            field(path, "displayDecimalPlaces"),
            "displayDecimalPlaces must be between 0 and 9",
        );
    }
    validate_safe_sequence(
        settings.deterministic_seed,
        &field(path, "deterministicSeed"),
    )
}

fn validate_axis_graph(machine: &MachineDefinition, machine_index: usize) -> ContractResult<()> {
    let machine_path = index_path("$.machines", machine_index);
    let axes = index_ids(
        machine
            .axes
            .iter()
            .enumerate()
            .map(|(index, axis)| (axis.id(), index)),
        &format!("{machine_path}.axes"),
    )?;

    for (axis_index, axis) in machine.axes.iter().enumerate() {
        if let Some(parent_id) = axis.parent_id()
            && !axes.contains_key(parent_id)
        {
            return contract_error(
                "axis.parent_missing",
                format!("{machine_path}.axes[{axis_index}].parentId"),
                "axis parentId must reference an axis in the same machine",
            );
        }
    }

    for (root_index, root_id) in machine.kinematic_root_axis_ids.iter().enumerate() {
        let Some(axis_index) = axes.get(root_id.as_str()) else {
            return contract_error(
                "axis.root_missing",
                format!("{machine_path}.kinematicRootAxisIds[{root_index}]"),
                "kinematic root must reference an axis in the same machine",
            );
        };
        if machine.axes[*axis_index].parent_id().is_some() {
            return contract_error(
                "axis.root_has_parent",
                format!("{machine_path}.kinematicRootAxisIds[{root_index}]"),
                "kinematic root axis must not have a parent",
            );
        }
    }

    for (start_index, start_axis) in machine.axes.iter().enumerate() {
        let mut visited = HashSet::new();
        let mut cursor = Some(start_axis);
        while let Some(axis) = cursor {
            if !visited.insert(axis.id()) {
                return contract_error(
                    "axis.cycle",
                    format!("{machine_path}.axes[{start_index}].parentId"),
                    "kinematic axis graph must not contain a cycle",
                );
            }
            cursor = axis
                .parent_id()
                .and_then(|parent_id| axes.get(parent_id))
                .map(|index| &machine.axes[*index]);
        }
    }

    let minimum = &machine.work_envelope.min_mm;
    let maximum = &machine.work_envelope.max_mm;
    if minimum.x_mm >= maximum.x_mm || minimum.y_mm >= maximum.y_mm || minimum.z_mm >= maximum.z_mm
    {
        return contract_error(
            "machine.work_envelope_reversed",
            format!("{machine_path}.workEnvelope"),
            "work envelope minimum must be less than maximum on every axis",
        );
    }

    Ok(())
}

fn index_ids<'a>(
    values: impl IntoIterator<Item = (&'a str, usize)>,
    path: &str,
) -> ContractResult<HashMap<&'a str, usize>> {
    let mut indexed = HashMap::new();
    for (id, index) in values {
        if indexed.insert(id, index).is_some() {
            return contract_error(
                "id.duplicate",
                format!("{path}[{index}].id"),
                "collection IDs must be unique",
            );
        }
    }
    Ok(indexed)
}

fn require_reference(
    index: &HashMap<&str, usize>,
    id: &str,
    path: &str,
    collection: &str,
) -> ContractResult<()> {
    if index.contains_key(id) {
        Ok(())
    } else {
        contract_error(
            "reference.missing",
            path,
            format!("reference must resolve within {collection}"),
        )
    }
}

fn validate_segment_base(
    schema_version: u32,
    id: &str,
    sequence: u64,
    path: &str,
) -> ContractResult<()> {
    validate_schema_version(schema_version, &field(path, "schemaVersion"))?;
    validate_uuid(id, &field(path, "id"))?;
    validate_safe_sequence(sequence, &field(path, "sequence"))
}

pub(crate) fn validate_schema_version(value: u32, path: &str) -> ContractResult<()> {
    if value == SCHEMA_VERSION {
        Ok(())
    } else {
        contract_error(
            "schema.version",
            path,
            format!("expected schema version {SCHEMA_VERSION}"),
        )
    }
}

pub(crate) fn validate_uuid(value: &str, path: &str) -> ContractResult<()> {
    let bytes = value.as_bytes();
    let valid_shape = bytes.len() == 36
        && [8, 13, 18, 23]
            .into_iter()
            .all(|index| bytes[index] == b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit());
    let valid_version = valid_shape && matches!(bytes[14], b'1'..=b'8');
    let valid_variant = valid_shape && matches!(bytes[19], b'8' | b'9' | b'a' | b'A' | b'b' | b'B');

    if valid_shape && valid_version && valid_variant {
        Ok(())
    } else {
        contract_error("string.uuid", path, "value must be an RFC 9562 UUID")
    }
}

pub(crate) fn validate_optional_uuid(value: &Option<String>, path: &str) -> ContractResult<()> {
    if let Some(value) = value {
        validate_uuid(value, path)?;
    }
    Ok(())
}

pub(crate) fn validate_uuid_list(values: &[String], path: &str) -> ContractResult<()> {
    for (index, value) in values.iter().enumerate() {
        validate_uuid(value, &index_path(path, index))?;
    }
    Ok(())
}

pub(crate) fn validate_text(
    value: &str,
    minimum: usize,
    maximum: usize,
    path: &str,
) -> ContractResult<()> {
    let length = value.chars().count();
    if length < minimum || length > maximum {
        contract_error(
            "string.length",
            path,
            format!("string length must be between {minimum} and {maximum}"),
        )
    } else {
        Ok(())
    }
}

pub(crate) fn validate_finite(value: f64, path: &str) -> ContractResult<()> {
    if !value.is_finite() {
        return contract_error("number.not_finite", path, "wire numbers must be finite");
    }
    if value == 0.0 && value.is_sign_negative() {
        return contract_error(
            "number.negative_zero",
            path,
            "wire numbers must not be negative zero",
        );
    }
    Ok(())
}

pub(crate) fn validate_positive(value: f64, path: &str) -> ContractResult<()> {
    validate_finite(value, path)?;
    if value > 0.0 {
        Ok(())
    } else {
        contract_error(
            "number.not_positive",
            path,
            "value must be greater than zero",
        )
    }
}

pub(crate) fn validate_non_negative(value: f64, path: &str) -> ContractResult<()> {
    validate_finite(value, path)?;
    if value >= 0.0 {
        Ok(())
    } else {
        contract_error("number.negative", path, "value must not be negative")
    }
}

pub(crate) fn validate_ratio(value: f64, path: &str) -> ContractResult<()> {
    validate_non_negative(value, path)?;
    if value <= 1.0 {
        Ok(())
    } else {
        contract_error(
            "number.out_of_range",
            path,
            "ratio must be between zero and one",
        )
    }
}

pub(crate) fn validate_safe_sequence(value: u64, path: &str) -> ContractResult<()> {
    if value <= MAX_SAFE_INTEGER {
        Ok(())
    } else {
        contract_error(
            "number.unsafe_integer",
            path,
            "integer must not exceed JavaScript Number.MAX_SAFE_INTEGER",
        )
    }
}

pub(crate) fn validate_code(value: &str, path: &str) -> ContractResult<()> {
    let valid = !value.is_empty()
        && value.split('.').all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        });
    if valid {
        Ok(())
    } else {
        contract_error(
            "string.code",
            path,
            "code must contain lowercase alphanumeric dot-separated segments",
        )
    }
}

pub(crate) fn validate_lower_hex(
    value: &str,
    expected_length: usize,
    path: &str,
) -> ContractResult<()> {
    if value.len() == expected_length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        Ok(())
    } else {
        contract_error(
            "string.hex",
            path,
            format!("value must contain {expected_length} lowercase hexadecimal characters"),
        )
    }
}

fn validate_vec3(value: &Vec3Mm, path: &str) -> ContractResult<()> {
    validate_finite(value.x_mm, &field(path, "xMm"))?;
    validate_finite(value.y_mm, &field(path, "yMm"))?;
    validate_finite(value.z_mm, &field(path, "zMm"))
}

fn validate_direction(value: &DirectionUnit, path: &str) -> ContractResult<()> {
    validate_finite(value.x, &field(path, "x"))?;
    validate_finite(value.y, &field(path, "y"))?;
    validate_finite(value.z, &field(path, "z"))?;
    let magnitude = value.x.hypot(value.y).hypot(value.z);
    if (magnitude - 1.0).abs() <= 1.0e-9 {
        Ok(())
    } else {
        contract_error(
            "axis.direction_not_normalized",
            path,
            "axis direction must be a normalized unit vector",
        )
    }
}

fn validate_rotation(value: &RotationRad, path: &str) -> ContractResult<()> {
    validate_finite(value.x_rad, &field(path, "xRad"))?;
    validate_finite(value.y_rad, &field(path, "yRad"))?;
    validate_finite(value.z_rad, &field(path, "zRad"))
}

fn validate_transform(value: &Transform, path: &str) -> ContractResult<()> {
    validate_vec3(&value.position_mm, &field(path, "positionMm"))?;
    validate_rotation(&value.rotation_rad, &field(path, "rotationRad"))
}

fn validate_ordered_range(minimum: f64, maximum: f64, home: f64, path: &str) -> ContractResult<()> {
    if minimum >= maximum {
        return contract_error(
            "axis.range_reversed",
            path,
            "axis minimum must be less than maximum",
        );
    }
    if home < minimum || home > maximum {
        return contract_error(
            "axis.home_out_of_range",
            path,
            "axis home must be inside the inclusive range",
        );
    }
    Ok(())
}

fn validate_utc_datetime(value: &str, path: &str) -> ContractResult<()> {
    let bytes = value.as_bytes();
    let fixed = bytes.len() >= 20
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b':'
        && bytes[16] == b':'
        && bytes.last() == Some(&b'Z')
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 | 10 | 13 | 16 => true,
            index if index == bytes.len() - 1 => true,
            19 if bytes.len() > 20 => *byte == b'.',
            _ => byte.is_ascii_digit(),
        });
    let fractional_length_ok = bytes.len() == 20 || (bytes.len() >= 22 && bytes.len() <= 30);
    let calendar_and_time_ok = fixed && fractional_length_ok && {
        let number = |start: usize, end: usize| {
            bytes[start..end]
                .iter()
                .fold(0_u32, |value, digit| value * 10 + u32::from(*digit - b'0'))
        };
        let year = number(0, 4);
        let month = number(5, 7);
        let day = number(8, 10);
        let hour = number(11, 13);
        let minute = number(14, 16);
        let second = number(17, 19);

        let is_leap_year = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);

        let days_in_month = match month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 if is_leap_year => 29,
            2 => 28,
            _ => 0,
        };

        year >= 1
            && (1..=12).contains(&month)
            && day >= 1
            && day <= days_in_month
            && hour <= 23
            && minute <= 59
            && second <= 59
    };

    if fixed && fractional_length_ok && calendar_and_time_ok {
        Ok(())
    } else {
        contract_error(
            "string.utc_datetime",
            path,
            "timestamp must be UTC RFC 3339",
        )
    }
}

fn is_normalized_media_type(value: &str) -> bool {
    let mut parts = value.split('/');
    let Some(media_type) = parts.next() else {
        return false;
    };
    let Some(subtype) = parts.next() else {
        return false;
    };
    parts.next().is_none() && is_media_token(media_type) && is_media_token(subtype)
}

fn is_media_token(value: &str) -> bool {
    !value.is_empty()
        && value
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(
                    byte,
                    b'!' | b'#' | b'$' | b'&' | b'^' | b'_' | b'.' | b'+' | b'-'
                )
        })
}

fn is_safe_resource_path(path: &str) -> bool {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path.chars().any(char::is_control)
    {
        return false;
    }
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return false;
    }
    path.split('/')
        .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn contract_error<T>(
    code: &'static str,
    path: impl Into<String>,
    message: impl Into<String>,
) -> ContractResult<T> {
    Err(ContractError::new(code, path, message))
}

fn field(path: &str, name: &str) -> String {
    format!("{path}.{name}")
}

fn index_path(path: &str, index: usize) -> String {
    format!("{path}[{index}]")
}

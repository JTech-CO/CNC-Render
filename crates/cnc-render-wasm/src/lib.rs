use std::{
    collections::BTreeMap,
    sync::{Mutex, MutexGuard},
};

use cnc_render_contracts::{
    SCHEMA_VERSION,
    domain::{
        CollisionGroup, DirectionUnit, KinematicAxis, MachineDefinition, MachineType,
        SpindleDefinition, Vec3Mm, WorkEnvelope,
    },
    semantic_hash,
};
use cnc_render_gcode_core::{
    CanonicalMotion, InitialState, ParseOptions, RotaryPositionRad, compile,
};
use cnc_render_simulation_core::{
    SimulationError, ThreeAxisKinematics,
    material_removal::{
        MillingQualityPreset, MillingStockInput, MillingSurfacePatch, MillingSweep,
        MillingToolInput, SparseDexelMillingEngine,
    },
    turning::{
        LatheRadiusFieldEngine, TurningCut, TurningProfilePatch, TurningQualityPreset,
        TurningStockInput, TurningToolKind,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_INPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_BINARY_BYTES: usize = 128 * 1024 * 1024;
const TOOL_OBJECT_ID: &str = "70000000-0000-4000-8000-000000000010";
const X_AXIS_ID: &str = "70000000-0000-4000-8000-000000000001";
const Y_AXIS_ID: &str = "70000000-0000-4000-8000-000000000002";
const Z_AXIS_ID: &str = "70000000-0000-4000-8000-000000000003";
const NUMERIC_EPSILON: f64 = 1e-9;

static INPUT: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static OUTPUT_JSON: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static OUTPUT_BINARY: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static SESSION: Mutex<Option<CoordinatorSession>> = Mutex::new(None);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CoordinatorRunRequest {
    schema_version: u32,
    run_id: String,
    fixture_id: String,
    source: String,
    initial_position_mm: Vec3Mm,
    process: ProcessConfiguration,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "processType",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum ProcessConfiguration {
    Milling {
        stock: MillingStockInput,
        tool: MillingToolInput,
        preset: MillingQualityPreset,
        seed: u32,
        brick_size_dexels: usize,
        rapid_rate_mm_per_min: f64,
        axis_limit_mm: f64,
        tool_collision_radius_mm: f64,
        collision_boxes: Vec<CollisionBox>,
    },
    Turning {
        stock: TurningStockInput,
        tool_kind: TurningToolKind,
        preset: TurningQualityPreset,
        seed: u32,
        machine_max_spindle_speed_rpm: f64,
        chuck_grip_length_mm: f64,
        rapid_rate_mm_per_min: f64,
        radial_segments: u32,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CollisionBox {
    object_id: String,
    minimum_mm: Vec3Mm,
    maximum_mm: Vec3Mm,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CollisionRecord {
    code: String,
    object_a_id: String,
    object_b_id: String,
    position_mm: Vec3Mm,
    penetration_estimate_mm: f64,
    source_line: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BinaryLayout {
    binary_kind: String,
    offset: u32,
    byte_length: u32,
    element_type: String,
}

#[derive(Debug, Default)]
struct BinaryBuilder {
    bytes: Vec<u8>,
    layout: Vec<BinaryLayout>,
}

impl BinaryBuilder {
    fn push_u32(&mut self, binary_kind: &str, values: &[u32]) -> CoreResult<()> {
        self.align_four();
        let offset = self.bytes.len();
        for value in values {
            self.bytes.extend_from_slice(&value.to_le_bytes());
        }
        self.push_layout(binary_kind, offset, std::mem::size_of_val(values), "uint32")
    }

    fn push_f32(&mut self, binary_kind: &str, values: &[f32]) -> CoreResult<()> {
        self.align_four();
        let offset = self.bytes.len();
        for value in values {
            self.bytes.extend_from_slice(&value.to_le_bytes());
        }
        self.push_layout(
            binary_kind,
            offset,
            std::mem::size_of_val(values),
            "float32",
        )
    }

    fn align_four(&mut self) {
        while !self.bytes.len().is_multiple_of(4) {
            self.bytes.push(0);
        }
    }

    fn push_layout(
        &mut self,
        binary_kind: &str,
        offset: usize,
        byte_length: usize,
        element_type: &str,
    ) -> CoreResult<()> {
        if self.bytes.len() > MAX_BINARY_BYTES {
            return Err(CoreError::new(
                "wasm.binary.resource-limit",
                "WASM render output exceeded the binary transfer limit.",
            ));
        }
        self.layout.push(BinaryLayout {
            binary_kind: binary_kind.to_owned(),
            offset: to_u32(offset, "binary offset")?,
            byte_length: to_u32(byte_length, "binary byte length")?,
            element_type: element_type.to_owned(),
        });
        Ok(())
    }
}

#[derive(Debug)]
struct CoreOutput {
    json: Value,
    binary: Vec<u8>,
}

#[derive(Debug, Clone)]
struct CoreError {
    code: String,
    message: String,
}

type CoreResult<T> = Result<T, CoreError>;

impl CoreError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<SimulationError> for CoreError {
    fn from(value: SimulationError) -> Self {
        Self::new(value.code, value.message)
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(value: serde_json::Error) -> Self {
        Self::new("wasm.json.invalid", value.to_string())
    }
}

#[derive(Debug)]
struct CommonSession {
    run_id: String,
    fixture_id: String,
    process_type: &'static str,
    toolpath_id: String,
    parse_semantic_hash_sha256: String,
    motions: Vec<CanonicalMotion>,
    next_motion_index: usize,
    logical_time_s: f64,
    tool_position_mm: Vec3Mm,
    diagnostic_codes: Vec<String>,
    collision: Option<CollisionRecord>,
    stopped: bool,
}

#[derive(Debug)]
struct MillingSession {
    engine: SparseDexelMillingEngine,
    kinematics: ThreeAxisKinematics,
    rapid_rate_mm_per_min: f64,
    tool_collision_radius_mm: f64,
    collision_boxes: Vec<CollisionBox>,
}

#[derive(Debug)]
struct TurningSession {
    engine: LatheRadiusFieldEngine,
    tool_kind: TurningToolKind,
    rapid_rate_mm_per_min: f64,
    radial_segments: u32,
}

#[derive(Debug)]
enum SessionProcess {
    Milling(MillingSession),
    Turning(TurningSession),
}

#[derive(Debug)]
struct CoordinatorSession {
    common: CommonSession,
    process: SessionProcess,
}

impl CoordinatorSession {
    fn new(request: CoordinatorRunRequest) -> CoreResult<Self> {
        if request.schema_version != SCHEMA_VERSION {
            return Err(CoreError::new(
                "wasm.schema-version.unsupported",
                format!("Expected schemaVersion {SCHEMA_VERSION}."),
            ));
        }
        validate_uuid_like(&request.run_id, "runId")?;
        if request.fixture_id.is_empty() || request.fixture_id.len() > 128 {
            return Err(CoreError::new(
                "wasm.fixture-id.invalid",
                "fixtureId must contain 1 to 128 characters.",
            ));
        }
        if request.source.len() > MAX_INPUT_BYTES {
            return Err(CoreError::new(
                "wasm.gcode.resource-limit",
                "G-code source exceeded the WASM input limit.",
            ));
        }
        validate_vec3(&request.initial_position_mm, "initialPositionMm")?;

        let parse_options = ParseOptions {
            initial_state: InitialState {
                position_mm: request.initial_position_mm.clone(),
                rotary_rad: RotaryPositionRad::default(),
            },
            ..ParseOptions::default()
        };
        let parsed = compile(&request.source, &parse_options);
        let parse_value = serde_json::to_value(&parsed)?;
        let parse_semantic_hash_sha256 = semantic_hash(&parse_value)
            .map_err(|error| CoreError::new("wasm.parse-hash.failed", error.to_string()))?;
        if !parsed.accepted {
            let first = parsed.diagnostics.first();
            return Err(CoreError::new(
                first
                    .map(|diagnostic| diagnostic.code.as_str())
                    .unwrap_or("wasm.gcode.rejected"),
                first
                    .map(|diagnostic| diagnostic.message.as_str())
                    .unwrap_or("G-code was rejected by the parser."),
            ));
        }
        let toolpath_id = parsed
            .toolpath
            .as_ref()
            .map(|toolpath| toolpath.id.clone())
            .ok_or_else(|| {
                CoreError::new(
                    "wasm.toolpath.missing",
                    "An accepted G-code program must produce Toolpath IR.",
                )
            })?;
        let diagnostic_codes = parsed
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.code.clone())
            .collect::<Vec<_>>();

        let (process_type, process) = match request.process {
            ProcessConfiguration::Milling {
                stock,
                tool,
                preset,
                seed,
                brick_size_dexels,
                rapid_rate_mm_per_min,
                axis_limit_mm,
                tool_collision_radius_mm,
                mut collision_boxes,
            } => {
                validate_positive(rapid_rate_mm_per_min, "rapidRateMmPerMin")?;
                validate_positive(axis_limit_mm, "axisLimitMm")?;
                validate_positive(tool_collision_radius_mm, "toolCollisionRadiusMm")?;
                for collision_box in &collision_boxes {
                    collision_box.validate()?;
                }
                collision_boxes.sort_by(|left, right| left.object_id.cmp(&right.object_id));
                let engine =
                    SparseDexelMillingEngine::new(stock, tool, preset, seed, brick_size_dexels)?;
                let machine = representative_vmc(axis_limit_mm, rapid_rate_mm_per_min);
                let kinematics = ThreeAxisKinematics::new(
                    &machine,
                    Vec3Mm {
                        x_mm: 0.0,
                        y_mm: 0.0,
                        z_mm: 0.0,
                    },
                )?;
                (
                    "milling",
                    SessionProcess::Milling(MillingSession {
                        engine,
                        kinematics,
                        rapid_rate_mm_per_min,
                        tool_collision_radius_mm,
                        collision_boxes,
                    }),
                )
            }
            ProcessConfiguration::Turning {
                stock,
                tool_kind,
                preset,
                seed,
                machine_max_spindle_speed_rpm,
                chuck_grip_length_mm,
                rapid_rate_mm_per_min,
                radial_segments,
            } => {
                validate_positive(rapid_rate_mm_per_min, "rapidRateMmPerMin")?;
                if !(8..=256).contains(&radial_segments) {
                    return Err(CoreError::new(
                        "wasm.turning.radial-segments.invalid",
                        "radialSegments must be between 8 and 256.",
                    ));
                }
                let engine = LatheRadiusFieldEngine::new(
                    stock,
                    tool_kind,
                    preset,
                    seed,
                    machine_max_spindle_speed_rpm,
                    chuck_grip_length_mm,
                )?;
                (
                    "turning",
                    SessionProcess::Turning(TurningSession {
                        engine,
                        tool_kind,
                        rapid_rate_mm_per_min,
                        radial_segments,
                    }),
                )
            }
        };

        Ok(Self {
            common: CommonSession {
                run_id: request.run_id,
                fixture_id: request.fixture_id,
                process_type,
                toolpath_id,
                parse_semantic_hash_sha256,
                motions: parsed.canonical_motions,
                next_motion_index: 0,
                logical_time_s: 0.0,
                tool_position_mm: request.initial_position_mm,
                diagnostic_codes,
                collision: None,
                stopped: false,
            },
            process,
        })
    }

    fn full_render(&self) -> CoreResult<(Value, BinaryBuilder)> {
        let mut binary = BinaryBuilder::default();
        let render = match &self.process {
            SessionProcess::Milling(session) => {
                let snapshot = session.engine.surface_snapshot();
                binary.push_f32("milling.top-z-mm", &snapshot.top_z_mm)?;
                json!({
                    "renderType": "milling-full",
                    "boundsMm": {
                        "minimum": snapshot.minimum_mm,
                        "maximum": snapshot.maximum_mm,
                    },
                    "columns": snapshot.columns,
                    "rows": snapshot.rows,
                    "resolutionMm": snapshot.resolution_mm,
                })
            }
            SessionProcess::Turning(session) => {
                let snapshot = session.engine.serialize_profile();
                let inner = snapshot
                    .inner_radius_layers
                    .iter()
                    .map(|layers| (*layers as f64 * snapshot.resolution_mm) as f32)
                    .collect::<Vec<_>>();
                let outer = snapshot
                    .outer_radius_layers
                    .iter()
                    .map(|layers| {
                        (*layers as f64 * snapshot.resolution_mm).min(snapshot.initial_radius_mm)
                            as f32
                    })
                    .collect::<Vec<_>>();
                binary.push_f32("turning.inner-radius-mm", &inner)?;
                binary.push_f32("turning.outer-radius-mm", &outer)?;
                json!({
                    "renderType": "turning-full",
                    "axisCenterMm": snapshot.axis_center_mm,
                    "minimumZMm": snapshot.minimum_z_mm,
                    "maximumZMm": snapshot.maximum_z_mm,
                    "axialCells": snapshot.axial_cells,
                    "radialSegments": session.radial_segments,
                    "resolutionMm": snapshot.resolution_mm,
                })
            }
        };
        Ok((render, binary))
    }

    fn initialized_output(&self) -> CoreResult<CoreOutput> {
        let (render, binary) = self.full_render()?;
        self.output("initialized", Some(render), binary, false)
    }

    fn step(&mut self) -> CoreResult<CoreOutput> {
        if self.common.stopped {
            return self.output("stopped", None, BinaryBuilder::default(), true);
        }
        if self.common.next_motion_index >= self.common.motions.len() {
            return self.output("completed", None, BinaryBuilder::default(), true);
        }

        let motion = self.common.motions[self.common.next_motion_index].clone();
        let motion_data = MotionData::from_motion(&motion);
        let mut binary = BinaryBuilder::default();
        let mut render = None;
        let collision;
        let mut effective_end = motion_data.end_mm.clone();

        match &mut self.process {
            SessionProcess::Milling(session) => {
                collision = swept_sphere_collision(
                    &motion_data.start_mm,
                    &motion_data.end_mm,
                    session.tool_collision_radius_mm,
                    motion_data.source_line,
                    &session.collision_boxes,
                );
                if let Some(record) = &collision {
                    effective_end = record.position_mm.clone();
                }
                let positions = axis_positions(&effective_end);
                session.kinematics.solve(&positions)?;
                let limit_diagnostics = session.kinematics.position_diagnostics(&positions)?;
                self.common.diagnostic_codes.extend(
                    limit_diagnostics
                        .into_iter()
                        .map(|diagnostic| diagnostic.code),
                );

                if collision.is_none() && motion_data.removes_material {
                    session.engine.apply_sweep(&MillingSweep {
                        start_mm: motion_data.start_mm.clone(),
                        end_mm: motion_data.end_mm.clone(),
                    })?;
                }
                let patch = session.engine.drain_dirty_surface_patch();
                if !patch.cell_indices.is_empty() {
                    add_milling_patch(&mut binary, &patch)?;
                    render = Some(json!({
                        "renderType": "milling-patch",
                        "revision": patch.revision,
                        "brickX": 0,
                        "brickY": 0,
                    }));
                }
                self.common.logical_time_s += motion_data.duration_s(session.rapid_rate_mm_per_min);
            }
            SessionProcess::Turning(session) => {
                collision = turning_collision(
                    &session.engine,
                    &motion_data.start_mm,
                    &motion_data.end_mm,
                    motion_data.source_line,
                )?;
                if let Some(record) = &collision {
                    effective_end = record.position_mm.clone();
                }
                if collision.is_none()
                    && motion_data.removes_material
                    && let Some(cut) = turning_cut_from_motion(
                        &motion_data,
                        session.tool_kind,
                        session.engine.diagnostics().resolution_mm,
                    )
                {
                    session.engine.apply_cut(&cut)?;
                }
                let patch = session.engine.drain_dirty_profile_patch();
                if !patch.cell_indices.is_empty() {
                    add_turning_patch(&mut binary, &patch)?;
                    render = Some(json!({
                        "renderType": "turning-patch",
                        "revision": patch.revision,
                    }));
                }
                self.common.logical_time_s += motion_data.duration_s(session.rapid_rate_mm_per_min);
            }
        }

        self.common.next_motion_index += 1;
        self.common.tool_position_mm = effective_end;
        if let Some(record) = collision {
            self.common.collision = Some(record);
            self.common.stopped = true;
        }
        let terminal =
            self.common.stopped || self.common.next_motion_index >= self.common.motions.len();
        let phase = if self.common.stopped {
            "stopped"
        } else if terminal {
            "completed"
        } else {
            "progress"
        };
        self.output(phase, render, binary, terminal)
    }

    fn snapshot(&self) -> CoreResult<CoreOutput> {
        let (render, binary) = self.full_render()?;
        self.output("snapshot", Some(render), binary, self.is_terminal())
    }

    fn is_completed(&self) -> bool {
        !self.common.stopped && self.common.next_motion_index >= self.common.motions.len()
    }

    fn is_terminal(&self) -> bool {
        self.common.stopped || self.is_completed()
    }

    fn output(
        &self,
        phase: &str,
        render: Option<Value>,
        binary: BinaryBuilder,
        include_final_hash: bool,
    ) -> CoreResult<CoreOutput> {
        let stock_hash = self.stock_hash()?;
        let state_hash = self.state_semantic_hash(&stock_hash)?;
        let diagnostics = self.process_diagnostics();
        let final_hash = include_final_hash.then_some(state_hash.clone());
        let json = json!({
            "schemaVersion": SCHEMA_VERSION,
            "coreVersion": CORE_VERSION,
            "wasm": true,
            "phase": phase,
            "runId": self.common.run_id,
            "fixtureId": self.common.fixture_id,
            "processType": self.common.process_type,
            "toolpathId": self.common.toolpath_id,
            "parseSemanticHashSha256": self.common.parse_semantic_hash_sha256,
            "stateSemanticHashSha256": state_hash,
            "finalSemanticHashSha256": final_hash,
            "stockHashSha256": stock_hash,
            "currentStep": self.common.next_motion_index,
            "totalSteps": self.common.motions.len(),
            "logicalTimeS": normalized_zero(self.common.logical_time_s),
            "toolPositionMm": self.common.tool_position_mm,
            "stockRevision": diagnostics.stock_revision,
            "removedVolumeMm3": diagnostics.removed_volume_mm3,
            "diagnosticCodes": self.common.diagnostic_codes,
            "collision": self.common.collision,
            "completed": self.is_completed(),
            "stopped": self.common.stopped,
            "render": render,
            "binaryLayout": binary.layout,
            "binaryByteLength": binary.bytes.len(),
        });
        Ok(CoreOutput {
            json,
            binary: binary.bytes,
        })
    }

    fn stock_hash(&self) -> CoreResult<String> {
        match &self.process {
            SessionProcess::Milling(session) => {
                session.engine.stock_hash_sha256().map_err(Into::into)
            }
            SessionProcess::Turning(session) => {
                session.engine.profile_hash_sha256().map_err(Into::into)
            }
        }
    }

    fn process_diagnostics(&self) -> ProcessDiagnostics {
        match &self.process {
            SessionProcess::Milling(session) => {
                let diagnostics = session.engine.diagnostics();
                ProcessDiagnostics {
                    stock_revision: diagnostics.revision,
                    removed_volume_mm3: diagnostics.removed_volume_mm3,
                }
            }
            SessionProcess::Turning(session) => {
                let diagnostics = session.engine.diagnostics();
                ProcessDiagnostics {
                    stock_revision: diagnostics.revision,
                    removed_volume_mm3: diagnostics.removed_volume_mm3,
                }
            }
        }
    }

    fn state_semantic_hash(&self, stock_hash: &str) -> CoreResult<String> {
        semantic_hash(&json!({
            "schemaVersion": SCHEMA_VERSION,
            "coreVersion": CORE_VERSION,
            "fixtureId": self.common.fixture_id,
            "processType": self.common.process_type,
            "toolpathId": self.common.toolpath_id,
            "parseSemanticHashSha256": self.common.parse_semantic_hash_sha256,
            "stockHashSha256": stock_hash,
            "nextMotionIndex": self.common.next_motion_index,
            "logicalTimeS": normalized_zero(self.common.logical_time_s),
            "toolPositionMm": self.common.tool_position_mm,
            "diagnosticCodes": self.common.diagnostic_codes,
            "collision": self.common.collision,
            "stopped": self.common.stopped,
        }))
        .map_err(|error| CoreError::new("wasm.state-hash.failed", error.to_string()))
    }
}

#[derive(Debug, Clone, Copy)]
struct ProcessDiagnostics {
    stock_revision: u64,
    removed_volume_mm3: f64,
}

#[derive(Debug, Clone)]
struct MotionData {
    source_line: u64,
    start_mm: Vec3Mm,
    end_mm: Vec3Mm,
    feed_mm_per_min: Option<f64>,
    dwell_s: Option<f64>,
    removes_material: bool,
}

impl MotionData {
    fn from_motion(motion: &CanonicalMotion) -> Self {
        match motion {
            CanonicalMotion::Rapid {
                source_line,
                start_mm,
                end_mm,
                ..
            } => Self {
                source_line: *source_line,
                start_mm: start_mm.clone(),
                end_mm: end_mm.clone(),
                feed_mm_per_min: None,
                dwell_s: None,
                removes_material: false,
            },
            CanonicalMotion::Linear {
                source_line,
                start_mm,
                end_mm,
                feed_mm_per_min,
                ..
            }
            | CanonicalMotion::Arc {
                source_line,
                start_mm,
                end_mm,
                feed_mm_per_min,
                ..
            } => Self {
                source_line: *source_line,
                start_mm: start_mm.clone(),
                end_mm: end_mm.clone(),
                feed_mm_per_min: Some(*feed_mm_per_min),
                dwell_s: None,
                removes_material: true,
            },
            CanonicalMotion::Dwell {
                source_line,
                position_mm,
                duration_s,
            } => Self {
                source_line: *source_line,
                start_mm: position_mm.clone(),
                end_mm: position_mm.clone(),
                feed_mm_per_min: None,
                dwell_s: Some(*duration_s),
                removes_material: false,
            },
            CanonicalMotion::ToolChange {
                source_line,
                position_mm,
                ..
            } => Self {
                source_line: *source_line,
                start_mm: position_mm.clone(),
                end_mm: position_mm.clone(),
                feed_mm_per_min: None,
                dwell_s: None,
                removes_material: false,
            },
        }
    }

    fn duration_s(&self, rapid_rate_mm_per_min: f64) -> f64 {
        if let Some(dwell_s) = self.dwell_s {
            return normalized_zero(dwell_s);
        }
        let feed = self.feed_mm_per_min.unwrap_or(rapid_rate_mm_per_min);
        normalized_zero(distance(&self.start_mm, &self.end_mm) / feed * 60.0)
    }
}

impl CollisionBox {
    fn validate(&self) -> CoreResult<()> {
        validate_uuid_like(&self.object_id, "collisionBoxes.objectId")?;
        validate_vec3(&self.minimum_mm, "collisionBoxes.minimumMm")?;
        validate_vec3(&self.maximum_mm, "collisionBoxes.maximumMm")?;
        if self.minimum_mm.x_mm >= self.maximum_mm.x_mm
            || self.minimum_mm.y_mm >= self.maximum_mm.y_mm
            || self.minimum_mm.z_mm >= self.maximum_mm.z_mm
        {
            return Err(CoreError::new(
                "wasm.collision-box.invalid",
                "Collision box minimum coordinates must be below maximum coordinates.",
            ));
        }
        Ok(())
    }
}

fn add_milling_patch(binary: &mut BinaryBuilder, patch: &MillingSurfacePatch) -> CoreResult<()> {
    binary.push_u32("milling.cell-indices", &patch.cell_indices)?;
    binary.push_f32("milling.top-z-mm", &patch.top_z_mm)
}

fn add_turning_patch(binary: &mut BinaryBuilder, patch: &TurningProfilePatch) -> CoreResult<()> {
    binary.push_u32("turning.cell-indices", &patch.cell_indices)?;
    binary.push_f32("turning.inner-radius-mm", &patch.inner_radius_mm)?;
    binary.push_f32("turning.outer-radius-mm", &patch.outer_radius_mm)
}

fn turning_cut_from_motion(
    motion: &MotionData,
    tool_kind: TurningToolKind,
    resolution_mm: f64,
) -> Option<TurningCut> {
    let start_radius = (motion.start_mm.x_mm / 2.0).abs();
    let end_radius = (motion.end_mm.x_mm / 2.0).abs();
    let start_z = motion.start_mm.z_mm;
    let end_z = motion.end_mm.z_mm;
    let (minimum_z, maximum_z, minimum_radius, maximum_radius) = if start_z <= end_z {
        (start_z, end_z, start_radius, end_radius)
    } else {
        (end_z, start_z, end_radius, start_radius)
    };

    if (maximum_z - minimum_z).abs() <= NUMERIC_EPSILON {
        let half_cell = resolution_mm / 2.0;
        return match tool_kind {
            TurningToolKind::Turning => Some(TurningCut::Groove {
                start_z_mm: minimum_z - half_cell,
                end_z_mm: maximum_z + half_cell,
                start_outer_radius_mm: start_radius.min(end_radius),
                end_outer_radius_mm: start_radius.min(end_radius),
            }),
            TurningToolKind::Drill => Some(TurningCut::Drilling {
                start_z_mm: minimum_z - half_cell,
                end_z_mm: maximum_z + half_cell,
                start_inner_radius_mm: start_radius.max(end_radius),
                end_inner_radius_mm: start_radius.max(end_radius),
            }),
            TurningToolKind::Boring => Some(TurningCut::Boring {
                start_z_mm: minimum_z - half_cell,
                end_z_mm: maximum_z + half_cell,
                start_inner_radius_mm: start_radius.max(end_radius),
                end_inner_radius_mm: start_radius.max(end_radius),
            }),
        };
    }

    match tool_kind {
        TurningToolKind::Turning => {
            if (minimum_radius - maximum_radius).abs() <= NUMERIC_EPSILON {
                Some(TurningCut::OdTurning {
                    start_z_mm: minimum_z,
                    end_z_mm: maximum_z,
                    start_outer_radius_mm: minimum_radius,
                    end_outer_radius_mm: maximum_radius,
                })
            } else {
                Some(TurningCut::Taper {
                    start_z_mm: minimum_z,
                    end_z_mm: maximum_z,
                    start_outer_radius_mm: minimum_radius,
                    end_outer_radius_mm: maximum_radius,
                })
            }
        }
        TurningToolKind::Drill => Some(TurningCut::Drilling {
            start_z_mm: minimum_z,
            end_z_mm: maximum_z,
            start_inner_radius_mm: minimum_radius,
            end_inner_radius_mm: maximum_radius,
        }),
        TurningToolKind::Boring => Some(TurningCut::Boring {
            start_z_mm: minimum_z,
            end_z_mm: maximum_z,
            start_inner_radius_mm: minimum_radius,
            end_inner_radius_mm: maximum_radius,
        }),
    }
}

fn turning_collision(
    engine: &LatheRadiusFieldEngine,
    start: &Vec3Mm,
    end: &Vec3Mm,
    source_line: u64,
) -> CoreResult<Option<CollisionRecord>> {
    let distance_mm = distance(start, end);
    let steps = ((distance_mm / 0.5).ceil() as usize).clamp(1, 1_000_000);
    for step in 0..=steps {
        let ratio = step as f64 / steps as f64;
        let position = interpolate(start, end, ratio);
        if let Some(collision) =
            engine.detect_restricted_zone_collision(position.x_mm, position.z_mm)?
        {
            return Ok(Some(CollisionRecord {
                code: collision.code,
                object_a_id: TOOL_OBJECT_ID.to_owned(),
                object_b_id: match collision.kind {
                    cnc_render_simulation_core::turning::TurningCollisionKind::Chuck => {
                        "70000000-0000-4000-8000-000000000020"
                    }
                    cnc_render_simulation_core::turning::TurningCollisionKind::AxisOppositeSide => {
                        "70000000-0000-4000-8000-000000000021"
                    }
                }
                .to_owned(),
                position_mm: Vec3Mm {
                    x_mm: collision.x_mm,
                    y_mm: collision.y_mm,
                    z_mm: collision.z_mm,
                },
                penetration_estimate_mm: 0.001,
                source_line,
            }));
        }
    }
    Ok(None)
}

fn swept_sphere_collision(
    start: &Vec3Mm,
    end: &Vec3Mm,
    radius_mm: f64,
    source_line: u64,
    boxes: &[CollisionBox],
) -> Option<CollisionRecord> {
    if boxes.is_empty() {
        return None;
    }
    let distance_mm = distance(start, end);
    let steps = ((distance_mm / (radius_mm * 0.5).max(0.25)).ceil() as usize).clamp(1, 1_000_000);
    for step in 0..=steps {
        let ratio = step as f64 / steps as f64;
        let position = interpolate(start, end, ratio);
        for collision_box in boxes {
            let closest = Vec3Mm {
                x_mm: position
                    .x_mm
                    .clamp(collision_box.minimum_mm.x_mm, collision_box.maximum_mm.x_mm),
                y_mm: position
                    .y_mm
                    .clamp(collision_box.minimum_mm.y_mm, collision_box.maximum_mm.y_mm),
                z_mm: position
                    .z_mm
                    .clamp(collision_box.minimum_mm.z_mm, collision_box.maximum_mm.z_mm),
            };
            let separation = distance(&position, &closest);
            if separation <= radius_mm + NUMERIC_EPSILON {
                return Some(CollisionRecord {
                    code: "collision.tool.fixture".to_owned(),
                    object_a_id: TOOL_OBJECT_ID.to_owned(),
                    object_b_id: collision_box.object_id.clone(),
                    position_mm: position,
                    penetration_estimate_mm: (radius_mm - separation).max(0.001),
                    source_line,
                });
            }
        }
    }
    None
}

fn representative_vmc(axis_limit_mm: f64, rapid_rate_mm_per_min: f64) -> MachineDefinition {
    let zero = Vec3Mm {
        x_mm: 0.0,
        y_mm: 0.0,
        z_mm: 0.0,
    };
    let axis = |id: &str, name: &str, parent_id: Option<&str>, direction_unit: DirectionUnit| {
        KinematicAxis::Linear {
            schema_version: SCHEMA_VERSION,
            id: id.to_owned(),
            name: name.to_owned(),
            parent_id: parent_id.map(str::to_owned),
            direction_unit,
            pivot_mm: zero.clone(),
            min_mm: -axis_limit_mm,
            max_mm: axis_limit_mm,
            max_velocity_mm_per_min: rapid_rate_mm_per_min,
            max_acceleration_mm_per_s2: 1_000.0,
            home_mm: 0.0,
        }
    };
    MachineDefinition {
        schema_version: SCHEMA_VERSION,
        id: "70000000-0000-4000-8000-000000000000".to_owned(),
        name: "M7 representative VMC".to_owned(),
        machine_type: MachineType::VerticalMachiningCenter,
        kinematic_root_axis_ids: vec![X_AXIS_ID.to_owned()],
        axes: vec![
            axis(
                X_AXIS_ID,
                "X",
                None,
                DirectionUnit {
                    x: 1.0,
                    y: 0.0,
                    z: 0.0,
                },
            ),
            axis(
                Y_AXIS_ID,
                "Y",
                Some(X_AXIS_ID),
                DirectionUnit {
                    x: 0.0,
                    y: 1.0,
                    z: 0.0,
                },
            ),
            axis(
                Z_AXIS_ID,
                "Z",
                Some(Y_AXIS_ID),
                DirectionUnit {
                    x: 0.0,
                    y: 0.0,
                    z: 1.0,
                },
            ),
        ],
        spindles: vec![SpindleDefinition {
            schema_version: SCHEMA_VERSION,
            id: "70000000-0000-4000-8000-000000000004".to_owned(),
            name: "M7 spindle".to_owned(),
            max_spindle_speed_rpm: 12_000.0,
        }],
        work_envelope: WorkEnvelope {
            min_mm: Vec3Mm {
                x_mm: -axis_limit_mm,
                y_mm: -axis_limit_mm,
                z_mm: -axis_limit_mm,
            },
            max_mm: Vec3Mm {
                x_mm: axis_limit_mm,
                y_mm: axis_limit_mm,
                z_mm: axis_limit_mm,
            },
        },
        max_feed_mm_per_min: rapid_rate_mm_per_min,
        model_asset_resource_id: None,
        collision_groups: Vec::<CollisionGroup>::new(),
    }
}

fn axis_positions(position: &Vec3Mm) -> BTreeMap<String, f64> {
    BTreeMap::from([
        (X_AXIS_ID.to_owned(), position.x_mm),
        (Y_AXIS_ID.to_owned(), position.y_mm),
        (Z_AXIS_ID.to_owned(), position.z_mm),
    ])
}

fn interpolate(start: &Vec3Mm, end: &Vec3Mm, ratio: f64) -> Vec3Mm {
    Vec3Mm {
        x_mm: normalized_zero(start.x_mm + (end.x_mm - start.x_mm) * ratio),
        y_mm: normalized_zero(start.y_mm + (end.y_mm - start.y_mm) * ratio),
        z_mm: normalized_zero(start.z_mm + (end.z_mm - start.z_mm) * ratio),
    }
}

fn distance(start: &Vec3Mm, end: &Vec3Mm) -> f64 {
    ((end.x_mm - start.x_mm).powi(2)
        + (end.y_mm - start.y_mm).powi(2)
        + (end.z_mm - start.z_mm).powi(2))
    .sqrt()
}

fn validate_positive(value: f64, path: &str) -> CoreResult<()> {
    if !value.is_finite() || value <= 0.0 {
        return Err(CoreError::new(
            "wasm.number.not-positive",
            format!("{path} must be a finite positive value."),
        ));
    }
    Ok(())
}

fn validate_vec3(value: &Vec3Mm, path: &str) -> CoreResult<()> {
    if !value.x_mm.is_finite() || !value.y_mm.is_finite() || !value.z_mm.is_finite() {
        return Err(CoreError::new(
            "wasm.vector.nonfinite",
            format!("{path} must contain finite millimetre values."),
        ));
    }
    Ok(())
}

fn validate_uuid_like(value: &str, path: &str) -> CoreResult<()> {
    if value.len() != 36
        || value.as_bytes().get(8) != Some(&b'-')
        || value.as_bytes().get(13) != Some(&b'-')
        || value.as_bytes().get(18) != Some(&b'-')
        || value.as_bytes().get(23) != Some(&b'-')
    {
        return Err(CoreError::new(
            "wasm.uuid.invalid",
            format!("{path} must be an RFC 9562 UUID string."),
        ));
    }
    Ok(())
}

fn normalized_zero(value: f64) -> f64 {
    if value == 0.0 { 0.0 } else { value }
}

fn to_u32(value: usize, label: &str) -> CoreResult<u32> {
    u32::try_from(value).map_err(|_| {
        CoreError::new(
            "wasm.integer.out-of-range",
            format!("{label} exceeds the WebAssembly 32-bit address space."),
        )
    })
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn read_request() -> CoreResult<CoordinatorRunRequest> {
    let input = lock(&INPUT);
    if input.is_empty() || input.len() > MAX_INPUT_BYTES {
        return Err(CoreError::new(
            "wasm.input.resource-limit",
            "WASM input must contain between 1 byte and 16 MiB.",
        ));
    }
    serde_json::from_slice(&input).map_err(Into::into)
}

fn write_result(result: CoreResult<CoreOutput>) -> u32 {
    let (json_value, binary, status) = match result {
        Ok(output) => (output.json, output.binary, 0),
        Err(error) => (
            json!({
                "schemaVersion": SCHEMA_VERSION,
                "coreVersion": CORE_VERSION,
                "wasm": true,
                "phase": "error",
                "code": error.code,
                "message": error.message,
                "binaryLayout": [],
                "binaryByteLength": 0,
            }),
            Vec::new(),
            1,
        ),
    };
    let encoded = serde_json::to_vec(&json_value).unwrap_or_else(|_| {
        br#"{"schemaVersion":1,"phase":"error","code":"wasm.json.encode-failed","message":"Could not encode WASM output.","binaryLayout":[],"binaryByteLength":0}"#.to_vec()
    });
    *lock(&OUTPUT_JSON) = encoded;
    *lock(&OUTPUT_BINARY) = binary;
    status
}

#[unsafe(no_mangle)]
pub extern "C" fn cnc_render_protocol_version() -> u32 {
    SCHEMA_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn cnc_render_input_resize(byte_length: u32) -> u32 {
    let byte_length = byte_length as usize;
    if byte_length > MAX_INPUT_BYTES {
        return 0;
    }
    let mut input = lock(&INPUT);
    input.resize(byte_length, 0);
    input.as_mut_ptr() as usize as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn cnc_render_initialize() -> u32 {
    let result = read_request().and_then(|request| {
        let session = CoordinatorSession::new(request)?;
        let output = session.initialized_output()?;
        *lock(&SESSION) = Some(session);
        Ok(output)
    });
    write_result(result)
}

#[unsafe(no_mangle)]
pub extern "C" fn cnc_render_step() -> u32 {
    let result = lock(&SESSION)
        .as_mut()
        .ok_or_else(|| CoreError::new("wasm.session.missing", "Initialize a run before stepping."))
        .and_then(CoordinatorSession::step);
    write_result(result)
}

#[unsafe(no_mangle)]
pub extern "C" fn cnc_render_snapshot() -> u32 {
    let result = lock(&SESSION)
        .as_ref()
        .ok_or_else(|| {
            CoreError::new(
                "wasm.session.missing",
                "Initialize a run before snapshotting.",
            )
        })
        .and_then(CoordinatorSession::snapshot);
    write_result(result)
}

#[unsafe(no_mangle)]
pub extern "C" fn cnc_render_cancel() -> u32 {
    let mut session = lock(&SESSION);
    let run_id = session.as_ref().map(|value| value.common.run_id.clone());
    *session = None;
    write_result(Ok(CoreOutput {
        json: json!({
            "schemaVersion": SCHEMA_VERSION,
            "coreVersion": CORE_VERSION,
            "wasm": true,
            "phase": "cancelled",
            "runId": run_id,
            "binaryLayout": [],
            "binaryByteLength": 0,
        }),
        binary: Vec::new(),
    }))
}

#[unsafe(no_mangle)]
pub extern "C" fn cnc_render_output_json_ptr() -> u32 {
    lock(&OUTPUT_JSON).as_ptr() as usize as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn cnc_render_output_json_len() -> u32 {
    lock(&OUTPUT_JSON).len() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn cnc_render_output_binary_ptr() -> u32 {
    lock(&OUTPUT_BINARY).as_ptr() as usize as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn cnc_render_output_binary_len() -> u32 {
    lock(&OUTPUT_BINARY).len() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn milling_request(collision: bool) -> CoordinatorRunRequest {
        let collision_boxes = if collision {
            vec![CollisionBox {
                object_id: "70000000-0000-4000-8000-000000000099".to_owned(),
                minimum_mm: Vec3Mm {
                    x_mm: 4.0,
                    y_mm: -2.0,
                    z_mm: 2.0,
                },
                maximum_mm: Vec3Mm {
                    x_mm: 6.0,
                    y_mm: 2.0,
                    z_mm: 8.0,
                },
            }]
        } else {
            vec![]
        };
        CoordinatorRunRequest {
            schema_version: SCHEMA_VERSION,
            run_id: "70000000-0000-4000-8000-000000000100".to_owned(),
            fixture_id: "m7-milling".to_owned(),
            source: "G21 G90\nG0 X0 Y0 Z8\nG1 Z4 F600\nG1 X10 F600\nM30\n".to_owned(),
            initial_position_mm: Vec3Mm {
                x_mm: 0.0,
                y_mm: 0.0,
                z_mm: 8.0,
            },
            process: ProcessConfiguration::Milling {
                stock: MillingStockInput {
                    size_mm: Vec3Mm {
                        x_mm: 40.0,
                        y_mm: 30.0,
                        z_mm: 10.0,
                    },
                    position_mm: Vec3Mm {
                        x_mm: 0.0,
                        y_mm: 0.0,
                        z_mm: 0.0,
                    },
                    base_resolution_mm: 1.0,
                },
                tool: MillingToolInput {
                    diameter_mm: 4.0,
                    cutting_length_mm: 12.0,
                },
                preset: MillingQualityPreset::Balanced,
                seed: 7,
                brick_size_dexels: 16,
                rapid_rate_mm_per_min: 12_000.0,
                axis_limit_mm: 500.0,
                tool_collision_radius_mm: 2.0,
                collision_boxes,
            },
        }
    }

    fn final_hash(mut session: CoordinatorSession) -> String {
        loop {
            let output = session.step().expect("step");
            if session.is_terminal() {
                return output.json["finalSemanticHashSha256"]
                    .as_str()
                    .expect("final hash")
                    .to_owned();
            }
        }
    }

    #[test]
    fn repeated_milling_replay_has_the_same_semantic_hash() {
        let first = final_hash(CoordinatorSession::new(milling_request(false)).expect("session"));
        let second = final_hash(CoordinatorSession::new(milling_request(false)).expect("session"));
        assert_eq!(first, second);
    }

    #[test]
    fn collision_stops_before_the_fixture_is_cut() {
        let mut session = CoordinatorSession::new(milling_request(true)).expect("session");
        let output = loop {
            let output = session.step().expect("step");
            if session.is_terminal() {
                break output;
            }
        };
        assert!(session.common.stopped);
        assert!(session.common.collision.is_some());
        assert_eq!(output.json["phase"], "stopped");
        assert_eq!(output.json["completed"], false);
        assert_eq!(output.json["stopped"], true);
    }

    #[test]
    fn initialized_output_uses_explicit_binary_layouts() {
        let session = CoordinatorSession::new(milling_request(false)).expect("session");
        let output = session.initialized_output().expect("initialized output");
        assert!(!output.binary.is_empty());
        assert_eq!(output.json["binaryLayout"][0]["elementType"], "float32");
        assert_eq!(output.json["wasm"], true);
    }

    #[test]
    fn snapshot_includes_the_complete_stock_without_advancing_state() {
        let mut session = CoordinatorSession::new(milling_request(false)).expect("session");
        let stepped = session.step().expect("step");
        let snapshot = session.snapshot().expect("snapshot");

        assert_eq!(snapshot.json["phase"], "snapshot");
        assert_eq!(snapshot.json["render"]["renderType"], "milling-full");
        assert!(!snapshot.binary.is_empty());
        assert_eq!(snapshot.json["binaryByteLength"], snapshot.binary.len());
        assert_eq!(
            snapshot.json["stateSemanticHashSha256"],
            stepped.json["stateSemanticHashSha256"]
        );
        assert_eq!(snapshot.json["currentStep"], stepped.json["currentStep"]);
    }
}

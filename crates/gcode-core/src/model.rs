use std::collections::BTreeMap;

use cnc_render_contracts::domain::{ToolpathIr, Vec3Mm};
use serde::{Deserialize, Serialize};

pub const DIALECT: &str = "common-v1";
pub const DEFAULT_OPERATION_ID: &str = "1c5cbff7-5118-5ea4-8d41-f024790fa322";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiagnosticSeverity {
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Diagnostic {
    pub line: u64,
    pub column: u64,
    pub code: String,
    pub severity: DiagnosticSeverity,
    pub recoverable: bool,
    pub message: String,
}

impl Diagnostic {
    pub(crate) fn error(
        line: usize,
        column: usize,
        code: &str,
        recoverable: bool,
        message: impl Into<String>,
    ) -> Self {
        Self {
            line: line as u64,
            column: column as u64,
            code: code.to_owned(),
            severity: DiagnosticSeverity::Error,
            recoverable,
            message: message.into(),
        }
    }

    pub fn warning(line: usize, column: usize, code: &str, message: impl Into<String>) -> Self {
        Self {
            line: line as u64,
            column: column as u64,
            code: code.to_owned(),
            severity: DiagnosticSeverity::Warning,
            recoverable: true,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Word {
    pub letter: char,
    pub value: f64,
    pub raw: String,
    pub line: u64,
    pub column: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LexedLine {
    pub source_line: u64,
    pub words: Vec<Word>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LexerOutput {
    pub lines: Vec<LexedLine>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Block {
    pub source_line: u64,
    pub words: Vec<Word>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlockParserOutput {
    pub blocks: Vec<Block>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RotaryPositionRad {
    pub a_rad: f64,
    pub b_rad: f64,
    pub c_rad: f64,
}

impl Default for RotaryPositionRad {
    fn default() -> Self {
        Self {
            a_rad: 0.0,
            b_rad: 0.0,
            c_rad: 0.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InitialState {
    #[serde(default = "zero_position")]
    pub position_mm: Vec3Mm,
    #[serde(default)]
    pub rotary_rad: RotaryPositionRad,
}

impl Default for InitialState {
    fn default() -> Self {
        Self {
            position_mm: zero_position(),
            rotary_rad: RotaryPositionRad::default(),
        }
    }
}

pub(crate) fn zero_position() -> Vec3Mm {
    Vec3Mm {
        x_mm: 0.0,
        y_mm: 0.0,
        z_mm: 0.0,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParseRequest {
    #[serde(default = "default_action")]
    pub action: String,
    pub source: String,
    #[serde(default = "default_dialect")]
    pub dialect: String,
    #[serde(default)]
    pub toolpath_id: Option<String>,
    #[serde(default = "default_operation_id")]
    pub operation_id: String,
    #[serde(default)]
    pub tool_numbers: BTreeMap<u32, String>,
    #[serde(default)]
    pub work_offsets_mm: BTreeMap<String, Vec3Mm>,
    #[serde(default)]
    pub tool_length_offsets_mm: BTreeMap<u32, f64>,
    #[serde(default)]
    pub initial_state: InitialState,
    #[serde(default = "default_repetitions")]
    pub repetitions: u32,
}

fn default_action() -> String {
    "parse".to_owned()
}

fn default_dialect() -> String {
    DIALECT.to_owned()
}

fn default_operation_id() -> String {
    DEFAULT_OPERATION_ID.to_owned()
}

fn default_repetitions() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseOptions {
    pub dialect: String,
    pub toolpath_id: Option<String>,
    pub operation_id: String,
    pub tool_numbers: BTreeMap<u32, String>,
    pub work_offsets_mm: BTreeMap<String, Vec3Mm>,
    pub tool_length_offsets_mm: BTreeMap<u32, f64>,
    pub initial_state: InitialState,
}

impl Default for ParseOptions {
    fn default() -> Self {
        Self {
            dialect: DIALECT.to_owned(),
            toolpath_id: None,
            operation_id: DEFAULT_OPERATION_ID.to_owned(),
            tool_numbers: BTreeMap::new(),
            work_offsets_mm: BTreeMap::new(),
            tool_length_offsets_mm: BTreeMap::new(),
            initial_state: InitialState::default(),
        }
    }
}

impl From<&ParseRequest> for ParseOptions {
    fn from(request: &ParseRequest) -> Self {
        Self {
            dialect: request.dialect.clone(),
            toolpath_id: request.toolpath_id.clone(),
            operation_id: request.operation_id.clone(),
            tool_numbers: request.tool_numbers.clone(),
            work_offsets_mm: request.work_offsets_mm.clone(),
            tool_length_offsets_mm: request.tool_length_offsets_mm.clone(),
            initial_state: request.initial_state.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MotionMode {
    Rapid,
    Linear,
    ArcClockwise,
    ArcCounterclockwise,
    Cycle81,
    Cycle82,
    Cycle83,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Plane {
    Xy,
    Xz,
    Yz,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DistanceMode {
    Absolute,
    Incremental,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnitMode {
    Millimeter,
    Inch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FeedMode {
    UnitsPerMinute,
    UnitsPerRevolution,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpindleMode {
    Rpm,
    SurfaceSpeed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpindleState {
    Off,
    Clockwise,
    Counterclockwise,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CoolantState {
    Off,
    Flood,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProgramControl {
    None,
    M0,
    M1,
    M2,
    M30,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgramControlEvent {
    pub source_line: u64,
    pub control: ProgramControl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProgramEnd {
    None,
    M2,
    M30,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReturnMode {
    InitialPlane,
    RPlane,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinalModalState {
    pub position_mm: Vec3Mm,
    pub rotary_rad: RotaryPositionRad,
    pub motion_mode: MotionMode,
    pub plane: Plane,
    pub distance_mode: DistanceMode,
    pub unit_mode: UnitMode,
    pub feed_mode: FeedMode,
    pub spindle_mode: SpindleMode,
    pub spindle_state: SpindleState,
    pub coolant_state: CoolantState,
    pub return_mode: ReturnMode,
    pub work_coordinate: String,
    pub selected_tool: Option<u32>,
    pub active_tool_length_offset: Option<u32>,
    pub cutter_compensation_active: bool,
    pub program_end: ProgramEnd,
    pub last_program_control: ProgramControl,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "motionType",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CanonicalMotion {
    Rapid {
        source_line: u64,
        start_mm: Vec3Mm,
        end_mm: Vec3Mm,
        start_rotary_rad: RotaryPositionRad,
        end_rotary_rad: RotaryPositionRad,
    },
    Linear {
        source_line: u64,
        start_mm: Vec3Mm,
        end_mm: Vec3Mm,
        start_rotary_rad: RotaryPositionRad,
        end_rotary_rad: RotaryPositionRad,
        feed_mm_per_min: f64,
    },
    Arc {
        source_line: u64,
        start_mm: Vec3Mm,
        end_mm: Vec3Mm,
        center_offset_mm: Vec3Mm,
        plane: Plane,
        clockwise: bool,
        feed_mm_per_min: f64,
    },
    Dwell {
        source_line: u64,
        position_mm: Vec3Mm,
        duration_s: f64,
    },
    ToolChange {
        source_line: u64,
        position_mm: Vec3Mm,
        tool_assembly_id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PathLengthMm {
    pub total: f64,
    pub rapid: f64,
    pub feed: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParseResult {
    pub dialect: String,
    pub accepted: bool,
    pub toolpath: Option<ToolpathIr>,
    pub canonical_motions: Vec<CanonicalMotion>,
    pub program_control_events: Vec<ProgramControlEvent>,
    pub diagnostics: Vec<Diagnostic>,
    pub final_state: FinalModalState,
    pub endpoint_mm: Vec3Mm,
    pub path_length_mm: PathLengthMm,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CliParseResponse {
    pub result: ParseResult,
    pub stable: bool,
    pub serialized_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportEntry {
    pub code: String,
    pub status: String,
    pub behavior: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WordSupportEntry {
    pub word: String,
    pub status: String,
    pub contexts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportMatrix {
    pub schema_version: u32,
    pub dialect: String,
    pub g_codes: Vec<SupportEntry>,
    pub m_codes: Vec<SupportEntry>,
    pub words: Vec<WordSupportEntry>,
    pub diagnostic_codes: Vec<String>,
}

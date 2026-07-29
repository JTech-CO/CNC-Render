use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    WORKER_PROTOCOL_VERSION,
    domain::{
        ContractValidate, MAX_SAFE_INTEGER, Project, Vec3Mm, validate_code, validate_finite,
        validate_lower_hex, validate_non_negative, validate_positive, validate_safe_sequence,
        validate_schema_version, validate_text, validate_uuid,
    },
    validation::{ContractError, ContractResult},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MessageKind {
    Command,
    Event,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransferMode {
    Transferable,
    SharedArrayBuffer,
    Copy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BinaryKind {
    ToolpathSegments,
    StockField,
    RenderMesh,
    Checkpoint,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BinaryElementType {
    Uint8,
    Uint16,
    Uint32,
    Int32,
    Float32,
    Float64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BinaryOwnership {
    Sender,
    Receiver,
    Shared,
    Copy,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BinaryHandleDescriptor {
    pub handle_id: String,
    pub binary_kind: BinaryKind,
    pub byte_length: u64,
    pub element_type: BinaryElementType,
    pub ownership: BinaryOwnership,
}

macro_rules! message_type {
    ($name:ident, $wire_name:literal, $variant:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name {
            #[serde(rename = $wire_name)]
            $variant,
        }
    };
}

message_type!(WorkerHandshakeType, "worker.handshake", WorkerHandshake);
message_type!(ProjectLoadType, "project.load", ProjectLoad);
message_type!(RunDisposeType, "run.dispose", RunDispose);
message_type!(WorkerReadyType, "worker.ready", WorkerReady);
message_type!(ProjectAcceptedType, "project.accepted", ProjectAccepted);
message_type!(ProjectRejectedType, "project.rejected", ProjectRejected);
message_type!(SimulationEventType, "simulation.event", SimulationEvent);
message_type!(WorkerErrorType, "worker.error", WorkerError);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerHandshakePayload {
    pub supported_protocol_versions: Vec<u32>,
    pub client_version: String,
    pub transfer_modes: Vec<TransferMode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerHandshakeMessage {
    pub protocol_version: u32,
    pub message_id: String,
    #[serde(deserialize_with = "crate::required_nullable::deserialize")]
    pub reply_to: Option<String>,
    pub kind: MessageKind,
    #[serde(rename = "type")]
    pub message_type: WorkerHandshakeType,
    #[serde(deserialize_with = "crate::required_nullable::deserialize")]
    pub run_id: Option<String>,
    pub sequence: u64,
    pub payload: WorkerHandshakePayload,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectLoadPayload {
    pub project: Project,
    pub transfer_mode: TransferMode,
    pub binary_handles: Vec<BinaryHandleDescriptor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectLoadMessage {
    pub protocol_version: u32,
    pub message_id: String,
    #[serde(deserialize_with = "crate::required_nullable::deserialize")]
    pub reply_to: Option<String>,
    pub kind: MessageKind,
    #[serde(rename = "type")]
    pub message_type: ProjectLoadType,
    pub run_id: String,
    pub sequence: u64,
    pub payload: ProjectLoadPayload,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunDisposeReason {
    Completed,
    Cancelled,
    Replaced,
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunDisposePayload {
    pub reason: RunDisposeReason,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunDisposeMessage {
    pub protocol_version: u32,
    pub message_id: String,
    #[serde(deserialize_with = "crate::required_nullable::deserialize")]
    pub reply_to: Option<String>,
    pub kind: MessageKind,
    #[serde(rename = "type")]
    pub message_type: RunDisposeType,
    pub run_id: String,
    pub sequence: u64,
    pub payload: RunDisposePayload,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerReadyPayload {
    pub selected_protocol_version: u32,
    pub core_version: String,
    pub transfer_mode: TransferMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerReadyMessage {
    pub protocol_version: u32,
    pub message_id: String,
    pub reply_to: String,
    pub kind: MessageKind,
    #[serde(rename = "type")]
    pub message_type: WorkerReadyType,
    #[serde(deserialize_with = "crate::required_nullable::deserialize")]
    pub run_id: Option<String>,
    pub sequence: u64,
    pub payload: WorkerReadyPayload,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectAcceptedPayload {
    pub project_id: String,
    pub semantic_hash_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectAcceptedMessage {
    pub protocol_version: u32,
    pub message_id: String,
    pub reply_to: String,
    pub kind: MessageKind,
    #[serde(rename = "type")]
    pub message_type: ProjectAcceptedType,
    pub run_id: String,
    pub sequence: u64,
    pub payload: ProjectAcceptedPayload,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WorkerPathSegment {
    Key(String),
    Index(u64),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectRejectedPayload {
    pub code: String,
    pub message_key: String,
    pub path: Vec<WorkerPathSegment>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectRejectedMessage {
    pub protocol_version: u32,
    pub message_id: String,
    pub reply_to: String,
    pub kind: MessageKind,
    #[serde(rename = "type")]
    pub message_type: ProjectRejectedType,
    pub run_id: String,
    pub sequence: u64,
    pub payload: ProjectRejectedPayload,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CollisionSeverity {
    Warning,
    Stop,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "eventType",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SimulationEvent {
    #[serde(rename = "simulation.initialized")]
    Initialized {
        schema_version: u32,
        run_id: String,
        sequence: u64,
        time_s: f64,
        project_id: String,
    },
    #[serde(rename = "simulation.progress")]
    Progress {
        schema_version: u32,
        run_id: String,
        sequence: u64,
        time_s: f64,
        progress_ratio: f64,
        toolpath_segment_index: u64,
        stock_revision: u64,
        tool_position_mm: Vec3Mm,
    },
    #[serde(rename = "simulation.diagnostic")]
    Diagnostic {
        schema_version: u32,
        run_id: String,
        sequence: u64,
        time_s: f64,
        severity: DiagnosticSeverity,
        code: String,
        message_key: String,
        #[serde(deserialize_with = "crate::required_nullable::deserialize")]
        source_line: Option<u64>,
    },
    #[serde(rename = "simulation.collision")]
    Collision {
        schema_version: u32,
        run_id: String,
        sequence: u64,
        time_s: f64,
        severity: CollisionSeverity,
        object_a_id: String,
        object_b_id: String,
        position_mm: Vec3Mm,
        penetration_estimate_mm: f64,
        #[serde(deserialize_with = "crate::required_nullable::deserialize")]
        source_line: Option<u64>,
    },
    #[serde(rename = "simulation.completed")]
    Completed {
        schema_version: u32,
        run_id: String,
        sequence: u64,
        time_s: f64,
        duration_s: f64,
        stock_revision: u64,
    },
    #[serde(rename = "simulation.failed")]
    Failed {
        schema_version: u32,
        run_id: String,
        sequence: u64,
        time_s: f64,
        code: String,
        message_key: String,
        recoverable: bool,
    },
}

impl SimulationEvent {
    pub fn run_id(&self) -> &str {
        match self {
            Self::Initialized { run_id, .. }
            | Self::Progress { run_id, .. }
            | Self::Diagnostic { run_id, .. }
            | Self::Collision { run_id, .. }
            | Self::Completed { run_id, .. }
            | Self::Failed { run_id, .. } => run_id,
        }
    }

    pub fn sequence(&self) -> u64 {
        match self {
            Self::Initialized { sequence, .. }
            | Self::Progress { sequence, .. }
            | Self::Diagnostic { sequence, .. }
            | Self::Collision { sequence, .. }
            | Self::Completed { sequence, .. }
            | Self::Failed { sequence, .. } => *sequence,
        }
    }

    fn validate_at(&self, path: &str) -> ContractResult<()> {
        match self {
            Self::Initialized {
                schema_version,
                run_id,
                sequence,
                time_s,
                project_id,
            } => {
                validate_event_base(*schema_version, run_id, *sequence, *time_s, path)?;
                validate_uuid(project_id, &field(path, "projectId"))
            }
            Self::Progress {
                schema_version,
                run_id,
                sequence,
                time_s,
                progress_ratio,
                toolpath_segment_index,
                stock_revision,
                tool_position_mm,
            } => {
                validate_event_base(*schema_version, run_id, *sequence, *time_s, path)?;
                validate_non_negative(*progress_ratio, &field(path, "progressRatio"))?;
                if *progress_ratio > 1.0 {
                    return contract_error(
                        "number.out_of_range",
                        field(path, "progressRatio"),
                        "progressRatio must be between zero and one",
                    );
                }
                validate_safe_sequence(
                    *toolpath_segment_index,
                    &field(path, "toolpathSegmentIndex"),
                )?;
                validate_safe_sequence(*stock_revision, &field(path, "stockRevision"))?;
                validate_vec3(tool_position_mm, &field(path, "toolPositionMm"))
            }
            Self::Diagnostic {
                schema_version,
                run_id,
                sequence,
                time_s,
                code,
                message_key,
                source_line,
                ..
            } => {
                validate_event_base(*schema_version, run_id, *sequence, *time_s, path)?;
                validate_code(code, &field(path, "code"))?;
                validate_code(message_key, &field(path, "messageKey"))?;
                validate_optional_source_line(*source_line, &field(path, "sourceLine"))
            }
            Self::Collision {
                schema_version,
                run_id,
                sequence,
                time_s,
                object_a_id,
                object_b_id,
                position_mm,
                penetration_estimate_mm,
                source_line,
                ..
            } => {
                validate_event_base(*schema_version, run_id, *sequence, *time_s, path)?;
                validate_uuid(object_a_id, &field(path, "objectAId"))?;
                validate_uuid(object_b_id, &field(path, "objectBId"))?;
                validate_vec3(position_mm, &field(path, "positionMm"))?;
                validate_positive(
                    *penetration_estimate_mm,
                    &field(path, "penetrationEstimateMm"),
                )?;
                validate_optional_source_line(*source_line, &field(path, "sourceLine"))
            }
            Self::Completed {
                schema_version,
                run_id,
                sequence,
                time_s,
                duration_s,
                stock_revision,
            } => {
                validate_event_base(*schema_version, run_id, *sequence, *time_s, path)?;
                validate_non_negative(*duration_s, &field(path, "durationS"))?;
                validate_safe_sequence(*stock_revision, &field(path, "stockRevision"))
            }
            Self::Failed {
                schema_version,
                run_id,
                sequence,
                time_s,
                code,
                message_key,
                ..
            } => {
                validate_event_base(*schema_version, run_id, *sequence, *time_s, path)?;
                validate_code(code, &field(path, "code"))?;
                validate_code(message_key, &field(path, "messageKey"))
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SimulationEventPayload {
    pub event: SimulationEvent,
    pub binary_handles: Vec<BinaryHandleDescriptor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SimulationEventMessage {
    pub protocol_version: u32,
    pub message_id: String,
    #[serde(deserialize_with = "crate::required_nullable::deserialize")]
    pub reply_to: Option<String>,
    pub kind: MessageKind,
    #[serde(rename = "type")]
    pub message_type: SimulationEventType,
    pub run_id: String,
    pub sequence: u64,
    pub payload: SimulationEventPayload,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerErrorPayload {
    pub code: String,
    pub message_key: String,
    pub recoverable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerErrorMessage {
    pub protocol_version: u32,
    pub message_id: String,
    #[serde(deserialize_with = "crate::required_nullable::deserialize")]
    pub reply_to: Option<String>,
    pub kind: MessageKind,
    #[serde(rename = "type")]
    pub message_type: WorkerErrorType,
    #[serde(deserialize_with = "crate::required_nullable::deserialize")]
    pub run_id: Option<String>,
    pub sequence: u64,
    pub payload: WorkerErrorPayload,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WorkerMessage {
    WorkerHandshake(WorkerHandshakeMessage),
    ProjectLoad(Box<ProjectLoadMessage>),
    RunDispose(RunDisposeMessage),
    WorkerReady(WorkerReadyMessage),
    ProjectAccepted(ProjectAcceptedMessage),
    ProjectRejected(ProjectRejectedMessage),
    SimulationEvent(SimulationEventMessage),
    WorkerError(WorkerErrorMessage),
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkerMessageTag {
    WorkerHandshake,
    ProjectLoad,
    RunDispose,
    WorkerReady,
    ProjectAccepted,
    ProjectRejected,
    SimulationEvent,
    WorkerError,
}

impl WorkerMessage {
    pub fn from_json_str(input: &str) -> ContractResult<Self> {
        let message: Self = serde_json::from_str(input)
            .map_err(|error| ContractError::new("message.deserialize", "$", error.to_string()))?;
        message.validate()?;
        Ok(message)
    }

    pub fn from_json_value(value: Value) -> ContractResult<Self> {
        let message: Self = serde_json::from_value(value)
            .map_err(|error| ContractError::new("message.deserialize", "$", error.to_string()))?;
        message.validate()?;
        Ok(message)
    }

    pub fn message_id(&self) -> &str {
        match self {
            Self::WorkerHandshake(message) => &message.message_id,
            Self::ProjectLoad(message) => &message.message_id,
            Self::RunDispose(message) => &message.message_id,
            Self::WorkerReady(message) => &message.message_id,
            Self::ProjectAccepted(message) => &message.message_id,
            Self::ProjectRejected(message) => &message.message_id,
            Self::SimulationEvent(message) => &message.message_id,
            Self::WorkerError(message) => &message.message_id,
        }
    }

    pub fn run_id(&self) -> Option<&str> {
        match self {
            Self::WorkerHandshake(message) => message.run_id.as_deref(),
            Self::ProjectLoad(message) => Some(&message.run_id),
            Self::RunDispose(message) => Some(&message.run_id),
            Self::WorkerReady(message) => message.run_id.as_deref(),
            Self::ProjectAccepted(message) => Some(&message.run_id),
            Self::ProjectRejected(message) => Some(&message.run_id),
            Self::SimulationEvent(message) => Some(&message.run_id),
            Self::WorkerError(message) => message.run_id.as_deref(),
        }
    }

    pub fn sequence(&self) -> u64 {
        match self {
            Self::WorkerHandshake(message) => message.sequence,
            Self::ProjectLoad(message) => message.sequence,
            Self::RunDispose(message) => message.sequence,
            Self::WorkerReady(message) => message.sequence,
            Self::ProjectAccepted(message) => message.sequence,
            Self::ProjectRejected(message) => message.sequence,
            Self::SimulationEvent(message) => message.sequence,
            Self::WorkerError(message) => message.sequence,
        }
    }

    pub fn kind(&self) -> MessageKind {
        match self {
            Self::WorkerHandshake(message) => message.kind,
            Self::ProjectLoad(message) => message.kind,
            Self::RunDispose(message) => message.kind,
            Self::WorkerReady(message) => message.kind,
            Self::ProjectAccepted(message) => message.kind,
            Self::ProjectRejected(message) => message.kind,
            Self::SimulationEvent(message) => message.kind,
            Self::WorkerError(message) => message.kind,
        }
    }

    fn reply_to(&self) -> Option<&str> {
        match self {
            Self::WorkerHandshake(message) => message.reply_to.as_deref(),
            Self::ProjectLoad(message) => message.reply_to.as_deref(),
            Self::RunDispose(message) => message.reply_to.as_deref(),
            Self::WorkerReady(message) => Some(&message.reply_to),
            Self::ProjectAccepted(message) => Some(&message.reply_to),
            Self::ProjectRejected(message) => Some(&message.reply_to),
            Self::SimulationEvent(message) => message.reply_to.as_deref(),
            Self::WorkerError(message) => message.reply_to.as_deref(),
        }
    }

    fn message_tag(&self) -> WorkerMessageTag {
        match self {
            Self::WorkerHandshake(_) => WorkerMessageTag::WorkerHandshake,
            Self::ProjectLoad(_) => WorkerMessageTag::ProjectLoad,
            Self::RunDispose(_) => WorkerMessageTag::RunDispose,
            Self::WorkerReady(_) => WorkerMessageTag::WorkerReady,
            Self::ProjectAccepted(_) => WorkerMessageTag::ProjectAccepted,
            Self::ProjectRejected(_) => WorkerMessageTag::ProjectRejected,
            Self::SimulationEvent(_) => WorkerMessageTag::SimulationEvent,
            Self::WorkerError(_) => WorkerMessageTag::WorkerError,
        }
    }

    pub fn is_run_dispose(&self) -> bool {
        matches!(self, Self::RunDispose(_))
    }
}

impl ContractValidate for WorkerMessage {
    fn validate(&self) -> ContractResult<()> {
        match self {
            Self::WorkerHandshake(message) => {
                validate_envelope(
                    message.protocol_version,
                    &message.message_id,
                    message.reply_to.as_deref(),
                    message.kind,
                    MessageKind::Command,
                    message.sequence,
                )?;
                validate_command_reply_to(&message.reply_to)?;
                if message.run_id.is_some() {
                    return contract_error(
                        "message.run_id",
                        "$.runId",
                        "worker.handshake runId must be null",
                    );
                }
                if message.sequence != 0 {
                    return contract_error(
                        "message.sequence",
                        "$.sequence",
                        "worker.handshake sequence must be zero",
                    );
                }
                if message.payload.supported_protocol_versions.is_empty() {
                    return contract_error(
                        "array.too_small",
                        "$.payload.supportedProtocolVersions",
                        "supportedProtocolVersions must not be empty",
                    );
                }
                if message.payload.supported_protocol_versions.contains(&0) {
                    return contract_error(
                        "number.not_positive",
                        "$.payload.supportedProtocolVersions",
                        "protocol versions must be positive integers",
                    );
                }
                validate_text(
                    &message.payload.client_version,
                    1,
                    64,
                    "$.payload.clientVersion",
                )?;
                if message.payload.transfer_modes.is_empty() {
                    return contract_error(
                        "array.too_small",
                        "$.payload.transferModes",
                        "transferModes must not be empty",
                    );
                }
                Ok(())
            }
            Self::ProjectLoad(message) => {
                validate_envelope(
                    message.protocol_version,
                    &message.message_id,
                    message.reply_to.as_deref(),
                    message.kind,
                    MessageKind::Command,
                    message.sequence,
                )?;
                validate_command_reply_to(&message.reply_to)?;
                validate_uuid(&message.run_id, "$.runId")?;
                message.payload.project.validate()?;
                validate_binary_handles(&message.payload.binary_handles, "$.payload.binaryHandles")
            }
            Self::RunDispose(message) => {
                validate_envelope(
                    message.protocol_version,
                    &message.message_id,
                    message.reply_to.as_deref(),
                    message.kind,
                    MessageKind::Command,
                    message.sequence,
                )?;
                validate_command_reply_to(&message.reply_to)?;
                validate_uuid(&message.run_id, "$.runId")
            }
            Self::WorkerReady(message) => {
                validate_envelope(
                    message.protocol_version,
                    &message.message_id,
                    Some(&message.reply_to),
                    message.kind,
                    MessageKind::Event,
                    message.sequence,
                )?;
                if message.run_id.is_some() {
                    return contract_error(
                        "message.run_id",
                        "$.runId",
                        "worker.ready runId must be null",
                    );
                }
                if message.sequence != 0 {
                    return contract_error(
                        "message.sequence",
                        "$.sequence",
                        "worker.ready sequence must be zero",
                    );
                }
                if message.payload.selected_protocol_version != WORKER_PROTOCOL_VERSION {
                    return contract_error(
                        "protocol.version",
                        "$.payload.selectedProtocolVersion",
                        format!("selected protocol version must be {WORKER_PROTOCOL_VERSION}"),
                    );
                }
                validate_text(
                    &message.payload.core_version,
                    1,
                    64,
                    "$.payload.coreVersion",
                )
            }
            Self::ProjectAccepted(message) => {
                validate_envelope(
                    message.protocol_version,
                    &message.message_id,
                    Some(&message.reply_to),
                    message.kind,
                    MessageKind::Event,
                    message.sequence,
                )?;
                validate_uuid(&message.run_id, "$.runId")?;
                validate_uuid(&message.payload.project_id, "$.payload.projectId")?;
                validate_lower_hex(
                    &message.payload.semantic_hash_sha256,
                    64,
                    "$.payload.semanticHashSha256",
                )
            }
            Self::ProjectRejected(message) => {
                validate_envelope(
                    message.protocol_version,
                    &message.message_id,
                    Some(&message.reply_to),
                    message.kind,
                    MessageKind::Event,
                    message.sequence,
                )?;
                validate_uuid(&message.run_id, "$.runId")?;
                validate_code(&message.payload.code, "$.payload.code")?;
                validate_code(&message.payload.message_key, "$.payload.messageKey")?;
                for (index, segment) in message.payload.path.iter().enumerate() {
                    if let WorkerPathSegment::Index(index_value) = segment {
                        validate_safe_sequence(*index_value, &format!("$.payload.path[{index}]"))?;
                    }
                }
                Ok(())
            }
            Self::SimulationEvent(message) => {
                validate_envelope(
                    message.protocol_version,
                    &message.message_id,
                    message.reply_to.as_deref(),
                    message.kind,
                    MessageKind::Event,
                    message.sequence,
                )?;
                validate_uuid(&message.run_id, "$.runId")?;
                message.payload.event.validate_at("$.payload.event")?;
                if message.run_id != message.payload.event.run_id() {
                    return contract_error(
                        "message.run_id_mismatch",
                        "$.payload.event.runId",
                        "simulation event runId must match the envelope runId",
                    );
                }
                if message.sequence != message.payload.event.sequence() {
                    return contract_error(
                        "message.sequence_mismatch",
                        "$.payload.event.sequence",
                        "simulation event sequence must match the envelope sequence",
                    );
                }
                validate_binary_handles(&message.payload.binary_handles, "$.payload.binaryHandles")
            }
            Self::WorkerError(message) => {
                validate_envelope(
                    message.protocol_version,
                    &message.message_id,
                    message.reply_to.as_deref(),
                    message.kind,
                    MessageKind::Event,
                    message.sequence,
                )?;
                if let Some(run_id) = &message.run_id {
                    validate_uuid(run_id, "$.runId")?;
                }
                validate_code(&message.payload.code, "$.payload.code")?;
                validate_code(&message.payload.message_key, "$.payload.messageKey")
            }
        }
    }
}
#[derive(Debug, Clone)]
struct AcceptedMessageMetadata {
    message_tag: WorkerMessageTag,
    run_id: Option<String>,
}

#[derive(Debug, Default)]
pub struct WorkerProtocolValidator {
    messages: HashMap<String, AcceptedMessageMetadata>,
    last_sequence: HashMap<(MessageKind, String), u64>,
    disposed_runs: HashSet<String>,
}

impl WorkerProtocolValidator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn accept_json_value(&mut self, value: Value) -> ContractResult<WorkerMessage> {
        let message = WorkerMessage::from_json_value(value)?;
        self.accept(message)
    }

    pub fn accept(&mut self, message: WorkerMessage) -> ContractResult<WorkerMessage> {
        message.validate()?;

        if self.messages.contains_key(message.message_id()) {
            return contract_error(
                "message.duplicate",
                "$.messageId",
                "messageId has already been accepted",
            );
        }
        validate_reply_reference(&self.messages, &message)?;

        if let Some(run_id) = message.run_id() {
            if self.disposed_runs.contains(run_id) {
                return contract_error(
                    "run.disposed",
                    "$.runId",
                    "messages for a disposed run are stale",
                );
            }
            let sequence_key = (message.kind(), run_id.to_owned());
            if self
                .last_sequence
                .get(&sequence_key)
                .is_some_and(|last_sequence| message.sequence() <= *last_sequence)
            {
                return contract_error(
                    "sequence.not_monotonic",
                    "$.sequence",
                    "sequence must increase monotonically within a run",
                );
            }
            self.last_sequence.insert(sequence_key, message.sequence());
        }

        let metadata = AcceptedMessageMetadata {
            message_tag: message.message_tag(),
            run_id: message.run_id().map(str::to_owned),
        };
        self.messages
            .insert(message.message_id().to_owned(), metadata);
        if message.is_run_dispose()
            && let Some(run_id) = message.run_id()
        {
            self.disposed_runs.insert(run_id.to_owned());
        }

        Ok(message)
    }
}
fn validate_reply_reference(
    messages: &HashMap<String, AcceptedMessageMetadata>,
    message: &WorkerMessage,
) -> ContractResult<()> {
    let Some(reply_to) = message.reply_to() else {
        return Ok(());
    };

    let Some(target) = messages.get(reply_to) else {
        return contract_error(
            "reply.unknown",
            "$.replyTo",
            "replyTo must reference an already accepted message ID",
        );
    };

    let expectation = match message.message_tag() {
        WorkerMessageTag::WorkerReady => Some((WorkerMessageTag::WorkerHandshake, false)),
        WorkerMessageTag::ProjectAccepted | WorkerMessageTag::ProjectRejected => {
            Some((WorkerMessageTag::ProjectLoad, true))
        }
        _ => None,
    };

    if let Some((expected_tag, require_same_run)) = expectation {
        if target.message_tag != expected_tag {
            return contract_error(
                "reply.type_mismatch",
                "$.replyTo",
                "replyTo references an incompatible message type",
            );
        }
        if require_same_run && target.run_id.as_deref() != message.run_id() {
            return contract_error(
                "reply.run_mismatch",
                "$.replyTo",
                "replyTo target must belong to the same run",
            );
        }
    }

    Ok(())
}
fn validate_command_reply_to(reply_to: &Option<String>) -> ContractResult<()> {
    if reply_to.is_none() {
        Ok(())
    } else {
        contract_error(
            "message.reply_not_null",
            "$.replyTo",
            "one-way command replyTo must be explicit null",
        )
    }
}

fn validate_envelope(
    protocol_version: u32,
    message_id: &str,
    reply_to: Option<&str>,
    actual_kind: MessageKind,
    expected_kind: MessageKind,
    sequence: u64,
) -> ContractResult<()> {
    if protocol_version != WORKER_PROTOCOL_VERSION {
        return contract_error(
            "protocol.version",
            "$.protocolVersion",
            format!("expected protocol version {WORKER_PROTOCOL_VERSION}"),
        );
    }
    validate_uuid(message_id, "$.messageId")?;
    if let Some(reply_to) = reply_to {
        validate_uuid(reply_to, "$.replyTo")?;
    }
    if actual_kind != expected_kind {
        return contract_error(
            "message.kind",
            "$.kind",
            format!("expected message kind {expected_kind:?}"),
        );
    }
    validate_safe_sequence(sequence, "$.sequence")
}

fn validate_binary_handles(handles: &[BinaryHandleDescriptor], path: &str) -> ContractResult<()> {
    for (index, handle) in handles.iter().enumerate() {
        let handle_path = index_path(path, index);
        validate_uuid(&handle.handle_id, &field(&handle_path, "handleId"))?;
        if handle.byte_length == 0 || handle.byte_length > MAX_SAFE_INTEGER {
            return contract_error(
                "number.out_of_range",
                field(&handle_path, "byteLength"),
                "byteLength must be a positive JavaScript-safe integer",
            );
        }
    }
    Ok(())
}

fn validate_event_base(
    schema_version: u32,
    run_id: &str,
    sequence: u64,
    time_s: f64,
    path: &str,
) -> ContractResult<()> {
    validate_schema_version(schema_version, &field(path, "schemaVersion"))?;
    validate_uuid(run_id, &field(path, "runId"))?;
    validate_safe_sequence(sequence, &field(path, "sequence"))?;
    validate_non_negative(time_s, &field(path, "timeS"))
}

fn validate_optional_source_line(value: Option<u64>, path: &str) -> ContractResult<()> {
    if let Some(value) = value {
        if value == 0 {
            return contract_error(
                "number.not_positive",
                path,
                "sourceLine must be greater than zero",
            );
        }
        validate_safe_sequence(value, path)?;
    }
    Ok(())
}

fn validate_vec3(value: &Vec3Mm, path: &str) -> ContractResult<()> {
    validate_finite(value.x_mm, &field(path, "xMm"))?;
    validate_finite(value.y_mm, &field(path, "yMm"))?;
    validate_finite(value.z_mm, &field(path, "zMm"))
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

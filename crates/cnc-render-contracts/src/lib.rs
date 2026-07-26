#![forbid(unsafe_code)]

pub mod canonical;
pub mod domain;
mod required_nullable;
mod semantic;
pub mod units;
pub mod validation;
pub mod worker;

pub use canonical::{canonical_json, semantic_hash};
pub use domain::{ContractValidate, Project};
pub use validation::{ContractError, ContractResult};
pub use worker::{WorkerMessage, WorkerProtocolValidator};

pub const SCHEMA_VERSION: u32 = 1;
pub const WORKER_PROTOCOL_VERSION: u32 = 1;
pub const PROJECT_SCHEMA_ID: &str = "urn:cnc-render:schema:project:1";

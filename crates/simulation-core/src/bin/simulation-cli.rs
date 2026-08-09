use cnc_render_contracts::domain::{MachineDefinition, Vec3Mm};
use cnc_render_simulation_core::{
    SimulationError, ThreeAxisKinematics, ThreeAxisPose,
    material_removal::{
        MillingQualityPreset, MillingStockDiagnostics, MillingStockInput, MillingSweep,
        MillingToolInput, SparseDexelMillingEngine,
    },
    turning::{
        LatheRadiusFieldEngine, TurningCut, TurningProfileDiagnostics, TurningQualityPreset,
        TurningStockInput, TurningToolKind,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    io::{self, Read},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PoseRequest {
    machine: MachineDefinition,
    tcp_at_home_mm: Vec3Mm,
    poses: Vec<PoseInput>,
    repetitions: u32,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum CliRequest {
    StockHash(StockHashRequest),
    LatheProfile(LatheProfileRequest),
    Poses(PoseRequest),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StockHashRequest {
    request_type: StockHashRequestType,
    stock: MillingStockInput,
    tool: MillingToolInput,
    preset: MillingQualityPreset,
    seed: u32,
    brick_size_dexels: usize,
    sweeps: Vec<MillingSweep>,
    repetitions: u32,
}

#[derive(Debug, Deserialize)]
enum StockHashRequestType {
    #[serde(rename = "stock-hash")]
    StockHash,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LatheProfileRequest {
    request_type: LatheProfileRequestType,
    stock: TurningStockInput,
    tool_kind: TurningToolKind,
    preset: TurningQualityPreset,
    seed: u32,
    machine_max_spindle_speed_rpm: f64,
    chuck_grip_length_mm: f64,
    cuts: Vec<TurningCut>,
    repetitions: u32,
}

#[derive(Debug, Deserialize)]
enum LatheProfileRequestType {
    #[serde(rename = "lathe-profile")]
    LatheProfile,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PoseInput {
    id: String,
    axis_positions_mm: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PoseOutput {
    id: String,
    pose: ThreeAxisPose,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PoseResponse {
    stable: bool,
    results: Vec<PoseOutput>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct StockHashEvaluation {
    stock_hash_sha256: String,
    removed_volume_mm3: f64,
    allocated_bricks: usize,
    allocated_bytes: usize,
    revision: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StockHashResponse {
    stable: bool,
    result: StockHashEvaluation,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LatheProfileEvaluation {
    profile_hash_sha256: String,
    removed_volume_mm3: f64,
    axial_cells: usize,
    allocated_bytes: usize,
    revision: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LatheProfileResponse {
    stable: bool,
    result: LatheProfileEvaluation,
}

fn execute(request: PoseRequest) -> Result<PoseResponse, SimulationError> {
    if request.repetitions == 0 || request.repetitions > 10_000 {
        return Err(SimulationError {
            code: "kinematics.request.repetitions-invalid".to_owned(),
            message: "repetitions must be in the inclusive range 1..=10000.".to_owned(),
        });
    }

    let kinematics = ThreeAxisKinematics::new(&request.machine, request.tcp_at_home_mm)?;
    let solve_all = || {
        request
            .poses
            .iter()
            .map(|input| {
                Ok(PoseOutput {
                    id: input.id.clone(),
                    pose: kinematics.solve(&input.axis_positions_mm)?,
                })
            })
            .collect::<Result<Vec<_>, SimulationError>>()
    };

    let baseline = solve_all()?;
    let mut stable = true;
    for _ in 1..request.repetitions {
        if solve_all()? != baseline {
            stable = false;
            break;
        }
    }

    Ok(PoseResponse {
        stable,
        results: baseline,
    })
}

fn evaluate_stock(request: &StockHashRequest) -> Result<StockHashEvaluation, SimulationError> {
    let StockHashRequestType::StockHash = request.request_type;
    let mut engine = SparseDexelMillingEngine::new(
        request.stock.clone(),
        request.tool.clone(),
        request.preset,
        request.seed,
        request.brick_size_dexels,
    )?;
    for sweep in &request.sweeps {
        engine.apply_sweep(sweep)?;
    }
    let MillingStockDiagnostics {
        allocated_bricks,
        allocated_bytes,
        revision,
        removed_volume_mm3,
        ..
    } = engine.diagnostics();
    Ok(StockHashEvaluation {
        stock_hash_sha256: engine.stock_hash_sha256()?,
        removed_volume_mm3,
        allocated_bricks,
        allocated_bytes,
        revision,
    })
}

fn execute_stock_hash(request: StockHashRequest) -> Result<StockHashResponse, SimulationError> {
    if request.repetitions == 0 || request.repetitions > 10_000 {
        return Err(SimulationError {
            code: "material-removal.request.repetitions-invalid".to_owned(),
            message: "repetitions must be in the inclusive range 1..=10000.".to_owned(),
        });
    }

    let baseline = evaluate_stock(&request)?;
    let mut stable = true;
    for _ in 1..request.repetitions {
        if evaluate_stock(&request)? != baseline {
            stable = false;
            break;
        }
    }
    Ok(StockHashResponse {
        stable,
        result: baseline,
    })
}

fn evaluate_lathe_profile(
    request: &LatheProfileRequest,
) -> Result<LatheProfileEvaluation, SimulationError> {
    let LatheProfileRequestType::LatheProfile = request.request_type;
    let mut engine = LatheRadiusFieldEngine::new(
        request.stock.clone(),
        request.tool_kind,
        request.preset,
        request.seed,
        request.machine_max_spindle_speed_rpm,
        request.chuck_grip_length_mm,
    )?;
    for cut in &request.cuts {
        engine.apply_cut(cut)?;
    }
    let TurningProfileDiagnostics {
        axial_cells,
        allocated_bytes,
        revision,
        removed_volume_mm3,
        ..
    } = engine.diagnostics();
    Ok(LatheProfileEvaluation {
        profile_hash_sha256: engine.profile_hash_sha256()?,
        removed_volume_mm3,
        axial_cells,
        allocated_bytes,
        revision,
    })
}

fn execute_lathe_profile(
    request: LatheProfileRequest,
) -> Result<LatheProfileResponse, SimulationError> {
    if request.repetitions == 0 || request.repetitions > 10_000 {
        return Err(SimulationError {
            code: "turning.request.repetitions-invalid".to_owned(),
            message: "repetitions must be in the inclusive range 1..=10000.".to_owned(),
        });
    }
    let baseline = evaluate_lathe_profile(&request)?;
    let mut stable = true;
    for _ in 1..request.repetitions {
        if evaluate_lathe_profile(&request)? != baseline {
            stable = false;
            break;
        }
    }
    Ok(LatheProfileResponse {
        stable,
        result: baseline,
    })
}

fn run() -> Result<(), String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| format!("failed to read request: {error}"))?;
    let request = serde_json::from_str::<CliRequest>(&input)
        .map_err(|error| format!("invalid request JSON: {error}"))?;
    let output = match request {
        CliRequest::Poses(request) => {
            serde_json::to_string(&execute(request).map_err(|error| error.to_string())?)
        }
        CliRequest::StockHash(request) => {
            serde_json::to_string(&execute_stock_hash(request).map_err(|error| error.to_string())?)
        }
        CliRequest::LatheProfile(request) => serde_json::to_string(
            &execute_lathe_profile(request).map_err(|error| error.to_string())?,
        ),
    }
    .map_err(|error| format!("failed to serialize response: {error}"))?;
    println!("{output}");
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

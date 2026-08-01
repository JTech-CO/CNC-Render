use cnc_render_contracts::domain::{MachineDefinition, Vec3Mm};
use cnc_render_simulation_core::{SimulationError, ThreeAxisKinematics, ThreeAxisPose};
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

fn run() -> Result<(), String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| format!("failed to read request: {error}"))?;
    let request = serde_json::from_str::<PoseRequest>(&input)
        .map_err(|error| format!("invalid request JSON: {error}"))?;
    let response = execute(request).map_err(|error| error.to_string())?;
    let output = serde_json::to_string(&response)
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

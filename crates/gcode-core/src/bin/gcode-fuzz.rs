#![forbid(unsafe_code)]

use std::collections::HashSet;
use std::env;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use cnc_render_contracts::domain::ToolpathSegment;
use cnc_render_gcode_core::{
    CanonicalMotion, CoolantState, DiagnosticSeverity, DistanceMode, FeedMode, MotionMode,
    ParseOptions, ParseResult, Plane, ProgramControl, ProgramEnd, ReturnMode, RotaryPositionRad,
    SpindleMode, SpindleState, UnitMode, compile,
};
use serde_json::json;

const DEFAULT_SEED: u64 = 0x434e_4352_454e_4445;
const MAX_SECONDS: f64 = 86_400.0;
const RAW_MAX_BYTES: u64 = 4_096;

const VALID_PREFIXES: &[(&str, &str)] = &[
    ("rapid-linear", "G21 G90\nG0 X0 Y0 Z5\nG1 X10 Y5 Z0 F250\n"),
    (
        "clockwise-arc",
        "G21 G90 G17\nG0 X10 Y0 Z0\nG2 X0 Y-10 I-10 J0 F120\n",
    ),
    (
        "counterclockwise-arc",
        "G21 G90 G17\nG0 X10 Y0 Z0\nG3 X0 Y10 I-10 J0 F120\n",
    ),
    (
        "cycle-81",
        "G21 G90 G17 G99\nG0 X0 Y0 Z5\nG81 X2 Y3 Z-2 R1 F100\nG80\n",
    ),
    (
        "cycle-82",
        "G21 G90 G17 G99\nG0 X0 Y0 Z5\nG82 X2 Y3 Z-2 R1 P0.25 F100\nG80\n",
    ),
    (
        "cycle-83",
        "G21 G90 G17 G99\nG0 X0 Y0 Z5\nG83 X2 Y3 Z-4 R1 Q1 F100\nG80\n",
    ),
    (
        "feed-per-revolution",
        "G21 G90\nG97 S1200 M3\nG95 G1 X10 F0.1\n",
    ),
    (
        "surface-speed-feed",
        "G21 G90\nG0 X20\nG96 S100 M3\nG95 G1 X10 F0.1\n",
    ),
    (
        "surface-speed-modal",
        "G21 G90\nG96 S150 M3\nG94 G1 X10 F100\n",
    ),
];

const MALFORMED_SEEDS: &[(&str, &str)] = &[
    ("unsupported-cutter-compensation", "G41\n"),
    ("linear-missing-feed", "G1 X1\n"),
    ("arc-missing-center", "G2 X1 Y1 F100\n"),
    ("cycle-non-positive-peck", "G83 Z-5 R1 Q0 F100\n"),
    ("feed-per-revolution-missing-speed", "G95 G1 X1 F0.1\n"),
    ("surface-speed-missing-value", "G96\n"),
    ("malformed-number", "G1 X+\n"),
];

fn main() -> ExitCode {
    let Some(configuration) = parse_arguments() else {
        eprintln!("usage: gcode-fuzz --time=SECONDS [--seed=UNSIGNED_INTEGER]");
        return ExitCode::from(2);
    };

    let mut counts = CaseCounts::default();
    if let Err(reason) = run_preflight() {
        print_outcome(false, configuration.seed, counts, Some(0), Some(&reason));
        return ExitCode::from(1);
    }

    let mut random = XorShift64::new(configuration.seed);
    let deadline = Instant::now() + Duration::from_secs_f64(configuration.seconds);
    while Instant::now() < deadline {
        let class = CaseClass::select(&mut random);
        let source = match class {
            CaseClass::Raw => raw_source(&mut random),
            CaseClass::Structured => structured_source(&mut random),
            CaseClass::Mutated => mutated_source(&mut random),
        };

        if let Err(reason) = exercise_twice(&source) {
            print_outcome(
                false,
                configuration.seed,
                counts,
                Some(counts.cases),
                Some(&reason),
            );
            return ExitCode::from(1);
        }
        counts.record(class);
    }

    print_outcome(true, configuration.seed, counts, None, None);
    ExitCode::SUCCESS
}

#[derive(Clone, Copy)]
struct Configuration {
    seconds: f64,
    seed: u64,
}

fn parse_arguments() -> Option<Configuration> {
    let mut seconds = None;
    let mut seed = DEFAULT_SEED;
    for argument in env::args().skip(1) {
        if let Some(value) = argument.strip_prefix("--time=") {
            if seconds.is_some() {
                return None;
            }
            seconds = value.parse::<f64>().ok();
        } else {
            let value = argument.strip_prefix("--seed=")?;
            seed = value.parse::<u64>().ok()?;
        }
    }
    let seconds = seconds?;
    (seconds.is_finite() && seconds > 0.0 && seconds <= MAX_SECONDS)
        .then_some(Configuration { seconds, seed })
}

#[derive(Clone, Copy, Default)]
struct CaseCounts {
    cases: u64,
    raw: u64,
    structured: u64,
    mutated: u64,
}

impl CaseCounts {
    fn record(&mut self, class: CaseClass) {
        self.cases += 1;
        match class {
            CaseClass::Raw => self.raw += 1,
            CaseClass::Structured => self.structured += 1,
            CaseClass::Mutated => self.mutated += 1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CaseClass {
    Raw,
    Structured,
    Mutated,
}

impl CaseClass {
    fn select(random: &mut XorShift64) -> Self {
        match random.next() % 5 {
            0 | 1 => Self::Raw,
            2 | 3 => Self::Structured,
            _ => Self::Mutated,
        }
    }
}

struct Observation {
    result: ParseResult,
    bytes: Vec<u8>,
}

fn observe(source: &str) -> Result<Observation, String> {
    let result = compile(source, &ParseOptions::default());
    validate_parse_result(&result)?;
    let bytes = serde_json::to_vec(&result)
        .map_err(|error| format!("serialization failed after validation: {error}"))?;
    Ok(Observation { result, bytes })
}

fn exercise_twice(source: &str) -> Result<ParseResult, String> {
    let first = catch_unwind(AssertUnwindSafe(|| observe(source)));
    let second = catch_unwind(AssertUnwindSafe(|| observe(source)));
    let first = first.map_err(|_| "first run panicked".to_owned())??;
    let second = second.map_err(|_| "second run panicked".to_owned())??;
    if first.bytes != second.bytes {
        return Err("runs produced non-deterministic serialized bytes".to_owned());
    }
    Ok(first.result)
}

fn run_preflight() -> Result<(), String> {
    for (name, source) in VALID_PREFIXES {
        let result = exercise_twice(source)
            .map_err(|reason| format!("valid preflight seed {name}: {reason}"))?;
        if !result.accepted {
            return Err(format!(
                "valid preflight seed {name} was rejected: {}",
                diagnostic_codes(&result)
            ));
        }
    }
    for (name, source) in MALFORMED_SEEDS {
        let result = exercise_twice(source)
            .map_err(|reason| format!("malformed preflight seed {name}: {reason}"))?;
        if result.accepted {
            return Err(format!(
                "known-malformed preflight seed {name} was silently accepted"
            ));
        }
    }
    Ok(())
}

fn diagnostic_codes(result: &ParseResult) -> String {
    result
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.code.as_str())
        .collect::<Vec<_>>()
        .join(",")
}

fn validate_parse_result(result: &ParseResult) -> Result<(), String> {
    if result.accepted != result.toolpath.is_some() {
        return Err("accepted must be equivalent to toolpath presence".to_owned());
    }

    let has_fatal = result.diagnostics.iter().any(|diagnostic| {
        diagnostic.severity == DiagnosticSeverity::Error && !diagnostic.recoverable
    });
    if result.accepted && has_fatal {
        return Err("accepted result contains a non-recoverable error".to_owned());
    }
    if !result.accepted {
        if !has_fatal {
            return Err("rejected result has no non-recoverable error".to_owned());
        }
        validate_fail_closed(result)?;
    }

    for (name, value) in [
        ("pathLengthMm.total", result.path_length_mm.total),
        ("pathLengthMm.rapid", result.path_length_mm.rapid),
        ("pathLengthMm.feed", result.path_length_mm.feed),
    ] {
        validate_non_negative_finite(name, value)?;
    }
    let parts = result.path_length_mm.rapid + result.path_length_mm.feed;
    if !parts.is_finite() || !approximately_equal(result.path_length_mm.total, parts) {
        return Err("pathLengthMm.total must equal rapid plus feed".to_owned());
    }

    validate_vec3(
        "endpointMm",
        result.endpoint_mm.x_mm,
        result.endpoint_mm.y_mm,
        result.endpoint_mm.z_mm,
    )?;
    validate_vec3(
        "finalState.positionMm",
        result.final_state.position_mm.x_mm,
        result.final_state.position_mm.y_mm,
        result.final_state.position_mm.z_mm,
    )?;
    validate_rotary("finalState.rotaryRad", &result.final_state.rotary_rad)?;

    for diagnostic in &result.diagnostics {
        if diagnostic.line == 0 || diagnostic.column == 0 {
            return Err("diagnostics must use one-based line and column values".to_owned());
        }
        if diagnostic.code.is_empty() {
            return Err("diagnostics must use a non-empty stable code".to_owned());
        }
    }
    let ordered_diagnostic_count = if result.diagnostics.last().is_some_and(|diagnostic| {
        diagnostic.code == "request.resource_limit" && !diagnostic.recoverable
    }) {
        result.diagnostics.len() - 1
    } else {
        result.diagnostics.len()
    };
    let ordered_diagnostics = &result.diagnostics[..ordered_diagnostic_count];
    if ordered_diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "request.resource_limit")
    {
        return Err("terminal request.resource_limit must be the final diagnostic".to_owned());
    }
    for diagnostics in ordered_diagnostics.windows(2) {
        let previous = (diagnostics[0].line, diagnostics[0].column);
        let current = (diagnostics[1].line, diagnostics[1].column);
        if previous > current {
            return Err("diagnostic prefix is not ordered by line and column".to_owned());
        }
    }

    let mut canonical_lines = Vec::with_capacity(result.canonical_motions.len());
    for (index, motion) in result.canonical_motions.iter().enumerate() {
        canonical_lines.push(validate_canonical_motion(index, motion)?);
    }

    if let Some(toolpath) = &result.toolpath {
        if toolpath.segments.len() != result.canonical_motions.len()
            || toolpath.segments.len() != toolpath.source_line_map.len()
        {
            return Err(
                "canonical motions, Toolpath segments, and sourceLineMap are not 1:1".to_owned(),
            );
        }

        let mut segment_ids = HashSet::with_capacity(toolpath.segments.len());
        let mut mapped_ids = HashSet::with_capacity(toolpath.source_line_map.len());
        for (index, (segment, mapping)) in toolpath
            .segments
            .iter()
            .zip(&toolpath.source_line_map)
            .enumerate()
        {
            validate_toolpath_segment(index, segment)?;
            let id = segment.id();
            if id.is_empty() {
                return Err(format!("Toolpath segment {index} has an empty id"));
            }
            if !segment_ids.insert(id) {
                return Err(format!("Toolpath segment id {id} is not unique"));
            }
            if !mapped_ids.insert(mapping.segment_id.as_str()) {
                return Err(format!(
                    "sourceLineMap segment id {} is not unique",
                    mapping.segment_id
                ));
            }
            if mapping.segment_id != id {
                return Err(format!(
                    "Toolpath segment {index} does not match its sourceLineMap entry"
                ));
            }
            if mapping.source_line == 0 {
                return Err(format!("Toolpath segment {index} maps to source line zero"));
            }
            if mapping.source_line != canonical_lines[index] {
                return Err(format!(
                    "Toolpath segment {index} source line does not match its canonical motion"
                ));
            }
            if segment_sequence(segment) != index as u64 {
                return Err(format!(
                    "Toolpath segment {index} has a non-contiguous sequence"
                ));
            }
        }
    }

    Ok(())
}

fn validate_fail_closed(result: &ParseResult) -> Result<(), String> {
    if !result.canonical_motions.is_empty() {
        return Err("fatal result leaked canonical motions".to_owned());
    }
    if !result.program_control_events.is_empty() {
        return Err("fatal result leaked program-control events".to_owned());
    }
    if result.path_length_mm.total != 0.0
        || result.path_length_mm.rapid != 0.0
        || result.path_length_mm.feed != 0.0
    {
        return Err("fatal result did not reset path-length summaries".to_owned());
    }

    let endpoint = &result.endpoint_mm;
    let state = &result.final_state;
    if endpoint.x_mm != 0.0
        || endpoint.y_mm != 0.0
        || endpoint.z_mm != 0.0
        || state.position_mm.x_mm != 0.0
        || state.position_mm.y_mm != 0.0
        || state.position_mm.z_mm != 0.0
        || state.rotary_rad != RotaryPositionRad::default()
        || state.motion_mode != MotionMode::None
        || state.plane != Plane::Xy
        || state.distance_mode != DistanceMode::Absolute
        || state.unit_mode != UnitMode::Millimeter
        || state.feed_mode != FeedMode::UnitsPerMinute
        || state.spindle_mode != SpindleMode::Rpm
        || state.spindle_state != SpindleState::Off
        || state.coolant_state != CoolantState::Off
        || state.return_mode != ReturnMode::InitialPlane
        || state.work_coordinate != "g54"
        || state.selected_tool.is_some()
        || state.active_tool_length_offset.is_some()
        || state.cutter_compensation_active
        || state.program_end != ProgramEnd::None
        || state.last_program_control != ProgramControl::None
    {
        return Err("fatal result did not restore the default safe initial state".to_owned());
    }
    Ok(())
}

fn validate_canonical_motion(index: usize, motion: &CanonicalMotion) -> Result<u64, String> {
    let source_line = match motion {
        CanonicalMotion::Rapid {
            source_line,
            start_mm,
            end_mm,
            start_rotary_rad,
            end_rotary_rad,
        } => {
            validate_position(format!("canonicalMotions[{index}].startMm"), start_mm)?;
            validate_position(format!("canonicalMotions[{index}].endMm"), end_mm)?;
            validate_rotary(
                &format!("canonicalMotions[{index}].startRotaryRad"),
                start_rotary_rad,
            )?;
            validate_rotary(
                &format!("canonicalMotions[{index}].endRotaryRad"),
                end_rotary_rad,
            )?;
            *source_line
        }
        CanonicalMotion::Linear {
            source_line,
            start_mm,
            end_mm,
            start_rotary_rad,
            end_rotary_rad,
            feed_mm_per_min,
        } => {
            validate_position(format!("canonicalMotions[{index}].startMm"), start_mm)?;
            validate_position(format!("canonicalMotions[{index}].endMm"), end_mm)?;
            validate_rotary(
                &format!("canonicalMotions[{index}].startRotaryRad"),
                start_rotary_rad,
            )?;
            validate_rotary(
                &format!("canonicalMotions[{index}].endRotaryRad"),
                end_rotary_rad,
            )?;
            validate_positive_finite(
                &format!("canonicalMotions[{index}].feedMmPerMin"),
                *feed_mm_per_min,
            )?;
            *source_line
        }
        CanonicalMotion::Arc {
            source_line,
            start_mm,
            end_mm,
            center_offset_mm,
            feed_mm_per_min,
            ..
        } => {
            validate_position(format!("canonicalMotions[{index}].startMm"), start_mm)?;
            validate_position(format!("canonicalMotions[{index}].endMm"), end_mm)?;
            validate_position(
                format!("canonicalMotions[{index}].centerOffsetMm"),
                center_offset_mm,
            )?;
            validate_positive_finite(
                &format!("canonicalMotions[{index}].feedMmPerMin"),
                *feed_mm_per_min,
            )?;
            *source_line
        }
        CanonicalMotion::Dwell {
            source_line,
            position_mm,
            duration_s,
        } => {
            validate_position(format!("canonicalMotions[{index}].positionMm"), position_mm)?;
            validate_positive_finite(&format!("canonicalMotions[{index}].durationS"), *duration_s)?;
            *source_line
        }
        CanonicalMotion::ToolChange {
            source_line,
            position_mm,
            tool_assembly_id,
        } => {
            validate_position(format!("canonicalMotions[{index}].positionMm"), position_mm)?;
            if tool_assembly_id.is_empty() {
                return Err(format!(
                    "canonicalMotions[{index}].toolAssemblyId must not be empty"
                ));
            }
            *source_line
        }
    };
    if source_line == 0 {
        return Err(format!(
            "canonicalMotions[{index}].sourceLine must be one-based"
        ));
    }
    Ok(source_line)
}

fn validate_toolpath_segment(index: usize, segment: &ToolpathSegment) -> Result<(), String> {
    match segment {
        ToolpathSegment::Rapid {
            start_mm, end_mm, ..
        } => {
            validate_position(format!("segments[{index}].startMm"), start_mm)?;
            validate_position(format!("segments[{index}].endMm"), end_mm)
        }
        ToolpathSegment::Linear {
            start_mm,
            end_mm,
            feed_mm_per_min,
            ..
        } => {
            validate_position(format!("segments[{index}].startMm"), start_mm)?;
            validate_position(format!("segments[{index}].endMm"), end_mm)?;
            validate_positive_finite(&format!("segments[{index}].feedMmPerMin"), *feed_mm_per_min)
        }
        ToolpathSegment::Arc {
            start_mm,
            end_mm,
            center_offset_mm,
            feed_mm_per_min,
            ..
        } => {
            validate_position(format!("segments[{index}].startMm"), start_mm)?;
            validate_position(format!("segments[{index}].endMm"), end_mm)?;
            validate_position(
                format!("segments[{index}].centerOffsetMm"),
                center_offset_mm,
            )?;
            validate_positive_finite(&format!("segments[{index}].feedMmPerMin"), *feed_mm_per_min)
        }
        ToolpathSegment::Dwell {
            position_mm,
            duration_s,
            ..
        } => {
            validate_position(format!("segments[{index}].positionMm"), position_mm)?;
            validate_positive_finite(&format!("segments[{index}].durationS"), *duration_s)
        }
        ToolpathSegment::ToolChange {
            position_mm,
            tool_assembly_id,
            ..
        } => {
            validate_position(format!("segments[{index}].positionMm"), position_mm)?;
            if tool_assembly_id.is_empty() {
                return Err(format!(
                    "segments[{index}].toolAssemblyId must not be empty"
                ));
            }
            Ok(())
        }
    }
}

fn validate_non_negative_finite(name: &str, value: f64) -> Result<(), String> {
    if !value.is_finite() || value < 0.0 || (value == 0.0 && value.is_sign_negative()) {
        return Err(format!(
            "{name} must be a finite canonical non-negative number"
        ));
    }
    Ok(())
}

fn validate_positive_finite(name: &str, value: f64) -> Result<(), String> {
    if !value.is_finite() || value <= 0.0 {
        return Err(format!("{name} must be a finite positive number"));
    }
    Ok(())
}

fn validate_position(
    name: String,
    position: &cnc_render_contracts::domain::Vec3Mm,
) -> Result<(), String> {
    validate_vec3(&name, position.x_mm, position.y_mm, position.z_mm)
}

fn validate_vec3(name: &str, x: f64, y: f64, z: f64) -> Result<(), String> {
    for (axis, value) in [("x", x), ("y", y), ("z", z)] {
        if !value.is_finite() || (value == 0.0 && value.is_sign_negative()) {
            return Err(format!("{name}.{axis} must be a finite canonical number"));
        }
    }
    Ok(())
}

fn validate_rotary(name: &str, rotary: &RotaryPositionRad) -> Result<(), String> {
    for (axis, value) in [
        ("a", rotary.a_rad),
        ("b", rotary.b_rad),
        ("c", rotary.c_rad),
    ] {
        if !value.is_finite() || (value == 0.0 && value.is_sign_negative()) {
            return Err(format!("{name}.{axis} must be a finite canonical number"));
        }
    }
    Ok(())
}

fn approximately_equal(left: f64, right: f64) -> bool {
    let scale = left.abs().max(right.abs()).max(1.0);
    (left - right).abs() <= scale * 1.0e-9
}

fn segment_sequence(segment: &ToolpathSegment) -> u64 {
    match segment {
        ToolpathSegment::Rapid { sequence, .. }
        | ToolpathSegment::Linear { sequence, .. }
        | ToolpathSegment::Arc { sequence, .. }
        | ToolpathSegment::Dwell { sequence, .. }
        | ToolpathSegment::ToolChange { sequence, .. } => *sequence,
    }
}

fn raw_source(random: &mut XorShift64) -> String {
    let length = (random.next() % RAW_MAX_BYTES) as usize;
    let mut bytes = vec![0_u8; length];
    for byte in &mut bytes {
        *byte = random.next() as u8;
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn structured_source(random: &mut XorShift64) -> String {
    let index = (random.next() % VALID_PREFIXES.len() as u64) as usize;
    VALID_PREFIXES[index].1.to_owned()
}

fn mutated_source(random: &mut XorShift64) -> String {
    let mut bytes = structured_source(random).into_bytes();
    let mutation = random.next() % 6;
    match mutation {
        0 if !bytes.is_empty() => {
            let index = random_index(random, bytes.len());
            bytes.remove(index);
        }
        1 if !bytes.is_empty() => {
            let index = random_index(random, bytes.len());
            const REPLACEMENTS: &[u8] = b"@()[]+\0";
            bytes[index] = REPLACEMENTS[random_index(random, REPLACEMENTS.len())];
        }
        2 => {
            let index = random_index_inclusive(random, bytes.len());
            bytes.insert(index, 0xff);
        }
        3 if !bytes.is_empty() => {
            let index = random_index(random, bytes.len());
            bytes.truncate(index);
        }
        4 => bytes.extend_from_slice(b"G41\n"),
        _ if !bytes.is_empty() => {
            let index = random_index(random, bytes.len());
            let byte = bytes[index];
            bytes[index] = if byte.is_ascii_lowercase() {
                byte.to_ascii_uppercase()
            } else if byte.is_ascii_uppercase() {
                byte.to_ascii_lowercase()
            } else {
                b'#'
            };
        }
        _ => bytes.push(b'@'),
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn random_index(random: &mut XorShift64, length: usize) -> usize {
    (random.next() % length as u64) as usize
}

fn random_index_inclusive(random: &mut XorShift64, length: usize) -> usize {
    (random.next() % (length as u64 + 1)) as usize
}

fn print_outcome(ok: bool, seed: u64, counts: CaseCounts, case: Option<u64>, reason: Option<&str>) {
    let mut outcome = json!({
        "ok": ok,
        "seed": seed,
        "cases": counts.cases,
        "raw": counts.raw,
        "structured": counts.structured,
        "mutated": counts.mutated,
    });
    if let Some(case) = case {
        outcome["case"] = json!(case);
    }
    if let Some(reason) = reason {
        outcome["reason"] = json!(reason);
    }
    println!("{outcome}");
}

struct XorShift64(u64);

impl XorShift64 {
    fn new(seed: u64) -> Self {
        Self(if seed == 0 {
            0x9e37_79b9_7f4a_7c15
        } else {
            seed
        })
    }

    fn next(&mut self) -> u64 {
        let mut value = self.0;
        value ^= value << 13;
        value ^= value >> 7;
        value ^= value << 17;
        self.0 = value;
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curated_valid_and_malformed_corpora_hold_their_contracts() {
        run_preflight().expect("preflight corpora must remain valid");
    }

    #[test]
    fn deterministic_mutations_replay_from_the_same_seed() {
        let mut first = XorShift64::new(42);
        let mut second = XorShift64::new(42);
        for _ in 0..64 {
            assert_eq!(
                mutated_source(&mut first),
                mutated_source(&mut second),
                "same seed must reproduce mutations"
            );
        }
    }

    #[test]
    fn result_validator_detects_authoritative_result_leaks() {
        let mut result = compile("G1 X1 F100\n", &ParseOptions::default());
        result.toolpath = None;
        assert!(validate_parse_result(&result).is_err());

        let mut rejected = compile("G41\n", &ParseOptions::default());
        rejected
            .canonical_motions
            .push(compile("G1 X1 F100\n", &ParseOptions::default()).canonical_motions[0].clone());
        assert!(validate_parse_result(&rejected).is_err());

        let mut unsafe_state = compile("G41\n", &ParseOptions::default());
        unsafe_state.final_state.program_end = ProgramEnd::M2;
        assert!(validate_parse_result(&unsafe_state).is_err());

        let mut invalid_summary = compile("G1 X1 F100\n", &ParseOptions::default());
        invalid_summary.path_length_mm.total = f64::NAN;
        assert!(validate_parse_result(&invalid_summary).is_err());
    }

    #[test]
    fn validator_accepts_terminal_resource_diagnostic_only_at_the_end() {
        let source = "(unterminated\n".repeat(cnc_render_gcode_core::MAX_DIAGNOSTICS - 2);
        let result = compile(
            &source,
            &ParseOptions {
                dialect: "unsupported-dialect".to_owned(),
                operation_id: "not-a-uuid".to_owned(),
                ..ParseOptions::default()
            },
        );

        assert_eq!(
            result
                .diagnostics
                .last()
                .map(|diagnostic| diagnostic.code.as_str()),
            Some("request.resource_limit")
        );
        validate_parse_result(&result).expect("terminal-last result must satisfy fuzz invariants");

        let mut misplaced = result;
        let terminal = misplaced.diagnostics.pop().expect("terminal diagnostic");
        misplaced.diagnostics.insert(0, terminal);
        assert!(validate_parse_result(&misplaced).is_err());
    }
    #[test]
    fn raw_structured_and_mutated_cases_all_run_twice() {
        let mut random = XorShift64::new(7);
        for source in [
            raw_source(&mut random),
            structured_source(&mut random),
            mutated_source(&mut random),
        ] {
            exercise_twice(&source).expect("case must not panic or violate invariants");
        }
    }
}

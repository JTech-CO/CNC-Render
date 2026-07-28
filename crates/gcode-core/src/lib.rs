#![forbid(unsafe_code)]

mod block_parser;
mod compiler;
mod geometry;
mod lexer;
mod limits;
mod model;
mod support;

pub use block_parser::parse_blocks;
pub use compiler::compile;
pub use lexer::lex;
pub use limits::{
    GcodeResourceLimits, MAX_CANONICAL_MOTIONS, MAX_CLI_JSON_STDIN_BYTES, MAX_DIAGNOSTICS,
    MAX_GCODE_LINE_BYTES, MAX_GCODE_LINES, MAX_GCODE_SOURCE_BYTES, MAX_GCODE_WORDS,
    MAX_REPETITIONS,
};
pub use model::{
    Block, BlockParserOutput, CanonicalMotion, CliParseResponse, CoolantState,
    DEFAULT_OPERATION_ID, DIALECT, Diagnostic, DiagnosticSeverity, DistanceMode, FeedMode,
    FinalModalState, InitialState, LexedLine, LexerOutput, MotionMode, ParseOptions, ParseRequest,
    ParseResult, PathLengthMm, Plane, ProgramControl, ProgramControlEvent, ProgramEnd, ReturnMode,
    RotaryPositionRad, SpindleMode, SpindleState, SupportEntry, SupportMatrix, UnitMode, Word,
    WordSupportEntry,
};
pub use support::support_matrix;

use sha2::{Digest, Sha256};

pub fn repetitions_are_supported(repetitions: u32) -> bool {
    (1..=MAX_REPETITIONS).contains(&repetitions)
}

pub fn run_repeated(request: &ParseRequest) -> CliParseResponse {
    let options = ParseOptions::from(request);
    let result = compile(&request.source, &options);
    let serialized = serde_json::to_vec(&result).unwrap_or_default();
    let stable = repetitions_are_supported(request.repetitions)
        && (1..request.repetitions).all(|_| {
            serde_json::to_vec(&compile(&request.source, &options))
                .is_ok_and(|candidate| candidate == serialized)
        });
    CliParseResponse {
        result,
        stable,
        serialized_sha256: lower_hex(&Sha256::digest(&serialized)),
    }
}

fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{DIALECT, MAX_REPETITIONS, ParseRequest, repetitions_are_supported, run_repeated};

    #[test]
    fn repeated_wire_result_is_stable() {
        let request: ParseRequest = serde_json::from_str(
            r#"{"source":"G1 X1 F10","dialect":"common-v1","repetitions":100}"#,
        )
        .expect("request");
        let response = run_repeated(&request);
        assert!(response.stable);
        assert_eq!(response.result.dialect, DIALECT);
        assert_eq!(response.serialized_sha256.len(), 64);
    }

    #[test]
    fn repetition_limit_is_inclusive_without_silent_clamping() {
        assert!(!repetitions_are_supported(0));
        assert!(repetitions_are_supported(1));
        assert!(repetitions_are_supported(MAX_REPETITIONS));
        assert!(!repetitions_are_supported(MAX_REPETITIONS + 1));

        let request: ParseRequest = serde_json::from_str(
            r#"{"source":"G1 X1 F10","dialect":"common-v1","repetitions":101}"#,
        )
        .expect("request");
        assert!(!run_repeated(&request).stable);
    }
}

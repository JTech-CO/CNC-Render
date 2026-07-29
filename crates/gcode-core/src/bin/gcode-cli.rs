#![forbid(unsafe_code)]

use std::io::{self, Read};
use std::process::ExitCode;

use cnc_render_gcode_core::{
    MAX_CLI_JSON_STDIN_BYTES, MAX_REPETITIONS, ParseRequest, repetitions_are_supported,
    run_repeated, support_matrix,
};
use serde_json::{Value, json};

fn main() -> ExitCode {
    let input = match read_bounded_utf8(io::stdin(), MAX_CLI_JSON_STDIN_BYTES) {
        Ok(Some(input)) => input,
        Ok(None) => {
            print_error(
                "request.resource_limit",
                &format!("CLI JSON input exceeds the {MAX_CLI_JSON_STDIN_BYTES} byte limit"),
            );
            return ExitCode::from(2);
        }
        Err(error) => {
            print_error("request.stdin", &error.to_string());
            return ExitCode::from(2);
        }
    };
    let value: Value = match serde_json::from_str(&input) {
        Ok(value) => value,
        Err(error) => {
            print_error("request.invalid_json", &error.to_string());
            return ExitCode::from(2);
        }
    };
    if value.get("action").and_then(Value::as_str) == Some("support-matrix") {
        return write_json(&support_matrix());
    }
    if value
        .get("repetitions")
        .is_some_and(|repetitions| !repetitions_json_value_is_supported(repetitions))
    {
        print_error(
            "request.resource_limit",
            &format!("repetitions must be in the inclusive range 1..={MAX_REPETITIONS}"),
        );
        return ExitCode::from(2);
    }
    let request: ParseRequest = match serde_json::from_value(value) {
        Ok(request) => request,
        Err(error) => {
            print_error("request.invalid", &error.to_string());
            return ExitCode::from(2);
        }
    };
    if request.action != "parse" {
        print_error(
            "request.action.unsupported",
            "action must be parse or support-matrix",
        );
        return ExitCode::from(2);
    }
    if !repetitions_are_supported(request.repetitions) {
        print_error(
            "request.resource_limit",
            &format!("repetitions must be in the inclusive range 1..={MAX_REPETITIONS}"),
        );
        return ExitCode::from(2);
    }
    write_json(&run_repeated(&request))
}

fn repetitions_json_value_is_supported(value: &Value) -> bool {
    value
        .as_u64()
        .is_some_and(|repetitions| (1..=u64::from(MAX_REPETITIONS)).contains(&repetitions))
}
fn read_bounded_utf8<R: Read>(reader: R, limit: usize) -> io::Result<Option<String>> {
    let mut bytes = Vec::new();
    reader
        .take(limit.saturating_add(1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Ok(None);
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn write_json(value: &impl serde::Serialize) -> ExitCode {
    match serde_json::to_string(value) {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            print_error("response.serialization", &error.to_string());
            ExitCode::from(2)
        }
    }
}

fn print_error(code: &str, message: &str) {
    println!("{}", json!({"error": {"code": code, "message": message}}));
}

#[cfg(test)]
mod tests {
    use super::{read_bounded_utf8, repetitions_json_value_is_supported};

    #[test]
    fn stdin_byte_limit_is_inclusive() {
        assert_eq!(
            read_bounded_utf8(&b"ab"[..], 3).expect("boundary - 1"),
            Some("ab".to_owned())
        );
        assert_eq!(
            read_bounded_utf8(&b"abc"[..], 3).expect("boundary"),
            Some("abc".to_owned())
        );
        assert_eq!(
            read_bounded_utf8(&b"abcd"[..], 3).expect("boundary + 1"),
            None
        );
    }

    #[test]
    fn raw_repetition_values_outside_the_inclusive_range_are_rejected() {
        assert!(!repetitions_json_value_is_supported(&serde_json::json!(-1)));
        assert!(!repetitions_json_value_is_supported(&serde_json::json!(0)));
        assert!(repetitions_json_value_is_supported(&serde_json::json!(1)));
        assert!(repetitions_json_value_is_supported(&serde_json::json!(100)));
        assert!(!repetitions_json_value_is_supported(&serde_json::json!(
            101
        )));
        assert!(!repetitions_json_value_is_supported(&serde_json::json!(
            1.5
        )));
    }
    #[test]
    fn oversized_input_wins_over_truncated_utf8() {
        assert_eq!(
            read_bounded_utf8(&[b'a', 0xc3, 0xa9][..], 1).expect("oversized"),
            None
        );
    }
}

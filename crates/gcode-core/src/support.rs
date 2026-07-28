use crate::model::{DIALECT, SupportEntry, SupportMatrix, WordSupportEntry};

const G_CODES: &[(&str, &str, &str)] = &[
    ("G0", "supported", "rapid"),
    ("G1", "supported", "linear"),
    ("G2", "supported", "arc-clockwise"),
    ("G3", "supported", "arc-counterclockwise"),
    ("G17", "supported", "plane-xy"),
    ("G18", "supported", "plane-xz"),
    ("G19", "supported", "plane-yz"),
    ("G20", "supported", "units-inch"),
    ("G21", "supported", "units-mm"),
    ("G40", "supported", "cutter-compensation-cancel"),
    ("G41", "recognized-unsupported", "cutter-compensation-left"),
    ("G42", "recognized-unsupported", "cutter-compensation-right"),
    ("G43", "supported", "tool-length-compensation-enable"),
    ("G49", "supported", "tool-length-compensation-cancel"),
    ("G54", "supported", "work-offset-1"),
    ("G55", "supported", "work-offset-2"),
    ("G56", "supported", "work-offset-3"),
    ("G57", "supported", "work-offset-4"),
    ("G58", "supported", "work-offset-5"),
    ("G59", "supported", "work-offset-6"),
    ("G80", "supported", "canned-cycle-cancel"),
    ("G81", "supported", "drill-cycle-expand"),
    ("G82", "supported", "drill-dwell-cycle-expand"),
    ("G83", "supported", "peck-drill-cycle-expand"),
    ("G84", "recognized-unsupported", "tapping-cycle"),
    ("G85", "recognized-unsupported", "boring-feed-out-cycle"),
    ("G86", "recognized-unsupported", "boring-spindle-stop-cycle"),
    ("G87", "recognized-unsupported", "back-boring-cycle"),
    ("G88", "recognized-unsupported", "boring-manual-out-cycle"),
    (
        "G89",
        "recognized-unsupported",
        "boring-dwell-feed-out-cycle",
    ),
    ("G90", "supported", "distance-absolute"),
    ("G91", "supported", "distance-incremental"),
    ("G94", "supported", "feed-per-minute"),
    ("G95", "supported", "feed-per-revolution"),
    ("G96", "supported", "spindle-constant-surface-speed"),
    ("G97", "supported", "spindle-rpm"),
    ("G98", "supported", "cycle-return-initial-plane"),
    ("G99", "supported", "cycle-return-r-plane"),
];

const M_CODES: &[(&str, &str, &str)] = &[
    ("M0", "supported", "program-stop"),
    ("M1", "supported", "optional-program-stop"),
    ("M2", "supported", "program-end"),
    ("M3", "supported", "spindle-clockwise"),
    ("M4", "supported", "spindle-counterclockwise"),
    ("M5", "supported", "spindle-stop"),
    ("M6", "supported", "tool-change"),
    ("M8", "supported", "coolant-on"),
    ("M9", "supported", "coolant-off"),
    ("M30", "supported", "program-end-rewind"),
];

const WORDS: &[(&str, &str, &[&str])] = &[
    ("T", "supported", &["tool-selection"]),
    ("S", "supported", &["spindle-rpm", "surface-speed"]),
    (
        "F",
        "supported",
        &["feed-per-minute", "feed-per-revolution"],
    ),
    ("X", "supported", &["linear-axis", "arc-endpoint", "cycle"]),
    ("Y", "supported", &["linear-axis", "arc-endpoint", "cycle"]),
    ("Z", "supported", &["linear-axis", "arc-endpoint", "cycle"]),
    (
        "A",
        "recognized-unsupported",
        &["rotary-axis", "parsed-not-lowered"],
    ),
    (
        "B",
        "recognized-unsupported",
        &["rotary-axis", "parsed-not-lowered"],
    ),
    (
        "C",
        "recognized-unsupported",
        &["rotary-axis", "parsed-not-lowered"],
    ),
    ("I", "supported", &["arc-center-x"]),
    ("J", "supported", &["arc-center-y"]),
    ("K", "supported", &["arc-center-z"]),
    ("H", "supported", &["tool-length-offset"]),
    ("R", "supported", &["arc-radius", "cycle-retract-plane"]),
    (
        "P",
        "supported",
        &[
            "cycle-dwell-seconds",
            "arc-turn-count-recognized-unsupported",
        ],
    ),
    ("Q", "supported", &["cycle-peck-depth"]),
];

const DIAGNOSTIC_CODES: &[&str] = &[
    "request.resource_limit",
    "request.dialect.unsupported",
    "request.uuid.invalid",
    "request.work_offset.invalid",
    "lexer.macro.unsupported",
    "lexer.symbol.unsupported",
    "lexer.number.invalid",
    "lexer.comment.unterminated",
    "parser.word.unsupported",
    "parser.word.duplicate",
    "parser.gcode.unsupported",
    "parser.mcode.unsupported",
    "parser.modal.conflict",
    "semantic.word.context",
    "semantic.cutter_comp.unsupported",
    "semantic.numeric.non_finite",
    "semantic.motion.missing",
    "semantic.motion.limit",
    "semantic.feed.missing",
    "semantic.feed.non_positive",
    "semantic.feed.unresolved_per_revolution",
    "semantic.arc.missing_center",
    "semantic.arc.invalid_radius",
    "semantic.arc.radius_mismatch",
    "semantic.arc.full_circle_r_unsupported",
    "semantic.arc.center_conflict",
    "semantic.arc.turns.unsupported",
    "semantic.cycle.parameter_missing",
    "semantic.cycle.invalid_parameter",
    "semantic.cycle.plane_change",
    "semantic.cycle.expansion_limit",
    "semantic.tool_length.missing_h",
    "semantic.tool_length.unmapped",
    "semantic.tool.not_selected",
    "semantic.tool.unmapped",
    "semantic.tool.invalid",
    "semantic.rotary.not_lowered",
    "semantic.spindle.missing",
    "semantic.spindle.non_positive",
];

pub fn support_matrix() -> SupportMatrix {
    SupportMatrix {
        schema_version: 1,
        dialect: DIALECT.to_owned(),
        g_codes: G_CODES.iter().map(|entry| support_entry(*entry)).collect(),
        m_codes: M_CODES.iter().map(|entry| support_entry(*entry)).collect(),
        words: WORDS
            .iter()
            .map(|(word, status, contexts)| WordSupportEntry {
                word: (*word).to_owned(),
                status: (*status).to_owned(),
                contexts: contexts
                    .iter()
                    .map(|context| (*context).to_owned())
                    .collect(),
            })
            .collect(),
        diagnostic_codes: DIAGNOSTIC_CODES
            .iter()
            .map(|code| (*code).to_owned())
            .collect(),
    }
}

fn support_entry((code, status, behavior): (&str, &str, &str)) -> SupportEntry {
    SupportEntry {
        code: code.to_owned(),
        status: status.to_owned(),
        behavior: behavior.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::support_matrix;
    use crate::{ParseOptions, compile};

    #[test]
    fn support_tokens_and_diagnostics_are_unique_and_ordered() {
        let matrix = support_matrix();
        assert_eq!(
            matrix.g_codes.first().map(|entry| entry.code.as_str()),
            Some("G0")
        );
        assert_eq!(
            matrix.g_codes.last().map(|entry| entry.code.as_str()),
            Some("G99")
        );
        assert_unique(matrix.g_codes.iter().map(|entry| entry.code.as_str()));
        assert_unique(matrix.m_codes.iter().map(|entry| entry.code.as_str()));
        assert_unique(matrix.words.iter().map(|entry| entry.word.as_str()));
        assert_unique(matrix.diagnostic_codes.iter().map(String::as_str));
        assert!(
            matrix
                .diagnostic_codes
                .iter()
                .any(|code| code == "request.resource_limit")
        );
        assert!(
            matrix
                .diagnostic_codes
                .iter()
                .any(|code| code == "semantic.motion.limit")
        );
    }

    #[test]
    fn recognized_unsupported_cycles_match_compiler_behavior() {
        let matrix = support_matrix();
        for code in 84..=89 {
            let token = format!("G{code}");
            let entry = matrix
                .g_codes
                .iter()
                .find(|entry| entry.code == token)
                .expect("cycle support entry");
            assert_eq!(entry.status, "recognized-unsupported");

            let result = compile(&token, &ParseOptions::default());
            assert!(!result.accepted);
            assert!(result.diagnostics.iter().any(|diagnostic| {
                diagnostic.code == "parser.gcode.unsupported"
                    && diagnostic.line == 1
                    && diagnostic.column == 1
            }));
        }
    }

    #[test]
    fn supported_and_matrix_out_tokens_match_compiler_behavior() {
        let matrix = support_matrix();
        for (token, source) in [("G0", "G0 X1"), ("M3", "S100 M3")] {
            let entries = if token.starts_with('G') {
                &matrix.g_codes
            } else {
                &matrix.m_codes
            };
            assert_eq!(
                entries
                    .iter()
                    .find(|entry| entry.code == token)
                    .map(|entry| entry.status.as_str()),
                Some("supported")
            );
            let result = compile(source, &ParseOptions::default());
            assert!(result.accepted, "{source}: {:?}", result.diagnostics);
        }

        for (token, diagnostic_code) in [
            ("G100", "parser.gcode.unsupported"),
            ("M10", "parser.mcode.unsupported"),
            ("U1", "parser.word.unsupported"),
        ] {
            assert!(!matrix.g_codes.iter().any(|entry| entry.code == token));
            assert!(!matrix.m_codes.iter().any(|entry| entry.code == token));
            assert!(!matrix.words.iter().any(|entry| entry.word == token));
            let result = compile(token, &ParseOptions::default());
            assert!(!result.accepted, "{token}");
            assert!(result.diagnostics.iter().any(|diagnostic| {
                diagnostic.code == diagnostic_code && diagnostic.line == 1 && diagnostic.column == 1
            }));
        }
    }
    fn assert_unique<'a>(tokens: impl IntoIterator<Item = &'a str>) {
        let mut seen = BTreeSet::new();
        for token in tokens {
            assert!(seen.insert(token), "duplicate support token {token}");
        }
    }
}

use crate::model::Diagnostic;

pub const MAX_GCODE_SOURCE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_GCODE_LINE_BYTES: usize = 1024 * 1024;
pub const MAX_GCODE_LINES: usize = 250_000;
pub const MAX_GCODE_WORDS: usize = 1_000_000;
pub const MAX_CANONICAL_MOTIONS: usize = 400_000;
pub const MAX_DIAGNOSTICS: usize = 10_000;
pub const MAX_CLI_JSON_STDIN_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_REPETITIONS: u32 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GcodeResourceLimits {
    pub source_bytes: usize,
    pub line_bytes: usize,
    pub lines: usize,
    pub words: usize,
    pub canonical_motions: usize,
    pub diagnostics: usize,
}

impl Default for GcodeResourceLimits {
    fn default() -> Self {
        Self {
            source_bytes: MAX_GCODE_SOURCE_BYTES,
            line_bytes: MAX_GCODE_LINE_BYTES,
            lines: MAX_GCODE_LINES,
            words: MAX_GCODE_WORDS,
            canonical_motions: MAX_CANONICAL_MOTIONS,
            diagnostics: MAX_DIAGNOSTICS,
        }
    }
}

pub(crate) fn push_diagnostic_with_limit(
    diagnostics: &mut Vec<Diagnostic>,
    diagnostic: Diagnostic,
    limit: usize,
) -> bool {
    if diagnostics
        .last()
        .is_some_and(|existing| existing.code == "request.resource_limit" && !existing.recoverable)
    {
        return false;
    }

    let effective_limit = limit.max(1);
    if diagnostic.code == "request.resource_limit" && !diagnostic.recoverable {
        if diagnostics.len() >= effective_limit {
            diagnostics.truncate(effective_limit - 1);
        }
        diagnostics.push(diagnostic);
        return false;
    }

    if diagnostics.len() < effective_limit - 1 {
        diagnostics.push(diagnostic);
        return true;
    }

    diagnostics.push(Diagnostic::error(
        diagnostic.line as usize,
        diagnostic.column as usize,
        "request.resource_limit",
        false,
        format!("diagnostic count reached the {effective_limit} diagnostic limit"),
    ));
    false
}

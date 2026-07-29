use crate::limits::{GcodeResourceLimits, push_diagnostic_with_limit};
use crate::model::{Diagnostic, LexedLine, LexerOutput, Word};

pub fn lex(source: &str) -> LexerOutput {
    lex_with_limits(source, GcodeResourceLimits::default())
}

pub(crate) fn lex_with_limits(source: &str, limits: GcodeResourceLimits) -> LexerOutput {
    let mut lines = Vec::new();
    let mut diagnostics = Vec::new();
    let mut word_count = 0_usize;

    if source.len() > limits.source_bytes {
        push_diagnostic_with_limit(
            &mut diagnostics,
            Diagnostic::error(
                1,
                1,
                "request.resource_limit",
                false,
                format!(
                    "G-code source is {} bytes; limit is {} bytes",
                    source.len(),
                    limits.source_bytes
                ),
            ),
            limits.diagnostics,
        );
        return LexerOutput { lines, diagnostics };
    }

    for (line_index, text) in source.lines().enumerate() {
        let line_number = line_index + 1;
        if line_index >= limits.lines {
            push_diagnostic_with_limit(
                &mut diagnostics,
                Diagnostic::error(
                    line_number,
                    1,
                    "request.resource_limit",
                    false,
                    format!("G-code line count exceeds the {} line limit", limits.lines),
                ),
                limits.diagnostics,
            );
            return LexerOutput { lines, diagnostics };
        }
        if text.len() > limits.line_bytes {
            push_diagnostic_with_limit(
                &mut diagnostics,
                Diagnostic::error(
                    line_number,
                    1,
                    "request.resource_limit",
                    false,
                    format!(
                        "G-code line is {} bytes; limit is {} bytes",
                        text.len(),
                        limits.line_bytes
                    ),
                ),
                limits.diagnostics,
            );
            return LexerOutput { lines, diagnostics };
        }
        let chars: Vec<char> = text.chars().collect();
        let mut words = Vec::new();
        let mut cursor = 0;

        while cursor < chars.len() {
            let character = chars[cursor];
            if character.is_whitespace() {
                cursor += 1;
                continue;
            }
            if character == ';' {
                break;
            }
            if character == '(' {
                let start = cursor;
                cursor += 1;
                while cursor < chars.len() && chars[cursor] != ')' {
                    cursor += 1;
                }
                if cursor == chars.len() {
                    if !push_diagnostic_with_limit(
                        &mut diagnostics,
                        Diagnostic::error(
                            line_number,
                            start + 1,
                            "lexer.comment.unterminated",
                            true,
                            "parenthesized comment is not terminated",
                        ),
                        limits.diagnostics,
                    ) {
                        return LexerOutput { lines, diagnostics };
                    }
                } else {
                    cursor += 1;
                }
                continue;
            }
            if matches!(character, '%' | '#' | '[' | ']' | '=') {
                if !push_diagnostic_with_limit(
                    &mut diagnostics,
                    Diagnostic::error(
                        line_number,
                        cursor + 1,
                        "lexer.macro.unsupported",
                        false,
                        format!("macro or program construct '{character}' is not supported"),
                    ),
                    limits.diagnostics,
                ) {
                    return LexerOutput { lines, diagnostics };
                }
                cursor += 1;
                continue;
            }
            if !character.is_ascii_alphabetic() {
                if !push_diagnostic_with_limit(
                    &mut diagnostics,
                    Diagnostic::error(
                        line_number,
                        cursor + 1,
                        "lexer.symbol.unsupported",
                        false,
                        format!("unsupported symbol '{character}'"),
                    ),
                    limits.diagnostics,
                ) {
                    return LexerOutput { lines, diagnostics };
                }
                cursor += 1;
                continue;
            }

            let word_start = cursor;
            if word_count >= limits.words {
                push_diagnostic_with_limit(
                    &mut diagnostics,
                    Diagnostic::error(
                        line_number,
                        word_start + 1,
                        "request.resource_limit",
                        false,
                        format!("G-code word count exceeds the {} word limit", limits.words),
                    ),
                    limits.diagnostics,
                );
                return LexerOutput { lines, diagnostics };
            }
            word_count += 1;
            let letter = character.to_ascii_uppercase();
            cursor += 1;
            let numeric_start = cursor;
            if cursor < chars.len() && matches!(chars[cursor], '+' | '-') {
                cursor += 1;
            }
            let mut digits = 0;
            let mut dot = false;
            while cursor < chars.len() {
                if chars[cursor].is_ascii_digit() {
                    digits += 1;
                    cursor += 1;
                } else if chars[cursor] == '.' && !dot {
                    dot = true;
                    cursor += 1;
                } else {
                    break;
                }
            }
            if digits == 0 {
                if !push_diagnostic_with_limit(
                    &mut diagnostics,
                    Diagnostic::error(
                        line_number,
                        word_start + 1,
                        "lexer.number.invalid",
                        false,
                        format!("word {letter} must be followed by a finite decimal number"),
                    ),
                    limits.diagnostics,
                ) {
                    return LexerOutput { lines, diagnostics };
                }
                continue;
            }
            let raw_number: String = chars[numeric_start..cursor].iter().collect();
            let Ok(mut value) = raw_number.parse::<f64>() else {
                if !push_diagnostic_with_limit(
                    &mut diagnostics,
                    Diagnostic::error(
                        line_number,
                        word_start + 1,
                        "lexer.number.invalid",
                        false,
                        format!("word {letter} has an invalid decimal number"),
                    ),
                    limits.diagnostics,
                ) {
                    return LexerOutput { lines, diagnostics };
                }
                continue;
            };
            if !value.is_finite() {
                if !push_diagnostic_with_limit(
                    &mut diagnostics,
                    Diagnostic::error(
                        line_number,
                        word_start + 1,
                        "lexer.number.invalid",
                        false,
                        format!("word {letter} must be finite"),
                    ),
                    limits.diagnostics,
                ) {
                    return LexerOutput { lines, diagnostics };
                }
                continue;
            }
            if value == 0.0 {
                value = 0.0;
            }
            if letter == 'O' {
                if !push_diagnostic_with_limit(
                    &mut diagnostics,
                    Diagnostic::error(
                        line_number,
                        word_start + 1,
                        "lexer.macro.unsupported",
                        false,
                        "O program labels and subprograms are not supported",
                    ),
                    limits.diagnostics,
                ) {
                    return LexerOutput { lines, diagnostics };
                }
                continue;
            }
            words.push(Word {
                letter,
                value,
                raw: chars[word_start..cursor].iter().collect(),
                line: line_number as u64,
                column: (word_start + 1) as u64,
            });
        }
        lines.push(LexedLine {
            source_line: line_number as u64,
            words,
        });
    }

    LexerOutput { lines, diagnostics }
}

#[cfg(test)]
mod tests {
    use super::{lex, lex_with_limits};
    use crate::limits::GcodeResourceLimits;

    #[test]
    fn lexes_words_without_spaces_and_comments() {
        let output = lex("N10G1X1.25Y-2 (ignored) ; rest\n");
        assert_eq!(output.lines[0].words.len(), 4);
        assert_eq!(output.lines[0].words[1].letter, 'G');
        assert_eq!(output.lines[0].words[3].value, -2.0);
        assert!(output.diagnostics.is_empty());
    }

    #[test]
    fn macros_are_never_silent() {
        let output = lex("%\nO100\n#1=[2]\n");
        assert!(
            output
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "lexer.macro.unsupported")
        );
        assert!(output.diagnostics.len() >= 5);
    }

    fn resource_diagnostic(source: &str, limits: GcodeResourceLimits) -> Option<(u64, u64)> {
        lex_with_limits(source, limits)
            .diagnostics
            .into_iter()
            .find(|diagnostic| diagnostic.code == "request.resource_limit")
            .map(|diagnostic| (diagnostic.line, diagnostic.column))
    }

    #[test]
    fn source_and_line_byte_limits_are_inclusive() {
        let source_limits = GcodeResourceLimits {
            source_bytes: 3,
            line_bytes: usize::MAX,
            ..GcodeResourceLimits::default()
        };
        assert_eq!(resource_diagnostic(";;", source_limits), None);
        assert_eq!(resource_diagnostic(";;;", source_limits), None);
        assert_eq!(resource_diagnostic(";;;;", source_limits), Some((1, 1)));

        let line_limits = GcodeResourceLimits {
            source_bytes: usize::MAX,
            line_bytes: 3,
            ..GcodeResourceLimits::default()
        };
        assert_eq!(resource_diagnostic(";;", line_limits), None);
        assert_eq!(resource_diagnostic(";;;", line_limits), None);
        assert_eq!(resource_diagnostic(";;;;", line_limits), Some((1, 1)));
    }

    #[test]
    fn line_and_word_count_limits_are_inclusive() {
        let line_limits = GcodeResourceLimits {
            lines: 2,
            ..GcodeResourceLimits::default()
        };
        assert_eq!(resource_diagnostic(";", line_limits), None);
        assert_eq!(resource_diagnostic(";\n;", line_limits), None);
        assert_eq!(resource_diagnostic(";\n;\n;", line_limits), Some((3, 1)));

        let word_limits = GcodeResourceLimits {
            words: 2,
            ..GcodeResourceLimits::default()
        };
        assert_eq!(resource_diagnostic("G1", word_limits), None);
        assert_eq!(resource_diagnostic("G1 X1", word_limits), None);
        assert_eq!(resource_diagnostic("G1 X1 Y1", word_limits), Some((1, 7)));
    }

    #[test]
    fn invalid_symbol_flood_stops_at_diagnostic_limit() {
        let output = lex_with_limits(
            "!!!!!",
            GcodeResourceLimits {
                diagnostics: 3,
                ..GcodeResourceLimits::default()
            },
        );
        assert_eq!(output.diagnostics.len(), 3);
        assert_eq!(output.diagnostics[0].code, "lexer.symbol.unsupported");
        assert_eq!(output.diagnostics[1].code, "lexer.symbol.unsupported");
        assert_eq!(output.diagnostics[2].code, "request.resource_limit");
        assert_eq!(
            (output.diagnostics[2].line, output.diagnostics[2].column),
            (1, 3)
        );
        assert!(!output.diagnostics[2].recoverable);
    }
}

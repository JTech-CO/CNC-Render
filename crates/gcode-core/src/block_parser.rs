use std::collections::BTreeSet;

use crate::limits::{GcodeResourceLimits, push_diagnostic_with_limit};
use crate::model::{Block, BlockParserOutput, Diagnostic, LexerOutput};

pub fn parse_blocks(lexer_output: &LexerOutput) -> BlockParserOutput {
    parse_blocks_with_limits(lexer_output, GcodeResourceLimits::default())
}

pub(crate) fn parse_blocks_with_limits(
    lexer_output: &LexerOutput,
    limits: GcodeResourceLimits,
) -> BlockParserOutput {
    let mut blocks = Vec::new();
    let mut diagnostics = lexer_output.diagnostics.clone();
    if diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "request.resource_limit" && !diagnostic.recoverable)
    {
        return BlockParserOutput {
            blocks,
            diagnostics,
        };
    }

    for line in &lexer_output.lines {
        let mut seen = BTreeSet::new();
        for word in &line.words {
            if !matches!(word.letter, 'G' | 'M')
                && !seen.insert(word.letter)
                && !push_diagnostic_with_limit(
                    &mut diagnostics,
                    Diagnostic::error(
                        word.line as usize,
                        word.column as usize,
                        "parser.word.duplicate",
                        false,
                        format!("word {} occurs more than once in one block", word.letter),
                    ),
                    limits.diagnostics,
                )
            {
                return BlockParserOutput {
                    blocks,
                    diagnostics,
                };
            }
        }
        if !line.words.is_empty() {
            blocks.push(Block {
                source_line: line.source_line,
                words: line.words.clone(),
            });
        }
    }
    BlockParserOutput {
        blocks,
        diagnostics,
    }
}

#[cfg(test)]
mod tests {
    use super::parse_blocks_with_limits;
    use crate::lexer::lex_with_limits;
    use crate::limits::GcodeResourceLimits;

    #[test]
    fn duplicate_word_flood_stops_at_diagnostic_limit() {
        let limits = GcodeResourceLimits {
            diagnostics: 3,
            ..GcodeResourceLimits::default()
        };
        let output = parse_blocks_with_limits(&lex_with_limits("X1 X2 X3 X4", limits), limits);

        assert_eq!(output.diagnostics.len(), 3);
        assert_eq!(output.diagnostics[0].code, "parser.word.duplicate");
        assert_eq!(output.diagnostics[1].code, "parser.word.duplicate");
        assert_eq!(output.diagnostics[2].code, "request.resource_limit");
        assert_eq!(
            (output.diagnostics[2].line, output.diagnostics[2].column),
            (1, 10)
        );
        assert!(!output.diagnostics[2].recoverable);
    }
}

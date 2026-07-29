use cnc_render_gcode_core::{DiagnosticSeverity, ParseOptions, compile};

#[test]
fn unterminated_comment_is_recoverable_and_keeps_safe_prefix_words() {
    let result = compile(
        "G21 G90 G0 X10 (unterminated\nG1 X20 F100\n",
        &ParseOptions::default(),
    );

    assert!(result.accepted, "{:?}", result.diagnostics);
    assert!(result.toolpath.is_some());
    assert_eq!(result.endpoint_mm.x_mm, 20.0);
    assert_eq!(result.canonical_motions.len(), 2);

    let diagnostic = result
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.code == "lexer.comment.unterminated")
        .expect("unterminated comment diagnostic");
    assert_eq!(diagnostic.severity, DiagnosticSeverity::Error);
    assert!(diagnostic.recoverable);
}

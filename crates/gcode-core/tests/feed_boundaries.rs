use cnc_render_gcode_core::{ParseOptions, compile};

#[test]
fn g95_feed_underflow_cannot_produce_a_zero_ir_feed() {
    let tiny = format!("0.{}1", "0".repeat(199));
    let source = format!("G97 S{tiny}\nG95 F{tiny}\nG1 X1\n");
    let result = compile(&source, &ParseOptions::default());

    assert!(!result.accepted);
    assert!(result.toolpath.is_none());
    assert!(result.canonical_motions.is_empty());
    assert!(result.diagnostics.iter().any(|diagnostic| {
        diagnostic.code == "semantic.feed.non_positive" && !diagnostic.recoverable
    }));
}

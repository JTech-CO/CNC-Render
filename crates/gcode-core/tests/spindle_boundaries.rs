use cnc_render_gcode_core::{ParseOptions, compile};

#[test]
fn every_explicit_g96_requires_a_same_block_speed() {
    let result = compile("G96 S100\nG96\n", &ParseOptions::default());

    assert!(!result.accepted);
    let diagnostics: Vec<_> = result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == "semantic.spindle.missing")
        .collect();
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].line, 2);
    assert!(!diagnostics[0].recoverable);
}

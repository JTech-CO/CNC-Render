use cnc_render_gcode_core::{ParseOptions, compile};

#[test]
fn g83_peck_budget_is_cumulative_across_modal_repeat_blocks() {
    let result = compile(
        "G17 G90 G99 G83 X0 Z-1 R1 Q0.000039999 F1\nX1\n",
        &ParseOptions::default(),
    );

    assert!(!result.accepted);
    assert!(result.toolpath.is_none());
    assert!(result.canonical_motions.is_empty());
    let diagnostic = result
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.code == "semantic.cycle.expansion_limit")
        .expect("parse-wide expansion-limit diagnostic");
    assert_eq!(diagnostic.line, 2);
    assert!(!diagnostic.recoverable);
}

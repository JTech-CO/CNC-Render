use cnc_render_gcode_core::{ParseOptions, compile};

#[test]
fn g96_missing_speed_is_reported_once_on_the_transition_block() {
    let result = compile("G96\nM3\n", &ParseOptions::default());
    let diagnostics: Vec<_> = result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == "semantic.spindle.missing")
        .collect();
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].line, 1);
}

#[test]
fn axis_words_without_a_motion_mode_do_not_move() {
    let result = compile("X10\n", &ParseOptions::default());
    assert!(!result.accepted);
    assert_eq!(result.endpoint_mm.x_mm, 0.0);
    assert!(result.canonical_motions.is_empty());
    assert!(
        result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "semantic.motion.missing")
    );
}

#[test]
fn tiny_peck_distance_is_bounded_before_expansion() {
    let mut options = ParseOptions::default();
    options.initial_state.position_mm.z_mm = 10.0;
    let result = compile("G83 Z-10 R1 Q0.000001 F100\n", &options);
    assert!(!result.accepted);
    assert!(result.canonical_motions.is_empty());
    assert!(
        result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "semantic.cycle.expansion_limit")
    );
}

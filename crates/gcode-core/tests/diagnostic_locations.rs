use cnc_render_gcode_core::{ParseOptions, compile};

#[test]
fn code_specific_diagnostics_point_to_the_actual_g_or_m_word() {
    for (source, code, column) in [
        ("G21 G41\n", "semantic.cutter_comp.unsupported", 5),
        ("G21 G84\n", "parser.gcode.unsupported", 5),
        ("G21 G43\n", "semantic.tool_length.missing_h", 5),
        ("G21 G96\n", "semantic.spindle.missing", 5),
        ("T1 M6\n", "semantic.tool.unmapped", 4),
    ] {
        let result = compile(source, &ParseOptions::default());
        let diagnostic = result
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == code)
            .unwrap_or_else(|| panic!("missing {code} for {source:?}"));
        assert_eq!(diagnostic.column, column, "{source}");
    }
}

#[test]
fn changing_plane_during_an_active_cycle_is_fatal_but_same_plane_is_allowed() {
    let changed = compile("G17 G83 Z-1 R1 Q1 F10\nG21 G18\n", &ParseOptions::default());
    let diagnostic = changed
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.code == "semantic.cycle.plane_change")
        .expect("plane-change diagnostic");
    assert!(!changed.accepted);
    assert_eq!(diagnostic.line, 2);
    assert_eq!(diagnostic.column, 5);

    let same = compile(
        "G17 G83 Z-1 R1 Q1 F10\nG17\nG80\n",
        &ParseOptions::default(),
    );
    assert!(same.accepted, "{:?}", same.diagnostics);
}

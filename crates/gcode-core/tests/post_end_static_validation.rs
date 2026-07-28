use cnc_render_gcode_core::{ParseOptions, ProgramEnd, compile};

#[test]
fn post_end_unsupported_tokens_are_still_reported_by_public_compile() {
    for (token, code) in [
        ("G100", "parser.gcode.unsupported"),
        ("M10", "parser.mcode.unsupported"),
        ("U1", "parser.word.unsupported"),
        ("G41", "semantic.cutter_comp.unsupported"),
    ] {
        let result = compile(&format!("M2\n{token}\n"), &ParseOptions::default());

        assert!(!result.accepted, "{token}");
        assert!(result.toolpath.is_none(), "{token}");
        assert!(result.canonical_motions.is_empty(), "{token}");
        assert!(result.program_control_events.is_empty(), "{token}");
        assert!(
            result.diagnostics.iter().any(|diagnostic| {
                diagnostic.code == code
                    && diagnostic.line == 2
                    && diagnostic.column == 1
                    && !diagnostic.recoverable
            }),
            "{token}: {:?}",
            result.diagnostics
        );
    }
}

#[test]
fn supported_blocks_after_program_end_are_not_executed_or_lowered() {
    for end in ["M2", "M30"] {
        let result = compile(
            &format!("{end}\nG0 X10\nS100 M3\n"),
            &ParseOptions::default(),
        );

        assert!(result.accepted, "{end}: {:?}", result.diagnostics);
        assert_eq!(result.endpoint_mm.x_mm, 0.0);
        assert!(result.canonical_motions.is_empty());
        assert_eq!(result.program_control_events.len(), 1);
        assert_ne!(result.final_state.program_end, ProgramEnd::None);
    }
}
#[test]
fn post_end_static_validation_preserves_g_and_m_modal_conflicts() {
    for (block, column) in [("G0 G1", 4), ("M3 M4", 4)] {
        let result = compile(&format!("M2\n{block}\n"), &ParseOptions::default());

        assert!(!result.accepted, "{block}");
        assert!(
            result.diagnostics.iter().any(|diagnostic| {
                diagnostic.code == "parser.modal.conflict"
                    && diagnostic.line == 2
                    && diagnostic.column == column
                    && !diagnostic.recoverable
            }),
            "{block}: {:?}",
            result.diagnostics
        );
    }
}
#[test]
fn post_end_arc_turn_count_is_statically_rejected_for_explicit_and_frozen_modes() {
    for (source, line, column) in [("M2\nG2 P2\n", 2, 4), ("G2\nM2\nP2\n", 3, 1)] {
        let result = compile(source, &ParseOptions::default());

        assert!(!result.accepted, "{source}");
        assert!(
            result.diagnostics.iter().any(|diagnostic| {
                diagnostic.code == "semantic.arc.turns.unsupported"
                    && diagnostic.line == line
                    && diagnostic.column == column
                    && !diagnostic.recoverable
            }),
            "{source}: {:?}",
            result.diagnostics
        );
    }
}

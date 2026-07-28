use std::collections::BTreeMap;

use cnc_render_contracts::domain::{ToolpathSegment, Vec3Mm};
use cnc_render_gcode_core::{
    CoolantState, ParseOptions, ProgramControl, ProgramEnd, SpindleState, compile,
};

const TOOL_ID: &str = "3711850d-e40e-5db4-b246-11c0fb5f1e76";

fn segment_id(result: &cnc_render_gcode_core::ParseResult) -> &str {
    match &result.toolpath.as_ref().expect("toolpath").segments[0] {
        ToolpathSegment::Rapid { id, .. }
        | ToolpathSegment::Linear { id, .. }
        | ToolpathSegment::Arc { id, .. }
        | ToolpathSegment::Dwell { id, .. }
        | ToolpathSegment::ToolChange { id, .. } => id,
    }
}

#[test]
fn supported_m_codes_and_tool_change_are_reflected_in_state_and_events() {
    let options = ParseOptions {
        tool_numbers: BTreeMap::from([(7, TOOL_ID.to_owned())]),
        ..ParseOptions::default()
    };
    let result = compile("T7 M6\nS100 M3 M8\nM0\nM1\nM4\nM5 M9\n", &options);
    assert!(result.accepted, "{:?}", result.diagnostics);
    assert_eq!(result.final_state.selected_tool, Some(7));
    assert_eq!(result.final_state.spindle_state, SpindleState::Off);
    assert_eq!(result.final_state.coolant_state, CoolantState::Off);
    assert_eq!(result.final_state.last_program_control, ProgramControl::M1);
    assert_eq!(
        result
            .program_control_events
            .iter()
            .map(|event| (event.source_line, event.control))
            .collect::<Vec<_>>(),
        vec![(3, ProgramControl::M0), (4, ProgramControl::M1)]
    );
    assert!(matches!(
        result.toolpath.expect("toolpath").segments[0],
        ToolpathSegment::ToolChange { .. }
    ));

    for (source, expected) in [
        ("S100 M3\n", SpindleState::Clockwise),
        ("S100 M4\n", SpindleState::Counterclockwise),
        ("S100 M3\nM5\n", SpindleState::Off),
    ] {
        assert_eq!(
            compile(source, &ParseOptions::default())
                .final_state
                .spindle_state,
            expected
        );
    }
}

#[test]
fn m2_and_m30_stop_following_blocks_but_keep_same_block_motion() {
    for (code, end, control) in [
        ("M2", ProgramEnd::M2, ProgramControl::M2),
        ("M30", ProgramEnd::M30, ProgramControl::M30),
    ] {
        let source = format!("G1 X1 F10 {code}\nG1 X99\n");
        let result = compile(&source, &ParseOptions::default());
        assert!(result.accepted, "{:?}", result.diagnostics);
        assert_eq!(result.endpoint_mm.x_mm, 1.0);
        assert_eq!(result.final_state.program_end, end);
        assert_eq!(result.final_state.last_program_control, control);
        assert_eq!(result.program_control_events.len(), 1);
        assert_eq!(result.program_control_events[0].source_line, 1);
    }
}

#[test]
fn any_fatal_error_returns_no_partial_authoritative_result() {
    let result = compile("G0 X10\nG41\n", &ParseOptions::default());
    assert!(!result.accepted);
    assert_eq!(result.endpoint_mm.x_mm, 0.0);
    assert!(result.canonical_motions.is_empty());
    assert!(result.program_control_events.is_empty());
    assert!(result.toolpath.is_none());
    assert_eq!(result.path_length_mm.total, 0.0);
}

#[test]
fn derived_overflow_and_invalid_options_are_json_safe() {
    let huge = format!("1{}", "0".repeat(307));
    let result = compile(&format!("G20 G90 G0 X{huge}\n"), &ParseOptions::default());
    assert!(!result.accepted);
    assert!(
        result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "semantic.numeric.non_finite")
    );
    let json = serde_json::to_string(&result).expect("finite fail-closed JSON");
    assert!(!json.contains("NaN"));
    assert!(!json.contains("Infinity"));
    assert!(result.endpoint_mm.x_mm.is_finite());
    assert!(result.endpoint_mm.y_mm.is_finite());
    assert!(result.endpoint_mm.z_mm.is_finite());
    assert!(result.path_length_mm.total.is_finite());

    let duplicate_offsets = ParseOptions {
        work_offsets_mm: BTreeMap::from([
            (
                "G54".to_owned(),
                Vec3Mm {
                    x_mm: 0.0,
                    y_mm: 0.0,
                    z_mm: 0.0,
                },
            ),
            (
                "g54".to_owned(),
                Vec3Mm {
                    x_mm: 1.0,
                    y_mm: 0.0,
                    z_mm: 0.0,
                },
            ),
        ]),
        ..ParseOptions::default()
    };
    let duplicate = compile("", &duplicate_offsets);
    assert!(
        duplicate
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "request.work_offset.invalid")
    );

    let non_finite = ParseOptions {
        tool_length_offsets_mm: BTreeMap::from([(1, f64::INFINITY)]),
        ..ParseOptions::default()
    };
    assert!(
        compile("", &non_finite)
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "semantic.numeric.non_finite")
    );
}

#[test]
fn g83_rejects_non_positive_q_and_moves_to_r_before_lateral_motion() {
    let invalid = compile("G83 Z-5 R1 Q-1 F100\n", &ParseOptions::default());
    assert!(!invalid.accepted);
    assert!(
        invalid
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "semantic.cycle.invalid_parameter")
    );

    let result = compile("G83 X10 Z-1 R5 Q2 F100\n", &ParseOptions::default());
    assert!(result.accepted, "{:?}", result.diagnostics);
    let segments = &result.toolpath.expect("toolpath").segments;
    let ToolpathSegment::Rapid {
        start_mm, end_mm, ..
    } = &segments[0]
    else {
        panic!("expected preliminary R rapid");
    };
    assert_eq!(start_mm.x_mm, 0.0);
    assert_eq!(end_mm.x_mm, 0.0);
    assert_eq!(end_mm.z_mm, 5.0);
    let ToolpathSegment::Rapid { end_mm, .. } = &segments[1] else {
        panic!("expected plane-parallel rapid");
    };
    assert_eq!(end_mm.x_mm, 10.0);
    assert_eq!(end_mm.z_mm, 5.0);
}

#[test]
fn g43_applies_to_absolute_cycle_z_coordinates() {
    let options = ParseOptions {
        tool_length_offsets_mm: BTreeMap::from([(1, 50.0)]),
        initial_state: cnc_render_gcode_core::InitialState {
            position_mm: Vec3Mm {
                x_mm: 0.0,
                y_mm: 0.0,
                z_mm: 60.0,
            },
            ..cnc_render_gcode_core::InitialState::default()
        },
        ..ParseOptions::default()
    };
    let result = compile("G43 H1 G99 G81 Z-3 R1 F100\n", &options);
    assert!(result.accepted, "{:?}", result.diagnostics);
    assert_eq!(result.endpoint_mm.z_mm, 51.0);
    assert!(
        result
            .toolpath
            .expect("toolpath")
            .segments
            .iter()
            .any(|segment| matches!(
                segment,
                ToolpathSegment::Linear { end_mm, .. } if end_mm.z_mm == 47.0
            ))
    );
}

#[test]
fn modal_center_only_full_circle_executes_and_r_only_is_rejected() {
    let result = compile("G17 G0 X10\nG2 I-10 F100\nI-10\n", &ParseOptions::default());
    assert!(result.accepted, "{:?}", result.diagnostics);
    assert_eq!(result.toolpath.expect("toolpath").segments.len(), 3);

    let radius = compile("G17 G0 X10\nG2 X0 R5 F100\nR5\n", &ParseOptions::default());
    assert!(!radius.accepted);
    assert!(
        radius
            .diagnostics
            .iter()
            .any(|diagnostic| { diagnostic.code == "semantic.arc.full_circle_r_unsupported" })
    );
}

#[test]
fn invalid_context_words_and_g80_axis_are_not_silent() {
    for source in ["G1 X1 I2 F10\n", "G43\nH1\n", "G80 X1\n", "N10\n"] {
        let result = compile(source, &ParseOptions::default());
        assert!(!result.accepted, "{source}");
        assert!(result.toolpath.is_none());
    }
}

#[test]
fn generated_ids_include_default_options_namespace() {
    let source = "G54 G0 X0\n";
    let first = compile(source, &ParseOptions::default());
    let second = compile(
        source,
        &ParseOptions {
            work_offsets_mm: BTreeMap::from([(
                "G54".to_owned(),
                Vec3Mm {
                    x_mm: 10.0,
                    y_mm: 0.0,
                    z_mm: 0.0,
                },
            )]),
            ..ParseOptions::default()
        },
    );
    assert_ne!(
        first.toolpath.as_ref().expect("first").id,
        second.toolpath.as_ref().expect("second").id
    );
    assert_ne!(segment_id(&first), segment_id(&second));
    assert_eq!(
        first.toolpath.as_ref().expect("first").id,
        compile(source, &ParseOptions::default())
            .toolpath
            .expect("repeat")
            .id
    );
}

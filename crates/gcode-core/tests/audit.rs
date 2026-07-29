use std::collections::BTreeMap;

use cnc_render_contracts::domain::ToolpathSegment;
use cnc_render_gcode_core::{ParseOptions, compile};

fn first_segment_id(result: &cnc_render_gcode_core::ParseResult) -> String {
    match &result
        .toolpath
        .as_ref()
        .expect("toolpath")
        .segments
        .first()
        .expect("segment")
    {
        ToolpathSegment::Rapid { id, .. }
        | ToolpathSegment::Linear { id, .. }
        | ToolpathSegment::Arc { id, .. }
        | ToolpathSegment::Dwell { id, .. }
        | ToolpathSegment::ToolChange { id, .. } => id.clone(),
    }
}

#[test]
fn segment_ids_are_scoped_by_toolpath_and_operation() {
    let source = "G1 X1 F10\n";
    let first = compile(
        source,
        &ParseOptions {
            toolpath_id: Some("20000000-0000-4000-8000-000000000001".to_owned()),
            operation_id: "20000000-0000-4000-8000-000000000002".to_owned(),
            ..ParseOptions::default()
        },
    );
    let second = compile(
        source,
        &ParseOptions {
            toolpath_id: Some("20000000-0000-4000-8000-000000000003".to_owned()),
            operation_id: "20000000-0000-4000-8000-000000000004".to_owned(),
            ..ParseOptions::default()
        },
    );
    assert_ne!(first_segment_id(&first), first_segment_id(&second));
}

#[test]
fn diagnostics_are_sorted_by_source_location_then_code() {
    let result = compile("U1\nX+\n", &ParseOptions::default());
    assert_eq!(result.diagnostics[0].line, 1);
    assert_eq!(result.diagnostics[0].code, "parser.word.unsupported");
    assert_eq!(result.diagnostics[1].line, 2);
    assert_eq!(result.diagnostics[1].code, "lexer.number.invalid");
}

#[test]
fn rotary_axis_motion_is_fatal_until_ir_can_represent_it() {
    let result = compile("G0 A90\n", &ParseOptions::default());
    assert!(!result.accepted);
    assert!(result.toolpath.is_none());
    assert!(result.canonical_motions.is_empty());
    assert_eq!(result.final_state.rotary_rad.a_rad, 0.0);
    assert!(result.diagnostics.iter().any(|diagnostic| diagnostic.code
        == "semantic.rotary.not_lowered"
        && !diagnostic.recoverable));
}

#[test]
fn g43_offsets_absolute_z_but_not_incremental_delta() {
    let options = ParseOptions {
        tool_length_offsets_mm: BTreeMap::from([(1, 50.0)]),
        ..ParseOptions::default()
    };
    let result = compile(
        "G43 H1 G0 Z0\nG91 G1 Z-10 F100\nG49 G90 G1 Z0 F100\n",
        &options,
    );
    assert!(result.accepted, "{:?}", result.diagnostics);
    let toolpath = result.toolpath.expect("toolpath");
    let endpoint = |index| match &toolpath.segments[index] {
        ToolpathSegment::Rapid { end_mm, .. } | ToolpathSegment::Linear { end_mm, .. } => {
            end_mm.z_mm
        }
        _ => panic!("expected motion"),
    };
    assert_eq!(endpoint(0), 50.0);
    assert_eq!(endpoint(1), 40.0);
    assert_eq!(endpoint(2), 0.0);
}

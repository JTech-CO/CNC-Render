use std::collections::BTreeMap;
use std::f64::consts::PI;

use cnc_render_contracts::domain::{ToolpathSegment, Vec3Mm};
use cnc_render_gcode_core::{
    DEFAULT_OPERATION_ID, DiagnosticSeverity, ParseOptions, Plane, SpindleMode, compile,
};

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= 1.0e-9,
        "actual {actual}, expected {expected}"
    );
}

#[test]
fn inch_incremental_motion_is_canonical_mm() {
    let result = compile("G20 G91\nG0 X1 Y-0.5\n", &ParseOptions::default());
    assert!(result.accepted, "{:?}", result.diagnostics);
    assert_close(result.endpoint_mm.x_mm, 25.4);
    assert_close(result.endpoint_mm.y_mm, -12.7);
}

#[test]
fn work_offsets_lower_to_machine_coordinates() {
    let mut options = ParseOptions::default();
    options.work_offsets_mm.insert(
        "G54".to_owned(),
        Vec3Mm {
            x_mm: 100.0,
            y_mm: 0.0,
            z_mm: 0.0,
        },
    );
    options.work_offsets_mm.insert(
        "G55".to_owned(),
        Vec3Mm {
            x_mm: -10.0,
            y_mm: 20.0,
            z_mm: 5.0,
        },
    );
    let result = compile("G90 G54 G0 X0 Y0 Z0\nG55 G1 X10 Y0 Z0 F100\n", &options);
    assert!(result.accepted, "{:?}", result.diagnostics);
    assert_eq!(
        result.endpoint_mm,
        Vec3Mm {
            x_mm: 0.0,
            y_mm: 20.0,
            z_mm: 5.0
        }
    );
}

#[test]
fn ijk_and_radius_arcs_have_expected_lengths() {
    let ijk = compile(
        "G21 G90 G17\nG0 X0 Y0\nG3 X10 Y0 I5 J0 F100\n",
        &ParseOptions::default(),
    );
    assert!(ijk.accepted, "{:?}", ijk.diagnostics);
    assert_close(ijk.path_length_mm.feed, 5.0 * PI);

    let radius = compile(
        "G21 G90 G18\nG0 X0 Z0\nG2 X10 Z0 R10 F100\n",
        &ParseOptions::default(),
    );
    assert!(radius.accepted, "{:?}", radius.diagnostics);
    assert!(radius.path_length_mm.feed > 10.0);
    let segment = &radius.toolpath.expect("toolpath").segments[1];
    assert!(matches!(
        segment,
        ToolpathSegment::Arc {
            plane: cnc_render_contracts::domain::ArcPlane::Xz,
            clockwise: true,
            ..
        }
    ));
}

#[test]
fn drill_cycles_expand_and_map_every_segment() {
    let mut options = ParseOptions::default();
    options.initial_state.position_mm.z_mm = 10.0;
    let result = compile("G90 G98 G81 X0 Y0 Z-5 R2 F100\nX10\nG80\n", &options);
    assert!(result.accepted, "{:?}", result.diagnostics);
    let toolpath = result.toolpath.expect("toolpath");
    assert_eq!(toolpath.segments.len(), toolpath.source_line_map.len());
    assert_eq!(toolpath.source_line_map[0].source_line, 1);
    assert_eq!(
        toolpath
            .source_line_map
            .last()
            .expect("mapping")
            .source_line,
        2
    );
    assert_close(result.endpoint_mm.z_mm, 10.0);
    assert_close(result.endpoint_mm.x_mm, 10.0);
}

#[test]
fn dwell_and_peck_cycles_are_deterministically_expanded() {
    let mut options = ParseOptions::default();
    options.initial_state.position_mm.z_mm = 10.0;
    let dwell = compile("G90 G99 G82 Z-2 R1 P0.5 F100\n", &options);
    assert!(dwell.accepted, "{:?}", dwell.diagnostics);
    assert!(
        dwell
            .toolpath
            .expect("toolpath")
            .segments
            .iter()
            .any(|segment| matches!(segment, ToolpathSegment::Dwell { .. }))
    );

    let peck = compile("G90 G99 G83 Z-4 R2 Q2 F100\n", &options);
    assert!(peck.accepted, "{:?}", peck.diagnostics);
    let serialized = serde_json::to_vec(&peck).expect("serialize");
    assert_eq!(
        serialized,
        serde_json::to_vec(&compile("G90 G99 G83 Z-4 R2 Q2 F100\n", &options)).expect("serialize")
    );
    assert_close(peck.endpoint_mm.z_mm, 2.0);
}

#[test]
fn feed_per_revolution_resolves_to_mm_per_minute() {
    let result = compile("G21 G95 G97 S1000 F0.1\nG1 X10\n", &ParseOptions::default());
    assert!(result.accepted, "{:?}", result.diagnostics);
    let ToolpathSegment::Linear {
        feed_mm_per_min, ..
    } = &result.toolpath.expect("toolpath").segments[0]
    else {
        panic!("expected linear segment");
    };
    assert_close(*feed_mm_per_min, 100.0);
    assert_eq!(result.final_state.spindle_mode, SpindleMode::Rpm);
}

#[test]
fn tool_change_uses_explicit_number_to_uuid_mapping() {
    let tool_id = "3711850d-e40e-5db4-b246-11c0fb5f1e76".to_owned();
    let mut options = ParseOptions {
        operation_id: DEFAULT_OPERATION_ID.to_owned(),
        tool_numbers: BTreeMap::from([(7, tool_id.clone())]),
        ..ParseOptions::default()
    };
    options.initial_state.position_mm.x_mm = 3.0;
    let result = compile("T7 M6\n", &options);
    assert!(result.accepted, "{:?}", result.diagnostics);
    let ToolpathSegment::ToolChange {
        tool_assembly_id, ..
    } = &result.toolpath.expect("toolpath").segments[0]
    else {
        panic!("expected tool change");
    };
    assert_eq!(tool_assembly_id, &tool_id);
}

#[test]
fn unsupported_constructs_are_explicit_and_fatal() {
    for (source, code) in [
        ("G41\n", "semantic.cutter_comp.unsupported"),
        ("G84\n", "parser.gcode.unsupported"),
        ("#\n", "lexer.macro.unsupported"),
        ("G1 X+\n", "lexer.number.invalid"),
    ] {
        let result = compile(source, &ParseOptions::default());
        assert!(!result.accepted, "{source}");
        let diagnostic = result
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == code)
            .unwrap_or_else(|| panic!("missing {code} for {source:?}"));
        assert_eq!(diagnostic.severity, DiagnosticSeverity::Error);
        assert!(!diagnostic.recoverable);
        assert!(result.toolpath.is_none());
    }
}

#[test]
fn rotary_words_are_rejected_without_partial_lowering() {
    let result = compile("G0 A90 B-45 C180\n", &ParseOptions::default());
    assert!(!result.accepted);
    assert!(result.toolpath.is_none());
    assert!(result.canonical_motions.is_empty());
    assert_close(result.final_state.rotary_rad.a_rad, 0.0);
    let diagnostic = result
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.code == "semantic.rotary.not_lowered")
        .expect("rotary diagnostic");
    assert_eq!(diagnostic.severity, DiagnosticSeverity::Error);
    assert!(!diagnostic.recoverable);
}

#[test]
fn generated_segment_ids_have_uuid_v8_and_rfc_variant_bits() {
    let result = compile("G1 X1 F10\n", &ParseOptions::default());
    let toolpath = result.toolpath.expect("toolpath");
    let id = match &toolpath.segments[0] {
        ToolpathSegment::Linear { id, .. } => id,
        _ => panic!("expected linear"),
    };
    assert_eq!(&id[14..15], "8");
    assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
}

#[test]
fn all_three_planes_are_public_canonical_modes() {
    assert_eq!(Plane::Xy, Plane::Xy);
    assert_eq!(Plane::Xz, Plane::Xz);
    assert_eq!(Plane::Yz, Plane::Yz);
}

use cnc_render_gcode_core::{CanonicalMotion, ParseOptions, compile};

fn linear_endpoints(result: &cnc_render_gcode_core::ParseResult) -> Vec<(u64, f64, f64)> {
    result
        .canonical_motions
        .iter()
        .filter_map(|motion| match motion {
            CanonicalMotion::Linear {
                source_line,
                end_mm,
                ..
            } => Some((*source_line, end_mm.x_mm, end_mm.z_mm)),
            _ => None,
        })
        .collect()
}

#[test]
fn incremental_repeat_reapplies_sticky_depth_delta_to_explicit_r() {
    let result = compile(
        "G21 G94 F100\nG91 G98 G81 X1 Z-0.5 R1\nX1 R0\nG80\n",
        &ParseOptions::default(),
    );

    assert!(result.accepted, "{:?}", result.diagnostics);
    assert_eq!(
        linear_endpoints(&result),
        vec![(2, 1.0, 0.5), (3, 2.0, 0.5)]
    );
    assert_eq!(result.endpoint_mm.x_mm, 2.0);
    assert_eq!(result.endpoint_mm.z_mm, 1.0);
}

#[test]
fn incremental_r_only_update_is_relative_to_block_start_and_does_not_drill() {
    let result = compile(
        "G21 G94 F100\nG91 G98 G81 X1 Z-0.5 R1\nR1\nX1\nG80\n",
        &ParseOptions::default(),
    );

    assert!(result.accepted, "{:?}", result.diagnostics);
    assert!(result.canonical_motions.iter().all(|motion| match motion {
        CanonicalMotion::Rapid { source_line, .. }
        | CanonicalMotion::Linear { source_line, .. }
        | CanonicalMotion::Arc { source_line, .. }
        | CanonicalMotion::Dwell { source_line, .. }
        | CanonicalMotion::ToolChange { source_line, .. } => *source_line != 3,
    }));
    assert_eq!(
        linear_endpoints(&result),
        vec![(2, 1.0, 0.5), (4, 2.0, 1.5)]
    );
    assert_eq!(result.endpoint_mm.z_mm, 2.0);
}

#[test]
fn invalid_incremental_r_update_is_fatal_and_fail_closed() {
    let result = compile(
        "G21 G94 F100\nG90 G98 G81 X0 Z-2 R1\nG91 R-5\n",
        &ParseOptions::default(),
    );

    assert!(!result.accepted);
    assert!(result.toolpath.is_none());
    assert!(result.canonical_motions.is_empty());
    assert!(result.diagnostics.iter().any(|diagnostic| {
        diagnostic.line == 3
            && diagnostic.code == "semantic.cycle.invalid_parameter"
            && !diagnostic.recoverable
    }));
}

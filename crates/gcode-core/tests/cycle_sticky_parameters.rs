use cnc_render_gcode_core::{CanonicalMotion, ParseOptions, compile};

fn source_line(motion: &CanonicalMotion) -> u64 {
    match motion {
        CanonicalMotion::Rapid { source_line, .. }
        | CanonicalMotion::Linear { source_line, .. }
        | CanonicalMotion::Arc { source_line, .. }
        | CanonicalMotion::Dwell { source_line, .. }
        | CanonicalMotion::ToolChange { source_line, .. } => *source_line,
    }
}

#[test]
fn g83_q_only_block_updates_sticky_peck_without_drilling() {
    let result = compile(
        "G17 G90 G99 F10\nG83 X0 Z-2 R1 Q2\nQ1\nX10\nG80\n",
        &ParseOptions::default(),
    );
    assert!(result.accepted, "{:?}", result.diagnostics);
    assert!(
        result
            .canonical_motions
            .iter()
            .all(|motion| source_line(motion) != 3)
    );
    assert_eq!(
        result
            .canonical_motions
            .iter()
            .filter(|motion| {
                source_line(motion) == 4 && matches!(motion, CanonicalMotion::Linear { .. })
            })
            .count(),
        3,
    );
}

#[test]
fn g82_p_only_block_updates_sticky_dwell_without_drilling() {
    let result = compile(
        "G17 G90 G99 F10\nG82 X0 Z-1 R1 P1\nP2\nX5\nG80\n",
        &ParseOptions::default(),
    );
    assert!(result.accepted, "{:?}", result.diagnostics);
    assert!(
        result
            .canonical_motions
            .iter()
            .all(|motion| source_line(motion) != 3)
    );
    let repeated_dwell = result
        .canonical_motions
        .iter()
        .find_map(|motion| match motion {
            CanonicalMotion::Dwell {
                source_line: 4,
                duration_s,
                ..
            } => Some(*duration_s),
            _ => None,
        })
        .expect("repeated G82 dwell");
    assert_eq!(repeated_dwell, 2.0);
}

#[test]
fn cycle_r_only_block_updates_return_plane_and_validates_direction() {
    let updated = compile(
        "G17 G90 G99 F10\nG81 X0 Z-2 R1\nR3\nX5\nG80\n",
        &ParseOptions::default(),
    );
    assert!(updated.accepted, "{:?}", updated.diagnostics);
    assert!(
        updated
            .canonical_motions
            .iter()
            .all(|motion| source_line(motion) != 3)
    );
    assert_eq!(updated.endpoint_mm.z_mm, 3.0);

    let invalid = compile(
        "G17 G90 G99 F10\nG81 X0 Z-2 R1\nR-3\n",
        &ParseOptions::default(),
    );
    assert!(!invalid.accepted);
    assert!(invalid.diagnostics.iter().any(|diagnostic| {
        diagnostic.line == 3 && diagnostic.code == "semantic.cycle.invalid_parameter"
    }));
}

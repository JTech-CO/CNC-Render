use std::collections::BTreeMap;

use cnc_render_contracts::domain::Vec3Mm;
use cnc_render_gcode_core::{ParseOptions, RotaryPositionRad, compile};

#[test]
fn negative_zero_is_rejected_at_json_option_boundaries() {
    let initial = ParseOptions {
        initial_state: cnc_render_gcode_core::InitialState {
            position_mm: Vec3Mm {
                x_mm: -0.0,
                y_mm: 0.0,
                z_mm: 0.0,
            },
            ..Default::default()
        },
        ..ParseOptions::default()
    };
    let work = ParseOptions {
        work_offsets_mm: BTreeMap::from([(
            "g54".to_owned(),
            Vec3Mm {
                x_mm: -0.0,
                y_mm: 0.0,
                z_mm: 0.0,
            },
        )]),
        ..ParseOptions::default()
    };
    let tool_length = ParseOptions {
        tool_length_offsets_mm: BTreeMap::from([(1, -0.0)]),
        ..ParseOptions::default()
    };

    for options in [initial, work, tool_length] {
        let result = compile("", &options);
        assert!(!result.accepted);
        assert!(result.toolpath.is_none());
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "semantic.numeric.non_finite")
        );
    }
}

#[test]
fn non_zero_initial_rotary_state_is_not_silently_dropped() {
    let rejected = compile(
        "G0 X1\n",
        &ParseOptions {
            initial_state: cnc_render_gcode_core::InitialState {
                rotary_rad: RotaryPositionRad {
                    a_rad: 1.0,
                    b_rad: 0.0,
                    c_rad: 0.0,
                },
                ..Default::default()
            },
            ..ParseOptions::default()
        },
    );
    assert!(!rejected.accepted);
    assert!(rejected.diagnostics.iter().any(|diagnostic| {
        diagnostic.code == "semantic.rotary.not_lowered" && !diagnostic.recoverable
    }));

    let accepted = compile("G0 X1\n", &ParseOptions::default());
    assert!(accepted.accepted, "{:?}", accepted.diagnostics);
}

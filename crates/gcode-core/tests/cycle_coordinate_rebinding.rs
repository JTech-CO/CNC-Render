use std::collections::BTreeMap;

use cnc_render_contracts::domain::Vec3Mm;
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
fn absolute_sticky_cycle_coordinates_rebind_to_the_active_work_offset() {
    let result = compile(
        "G90 G54 G99 G81 X0 Z-5 R1 F100\nG55 X10\nG80\n",
        &ParseOptions {
            work_offsets_mm: BTreeMap::from([
                (
                    "g54".to_owned(),
                    Vec3Mm {
                        x_mm: 0.0,
                        y_mm: 0.0,
                        z_mm: 0.0,
                    },
                ),
                (
                    "g55".to_owned(),
                    Vec3Mm {
                        x_mm: 100.0,
                        y_mm: 0.0,
                        z_mm: 100.0,
                    },
                ),
            ]),
            ..ParseOptions::default()
        },
    );

    assert!(result.accepted, "{:?}", result.diagnostics);
    assert_eq!(
        linear_endpoints(&result),
        vec![(1, 0.0, -5.0), (2, 110.0, 95.0)]
    );
    assert_eq!(result.endpoint_mm.x_mm, 110.0);
    assert_eq!(result.endpoint_mm.z_mm, 101.0);
    assert_eq!(result.path_length_mm.rapid, 223.0);
    assert_eq!(result.path_length_mm.feed, 12.0);
    assert_eq!(result.path_length_mm.total, 235.0);
}

#[test]
fn absolute_g17_sticky_cycle_coordinates_rebind_to_g43_and_g49() {
    let result = compile(
        "G90 G54 G99 G81 X0 Z-5 R1 F100\nG43 H1 X10\nG49 X20\nG80\n",
        &ParseOptions {
            tool_length_offsets_mm: BTreeMap::from([(1, 10.0)]),
            ..ParseOptions::default()
        },
    );

    assert!(result.accepted, "{:?}", result.diagnostics);
    assert_eq!(
        linear_endpoints(&result),
        vec![(1, 0.0, -5.0), (2, 10.0, 5.0), (3, 20.0, -5.0)]
    );
    assert_eq!(result.endpoint_mm.x_mm, 20.0);
    assert_eq!(result.endpoint_mm.z_mm, 1.0);
}

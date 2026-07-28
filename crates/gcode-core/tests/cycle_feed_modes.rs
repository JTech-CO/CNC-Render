use std::f64::consts::PI;

use cnc_render_gcode_core::{CanonicalMotion, ParseOptions, compile};

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= 1.0e-9,
        "expected {expected}, got {actual}"
    );
}

#[test]
fn g17_css_cycle_uses_the_hole_x_endpoint_not_the_pre_cycle_x() {
    let result = compile(
        "G21 G17 G90 G95 G96 S100 F0.1\nG81 X10 Z-2 R1\nG80\n",
        &ParseOptions::default(),
    );
    assert!(result.accepted, "{:?}", result.diagnostics);

    let feeds: Vec<_> = result
        .canonical_motions
        .iter()
        .filter_map(|motion| match motion {
            CanonicalMotion::Linear {
                end_mm,
                feed_mm_per_min,
                ..
            } => Some((end_mm.x_mm, *feed_mm_per_min)),
            _ => None,
        })
        .collect();
    assert_eq!(feeds.len(), 1);
    assert_close(feeds[0].0, 10.0);
    assert_close(feeds[0].1, 0.1 * 100_000.0 / (PI * 10.0));
}

#[test]
fn g19_g83_css_feed_is_resolved_for_each_peck_endpoint_x() {
    let result = compile(
        "G21 G19 G90 G95 G96 S100 F0.1\nG83 X10 Y0 Z0 R30 Q10\nG80\n",
        &ParseOptions::default(),
    );
    assert!(result.accepted, "{:?}", result.diagnostics);

    let feeds: Vec<_> = result
        .canonical_motions
        .iter()
        .filter_map(|motion| match motion {
            CanonicalMotion::Linear {
                end_mm,
                feed_mm_per_min,
                ..
            } => Some((end_mm.x_mm, *feed_mm_per_min)),
            _ => None,
        })
        .collect();
    assert_eq!(feeds.len(), 2);
    assert_close(feeds[0].0, 20.0);
    assert_close(feeds[0].1, 0.1 * 100_000.0 / (PI * 20.0));
    assert_close(feeds[1].0, 10.0);
    assert_close(feeds[1].1, 0.1 * 100_000.0 / (PI * 10.0));
}

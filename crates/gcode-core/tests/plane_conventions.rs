use std::f64::consts::PI;

use cnc_render_gcode_core::{ParseOptions, compile};

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= 1.0e-9,
        "expected {expected}, got {actual}"
    );
}

#[test]
fn g18_clockwise_is_observed_from_positive_y() {
    let ijk = compile(
        "G21 G90 G18\nG0 X10 Z0\nG2 X0 Z10 I-10 F100\n",
        &ParseOptions::default(),
    );
    assert!(ijk.accepted, "{:?}", ijk.diagnostics);
    assert_close(ijk.path_length_mm.feed, 5.0 * PI);

    let radius = compile(
        "G21 G90 G18\nG0 X10 Z0\nG2 X0 Z10 R10 F100\n",
        &ParseOptions::default(),
    );
    assert!(radius.accepted, "{:?}", radius.diagnostics);
    assert_close(radius.path_length_mm.feed, 5.0 * PI);
}

#[test]
fn g18_counterclockwise_takes_the_complementary_sweep() {
    let result = compile(
        "G21 G90 G18\nG0 X10 Z0\nG3 X0 Z10 I-10 F100\n",
        &ParseOptions::default(),
    );
    assert!(result.accepted, "{:?}", result.diagnostics);
    assert_close(result.path_length_mm.feed, 15.0 * PI);
}

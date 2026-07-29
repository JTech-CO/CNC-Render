use cnc_render_gcode_core::{ParseOptions, compile};

#[test]
fn millimeter_ijk_radius_uses_small_and_relative_tolerance() {
    let accepted = compile(
        "G21 G17 G90 G3 X1 Y1.001 I1 F10\n",
        &ParseOptions::default(),
    );
    assert!(accepted.accepted, "{:?}", accepted.diagnostics);

    let rejected = compile(
        "G21 G17 G90 G3 X1 Y1.006 I1 F10\n",
        &ParseOptions::default(),
    );
    assert!(!rejected.accepted);
    assert!(
        rejected
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "semantic.arc.radius_mismatch")
    );
}

#[test]
fn millimeter_ijk_radius_rejects_beyond_the_big_tolerance_cap() {
    let result = compile(
        "G21 G17 G90 G3 X1000 Y1000.501 I1000 F10\n",
        &ParseOptions::default(),
    );
    assert!(!result.accepted);
    assert!(
        result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "semantic.arc.radius_mismatch")
    );
}

#[test]
fn inch_ijk_radius_uses_canonical_mm_thresholds_and_big_cap() {
    let near = compile(
        "G20 G17 G90 G3 X1 Y1.0005 I1 F10\n",
        &ParseOptions::default(),
    );
    assert!(near.accepted, "{:?}", near.diagnostics);

    let relative_rejected = compile(
        "G20 G17 G90 G3 X1 Y1.002 I1 F10\n",
        &ParseOptions::default(),
    );
    assert!(!relative_rejected.accepted);

    let big_rejected = compile(
        "G20 G17 G90 G3 X100 Y100.051 I100 F10\n",
        &ParseOptions::default(),
    );
    assert!(!big_rejected.accepted);
    for result in [relative_rejected, big_rejected] {
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "semantic.arc.radius_mismatch")
        );
    }
}

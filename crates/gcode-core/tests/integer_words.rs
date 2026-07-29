use cnc_render_gcode_core::{ParseOptions, compile};

#[test]
fn fractional_codes_and_integer_addresses_are_never_rounded_into_support() {
    for (source, code) in [
        ("G1.0000000000005 X1 F1\n", "parser.gcode.unsupported"),
        ("M2.0000000000005\n", "parser.mcode.unsupported"),
        ("T1.0000000000005\n", "semantic.tool.invalid"),
    ] {
        let result = compile(source, &ParseOptions::default());
        assert!(!result.accepted, "{source}");
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == code),
            "{source}: {:?}",
            result.diagnostics
        );
    }
}

#[test]
fn fractional_h_is_rejected_at_the_h_word() {
    let result = compile(
        "G43 H1.0000000000005\n",
        &ParseOptions {
            tool_length_offsets_mm: [(1, 1.0)].into(),
            ..ParseOptions::default()
        },
    );
    let diagnostic = result
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.code == "semantic.tool_length.missing_h")
        .expect("fractional H diagnostic");
    assert!(!result.accepted);
    assert_eq!(diagnostic.column, 5);
}

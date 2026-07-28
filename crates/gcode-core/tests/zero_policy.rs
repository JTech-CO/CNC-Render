use cnc_render_gcode_core::{ParseOptions, compile, lex};

#[test]
fn lexical_negative_zero_is_canonicalized_but_remains_valid_gcode() {
    let lexed = lex("G0 X-0");
    let x = lexed.lines[0]
        .words
        .iter()
        .find(|word| word.letter == 'X')
        .expect("X word");
    assert_eq!(x.value, 0.0);
    assert!(!x.value.is_sign_negative());

    let result = compile("G0 X-0", &ParseOptions::default());
    assert!(result.accepted, "{:?}", result.diagnostics);
    assert_eq!(result.endpoint_mm.x_mm, 0.0);
    assert!(!result.endpoint_mm.x_mm.is_sign_negative());
}

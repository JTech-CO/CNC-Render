use cnc_render_gcode_core::{MAX_DIAGNOSTICS, ParseOptions, compile};

#[test]
fn diagnostic_cap_terminal_stays_last_after_public_compile_sorting() {
    let source = "(unterminated\n".repeat(MAX_DIAGNOSTICS - 2);
    let options = ParseOptions {
        dialect: "unsupported-dialect".to_owned(),
        operation_id: "not-a-uuid".to_owned(),
        ..ParseOptions::default()
    };

    let result = compile(&source, &options);

    assert!(!result.accepted);
    assert_eq!(result.diagnostics.len(), MAX_DIAGNOSTICS);
    let terminal = result.diagnostics.last().expect("terminal diagnostic");
    assert_eq!(terminal.code, "request.resource_limit");
    assert_eq!((terminal.line, terminal.column), (1, 1));
    assert!(!terminal.recoverable);
    assert_eq!(
        result
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "request.resource_limit")
            .count(),
        1
    );
    assert!(
        result.diagnostics[..MAX_DIAGNOSTICS - 1]
            .iter()
            .any(|diagnostic| diagnostic.code == "request.dialect.unsupported")
    );
    assert!(
        result.diagnostics[..MAX_DIAGNOSTICS - 1]
            .windows(2)
            .all(|diagnostics| {
                (diagnostics[0].line, diagnostics[0].column)
                    <= (diagnostics[1].line, diagnostics[1].column)
            })
    );
}

#[test]
fn accepted_recoverable_diagnostics_keep_stable_source_order() {
    let result = compile(
        "(first unterminated\n(second unterminated\n",
        &ParseOptions::default(),
    );

    assert!(result.accepted, "{:?}", result.diagnostics);
    assert_eq!(
        result
            .diagnostics
            .iter()
            .map(|diagnostic| (diagnostic.line, diagnostic.column))
            .collect::<Vec<_>>(),
        vec![(1, 1), (2, 1)]
    );
}

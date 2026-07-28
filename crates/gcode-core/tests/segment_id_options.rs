use std::collections::BTreeMap;

use cnc_render_contracts::domain::Vec3Mm;
use cnc_render_gcode_core::{ParseOptions, compile};

#[test]
fn explicit_toolpath_id_does_not_hide_geometry_changing_option_scope() {
    let explicit_id = "20000000-0000-4000-8000-000000000001";
    let first = compile(
        "G0 X1\n",
        &ParseOptions {
            toolpath_id: Some(explicit_id.to_owned()),
            ..ParseOptions::default()
        },
    );
    let second = compile(
        "G0 X1\n",
        &ParseOptions {
            toolpath_id: Some(explicit_id.to_owned()),
            work_offsets_mm: BTreeMap::from([(
                "g54".to_owned(),
                Vec3Mm {
                    x_mm: 10.0,
                    y_mm: 0.0,
                    z_mm: 0.0,
                },
            )]),
            ..ParseOptions::default()
        },
    );

    let first_toolpath = first.toolpath.expect("first toolpath");
    let second_toolpath = second.toolpath.expect("second toolpath");
    assert_eq!(first_toolpath.id, explicit_id);
    assert_eq!(second_toolpath.id, explicit_id);
    assert_ne!(
        first_toolpath.source_line_map[0].segment_id,
        second_toolpath.source_line_map[0].segment_id,
    );
}

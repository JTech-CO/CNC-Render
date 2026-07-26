use cnc_render_contracts::Project;
use serde_json::{Value, json};

const VALID_PROJECT: &str = include_str!("../../../tests/fixtures/m1/valid-project.json");

fn fixture() -> Value {
    serde_json::from_str(VALID_PROJECT).expect("valid project fixture")
}

#[test]
fn schema_global_entity_ids_are_unique_across_all_collections() {
    let mut value = fixture();
    value["machines"][0]["spindles"][0]["id"] = value["id"].clone();

    let error =
        Project::from_json_value(value).expect_err("cross-collection duplicate ID must fail");
    assert_eq!(error.code, "id.duplicate_global");
}

#[test]
fn schema_parentless_axes_match_unique_kinematic_roots_exactly() {
    let mut duplicate_root = fixture();
    let root_id = duplicate_root["machines"][0]["kinematicRootAxisIds"][0].clone();
    duplicate_root["machines"][0]["kinematicRootAxisIds"]
        .as_array_mut()
        .expect("root IDs")
        .push(root_id);
    let error = Project::from_json_value(duplicate_root).expect_err("duplicate root must fail");
    assert_eq!(error.code, "axis.root_duplicate");

    let mut missing_root = fixture();
    let mut second_axis = missing_root["machines"][0]["axes"][0].clone();
    second_axis["id"] = Value::String("60000000-0000-4000-8000-000000000001".to_owned());
    second_axis["name"] = Value::String("Y".to_owned());
    second_axis["directionUnit"] = json!({"x": 0, "y": 1, "z": 0});
    missing_root["machines"][0]["axes"]
        .as_array_mut()
        .expect("machine axes")
        .push(second_axis);
    let error =
        Project::from_json_value(missing_root).expect_err("unlisted parentless axis must fail");
    assert_eq!(error.code, "axis.root_incomplete");
}

#[test]
fn schema_collision_members_and_tool_changes_resolve_references() {
    let mut collision = fixture();
    collision["machines"][0]["collisionGroups"] = json!([{
        "schemaVersion": 1,
        "id": "60000000-0000-4000-8000-000000000002",
        "name": "Fixture collision group",
        "memberResourceIds": [
            "60000000-0000-4000-8000-000000000099"
        ]
    }]);
    let error =
        Project::from_json_value(collision).expect_err("missing collision resource must fail");
    assert_eq!(error.code, "reference.missing");

    let mut tool_change = fixture();
    tool_change["toolpaths"][0]["segments"]
        .as_array_mut()
        .expect("toolpath segments")
        .push(json!({
            "schemaVersion": 1,
            "id": "60000000-0000-4000-8000-000000000003",
            "sequence": 1,
            "segmentType": "tool-change",
            "positionMm": {
                "xMm": 0,
                "yMm": 0,
                "zMm": 31
            },
            "toolAssemblyId": "60000000-0000-4000-8000-000000000098"
        }));
    let error =
        Project::from_json_value(tool_change).expect_err("missing tool-change tool must fail");
    assert_eq!(error.code, "reference.missing");
}

#[test]
fn schema_toolpath_sequences_and_source_line_map_are_unambiguous() {
    let mut sequence = fixture();
    let mut duplicate_sequence = sequence["toolpaths"][0]["segments"][0].clone();
    duplicate_sequence["id"] = Value::String("60000000-0000-4000-8000-000000000004".to_owned());
    sequence["toolpaths"][0]["segments"]
        .as_array_mut()
        .expect("toolpath segments")
        .push(duplicate_sequence);
    let error =
        Project::from_json_value(sequence).expect_err("non-increasing segment sequence must fail");
    assert_eq!(error.code, "toolpath.sequence_not_increasing");

    let mut source_map = fixture();
    let duplicate_mapping = source_map["toolpaths"][0]["sourceLineMap"][0].clone();
    source_map["toolpaths"][0]["sourceLineMap"]
        .as_array_mut()
        .expect("source line map")
        .push(duplicate_mapping);
    let error = Project::from_json_value(source_map)
        .expect_err("duplicate sourceLineMap segment must fail");
    assert_eq!(error.code, "toolpath.source_line_duplicate");
}

#[test]
fn schema_project_timestamp_order_uses_nanosecond_precision() {
    let mut reversed = fixture();
    reversed["createdAt"] = Value::String("2026-07-26T00:00:00.000000002Z".to_owned());
    reversed["updatedAt"] = Value::String("2026-07-26T00:00:00.000000001Z".to_owned());
    let error =
        Project::from_json_value(reversed).expect_err("reversed nanosecond timestamps must fail");
    assert_eq!(error.code, "project.timestamp_order");

    let mut ordered = fixture();
    ordered["createdAt"] = Value::String("2026-07-26T00:00:00.000000001Z".to_owned());
    ordered["updatedAt"] = Value::String("2026-07-26T00:00:00.000000002Z".to_owned());
    Project::from_json_value(ordered).expect("increasing nanosecond timestamps");
}

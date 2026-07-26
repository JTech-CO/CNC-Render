use cnc_render_contracts::{
    ContractValidate, Project, canonical_json,
    domain::{ResourceDescriptor, ResourceRole},
    semantic_hash,
};
use serde::Deserialize;
use serde_json::Value;

const VALID_PROJECT: &str = include_str!("../../../tests/fixtures/m1/valid-project.json");
const VALID_PROJECT_HASH: &str = include_str!("../../../tests/fixtures/m1/valid-project.sha256");
const INVALID_PROJECTS: &str = include_str!("../../../tests/fixtures/m1/invalid-projects.json");

#[derive(Debug, Deserialize)]
struct InvalidProjectCase {
    name: String,
    path: Vec<PathSegment>,
    value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum PathSegment {
    Key(String),
    Index(usize),
}

#[test]
fn schema_project_fixture_round_trips_with_the_expected_semantic_hash() {
    let raw_value: Value = serde_json::from_str(VALID_PROJECT).expect("valid JSON fixture");
    let project = Project::from_json_value(raw_value.clone()).expect("valid project contract");

    project.validate().expect("semantic project validation");
    let serialized = project.to_json_value().expect("project serialization");

    assert_eq!(
        semantic_hash(&raw_value).expect("raw semantic hash"),
        VALID_PROJECT_HASH.trim(),
    );
    assert_eq!(
        project.semantic_hash().expect("typed semantic hash"),
        VALID_PROJECT_HASH.trim(),
    );
    assert_eq!(
        canonical_json(&serialized).expect("typed canonical JSON"),
        canonical_json(&raw_value).expect("raw canonical JSON"),
    );
}

#[test]
fn schema_invalid_project_fixture_cases_are_rejected() {
    let base: Value = serde_json::from_str(VALID_PROJECT).expect("valid base fixture");
    let cases: Vec<InvalidProjectCase> =
        serde_json::from_str(INVALID_PROJECTS).expect("invalid cases fixture");

    for case in cases {
        let mut candidate = base.clone();
        replace_at_path(&mut candidate, &case.path, case.value);
        assert!(
            Project::from_json_value(candidate).is_err(),
            "invalid project case should fail: {}",
            case.name,
        );
    }
}

#[test]
fn schema_unknown_fields_and_negative_zero_are_rejected() {
    let mut unknown: Value = serde_json::from_str(VALID_PROJECT).expect("valid base fixture");
    unknown
        .as_object_mut()
        .expect("project object")
        .insert("futureField".to_owned(), Value::Bool(true));
    assert!(Project::from_json_value(unknown).is_err());

    let mut negative_zero: Value = serde_json::from_str(VALID_PROJECT).expect("valid base fixture");
    negative_zero["machines"][0]["axes"][0]["homeMm"] = Value::from(-0.0_f64);
    let error = Project::from_json_value(negative_zero).expect_err("negative zero must fail");
    assert_eq!(error.code, "number.negative_zero");
}

#[test]
fn schema_required_nullable_project_fields_reject_missing_keys() {
    let base: Value = serde_json::from_str(VALID_PROJECT).expect("valid base fixture");

    for (parent_pointer, field) in [
        ("/machines/0/axes/0", "parentId"),
        ("/machines/0", "modelAssetResourceId"),
        ("/stocks/0", "sourceModelResourceId"),
        ("/operations/0", "targetGeometryResourceId"),
        ("/operations/0", "generatedToolpathId"),
    ] {
        let mut missing = base.clone();
        missing
            .pointer_mut(parent_pointer)
            .and_then(Value::as_object_mut)
            .expect("nullable field parent")
            .remove(field);
        assert!(
            Project::from_json_value(missing).is_err(),
            "missing required-nullable field must fail: {parent_pointer}/{field}",
        );
    }

    let mut explicit_null = base;
    explicit_null["operations"][0]["generatedToolpathId"] = Value::Null;
    Project::from_json_value(explicit_null).expect("explicit null remains valid");
}

#[test]
fn schema_uuid_policy_matches_strict_typescript_contract() {
    let base: Value = serde_json::from_str(VALID_PROJECT).expect("valid base fixture");

    for accepted in [
        "00000000-0000-1000-8000-000000000001",
        "00000000-0000-8000-b000-000000000001",
        "ABCDEF01-2345-4ABC-BDEF-0123456789AB",
    ] {
        let mut candidate = base.clone();
        candidate["id"] = Value::String(accepted.to_owned());
        Project::from_json_value(candidate)
            .unwrap_or_else(|error| panic!("accepted UUID {accepted}: {error}"));
    }

    for rejected in [
        "00000000-0000-0000-0000-000000000000",
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
        "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
        "00000000-0000-0000-8000-000000000001",
        "00000000-0000-9000-8000-000000000001",
        "00000000-0000-4000-7000-000000000001",
        "00000000-0000-4000-c000-000000000001",
        "00000000-0000-4000-8000-000000000001\n",
    ] {
        let mut candidate = base.clone();
        candidate["id"] = Value::String(rejected.to_owned());
        assert!(
            Project::from_json_value(candidate).is_err(),
            "rejected UUID must fail: {rejected:?}",
        );
    }
}

#[test]
fn schema_utc_timestamp_checks_calendar_and_clock_ranges() {
    let base: Value = serde_json::from_str(VALID_PROJECT).expect("valid base fixture");

    for accepted in [
        "0001-01-01T00:00:00Z",
        "2024-02-29T23:59:59Z",
        "2024-02-29T23:59:59.123456789Z",
    ] {
        let mut candidate = base.clone();
        candidate["createdAt"] = Value::String(accepted.to_owned());
        Project::from_json_value(candidate)
            .unwrap_or_else(|error| panic!("accepted timestamp {accepted}: {error}"));
    }

    for rejected in [
        "0000-01-01T00:00:00Z",
        "2023-02-29T00:00:00Z",
        "2024-04-31T00:00:00Z",
        "2024-13-01T00:00:00Z",
        "2024-01-01T24:00:00Z",
        "2024-01-01T00:60:00Z",
        "2024-01-01T00:00:60Z",
        "2024-01-01T00:00:00Z\n",
    ] {
        let mut candidate = base.clone();
        candidate["createdAt"] = Value::String(rejected.to_owned());
        assert!(
            Project::from_json_value(candidate).is_err(),
            "rejected timestamp must fail: {rejected:?}",
        );
    }
}

#[test]
fn schema_resource_descriptor_standalone_validation_rejects_unsafe_derived_data() {
    let project: Value = serde_json::from_str(VALID_PROJECT).expect("valid base fixture");
    let resource: ResourceDescriptor =
        serde_json::from_value(project["resources"][0].clone()).expect("resource fixture");
    resource.validate().expect("valid standalone resource");

    let mut unsafe_path = resource.clone();
    unsafe_path.path = "../escape.nc".to_owned();
    let error = unsafe_path
        .validate()
        .expect_err("unsafe standalone path must fail");
    assert_eq!(error.code, "resource.path_unsafe");

    let mut derived = resource;
    derived.role = ResourceRole::Preview;
    derived.authoritative = true;
    let error = derived
        .validate()
        .expect_err("authoritative derived resource must fail");
    assert_eq!(error.code, "resource.derived_authoritative");
}

#[test]
fn schema_save_load_preserves_internal_precision() {
    let mut value: Value = serde_json::from_str(VALID_PROJECT).expect("valid base fixture");
    value["machines"][0]["axes"][0]["homeMm"] = Value::from(12.345_678_901_234_5_f64);

    let project = Project::from_json_value(value).expect("precise project fixture");
    let saved = serde_json::to_string(&project).expect("save project");
    let loaded = Project::from_json_str(&saved).expect("load project");

    let home = match &loaded.machines[0].axes[0] {
        cnc_render_contracts::domain::KinematicAxis::Linear { home_mm, .. } => *home_mm,
        cnc_render_contracts::domain::KinematicAxis::Rotary { .. } => {
            panic!("expected linear axis")
        }
    };
    assert_eq!(home, 12.345_678_901_234_5_f64);
}

#[test]
fn schema_resource_paths_collide_after_nfc_and_lowercase_normalization() {
    let mut value: Value = serde_json::from_str(VALID_PROJECT).expect("valid base fixture");
    let mut composed = value["resources"][0].clone();
    composed["id"] = Value::String("40000000-0000-4000-8000-000000000001".to_owned());
    composed["path"] = Value::String("models/Café.stl".to_owned());

    let mut decomposed = composed.clone();
    decomposed["id"] = Value::String("40000000-0000-4000-8000-000000000002".to_owned());
    decomposed["path"] = Value::String("models/cafe\u{301}.stl".to_owned());

    value["resources"] = Value::Array(vec![composed, decomposed]);
    let error = Project::from_json_value(value).expect_err("normalized path collision must fail");
    assert_eq!(error.code, "resource.path_collision");
}

fn replace_at_path(root: &mut Value, path: &[PathSegment], replacement: Value) {
    let (last, parents) = path.split_last().expect("non-empty mutation path");
    let mut cursor = root;
    for segment in parents {
        cursor = match segment {
            PathSegment::Key(key) => cursor
                .as_object_mut()
                .and_then(|object| object.get_mut(key))
                .expect("fixture object path"),
            PathSegment::Index(index) => cursor
                .as_array_mut()
                .and_then(|array| array.get_mut(*index))
                .expect("fixture array path"),
        };
    }

    match last {
        PathSegment::Key(key) => {
            cursor
                .as_object_mut()
                .expect("fixture object parent")
                .insert(key.clone(), replacement);
        }
        PathSegment::Index(index) => {
            cursor.as_array_mut().expect("fixture array parent")[*index] = replacement;
        }
    }
}

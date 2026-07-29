use cnc_render_contracts::{ContractValidate, WorkerMessage, WorkerProtocolValidator};
use serde_json::{Value, json};

const WORKER_MESSAGES: &str = include_str!("../../../tests/fixtures/m1/worker-messages.json");

#[test]
fn schema_worker_fixture_messages_match_the_rust_contract() {
    let messages: Vec<Value> = serde_json::from_str(WORKER_MESSAGES).expect("worker fixture JSON");
    let mut validator = WorkerProtocolValidator::new();

    for message_value in messages {
        let message = WorkerMessage::from_json_value(message_value).expect("valid worker message");
        message.validate().expect("worker semantic validation");
        validator
            .accept(message)
            .expect("valid worker protocol transition");
    }
}

#[test]
fn schema_worker_required_nullable_fields_reject_missing_keys() {
    let messages = required_nullable_message_values();

    for message in &messages {
        WorkerMessage::from_json_value(message.clone()).expect("explicit null worker field");
        let mut missing_reply_to = message.clone();
        missing_reply_to
            .as_object_mut()
            .expect("worker message object")
            .remove("replyTo");
        assert!(
            WorkerMessage::from_json_value(missing_reply_to).is_err(),
            "every Worker envelope requires replyTo, even when null",
        );
    }

    for index in [0_usize, 3, 7] {
        let mut missing_run_id = messages[index].clone();
        missing_run_id
            .as_object_mut()
            .expect("worker message object")
            .remove("runId");
        assert!(
            WorkerMessage::from_json_value(missing_run_id).is_err(),
            "nullable runId must be present for message index {index}",
        );
    }

    let mut missing_diagnostic_line = messages[6].clone();
    missing_diagnostic_line["payload"]["event"]
        .as_object_mut()
        .expect("diagnostic event")
        .remove("sourceLine");
    assert!(
        WorkerMessage::from_json_value(missing_diagnostic_line).is_err(),
        "diagnostic sourceLine must be present even when null",
    );

    let mut collision = messages[6].clone();
    collision["messageId"] = Value::String("10000000-0000-4000-8000-00000000001a".to_owned());
    collision["payload"]["event"] = json!({
        "schemaVersion": 1,
        "runId": "20000000-0000-4000-8000-000000000010",
        "sequence": 0,
        "timeS": 0,
        "eventType": "simulation.collision",
        "severity": "warning",
        "objectAId": "50000000-0000-4000-8000-000000000001",
        "objectBId": "50000000-0000-4000-8000-000000000002",
        "positionMm": {
            "xMm": 0,
            "yMm": 0,
            "zMm": 0
        },
        "penetrationEstimateMm": 0.1,
        "sourceLine": null
    });
    WorkerMessage::from_json_value(collision.clone()).expect("explicit null collision sourceLine");
    collision["payload"]["event"]
        .as_object_mut()
        .expect("collision event")
        .remove("sourceLine");
    assert!(
        WorkerMessage::from_json_value(collision).is_err(),
        "collision sourceLine must be present even when null",
    );
}
#[test]
fn schema_worker_reply_shape_contract_is_explicit() {
    let messages = required_nullable_message_values();

    for message in &messages[..3] {
        let mut command_with_reply = message.clone();
        command_with_reply["replyTo"] =
            Value::String("10000000-0000-4000-8000-000000000099".to_owned());
        let error = WorkerMessage::from_json_value(command_with_reply)
            .expect_err("one-way command replyTo must be null");
        assert_eq!(error.code, "message.reply_not_null");
    }

    for message in &messages[3..6] {
        let mut event_without_reply = message.clone();
        event_without_reply["replyTo"] = Value::Null;
        assert!(
            WorkerMessage::from_json_value(event_without_reply).is_err(),
            "ready/accepted/rejected require a UUID replyTo",
        );
    }

    WorkerMessage::from_json_value(messages[6].clone())
        .expect("simulation.event permits explicit null replyTo");
    WorkerMessage::from_json_value(messages[7].clone())
        .expect("worker.error permits explicit null replyTo");
}

#[test]
fn schema_worker_state_validator_checks_reply_target_type_and_run() {
    let messages = required_nullable_message_values();

    let mut handshake_flow = WorkerProtocolValidator::new();
    handshake_flow
        .accept_json_value(messages[0].clone())
        .expect("handshake command");
    handshake_flow
        .accept_json_value(messages[3].clone())
        .expect("ready replies to handshake");

    let mut project_flow = WorkerProtocolValidator::new();
    project_flow
        .accept_json_value(messages[1].clone())
        .expect("project load command");
    project_flow
        .accept_json_value(messages[4].clone())
        .expect("project accepted replies to same-run load");

    let mut unknown_reply = messages[7].clone();
    unknown_reply["replyTo"] = Value::String("10000000-0000-4000-8000-000000000099".to_owned());
    let error = WorkerProtocolValidator::new()
        .accept_json_value(unknown_reply)
        .expect_err("unknown reply target must fail");
    assert_eq!(error.code, "reply.unknown");

    let mut wrong_type_flow = WorkerProtocolValidator::new();
    wrong_type_flow
        .accept_json_value(messages[0].clone())
        .expect("handshake command");
    let mut wrong_type = messages[4].clone();
    wrong_type["replyTo"] = messages[0]["messageId"].clone();
    let error = wrong_type_flow
        .accept_json_value(wrong_type)
        .expect_err("accepted must reply to project.load");
    assert_eq!(error.code, "reply.type_mismatch");

    let mut wrong_run_flow = WorkerProtocolValidator::new();
    wrong_run_flow
        .accept_json_value(messages[1].clone())
        .expect("project load command");
    let mut wrong_run = messages[5].clone();
    wrong_run["runId"] = Value::String("20000000-0000-4000-8000-000000000011".to_owned());
    let error = wrong_run_flow
        .accept_json_value(wrong_run)
        .expect_err("project reply run must match load run");
    assert_eq!(error.code, "reply.run_mismatch");
}

#[test]
fn schema_worker_validator_rejects_duplicate_and_regressing_messages() {
    let messages: Vec<Value> = serde_json::from_str(WORKER_MESSAGES).expect("worker fixture JSON");
    let first = WorkerMessage::from_json_value(messages[0].clone()).expect("handshake fixture");
    let mut duplicate_validator = WorkerProtocolValidator::new();
    duplicate_validator
        .accept(first.clone())
        .expect("first handshake");
    let duplicate = duplicate_validator
        .accept(first)
        .expect_err("duplicate message ID must fail");
    assert_eq!(duplicate.code, "message.duplicate");

    let mut sequence_validator = WorkerProtocolValidator::new();
    sequence_validator
        .accept_json_value(messages[2].clone())
        .expect("sequence zero");
    sequence_validator
        .accept_json_value(messages[3].clone())
        .expect("sequence one");

    let mut regression = messages[3].clone();
    regression["messageId"] = Value::String("10000000-0000-4000-8000-000000000005".to_owned());
    regression["sequence"] = Value::from(0);
    regression["payload"]["event"]["sequence"] = Value::from(0);
    let error = sequence_validator
        .accept_json_value(regression)
        .expect_err("regressing sequence must fail");
    assert_eq!(error.code, "sequence.not_monotonic");
}

#[test]
fn schema_worker_validator_rejects_disposed_run_messages() {
    let run_id = "20000000-0000-4000-8000-000000000002";
    let dispose = json!({
        "protocolVersion": 1,
        "messageId": "10000000-0000-4000-8000-000000000006",
        "replyTo": null,
        "kind": "command",
        "type": "run.dispose",
        "runId": run_id,
        "sequence": 0,
        "payload": {
            "reason": "cancelled"
        }
    });
    let stale_event = json!({
        "protocolVersion": 1,
        "messageId": "10000000-0000-4000-8000-000000000007",
        "replyTo": null,
        "kind": "event",
        "type": "worker.error",
        "runId": run_id,
        "sequence": 0,
        "payload": {
            "code": "run.cancelled",
            "messageKey": "run.cancelled",
            "recoverable": true
        }
    });

    let mut validator = WorkerProtocolValidator::new();
    validator
        .accept_json_value(dispose)
        .expect("dispose command");
    let error = validator
        .accept_json_value(stale_event)
        .expect_err("disposed run message must fail");
    assert_eq!(error.code, "run.disposed");
}

#[test]
fn schema_worker_rejects_envelope_event_mismatch_and_unknown_fields() {
    let messages: Vec<Value> = serde_json::from_str(WORKER_MESSAGES).expect("worker fixture JSON");
    let mut mismatch = messages[2].clone();
    mismatch["payload"]["event"]["runId"] =
        Value::String("20000000-0000-4000-8000-000000000099".to_owned());
    let error =
        WorkerMessage::from_json_value(mismatch).expect_err("event runId mismatch must fail");
    assert_eq!(error.code, "message.run_id_mismatch");

    let mut unknown = messages[0].clone();
    unknown["payload"]["binary"] = json!([1, 2, 3]);
    assert!(WorkerMessage::from_json_value(unknown).is_err());
}

#[test]
fn schema_binary_handles_are_opaque_and_positive_sized() {
    let project: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/m1/valid-project.json"
    ))
    .expect("valid project fixture");
    let run_id = "20000000-0000-4000-8000-000000000003";
    let valid = json!({
        "protocolVersion": 1,
        "messageId": "10000000-0000-4000-8000-000000000008",
        "replyTo": null,
        "kind": "command",
        "type": "project.load",
        "runId": run_id,
        "sequence": 0,
        "payload": {
            "project": project,
            "transferMode": "transferable",
            "binaryHandles": [{
                "handleId": "30000000-0000-4000-8000-000000000001",
                "binaryKind": "toolpath-segments",
                "byteLength": 1024,
                "elementType": "float64",
                "ownership": "receiver"
            }]
        }
    });
    WorkerMessage::from_json_value(valid.clone()).expect("opaque binary handle descriptor");

    let mut zero_size = valid;
    zero_size["messageId"] = Value::String("10000000-0000-4000-8000-000000000009".to_owned());
    zero_size["payload"]["binaryHandles"][0]["byteLength"] = Value::from(0);
    assert!(WorkerMessage::from_json_value(zero_size).is_err());
}

fn required_nullable_message_values() -> Vec<Value> {
    let fixture_messages: Vec<Value> =
        serde_json::from_str(WORKER_MESSAGES).expect("worker fixture JSON");
    let project: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/m1/valid-project.json"
    ))
    .expect("valid project fixture");
    let run_id = "20000000-0000-4000-8000-000000000010";

    vec![
        fixture_messages[0].clone(),
        json!({
            "protocolVersion": 1,
            "messageId": "10000000-0000-4000-8000-000000000011",
            "replyTo": null,
            "kind": "command",
            "type": "project.load",
            "runId": run_id,
            "sequence": 0,
            "payload": {
                "project": project,
                "transferMode": "copy",
                "binaryHandles": []
            }
        }),
        json!({
            "protocolVersion": 1,
            "messageId": "10000000-0000-4000-8000-000000000012",
            "replyTo": null,
            "kind": "command",
            "type": "run.dispose",
            "runId": run_id,
            "sequence": 1,
            "payload": {
                "reason": "completed"
            }
        }),
        fixture_messages[1].clone(),
        json!({
            "protocolVersion": 1,
            "messageId": "10000000-0000-4000-8000-000000000014",
            "replyTo": "10000000-0000-4000-8000-000000000011",
            "kind": "event",
            "type": "project.accepted",
            "runId": run_id,
            "sequence": 0,
            "payload": {
                "projectId": "00000000-0000-4000-8000-000000000001",
                "semanticHashSha256":
                    "0000000000000000000000000000000000000000000000000000000000000000"
            }
        }),
        json!({
            "protocolVersion": 1,
            "messageId": "10000000-0000-4000-8000-000000000015",
            "replyTo": "10000000-0000-4000-8000-000000000011",
            "kind": "event",
            "type": "project.rejected",
            "runId": run_id,
            "sequence": 0,
            "payload": {
                "code": "project.invalid",
                "messageKey": "project.invalid",
                "path": ["stocks", 0]
            }
        }),
        json!({
            "protocolVersion": 1,
            "messageId": "10000000-0000-4000-8000-000000000016",
            "replyTo": null,
            "kind": "event",
            "type": "simulation.event",
            "runId": run_id,
            "sequence": 0,
            "payload": {
                "event": {
                    "schemaVersion": 1,
                    "runId": run_id,
                    "sequence": 0,
                    "timeS": 0,
                    "eventType": "simulation.diagnostic",
                    "severity": "warning",
                    "code": "toolpath.warning",
                    "messageKey": "toolpath.warning",
                    "sourceLine": null
                },
                "binaryHandles": []
            }
        }),
        json!({
            "protocolVersion": 1,
            "messageId": "10000000-0000-4000-8000-000000000017",
            "replyTo": null,
            "kind": "event",
            "type": "worker.error",
            "runId": null,
            "sequence": 0,
            "payload": {
                "code": "worker.failure",
                "messageKey": "worker.failure",
                "recoverable": false
            }
        }),
    ]
}

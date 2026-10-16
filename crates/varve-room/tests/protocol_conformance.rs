//! Cross-implementation protocol conformance: the same fixture file that
//! the TypeScript client suite checks must produce identical accept/reject
//! decisions here. Extend the fixture, never one side alone.

use serde_json::Value;
use varve_room::protocol::{capture_payload_like, ClientMessage, ServerMessage};

fn load_fixture() -> Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/collab/src/__fixtures__/protocol-v1.json"
    );
    let raw = std::fs::read_to_string(path).expect("protocol fixture present");
    serde_json::from_str(&raw).expect("fixture parses")
}

#[test]
fn valid_fixture_frames_parse_and_validate() {
    let fixture = load_fixture();
    for frame in fixture["valid"].as_array().expect("valid array") {
        let as_client =
            serde_json::from_value::<ClientMessage>(frame.clone()).map(|m| m.validate().is_ok());
        let as_server = serde_json::from_value::<ServerMessage>(frame.clone()).map(|_| true);
        let accepted = matches!(as_client, Ok(true)) || matches!(as_server, Ok(true));
        assert!(accepted, "host must accept valid frame: {frame}");
    }
}

#[test]
fn invalid_fixture_frames_never_parse_and_validate() {
    let fixture = load_fixture();
    for frame in fixture["invalid"].as_array().expect("invalid array") {
        // The host's ONLY untrusted input direction is client frames, so
        // the host contract is strict there: an invalid frame must fail to
        // parse or fail structural validation. Server-direction frames are
        // produced (never parsed) by the host; their validation is the
        // TS client's contract and is checked by the TS fixture suite.
        let client_rejects = match serde_json::from_value::<ClientMessage>(frame.clone()) {
            Ok(message) => message.validate().is_err(),
            Err(_) => true,
        };
        assert!(client_rejects, "host must reject invalid frame: {frame}");
    }
}

#[test]
fn capture_envelope_check_rejects_wrong_shapes() {
    assert!(!capture_payload_like(&Value::Null));
    assert!(!capture_payload_like(&serde_json::json!({ "changes": [] })));
    assert!(!capture_payload_like(&serde_json::json!({
        "transactionId": "tx",
        "changes": [],
        "beforeHash": "short",
        "afterHash": "0".repeat(64),
        "summary": {},
    })));
    assert!(capture_payload_like(&serde_json::json!({
        "transactionId": "tx",
        "changes": [{ "changeType": "modified" }],
        "beforeHash": "a".repeat(64),
        "afterHash": "b".repeat(64),
        "summary": { "label": "x" },
    })));
}

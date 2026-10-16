//! End-to-end room host integration: real WebSocket clients through a live
//! server on an ephemeral port — join, ordered operations, journal
//! durability across restart, viewer restrictions, and revocation teardown.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use varve_room::protocol::ParticipantRole;
use varve_room::{HostConfig, RoomHost};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

fn temp_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("varve-room-test-{label}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

async fn serve_host(
    data_dir: std::path::PathBuf,
) -> (Arc<RoomHost>, SocketAddr, tokio::sync::watch::Sender<bool>) {
    let config = HostConfig {
        admin_token: Some("test-admin-token".to_string()),
        ..HostConfig::for_data_dir(data_dir.clone())
    };
    let host = RoomHost::open(config).expect("host opens");
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let address = varve_room::serve(host.clone(), "127.0.0.1:0".parse().unwrap(), shutdown_rx)
        .await
        .expect("server binds");
    (host, address, shutdown_tx)
}

async fn connect(address: SocketAddr, room_id: &str, token: &str) -> Ws {
    let url = format!("ws://{address}/room/{room_id}");
    let mut request = url.into_client_request().expect("request");
    request.headers_mut().remove("origin");
    let (ws, _) = tokio_tungstenite::connect_async(request)
        .await
        .expect("socket");
    let mut ws = ws;
    ws.send(WsMessage::Text(
        json!({
            "type": "hello",
            "protocol": 1,
            "token": token,
            "clientId": "test-client",
            "displayName": "Tester"
        })
        .to_string()
        .into(),
    ))
    .await
    .expect("hello sent");
    ws
}

async fn wait_for_frame(ws: &mut Ws, frame_type: &str) -> Value {
    loop {
        let frame = tokio::time::timeout(Duration::from_secs(5), ws.next())
            .await
            .expect("frame within timeout")
            .expect("stream open");
        if let Ok(WsMessage::Text(text)) = frame {
            let parsed: Value = serde_json::from_str(&text).expect("server frame parses");
            if parsed["type"] == frame_type {
                return parsed;
            }
        }
    }
}

fn make_op(client_op_id: &str, label: &str) -> String {
    json!({
        "type": "operation",
        "op": {
            "clientOpId": client_op_id,
            "basedOnSeq": 0,
            "actorId": "spoofed-actor",
            "actorName": "Tester",
            "transactionId": format!("tx-{client_op_id}"),
            "label": label,
            "kind": "modify",
            "originAuthor": "local-user",
            "revertsClientOpId": null,
            "capture": {
                "transactionId": format!("tx-{client_op_id}"),
                "changes": [{
                    "changeType": "modified",
                    "entityId": "n1",
                    "entityType": "node",
                    "propertyPath": "nodes.n1.opacity",
                    "before": 1,
                    "after": 0.5,
                    "summary": "opacity"
                }],
                "summary": { "label": label, "affectedEntityIds": ["n1"], "kind": "modify" },
                "beforeHash": "a".repeat(64),
                "afterHash": "b".repeat(64)
            }
        }
    })
    .to_string()
}

#[tokio::test]
async fn two_clients_exchange_ops_and_the_journal_survives_restart() {
    let dir = temp_dir("restart");
    let (host, address, shutdown) = serve_host(dir.clone()).await;

    let room = host
        .admin_create_room("doc-1", "{\"id\":\"doc-1\"}")
        .expect("room");
    let editor_token = host
        .admin_create_invite(&room.room_id, ParticipantRole::Editor, i64::MAX / 2)
        .expect("invite");

    let mut owner = connect(address, &room.room_id, &room.owner_invite_token).await;
    let welcome = wait_for_frame(&mut owner, "welcome").await;
    assert_eq!(welcome["role"], "owner");
    assert_eq!(welcome["snapshot"]["uptoSeq"], 0);

    let mut editor = connect(address, &room.room_id, &editor_token).await;
    wait_for_frame(&mut editor, "welcome").await;
    wait_for_frame(&mut owner, "participant-joined").await;

    owner
        .send(WsMessage::Text(make_op("op-owner-1", "Move node").into()))
        .await
        .expect("op sent");
    let accepted = wait_for_frame(&mut owner, "operation-accepted").await;
    assert_eq!(accepted["seq"], 1);
    let relayed = wait_for_frame(&mut editor, "operation").await;
    assert_eq!(relayed["op"]["clientOpId"], "op-owner-1");
    // The host stamps the authenticated actor: a spoofed identity is overridden.
    assert!(relayed["op"]["actorId"]
        .as_str()
        .expect("actorId")
        .starts_with("actor-"));

    // Restart the server against the same data dir: the journal is durable,
    // a fresh client bootstraps from snapshot + replayed operations.
    let _ = shutdown.send(true);
    tokio::time::sleep(Duration::from_millis(200)).await;
    let (_host2, address2, _shutdown2) = serve_host(dir).await;
    let mut late_joiner = connect(address2, &room.room_id, &editor_token).await;
    let welcome = wait_for_frame(&mut late_joiner, "welcome").await;
    assert_eq!(welcome["snapshot"]["uptoSeq"], 0);
    let sync = wait_for_frame(&mut late_joiner, "sync").await;
    assert_eq!(sync["operations"][0]["op"]["clientOpId"], "op-owner-1");
}

#[tokio::test]
async fn viewers_cannot_mutate_and_revocation_disconnects_live_sessions() {
    let dir = temp_dir("viewer");
    let (host, address, _shutdown) = serve_host(dir.clone()).await;

    let room = host
        .admin_create_room("doc-1", "{\"id\":\"doc-1\"}")
        .expect("room");
    let viewer_token = host
        .admin_create_invite(&room.room_id, ParticipantRole::Viewer, i64::MAX / 2)
        .expect("invite");

    let mut viewer = connect(address, &room.room_id, &viewer_token).await;
    let welcome = wait_for_frame(&mut viewer, "welcome").await;
    assert_eq!(welcome["role"], "viewer");

    viewer
        .send(WsMessage::Text(make_op("op-viewer-1", "Edit").into()))
        .await
        .expect("op sent");
    let rejected = wait_for_frame(&mut viewer, "operation-rejected").await;
    assert_eq!(
        rejected["reason"],
        "You have view-only access to this session."
    );

    // Revocation is an event: the live socket receives room-ended now.
    let hash = varve_room::token::token_hash(&viewer_token);
    assert!(host.admin_revoke_invite(&hash).expect("revoke"));
    let ended = wait_for_frame(&mut viewer, "room-ended").await;
    assert_eq!(ended["reason"], "Your access was revoked");
}

#[tokio::test]
async fn invalid_tokens_are_refused_before_any_room_data_flows() {
    let dir = temp_dir("badtoken");
    let (_host, address, _shutdown) = serve_host(dir.clone()).await;
    let room_host = RoomHost::open(HostConfig {
        admin_token: Some("test-admin-token".to_string()),
        ..HostConfig::for_data_dir(dir)
    })
    .expect("library host");
    let room = room_host
        .admin_create_room("doc-1", "{\"id\":\"doc-1\"}")
        .expect("room");

    let mut intruder = connect(address, &room.room_id, "not-a-real-token").await;
    // The host closes instead of sending any room state.
    let closed = tokio::time::timeout(Duration::from_secs(5), intruder.next()).await;
    match closed {
        Ok(Some(Ok(WsMessage::Close(frame)))) => {
            let code = frame.expect("close frame").code;
            let raw = u16::from(code);
            assert_eq!(raw, 4401, "close code must be 4401 (invite invalid)");
        }
        other => panic!("expected a 4401 close, got {other:?}"),
    }
}

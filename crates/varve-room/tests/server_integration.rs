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
use varve_room::store::RoomStoreError;
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
    serve_host_with_idle(data_dir, 15 * 60 * 1000).await
}

async fn serve_host_with_idle(
    data_dir: std::path::PathBuf,
    idle_timeout_ms: u64,
) -> (Arc<RoomHost>, SocketAddr, tokio::sync::watch::Sender<bool>) {
    let config = HostConfig {
        admin_token: Some("test-admin-token".to_string()),
        idle_timeout_ms,
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

/// Assert no frame of `frame_type` arrives within `within` (a negative check:
/// a revoked or rate-limited participant must not reach its peers).
async fn expect_no_frame(ws: &mut Ws, frame_type: &str, within: Duration) {
    let deadline = tokio::time::Instant::now() + within;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return;
        }
        let next = tokio::time::timeout(remaining, ws.next()).await;
        match next {
            Ok(Some(Ok(WsMessage::Text(text)))) => {
                let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                assert_ne!(
                    parsed["type"], frame_type,
                    "unexpected {frame_type} frame: {parsed}"
                );
            }
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(_))) | Ok(None) => return,
            Err(_) => return,
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

/// An operation whose capture carries embedded image bytes, mirroring what
/// `diffDocuments` emits for a newly added `DocumentAsset` (the capture
/// carries the data URL — see packages/history/src/diff.ts).
fn make_asset_op(client_op_id: &str, data_url: &str) -> String {
    json!({
        "type": "operation",
        "op": {
            "clientOpId": client_op_id,
            "basedOnSeq": 0,
            "actorId": "spoofed-actor",
            "actorName": "Tester",
            "transactionId": format!("tx-{client_op_id}"),
            "label": "Insert image",
            "kind": "modify",
            "originAuthor": "local-user",
            "revertsClientOpId": null,
            "capture": {
                "transactionId": format!("tx-{client_op_id}"),
                "changes": [{
                    "changeType": "added",
                    "entityId": "asset-abc",
                    "entityType": "asset",
                    "propertyPath": "assets",
                    "after": {
                        "id": "asset-abc",
                        "storage": "embedded",
                        "mimeType": "image/png",
                        "dataUrl": data_url,
                        "naturalWidth": 1,
                        "naturalHeight": 1,
                        "byteLength": 1,
                        "hash": "deadbeef"
                    },
                    "summary": "Added image asset"
                }],
                "summary": { "label": "Insert image", "affectedEntityIds": ["asset-abc"], "kind": "modify" },
                "beforeHash": "a".repeat(64),
                "afterHash": "b".repeat(64)
            }
        }
    })
    .to_string()
}

const MAX_INLINE_FRAME_BYTES_TEST: usize = 2_000_000;
const TEST_CHUNK_CHARS: usize = 200_000;

/// Upload one serialized operation frame through the chunked path: begin,
/// ordered chunks, end. Mirrors `packages/collab/src/chunkedOperation.ts`.
async fn send_chunked_operation(ws: &mut Ws, upload_id: &str, frame: &str) {
    let chars: Vec<char> = frame.chars().collect();
    let chunk_count = chars.len().div_ceil(TEST_CHUNK_CHARS);
    ws.send(WsMessage::Text(
        json!({
            "type": "operation-begin",
            "uploadId": upload_id,
            "totalBytes": frame.len(),
            "chunkCount": chunk_count,
            "digest": sha256_hex(frame.as_bytes()),
        })
        .to_string()
        .into(),
    ))
    .await
    .expect("begin sent");
    for index in 0..chunk_count {
        let start = index * TEST_CHUNK_CHARS;
        let end = (start + TEST_CHUNK_CHARS).min(chars.len());
        let data: String = chars[start..end].iter().collect();
        ws.send(WsMessage::Text(
            json!({
                "type": "operation-chunk",
                "uploadId": upload_id,
                "index": index,
                "data": data,
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("chunk sent");
    }
    ws.send(WsMessage::Text(
        json!({ "type": "operation-end", "uploadId": upload_id })
            .to_string()
            .into(),
    ))
    .await
    .expect("end sent");
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
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
    // a fresh client bootstraps from snapshot + replayed operations. The
    // single-owner lock means the old process must actually be gone first —
    // dropping the last handle is what releases the directory.
    let _ = shutdown.send(true);
    tokio::time::sleep(Duration::from_millis(200)).await;
    drop(owner);
    drop(editor);
    drop(host);
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

    // Revocation is an event: the live socket is told, and then ENDED. Merely
    // messaging a hostile client would leave it able to keep reading the
    // journal and injecting presence.
    let hash = varve_room::token::token_hash(&viewer_token);
    assert!(host.admin_revoke_invite(&hash).expect("revoke"));
    let ended = wait_for_frame(&mut viewer, "room-ended").await;
    assert_eq!(ended["reason"], "Your access was revoked");
    let mut closed_by_host = false;
    loop {
        let next = tokio::time::timeout(Duration::from_secs(5), viewer.next()).await;
        match next {
            Ok(Some(Ok(WsMessage::Close(_)))) | Ok(None) | Ok(Some(Err(_))) => {
                closed_by_host = true;
                break;
            }
            Ok(Some(Ok(_))) => continue,
            Err(_) => break,
        }
    }
    assert!(closed_by_host, "a revoked session's socket must be closed");

    // A presence frame from a revoked session never reaches a peer.
    let mut peer = connect(address, &room.room_id, &room.owner_invite_token).await;
    wait_for_frame(&mut peer, "welcome").await;
    let _ = viewer
        .send(WsMessage::Text(
            json!({ "type": "cursor", "pageId": null, "x": 1.0, "y": 2.0 })
                .to_string()
                .into(),
        ))
        .await;
    expect_no_frame(&mut peer, "presence-cursor", Duration::from_millis(600)).await;
}

/// A revoked OWNER must not be able to move the baseline every future joiner
/// bootstraps from, and the refusal is visible rather than a silent no-op.
#[tokio::test]
async fn a_revoked_owner_cannot_replace_the_baseline() {
    let dir = temp_dir("revoked-owner");
    let (host, address, _shutdown) = serve_host(dir.clone()).await;
    let room = host
        .admin_create_room("doc-1", "{\"id\":\"doc-1\"}")
        .expect("room");

    let mut owner = connect(address, &room.room_id, &room.owner_invite_token).await;
    wait_for_frame(&mut owner, "welcome").await;

    // Nonsense baseline for a non-owner is refused with a reason.
    let viewer_token = host
        .admin_create_invite(&room.room_id, ParticipantRole::Viewer, i64::MAX / 2)
        .expect("invite");
    let mut viewer = connect(address, &room.room_id, &viewer_token).await;
    wait_for_frame(&mut viewer, "welcome").await;
    viewer
        .send(WsMessage::Text(
            json!({ "type": "snapshot-upload", "uptoSeq": 0, "documentJson": "{\"id\":\"evil\"}" })
                .to_string()
                .into(),
        ))
        .await
        .expect("upload sent");
    let refused = wait_for_frame(&mut viewer, "error").await;
    assert_eq!(refused["code"], "snapshot-refused");

    // A revoked owner cannot either, and the stored baseline is unchanged.
    let before = host
        .admin_create_invite(&room.room_id, ParticipantRole::Editor, i64::MAX / 2)
        .is_ok();
    assert!(before, "the host still serves");
    let hash = varve_room::token::token_hash(&room.owner_invite_token);
    assert!(host.admin_revoke_invite(&hash).expect("revoke"));
    let _ = owner
        .send(WsMessage::Text(
            json!({ "type": "snapshot-upload", "uptoSeq": 0, "documentJson": "{\"id\":\"evil\"}" })
                .to_string()
                .into(),
        ))
        .await;
    // The upload is refused before it is stored: a fresh joiner still sees the
    // original baseline.
    let mut late = connect(address, &room.room_id, &viewer_token).await;
    let welcome = wait_for_frame(&mut late, "welcome").await;
    assert_eq!(
        welcome["snapshot"]["documentJson"], "{\"id\":\"doc-1\"}",
        "the baseline must be unchanged"
    );
}

/// An operation refused for a bound violation is attributed to its own
/// clientOpId, so the sender settles it instead of re-sending it forever.
#[tokio::test]
async fn an_out_of_bounds_operation_is_refused_by_name() {
    let dir = temp_dir("attributed");
    let (host, address, _shutdown) = serve_host(dir.clone()).await;
    let room = host
        .admin_create_room("doc-1", "{\"id\":\"doc-1\"}")
        .expect("room");
    let editor_token = host
        .admin_create_invite(&room.room_id, ParticipantRole::Editor, i64::MAX / 2)
        .expect("invite");

    let mut editor = connect(address, &room.room_id, &editor_token).await;
    wait_for_frame(&mut editor, "welcome").await;

    // A label over the 120-character bound: structurally well-formed JSON that
    // fails validation.
    let long_label = "x".repeat(140);
    let op = make_op("op-long-label", &long_label);
    editor
        .send(WsMessage::Text(op.into()))
        .await
        .expect("op sent");
    let rejected = wait_for_frame(&mut editor, "operation-rejected").await;
    assert_eq!(rejected["clientOpId"], "op-long-label");
    assert_eq!(rejected["reason"], "Frame out of bounds.");
    assert_eq!(rejected["fatal"], false);
}

/// Draft streaming must not consume the budget of the message the author
/// sends: a long draft burst is followed by a finalized frame that ARRIVES.
#[tokio::test]
async fn a_finalized_chat_message_survives_a_draft_burst() {
    let dir = temp_dir("chat-budget");
    let (host, address, _shutdown) = serve_host(dir.clone()).await;
    let room = host
        .admin_create_room("doc-1", "{\"id\":\"doc-1\"}")
        .expect("room");
    let author_token = host
        .admin_create_invite(&room.room_id, ParticipantRole::Editor, i64::MAX / 2)
        .expect("invite");

    let mut author = connect(address, &room.room_id, &author_token).await;
    wait_for_frame(&mut author, "welcome").await;
    let mut peer = connect(address, &room.room_id, &room.owner_invite_token).await;
    wait_for_frame(&mut peer, "welcome").await;

    // 40 draft frames back to back — far past the finalized-chat bucket.
    for index in 1..=40u32 {
        author
            .send(WsMessage::Text(
                json!({
                    "type": "chat",
                    "message": {
                        "messageId": "draft-1",
                        "actorId": "spoofed",
                        "text": format!("draft {index}"),
                        "composing": true,
                    },
                })
                .to_string()
                .into(),
            ))
            .await
            .expect("draft sent");
    }
    author
        .send(WsMessage::Text(
            json!({
                "type": "chat",
                "message": {
                    "messageId": "draft-1",
                    "actorId": "spoofed",
                    "text": "the message the author sent",
                    "composing": false,
                },
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("final sent");

    // The peer receives the finalized frame with its full text (drafts may be
    // coalesced or dropped: they are lossy by design).
    let mut saw_final = false;
    for _ in 0..200 {
        let next = tokio::time::timeout(Duration::from_secs(5), peer.next()).await;
        match next {
            Ok(Some(Ok(WsMessage::Text(text)))) => {
                let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                if parsed["type"] == "chat"
                    && parsed["message"]["composing"] == false
                    && parsed["message"]["text"] == "the message the author sent"
                {
                    saw_final = true;
                    break;
                }
            }
            Ok(Some(Ok(_))) => {}
            _ => break,
        }
    }
    assert!(
        saw_final,
        "the finalized message must reach the peer after a draft burst"
    );
}

/// An operation carrying an embedded image asset is larger than the inline
/// frame ceiling: the document's own inline-asset bound is 10 MB
/// (`documentCodec.ts` → MAX_INLINE_ASSET_BYTES), while an inline operation
/// frame is capped at 2 MB. Inserting a photo into a shared document is the
/// ordinary way to cross that line, so the host must reassemble a chunked
/// upload rather than close the connection and strand the editor in a
/// reconnect loop with the operation permanently pending.
#[tokio::test]
async fn a_large_asset_operation_is_reassembled_instead_of_killing_the_session() {
    let dir = temp_dir("large-op");
    let (host, address, _shutdown) = serve_host(dir.clone()).await;

    let room = host
        .admin_create_room("doc-1", "{\"id\":\"doc-1\"}")
        .expect("room");
    let editor_token = host
        .admin_create_invite(&room.room_id, ParticipantRole::Editor, i64::MAX / 2)
        .expect("invite");

    let mut owner = connect(address, &room.room_id, &room.owner_invite_token).await;
    wait_for_frame(&mut owner, "welcome").await;
    let mut editor = connect(address, &room.room_id, &editor_token).await;
    wait_for_frame(&mut editor, "welcome").await;

    let data_url = format!("data:image/png;base64,{}", "A".repeat(3_000_000));
    let frame = make_asset_op("op-large-1", &data_url);
    assert!(
        frame.len() > MAX_INLINE_FRAME_BYTES_TEST,
        "the fixture must exceed the inline frame ceiling (was {})",
        frame.len()
    );

    send_chunked_operation(&mut editor, "upload-1", &frame).await;

    let accepted = wait_for_frame(&mut editor, "operation-accepted").await;
    assert_eq!(accepted["clientOpId"], "op-large-1");
    let relayed = wait_for_frame(&mut owner, "operation").await;
    assert_eq!(relayed["op"]["clientOpId"], "op-large-1");
    assert_eq!(
        relayed["op"]["capture"]["changes"][0]["after"]["dataUrl"], data_url,
        "the reassembled capture must carry the asset bytes intact"
    );

    // The connection is still usable: a small follow-up operation works.
    editor
        .send(WsMessage::Text(make_op("op-small-1", "Small").into()))
        .await
        .expect("second op sent");
    let accepted = wait_for_frame(&mut editor, "operation-accepted").await;
    assert_eq!(accepted["clientOpId"], "op-small-1");
}

/// Negative control for the chunked path: the memory ceiling still holds.
/// An oversized frame that does NOT declare a multi-frame kind is closed on
/// rather than buffered, so "chunk it" cannot be used to bypass the bound.
#[tokio::test]
async fn an_oversized_inline_operation_frame_is_still_refused() {
    let dir = temp_dir("oversize-inline");
    let (host, address, _shutdown) = serve_host(dir.clone()).await;
    let room = host
        .admin_create_room("doc-1", "{\"id\":\"doc-1\"}")
        .expect("room");

    let mut editor = connect(address, &room.room_id, &room.owner_invite_token).await;
    wait_for_frame(&mut editor, "welcome").await;

    let frame = make_asset_op("op-inline-huge", &format!("data:image/png;base64,{}", "A".repeat(3_000_000)));
    assert!(frame.len() > MAX_INLINE_FRAME_BYTES_TEST);
    editor
        .send(WsMessage::Text(frame.into()))
        .await
        .expect("frame sent");

    // Closed, never buffered: the socket ends without any operation ack.
    let mut saw_ack = false;
    loop {
        // Bind the frame before matching: holding a temporary with a custom
        // destructor in a `while let` scrutinee changes drop order in 2024.
        let next = tokio::time::timeout(Duration::from_secs(5), editor.next()).await;
        let Ok(Some(Ok(frame))) = next else { break };
        if let WsMessage::Text(text) = frame {
            let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            if parsed["type"] == "operation-accepted" {
                saw_ack = true;
            }
        }
    }
    assert!(!saw_ack, "an oversized inline frame must never be accepted");
}

/// Interrupted and corrupt chunked uploads must never wedge a session: the
/// abandoned buffer is bounded and droppable, a rejected upload is reported
/// visibly, and the connection stays usable for ordinary operations.
#[tokio::test]
async fn a_corrupt_chunked_upload_is_rejected_and_the_session_survives() {
    let dir = temp_dir("chunk-corrupt");
    let (host, address, _shutdown) = serve_host(dir.clone()).await;
    let room = host
        .admin_create_room("doc-1", "{\"id\":\"doc-1\"}")
        .expect("room");
    let editor_token = host
        .admin_create_invite(&room.room_id, ParticipantRole::Editor, i64::MAX / 2)
        .expect("invite");

    let mut editor = connect(address, &room.room_id, &editor_token).await;
    wait_for_frame(&mut editor, "welcome").await;
    let mut peer = connect(address, &room.room_id, &room.owner_invite_token).await;
    wait_for_frame(&mut peer, "welcome").await;

    // An upload that is opened and never finished occupies the connection's
    // single upload slot. A second begin is refused with a visible reason
    // rather than silently replacing or interleaving the first.
    editor
        .send(WsMessage::Text(
            json!({
                "type": "operation-begin",
                "uploadId": "upload-abandoned",
                "totalBytes": 64,
                "chunkCount": 1,
                "digest": "0".repeat(64),
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("begin sent");
    editor
        .send(WsMessage::Text(
            json!({
                "type": "operation-begin",
                "uploadId": "upload-second",
                "totalBytes": 64,
                "chunkCount": 1,
                "digest": "0".repeat(64),
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("second begin sent");
    let refused = wait_for_frame(&mut editor, "operation-upload-rejected").await;
    assert_eq!(refused["reason"], "Another upload is already in progress.");

    // Ordinary operations are unaffected by the abandoned upload.
    editor
        .send(WsMessage::Text(make_op("op-after-abandon", "After abandon").into()))
        .await
        .expect("inline op sent");
    let accepted = wait_for_frame(&mut editor, "operation-accepted").await;
    assert_eq!(accepted["clientOpId"], "op-after-abandon");
    let relayed = wait_for_frame(&mut peer, "operation").await;
    assert_eq!(relayed["op"]["clientOpId"], "op-after-abandon");

    // A fresh connection (the reconnect case) uploads a frame whose declared
    // digest does not match: rejected, never journaled.
    let mut reconnected = connect(address, &room.room_id, &editor_token).await;
    wait_for_frame(&mut reconnected, "welcome").await;
    reconnected
        .send(WsMessage::Text(
            json!({
                "type": "operation-begin",
                "uploadId": "upload-bad-digest",
                "totalBytes": 3,
                "chunkCount": 1,
                "digest": "f".repeat(64),
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("begin sent");
    reconnected
        .send(WsMessage::Text(
            json!({ "type": "operation-chunk", "uploadId": "upload-bad-digest", "index": 0, "data": "abc" })
                .to_string()
                .into(),
        ))
        .await
        .expect("chunk sent");
    reconnected
        .send(WsMessage::Text(
            json!({ "type": "operation-end", "uploadId": "upload-bad-digest" })
                .to_string()
                .into(),
        ))
        .await
        .expect("end sent");
    let rejected = wait_for_frame(&mut reconnected, "operation-upload-rejected").await;
    assert_eq!(rejected["reason"], "Upload digest did not match.");

    // Still usable afterwards, and the rejected frame never reached the room.
    reconnected
        .send(WsMessage::Text(make_op("op-after-reject", "After reject").into()))
        .await
        .expect("op sent");
    let accepted = wait_for_frame(&mut reconnected, "operation-accepted").await;
    assert_eq!(accepted["clientOpId"], "op-after-reject");
    let relayed = wait_for_frame(&mut peer, "operation").await;
    assert_eq!(relayed["op"]["clientOpId"], "op-after-reject");
}

/// A socket that goes silent is reaped like a disconnect, so a crashed tab
/// cannot hold one of a room's ten participant slots; a client that speaks
/// (the liveness heartbeat) stays connected past the same window.
#[tokio::test]
async fn a_silent_socket_is_closed_and_the_room_is_told() {
    let dir = temp_dir("idle");
    let (host, address, _shutdown) = serve_host_with_idle(dir.clone(), 900).await;
    let room = host
        .admin_create_room("doc-1", "{\"id\":\"doc-1\"}")
        .expect("room");
    let editor_token = host
        .admin_create_invite(&room.room_id, ParticipantRole::Editor, i64::MAX / 2)
        .expect("invite");

    // Phase 1: a silent socket simply ends.
    let mut silent = connect(address, &room.room_id, &editor_token).await;
    wait_for_frame(&mut silent, "welcome").await;
    let closed = tokio::time::timeout(Duration::from_secs(6), silent.next()).await;
    assert!(
        matches!(
            closed,
            Ok(None) | Ok(Some(Ok(WsMessage::Close(_)))) | Ok(Some(Err(_)))
        ),
        "an idle socket must be closed by the host, got {closed:?}"
    );

    // Phase 2: the remaining participants are told, so the UI drops the
    // presence instead of showing a stalled participant forever.
    let mut observer = connect(address, &room.room_id, &room.owner_invite_token).await;
    wait_for_frame(&mut observer, "welcome").await;
    let mut silent2 = connect(address, &room.room_id, &editor_token).await;
    wait_for_frame(&mut silent2, "welcome").await;

    let mut saw_left = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
    while tokio::time::Instant::now() < deadline {
        let ping = WsMessage::Text(json!({ "type": "ping" }).to_string().into());
        observer.send(ping).await.expect("observer ping");
        let next = tokio::time::timeout(Duration::from_millis(200), observer.next()).await;
        match next {
            Ok(Some(Ok(WsMessage::Text(text)))) => {
                let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                if parsed["type"] == "participant-left" {
                    assert_eq!(parsed["reason"], "disconnect");
                    saw_left = true;
                    break;
                }
            }
            Ok(Some(Ok(_))) => {}
            other => panic!("observer stream ended early: {other:?}"),
        }
    }
    assert!(saw_left, "the room must be told when a silent socket is reaped");

    // Phase 3: a heartbeating participant survives the same idle window.
    let mut beating = connect(address, &room.room_id, &editor_token).await;
    wait_for_frame(&mut beating, "welcome").await;
    for _ in 0..3 {
        tokio::time::sleep(Duration::from_millis(300)).await;
        beating
            .send(WsMessage::Text(json!({ "type": "ping" }).to_string().into()))
            .await
            .expect("ping sent");
        let pong = wait_for_frame(&mut beating, "pong").await;
        assert_eq!(pong["type"], "pong");
    }
}

/// Every fail-closed branch of the reassembler guards a 64 MB buffer. An
/// out-of-order chunk is the one a real client can hit after a partial send.
#[tokio::test]
async fn each_chunked_upload_refusal_branch_is_fail_closed() {
    let dir = temp_dir("chunk-branches");
    let (host, address, _shutdown) = serve_host(dir.clone()).await;
    let room = host
        .admin_create_room("doc-1", "{\"id\":\"doc-1\"}")
        .expect("room");
    let op_frame = make_op("op-in-chunks", "Chunked");
    let digest = sha256_hex(op_frame.as_bytes());

    let begin = |upload_id: &str, total: usize, chunks: usize| {
        json!({
            "type": "operation-begin",
            "uploadId": upload_id,
            "totalBytes": total,
            "chunkCount": chunks,
            "digest": digest,
        })
        .to_string()
    };

    // Each case uses a fresh connection: a refusal discards the buffer, but a
    // new upload needs the slot to be free.
    let cases: Vec<(&str, Vec<String>, &str)> = vec![
        (
            "out-of-order index",
            vec![
                begin("u-order", op_frame.len(), 2),
                json!({ "type": "operation-chunk", "uploadId": "u-order", "index": 1, "data": "x" })
                    .to_string(),
                json!({ "type": "operation-end", "uploadId": "u-order" }).to_string(),
            ],
            "Chunks arrived out of order.",
        ),
        (
            "chunk overruns the declared total",
            vec![
                begin("u-overrun", 8, 1),
                json!({ "type": "operation-chunk", "uploadId": "u-overrun", "index": 0, "data": "0123456789" })
                    .to_string(),
                json!({ "type": "operation-end", "uploadId": "u-overrun" }).to_string(),
            ],
            "Upload exceeds its declared size.",
        ),
        (
            "chunk for an unknown upload",
            vec![
                json!({ "type": "operation-chunk", "uploadId": "u-unknown", "index": 0, "data": "x" })
                    .to_string(),
            ],
            "No upload is in progress.",
        ),
        (
            "end before every chunk arrived",
            vec![
                begin("u-early", op_frame.len(), 3),
                json!({ "type": "operation-chunk", "uploadId": "u-early", "index": 0, "data": "x" })
                    .to_string(),
                json!({ "type": "operation-end", "uploadId": "u-early" }).to_string(),
            ],
            "Upload ended before every chunk arrived.",
        ),
    ];

    for (label, frames, expected_reason) in cases {
        let mut client = connect(address, &room.room_id, &room.owner_invite_token).await;
        wait_for_frame(&mut client, "welcome").await;
        for frame in frames {
            client
                .send(WsMessage::Text(frame.into()))
                .await
                .expect("frame sent");
        }
        let rejected = wait_for_frame(&mut client, "operation-upload-rejected").await;
        assert_eq!(
            rejected["reason"], expected_reason,
            "case: {label} must be refused with its reason"
        );
        let _ = client.close(None).await;
    }

    // Nothing from those attempts entered the journal: an authenticated client
    // asking for a catch-up is told there is nothing after seq 0, so no refused
    // upload was stored.
    let mut probe = connect(address, &room.room_id, &room.owner_invite_token).await;
    wait_for_frame(&mut probe, "welcome").await;
    probe
        .send(WsMessage::Text(
            json!({ "type": "sync-request", "fromSeq": 0 })
                .to_string()
                .into(),
        ))
        .await
        .expect("sync request sent");
    let sync = wait_for_frame(&mut probe, "sync").await;
    assert_eq!(
        sync["operations"].as_array().map(Vec::len),
        Some(0),
        "a refused upload must never reach the journal"
    );
}

/// The app's webview and the browser build are not served by the room server,
/// so the admin API is a CROSS-ORIGIN call for them. Without CORS headers the
/// browser blocks it and the user sees only "Failed to fetch" — measured with
/// the app-hosted E2E, which could not create a room on a user-run server.
#[tokio::test]
async fn the_admin_api_answers_cross_origin_calls_from_allowed_origins_only() {
    let dir = temp_dir("cors");
    let (host, address, _shutdown) = serve_host(dir.clone()).await;
    let room = host
        .admin_create_room("doc-1", "{\"id\":\"doc-1\"}")
        .expect("room");

    // A loopback page (the desktop dev server, the browser demo) may preflight.
    let (status, headers) = http_request(
        address,
        "OPTIONS /admin/rooms HTTP/1.1",
        &[
            ("Origin", "http://localhost:1420"),
            ("Access-Control-Request-Method", "POST"),
            ("Access-Control-Request-Headers", "x-varve-admin-token, content-type"),
        ],
    )
    .await;
    assert_eq!(status, 204, "an allowed origin's preflight must succeed");
    assert_eq!(
        headers.get("access-control-allow-origin").map(String::as_str),
        Some("http://localhost:1420")
    );
    assert!(headers
        .get("access-control-allow-headers")
        .is_some_and(|value| value.contains("x-varve-admin-token")));

    // A remote page is refused, and is told nothing it could use.
    let (status, headers) = http_request(
        address,
        "OPTIONS /admin/rooms HTTP/1.1",
        &[("Origin", "https://evil.example")],
    )
    .await;
    assert_eq!(status, 403);
    assert!(!headers.contains_key("access-control-allow-origin"));

    // A configured --allow-origin is accepted, and the real request carries the
    // token (the CORS answer is never a wildcard, because it is a credential).
    let mut config = HostConfig::for_data_dir(temp_dir("cors-configured"));
    config.admin_token = Some("test-admin-token".to_string());
    config.allowed_origins = vec!["https://rooms.example.com".to_string()];
    let configured = RoomHost::open(config).expect("host opens");
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let address2 = varve_room::serve(
        configured,
        "127.0.0.1:0".parse().unwrap(),
        shutdown_rx,
    )
    .await
    .expect("binds");
    let (status, headers) = http_request(
        address2,
        "OPTIONS /admin/rooms HTTP/1.1",
        &[("Origin", "https://rooms.example.com")],
    )
    .await;
    assert_eq!(status, 204);
    assert_eq!(
        headers.get("access-control-allow-origin").map(String::as_str),
        Some("https://rooms.example.com")
    );
    assert_ne!(
        headers.get("access-control-allow-origin").map(String::as_str),
        Some("*"),
        "a credential-bearing API must never allow every origin"
    );
    let _ = shutdown_tx.send(true);
    let _ = room;
}

/// Minimal HTTP/1.1 request over loopback: status code plus response headers.
async fn http_request(
    address: SocketAddr,
    request_line: &str,
    headers: &[(&str, &str)],
) -> (u16, std::collections::HashMap<String, String>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut stream = tokio::net::TcpStream::connect(address)
        .await
        .expect("connect");
    let mut request = format!("{request_line}\r\nHost: {address}\r\nConnection: close\r\n");
    for (name, value) in headers {
        request.push_str(&format!("{name}: {value}\r\n"));
    }
    request.push_str("\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .expect("request written");
    let mut raw = Vec::new();
    let _ = stream.read_to_end(&mut raw).await;
    let text = String::from_utf8_lossy(&raw).to_string();
    let status = text
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(0);
    let mut collected = std::collections::HashMap::new();
    for line in text.lines().skip(1) {
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            collected.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    (status, collected)
}

/// One process per data directory, enforced rather than documented: two hosts
/// on one store can write divergent histories, and the store cannot tell which
/// one is right. The lock is also recoverable — a crashed holder stops
/// refreshing, and the next process takes the directory over instead of being
/// refused forever.
#[tokio::test]
async fn a_second_host_is_refused_until_the_first_releases_the_directory() {
    let dir = temp_dir("single-owner");
    std::fs::create_dir_all(&dir).expect("data dir");
    let first = varve_room::RoomStore::open(&dir.join("rooms.db")).expect("store");
    first
        .acquire_host_lock("owner-a", 11, "host-a", 1_000, 120_000)
        .expect("first acquire");

    // A live holder refuses a second owner.
    match first
        .acquire_host_lock("owner-b", 22, "host-b", 1_100, 120_000)
        .expect("second attempt")
    {
        varve_room::store::LockOutcome::Held { owner_pid, .. } => assert_eq!(owner_pid, 11),
        other => panic!("expected the lock to be held, got {other:?}"),
    }

    // The holder's own heartbeat keeps it.
    assert_eq!(
        first.refresh_host_lock("owner-a", 1_200).expect("refresh"),
        varve_room::store::LockHeartbeat::Refreshed
    );

    // A crashed holder stops refreshing: after the staleness window the
    // directory can be taken over.
    assert!(matches!(
        first
            .acquire_host_lock("owner-c", 33, "host-c", 200_000, 120_000)
            .expect("stale takeover"),
        varve_room::store::LockOutcome::Acquired
    ));

    // And a clean stop releases it immediately.
    first.release_host_lock("owner-c").expect("release");
    assert!(matches!(
        first
            .acquire_host_lock("owner-d", 44, "host-d", 200_100, 120_000)
            .expect("after release"),
        varve_room::store::LockOutcome::Acquired
    ));

    // Through the host API: a second host on a directory a live host serves is
    // refused with a message an operator can act on.
    let live_dir = temp_dir("single-owner-live");
    let (_host, _address, _shutdown) = serve_host(live_dir.clone()).await;
    let refused = RoomHost::open(HostConfig {
        admin_token: Some("t".to_string()),
        ..HostConfig::for_data_dir(live_dir.clone())
    });
    match refused {
        Err(RoomStoreError::HostLocked { hostname, .. }) => {
            assert!(!hostname.is_empty(), "the refusal names the holder");
        }
        Ok(_) => panic!("a second host must not open a directory another host owns"),
        Err(other) => panic!("unexpected error: {other}"),
    }
}

#[tokio::test]
async fn invalid_tokens_are_refused_before_any_room_data_flows() {
    let dir = temp_dir("badtoken");
    // The running host owns this data directory (single-owner rule), so it is
    // also the host that creates the room.
    let (host, address, _shutdown) = serve_host(dir.clone()).await;
    let room = host
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

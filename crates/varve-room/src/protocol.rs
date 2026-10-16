//! Wire protocol types for the Varve room host (protocol v1).
//!
//! Mirrors `packages/collab/src/protocol.ts` field-for-field in camelCase.
//! The conformance fixtures at
//! `packages/collab/src/__fixtures__/protocol-v1.json` are checked by both
//! implementations (`tests/protocol_conformance.rs` and the TS suite); when
//! the protocol changes, change the fixture and both sides together.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const COLLAB_PROTOCOL_VERSION: i64 = 1;

/// Frame size ceilings. The host closes connections that exceed them
/// before parsing (decompression bombs and memory exhaustion are rejected
/// at the socket boundary, not after).
pub const MAX_OPERATION_FRAME_BYTES: usize = 2_000_000;
pub const MAX_SNAPSHOT_UPLOAD_BYTES: usize = 64_000_000;
pub const MAX_CHAT_LENGTH: usize = 280;
pub const MAX_SELECTION_IDS: usize = 200;
pub const MAX_PARTICIPANTS: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ParticipantRole {
    Owner,
    Editor,
    Viewer,
}

/// A document mutation as it travels through the room. The capture payload
/// is validated structurally here (shape and size) and semantically by
/// every receiving client through its operation registry — the host cannot
/// replay design semantics and does not pretend to.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomOperation {
    pub client_op_id: String,
    pub based_on_seq: i64,
    pub actor_id: String,
    pub actor_name: String,
    pub transaction_id: String,
    pub label: String,
    pub kind: String,
    pub origin_author: String,
    pub reverts_client_op_id: Option<String>,
    pub capture: Value,
}

/// Untrusted client frame. Parsed leniently (serde with defaults denied via
/// explicit validation) and then validated by `validate` before use.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ClientMessage {
    Hello {
        protocol: i64,
        token: String,
        #[serde(rename = "clientId")]
        client_id: String,
        #[serde(rename = "displayName")]
        display_name: String,
    },
    Operation {
        op: RoomOperation,
    },
    Cursor {
        #[serde(rename = "pageId")]
        page_id: Option<String>,
        x: f64,
        y: f64,
    },
    Selection {
        #[serde(rename = "pageId")]
        page_id: Option<String>,
        #[serde(rename = "nodeIds")]
        node_ids: Vec<String>,
    },
    Viewport {
        #[serde(rename = "pageId")]
        page_id: Option<String>,
        #[serde(rename = "centerX")]
        center_x: f64,
        #[serde(rename = "centerY")]
        center_y: f64,
        zoom: f64,
        spotlighting: bool,
    },
    Chat {
        #[serde(rename = "message")]
        message: ChatMessageFrame,
    },
    #[serde(rename = "sync-request")]
    SyncRequest {
        #[serde(rename = "fromSeq")]
        from_seq: i64,
    },
    #[serde(rename = "snapshot-upload")]
    SnapshotUpload {
        #[serde(rename = "uptoSeq")]
        upto_seq: i64,
        #[serde(rename = "documentJson")]
        document_json: String,
    },
    Leave,
    Ping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageFrame {
    #[serde(rename = "messageId")]
    pub message_id: String,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticipantInfo {
    pub actor_id: String,
    pub display_name: String,
    pub color_index: i64,
    pub role: ParticipantRole,
    pub client_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSnapshot {
    pub upto_seq: i64,
    pub document_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub seq: i64,
    pub op: RoomOperation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ServerMessage {
    Welcome {
        protocol: i64,
        #[serde(rename = "roomSeq")]
        room_seq: i64,
        #[serde(rename = "actorId")]
        actor_id: String,
        role: ParticipantRole,
        participants: Vec<ParticipantInfo>,
        snapshot: RoomSnapshot,
        #[serde(rename = "sharedBaselineSeq")]
        shared_baseline_seq: i64,
    },
    #[serde(rename = "operation-accepted")]
    OperationAccepted {
        #[serde(rename = "clientOpId")]
        client_op_id: String,
        seq: i64,
    },
    #[serde(rename = "operation-rejected")]
    OperationRejected {
        #[serde(rename = "clientOpId")]
        client_op_id: String,
        reason: String,
        fatal: bool,
    },
    Operation {
        seq: i64,
        op: RoomOperation,
    },
    #[serde(rename = "participant-joined")]
    ParticipantJoined {
        participant: ParticipantInfo,
    },
    #[serde(rename = "participant-left")]
    ParticipantLeft {
        #[serde(rename = "actorId")]
        actor_id: String,
        reason: String,
    },
    #[serde(rename = "presence-cursor")]
    PresenceCursor {
        #[serde(rename = "actorId")]
        actor_id: String,
        cursor: CursorFrame,
    },
    #[serde(rename = "presence-selection")]
    PresenceSelection {
        #[serde(rename = "actorId")]
        actor_id: String,
        selection: SelectionFrame,
    },
    #[serde(rename = "presence-viewport")]
    PresenceViewport {
        #[serde(rename = "actorId")]
        actor_id: String,
        viewport: ViewportFrame,
    },
    Chat {
        message: ChatMessageFrame,
    },
    Sync {
        #[serde(rename = "fromSeq")]
        from_seq: i64,
        seq: i64,
        operations: Vec<JournalEntry>,
    },
    Snapshot {
        snapshot: RoomSnapshot,
    },
    #[serde(rename = "role-changed")]
    RoleChanged {
        #[serde(rename = "actorId")]
        actor_id: String,
        role: ParticipantRole,
    },
    #[serde(rename = "room-ended")]
    RoomEnded {
        reason: String,
    },
    Error {
        code: String,
        message: String,
        fatal: bool,
    },
    Pong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorFrame {
    pub page_id: Option<String>,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionFrame {
    pub page_id: Option<String>,
    pub node_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportFrame {
    pub page_id: Option<String>,
    pub center_x: f64,
    pub center_y: f64,
    pub zoom: f64,
    pub spotlighting: bool,
}

// ── Validation (host-side mirror of the TS guards) ───────────────────────────

fn bounded(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max
}

impl ClientMessage {
    /// Structural validation beyond serde shape: bounds on every untrusted
    /// string and numeric field, mirroring `parseClientMessage`.
    pub fn validate(&self) -> Result<(), &'static str> {
        match self {
            ClientMessage::Hello {
                protocol,
                token,
                client_id,
                display_name,
            } => {
                if *protocol != COLLAB_PROTOCOL_VERSION {
                    return Err("protocol version unsupported");
                }
                if !bounded(token, 256) || !bounded(client_id, 128) || display_name.len() > 60 {
                    return Err("hello fields out of bounds");
                }
            }
            ClientMessage::Operation { op } => {
                if !bounded(&op.client_op_id, 128)
                    || op.based_on_seq < 0
                    || !bounded(&op.actor_id, 128)
                    || op.actor_name.len() > 60
                    || !bounded(&op.transaction_id, 128)
                    || op.label.len() > 120
                    || op.kind.len() > 40
                    || (op.origin_author != "local-user" && op.origin_author != "system")
                {
                    return Err("operation fields out of bounds");
                }
                if !capture_payload_like(&op.capture) {
                    return Err("operation capture envelope invalid");
                }
            }
            ClientMessage::Cursor { x, y, .. } => {
                if !x.is_finite() || !y.is_finite() {
                    return Err("cursor coordinates must be finite");
                }
            }
            ClientMessage::Selection { node_ids, .. } => {
                if node_ids.len() > MAX_SELECTION_IDS {
                    return Err("selection too large");
                }
                if node_ids.iter().any(|id| id.len() > 128 || id.is_empty()) {
                    return Err("selection ids out of bounds");
                }
            }
            ClientMessage::Viewport { zoom, .. } => {
                if !zoom.is_finite() || *zoom <= 0.0 {
                    return Err("viewport zoom must be finite and positive");
                }
            }
            ClientMessage::Chat { message } => {
                if !bounded(&message.message_id, 128)
                    || !bounded(&message.actor_id, 128)
                    || message.text.len() > MAX_CHAT_LENGTH
                {
                    return Err("chat fields out of bounds");
                }
            }
            ClientMessage::SyncRequest { from_seq } => {
                if *from_seq < 0 {
                    return Err("fromSeq must be non-negative");
                }
            }
            ClientMessage::SnapshotUpload {
                upto_seq,
                document_json,
            } => {
                if *upto_seq < 0 || document_json.len() > MAX_SNAPSHOT_UPLOAD_BYTES {
                    return Err("snapshot upload out of bounds");
                }
            }
            ClientMessage::Leave | ClientMessage::Ping => {}
        }
        Ok(())
    }
}

/// A structurally valid capture payload has the envelope fields the
/// registry validation on clients will need. The host checks shape only.
pub fn capture_payload_like(capture: &Value) -> bool {
    let Some(object) = capture.as_object() else {
        return false;
    };
    let Some(changes) = object.get("changes").and_then(Value::as_array) else {
        return false;
    };
    if changes.len() > 20_000 {
        return false;
    }
    let tx_ok = object
        .get("transactionId")
        .and_then(Value::as_str)
        .is_some_and(|s| bounded(s, 128));
    let hash_ok = ["beforeHash", "afterHash"].iter().all(|key| {
        object
            .get(*key)
            .and_then(Value::as_str)
            .is_some_and(|s| s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()))
    });
    tx_ok && hash_ok && object.get("summary").is_some_and(Value::is_object)
}

/// Wire frame classification used to enforce per-kind size ceilings before
/// JSON parsing. Frames at or under the operation cap parse as normal; a
/// larger frame must identify itself as a snapshot upload or it is closed.
pub fn is_snapshot_upload_frame(raw: &[u8]) -> bool {
    // Our own serializer emits the tag first; accept that fast path and
    // fall back to a full parse for differently ordered producers.
    if raw.starts_with(b"{\"type\":\"snapshot-upload\"") {
        return true;
    }
    serde_json::from_slice::<Value>(raw)
        .ok()
        .and_then(|v| {
            v.get("type")
                .and_then(Value::as_str)
                .map(|t| t == "snapshot-upload")
        })
        .unwrap_or(false)
}

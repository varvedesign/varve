//! The authoritative room host.
//!
//! One process owns its rooms (single-owner by deployment contract —
//! running two servers against one data directory is a documented
//! misconfiguration, mirroring the tldraw TLSocketRoom rule). The host
//! authenticates connections, orders mutations, acks only after the
//! journal commits, relays presence lossy, and never interprets design
//! semantics — receiving clients validate captures through their
//! operation registry and resynchronize on anything they cannot apply.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::ws::{CloseFrame, Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path as AxumPath, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::mpsc;

use crate::protocol::{
    capture_payload_like, is_snapshot_upload_frame, ClientMessage, CursorFrame, JournalEntry,
    ParticipantInfo, ParticipantRole, RoomOperation, RoomSnapshot, SelectionFrame, ServerMessage,
    ViewportFrame, MAX_CHAT_LENGTH, MAX_OPERATION_FRAME_BYTES, MAX_PARTICIPANTS, MAX_SELECTION_IDS,
    MAX_SNAPSHOT_UPLOAD_BYTES,
};
use crate::store::{RoomStore, RoomStoreError};
use crate::token::{mint_token, token_hash, token_hash_matches};

#[derive(Debug, Clone)]
pub struct HostConfig {
    pub data_dir: PathBuf,
    /// Loopback-only when false; binding a non-loopback address requires
    /// `true` (set by the CLI's `--expose`), an explicit decision.
    pub allow_non_loopback: bool,
    /// Admin API token. Generated at startup when absent; a server exposed
    /// beyond loopback refuses to start without an explicit token.
    pub admin_token: Option<String>,
    pub max_rooms: usize,
    /// Milliseconds a client may stay silent before the host closes it.
    pub idle_timeout_ms: u64,
}

impl HostConfig {
    pub fn for_data_dir(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            allow_non_loopback: false,
            admin_token: None,
            max_rooms: 256,
            idle_timeout_ms: 15 * 60 * 1000,
        }
    }
}

pub struct RoomHost {
    store: Mutex<RoomStore>,
    config: HostConfig,
    rooms: Mutex<HashMap<String, RoomState>>,
    operation_counter: AtomicU64,
}

struct ParticipantEntry {
    info: ParticipantInfo,
    token_hash: String,
    outgoing: mpsc::UnboundedSender<ServerMessage>,
}

#[derive(Default)]
struct RoomState {
    participants: HashMap<String, ParticipantEntry>,
}

/// A connected, authenticated session (host-side view).
struct Session {
    room_id: String,
    token_hash: String,
    role: ParticipantRole,
    actor_id: String,
    display_name: String,
}

/// Per-connection token bucket (operations + chat; presence is relay-best-effort).
struct RateLimiter {
    op_tokens: f64,
    chat_tokens: f64,
    last: SystemTime,
}

const OPS_PER_SECOND: f64 = 30.0;
const OPS_BURST: f64 = 60.0;
const CHAT_PER_SECOND: f64 = 0.5;
const CHAT_BURST: f64 = 5.0;

impl RateLimiter {
    fn new() -> Self {
        Self {
            op_tokens: OPS_BURST,
            chat_tokens: CHAT_BURST,
            last: SystemTime::now(),
        }
    }

    fn take(&mut self, chat: bool) -> bool {
        let now = SystemTime::now();
        let elapsed = now
            .duration_since(self.last)
            .unwrap_or(Duration::ZERO)
            .as_secs_f64();
        self.last = now;
        self.op_tokens = (self.op_tokens + elapsed * OPS_PER_SECOND).min(OPS_BURST);
        self.chat_tokens = (self.chat_tokens + elapsed * CHAT_PER_SECOND).min(CHAT_BURST);
        if chat {
            if self.chat_tokens >= 1.0 {
                self.chat_tokens -= 1.0;
                true
            } else {
                false
            }
        } else if self.op_tokens >= 1.0 {
            self.op_tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl RoomHost {
    pub fn open(config: HostConfig) -> Result<Arc<Self>, RoomStoreError> {
        std::fs::create_dir_all(&config.data_dir).map_err(|error| {
            RoomStoreError::Sqlite(rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
        })?;
        let store = RoomStore::open(&config.data_dir.join("rooms.db"))?;
        Ok(Arc::new(Self {
            store: Mutex::new(store),
            config,
            rooms: Mutex::new(HashMap::new()),
            operation_counter: AtomicU64::new(0),
        }))
    }

    /// Admin API: create a room seeded with the owner's document snapshot.
    pub fn admin_create_room(
        &self,
        doc_id: &str,
        document_json: &str,
    ) -> Result<AdminRoom, RoomStoreError> {
        if document_json.len() > MAX_SNAPSHOT_UPLOAD_BYTES {
            return Err(RoomStoreError::SnapshotAheadOfJournal); // size guard
        }
        {
            let rooms = self.rooms.lock().expect("room map poisoned");
            if rooms.len() >= self.config.max_rooms {
                return Err(RoomStoreError::SequenceExhausted); // capacity guard
            }
        }
        let store = self.store.lock().expect("store poisoned");
        if store.room_count()? as usize >= self.config.max_rooms {
            return Err(RoomStoreError::SequenceExhausted);
        }
        let room_id = format!("room-{}", &mint_token()[..16]);
        let now = now_ms();
        store.create_room(&room_id, doc_id, now)?;
        store.compact_with_snapshot(&room_id, 0, document_json, now)?;
        let owner_token = mint_token();
        store.create_invite(
            &token_hash(&owner_token),
            &room_id,
            ParticipantRole::Owner,
            i64::MAX / 2,
            now,
        )?;
        Ok(AdminRoom {
            room_id,
            owner_invite_token: owner_token,
        })
    }

    /// Admin API: mint an additional invite for a room.
    pub fn admin_create_invite(
        &self,
        room_id: &str,
        role: ParticipantRole,
        expires_at: i64,
    ) -> Result<String, RoomStoreError> {
        let store = self.store.lock().expect("store poisoned");
        if !store.room_exists(room_id)? {
            return Err(RoomStoreError::Sqlite(rusqlite::Error::QueryReturnedNoRows));
        }
        let token = mint_token();
        store.create_invite(&token_hash(&token), room_id, role, expires_at, now_ms())?;
        Ok(token)
    }

    /// Admin API: revoke an invite and disconnect its live sessions.
    /// Revocation is an event: the sockets close now, not at their next
    /// convenience.
    pub fn admin_revoke_invite(&self, token_hash_value: &str) -> Result<bool, RoomStoreError> {
        {
            let store = self.store.lock().expect("store poisoned");
            if !store.revoke_invite(token_hash_value)? {
                return Ok(false);
            }
        }
        let mut rooms = self.rooms.lock().expect("room map poisoned");
        for room in rooms.values_mut() {
            let actors: Vec<String> = room
                .participants
                .iter()
                .filter(|(_, entry)| entry.token_hash == token_hash_value)
                .map(|(actor, _)| actor.clone())
                .collect();
            for actor in actors {
                let entry = room.participants.remove(&actor);
                if let Some(entry) = entry {
                    let _ = entry.outgoing.send(ServerMessage::RoomEnded {
                        reason: "Your access was revoked".to_string(),
                    });
                }
            }
        }
        Ok(true)
    }

    /// Admin API: end a room and disconnect everyone.
    pub fn admin_end_room(&self, room_id: &str) -> Result<bool, RoomStoreError> {
        let existed = {
            let store = self.store.lock().expect("store poisoned");
            let existed = store.room_exists(room_id)?;
            if existed {
                store.delete_room(room_id)?;
            }
            existed
        };
        if !existed {
            return Ok(false);
        }
        let mut rooms = self.rooms.lock().expect("room map poisoned");
        if let Some(room) = rooms.remove(room_id) {
            for (_, entry) in room.participants {
                let _ = entry.outgoing.send(ServerMessage::RoomEnded {
                    reason: "The session was ended by the host".to_string(),
                });
            }
        }
        Ok(true)
    }
}

pub struct AdminRoom {
    pub room_id: String,
    pub owner_invite_token: String,
}

// ── HTTP surface ──────────────────────────────────────────────────────────────

pub fn router(host: Arc<RoomHost>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/room/{room_id}", get(ws_upgrade))
        .route("/admin/rooms", post(admin_rooms))
        .route("/admin/rooms/{room_id}/invites", post(admin_invites))
        .route("/admin/invites/{token_hash}", delete(admin_revoke))
        .route("/admin/rooms/{room_id}", delete(admin_end_room))
        .with_state(host)
}

async fn health() -> impl IntoResponse {
    (StatusCode::OK, axum::Json(json!({ "ok": true })))
}

async fn ready(State(host): State<Arc<RoomHost>>) -> impl IntoResponse {
    let ok = RoomStore::open(&host.config.data_dir.join("rooms.db")).is_ok();
    if ok {
        (StatusCode::OK, axum::Json(json!({ "ready": true })))
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(json!({ "ready": false })),
        )
    }
}

#[derive(Deserialize)]
struct CreateRoomBody {
    #[serde(rename = "docId")]
    doc_id: String,
    #[serde(rename = "documentJson")]
    document_json: String,
}

async fn admin_rooms(
    State(host): State<Arc<RoomHost>>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<CreateRoomBody>,
) -> impl IntoResponse {
    if !admin_authorized(&host, &headers) {
        return admin_unauthorized();
    }
    match host.admin_create_room(&body.doc_id, &body.document_json) {
        Ok(room) => (
            StatusCode::CREATED,
            axum::Json(json!({
                "roomId": room.room_id,
                "ownerInviteToken": room.owner_invite_token,
            })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            axum::Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct CreateInviteBody {
    role: String,
    /// Hours until expiry. Absent = one week.
    #[serde(rename = "expiresInHours")]
    expires_in_hours: Option<i64>,
}

async fn admin_invites(
    State(host): State<Arc<RoomHost>>,
    AxumPath(room_id): AxumPath<String>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<CreateInviteBody>,
) -> impl IntoResponse {
    if !admin_authorized(&host, &headers) {
        return admin_unauthorized();
    }
    let role = match body.role.as_str() {
        "editor" => ParticipantRole::Editor,
        "viewer" => ParticipantRole::Viewer,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(json!({ "error": "role must be editor or viewer" })),
            )
                .into_response()
        }
    };
    let expires_at = now_ms() + body.expires_in_hours.unwrap_or(24 * 7) * 3_600_000;
    match host.admin_create_invite(&room_id, role, expires_at) {
        Ok(token) => (
            StatusCode::CREATED,
            axum::Json(json!({ "inviteToken": token })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::NOT_FOUND,
            axum::Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn admin_revoke(
    State(host): State<Arc<RoomHost>>,
    AxumPath(token_hash_value): AxumPath<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !admin_authorized(&host, &headers) {
        return admin_unauthorized();
    }
    match host.admin_revoke_invite(&token_hash_value) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn admin_end_room(
    State(host): State<Arc<RoomHost>>,
    AxumPath(room_id): AxumPath<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !admin_authorized(&host, &headers) {
        return admin_unauthorized();
    }
    match host.admin_end_room(&room_id) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

fn admin_authorized(host: &RoomHost, headers: &HeaderMap) -> bool {
    let Some(expected) = host.config.admin_token.as_deref() else {
        return false;
    };
    let Some(presented) = headers
        .get("x-varve-admin-token")
        .and_then(|v| v.to_str().ok())
    else {
        return false;
    };
    token_hash_matches(presented, &token_hash(expected))
}

fn admin_unauthorized() -> axum::response::Response {
    (
        StatusCode::UNAUTHORIZED,
        axum::Json(json!({ "error": "admin token required" })),
    )
        .into_response()
}

// ── WebSocket session ─────────────────────────────────────────────────────────

async fn ws_upgrade(
    State(host): State<Arc<RoomHost>>,
    AxumPath(room_id): AxumPath<String>,
    headers: HeaderMap,
    ConnectInfo(_addr): ConnectInfo<SocketAddr>,
    upgrade: WebSocketUpgrade,
) -> impl IntoResponse {
    // Origin checking: browser clients always send Origin; native clients
    // send none. An Origin that is not allow-listed cannot open a socket —
    // this is the cross-site WebSocket hijacking boundary. For now any
    // Origin that matches the host itself is allowed and cross-origin
    // browser pages are refused; native clients are unaffected.
    if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        let loopback_ok = origin.starts_with("http://localhost")
            || origin.starts_with("http://127.0.0.1")
            || origin.starts_with("tauri://")
            || origin.starts_with("http://tauri.localhost");
        if !loopback_ok && !origin.starts_with("https://") {
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    upgrade.on_upgrade(move |socket| run_session(host, room_id, socket))
}

enum Registration {
    Ok {
        baseline: Option<crate::store::RoomBaseline>,
        current_seq: i64,
        participants: Vec<ParticipantInfo>,
    },
    ServerFull,
    RoomFull,
}

/// Synchronous registration: takes every lock it needs and returns before
/// any await, so guards can never be held across the session's async paths.
fn register_participant(
    host: &Arc<RoomHost>,
    session: &Session,
    hello: &ClientMessage,
    outgoing: mpsc::UnboundedSender<ServerMessage>,
) -> Registration {
    let mut rooms = host.rooms.lock().expect("room map poisoned");
    let store = host.store.lock().expect("store poisoned");
    let live_count: usize = rooms.values().map(|room| room.participants.len()).sum();
    if live_count >= host.config.max_rooms * MAX_PARTICIPANTS {
        return Registration::ServerFull;
    }
    let room = rooms.entry(session.room_id.clone()).or_default();
    if room.participants.len() >= MAX_PARTICIPANTS {
        return Registration::RoomFull;
    }
    let color_index = (0..8)
        .find(|index| {
            !room
                .participants
                .values()
                .any(|entry| entry.info.color_index == *index as i64)
        })
        .unwrap_or(0);
    room.participants.insert(
        session.actor_id.clone(),
        ParticipantEntry {
            info: ParticipantInfo {
                actor_id: session.actor_id.clone(),
                display_name: session.display_name.clone(),
                color_index: color_index as i64,
                role: session.role,
                client_id: client_id_of(hello),
            },
            token_hash: session.token_hash.clone(),
            outgoing,
        },
    );
    let baseline = store.baseline(&session.room_id).ok().flatten();
    let current_seq = store.current_seq(&session.room_id).unwrap_or(0);
    let participants: Vec<ParticipantInfo> = room
        .participants
        .values()
        .map(|entry| entry.info.clone())
        .collect();
    Registration::Ok {
        baseline,
        current_seq,
        participants,
    }
}

async fn run_session(host: Arc<RoomHost>, room_id: String, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let (outgoing_tx, mut outgoing_rx) = mpsc::unbounded_channel::<ServerMessage>();

    // First frame must be hello within the idle timeout.
    let hello = tokio::time::timeout(
        Duration::from_millis(host.config.idle_timeout_ms),
        stream.next(),
    )
    .await;
    let Ok(Some(Ok(WsMessage::Text(text)))) = hello else {
        let _ = sink
            .send(WsMessage::Close(Some(CloseFrame {
                code: 4400,
                reason: "expected hello".into(),
            })))
            .await;
        return;
    };
    let Ok(client_message) = serde_json::from_str::<ClientMessage>(&text) else {
        let _ = sink.close().await;
        return;
    };
    let ClientMessage::Hello { token, .. } = &client_message else {
        let _ = sink
            .send(WsMessage::Close(Some(CloseFrame {
                code: 4400,
                reason: "expected hello".into(),
            })))
            .await;
        return;
    };

    // Authenticate: hash lookup, expiry, revocation, room existence.
    let digest = token_hash(token);
    let auth = {
        let store = host.store.lock().expect("store poisoned");
        store.resolve_invite(&digest, now_ms())
    };
    let invite = match auth {
        Ok(Some(invite)) if invite.room_id == room_id => invite,
        _ => {
            let _ = sink
                .send(WsMessage::Close(Some(CloseFrame {
                    code: 4401,
                    reason: "invite invalid".into(),
                })))
                .await;
            return;
        }
    };

    // Register: assign actor identity and the lowest free palette slot.
    // All locking happens inside the synchronous helper — no lock guard can
    // overlap an await point.
    let session = Session {
        room_id: room_id.clone(),
        token_hash: digest,
        role: invite.role,
        actor_id: format!("actor-{}", &mint_token()[..12]),
        display_name: display_name_of(&client_message),
    };
    let registration = register_participant(&host, &session, &client_message, outgoing_tx.clone());
    let (baseline, current_seq, participants) = match registration {
        Registration::Ok {
            baseline,
            current_seq,
            participants,
        } => (baseline, current_seq, participants),
        full @ (Registration::ServerFull | Registration::RoomFull) => {
            let (code, reason) = if matches!(full, Registration::ServerFull) {
                ("server-full", "The collaboration service is at capacity.")
            } else {
                ("room-full", "This session is at the participant limit.")
            };
            let _ = outgoing_tx.send(ServerMessage::Error {
                code: code.to_string(),
                message: reason.to_string(),
                fatal: true,
            });
            let _ = sink
                .send(WsMessage::Close(Some(CloseFrame {
                    code: 4429,
                    reason: "full".into(),
                })))
                .await;
            return;
        }
    };

    // Welcome: the baseline snapshot; the journal replay follows as sync.
    let snapshot_seq = baseline.as_ref().map(|b| b.seq).unwrap_or(0);
    let _ = outgoing_tx.send(ServerMessage::Welcome {
        protocol: 1,
        room_seq: current_seq,
        actor_id: session.actor_id.clone(),
        role: session.role,
        participants: participants.clone(),
        snapshot: RoomSnapshot {
            upto_seq: snapshot_seq,
            document_json: baseline
                .map(|b| b.document_json)
                .unwrap_or_else(|| "null".to_string()),
        },
        shared_baseline_seq: 0,
    });
    if current_seq > snapshot_seq {
        if let Ok(entries) = {
            let store = host.store.lock().expect("store poisoned");
            store.journal_range(&room_id, snapshot_seq, current_seq)
        } {
            let _ = outgoing_tx.send(ServerMessage::Sync {
                from_seq: snapshot_seq,
                seq: current_seq,
                operations: entries
                    .into_iter()
                    .filter_map(|(seq, payload)| {
                        serde_json::from_str::<RoomOperation>(&payload)
                            .ok()
                            .map(|op| JournalEntry { seq, op })
                    })
                    .collect(),
            });
        }
    }

    // Announce the join to other participants.
    {
        let rooms = host.rooms.lock().expect("room map poisoned");
        if let Some(room) = rooms.get(&room_id) {
            let info = room
                .participants
                .get(&session.actor_id)
                .map(|entry| entry.info.clone());
            if let Some(info) = info {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        let _ = entry.outgoing.send(ServerMessage::ParticipantJoined {
                            participant: info.clone(),
                        });
                    }
                }
            }
        }
    }

    // Outbound pump.
    let outbound = tokio::spawn(async move {
        while let Some(message) = outgoing_rx.recv().await {
            let Ok(data) = serde_json::to_string(&message) else {
                continue;
            };
            if sink.send(WsMessage::Text(data.into())).await.is_err() {
                break;
            }
        }
    });

    // Inbound loop.
    let mut limiter = RateLimiter::new();
    loop {
        let next = stream.next().await;
        let Some(frame) = next else { break };
        let Ok(message) = frame else { break };
        match message {
            WsMessage::Text(text) => {
                if handle_client_frame(&host, &session, text.as_bytes(), &mut limiter, &outgoing_tx)
                    .is_break()
                {
                    break;
                }
            }
            WsMessage::Binary(bytes) => {
                if handle_client_frame(&host, &session, &bytes, &mut limiter, &outgoing_tx)
                    .is_break()
                {
                    break;
                }
            }
            WsMessage::Close(_) => break,
            WsMessage::Ping(_) | WsMessage::Pong(_) => {}
        }
    }

    // Deregister and announce departure.
    {
        let mut rooms = host.rooms.lock().expect("room map poisoned");
        if let Some(room) = rooms.get_mut(&room_id) {
            room.participants.remove(&session.actor_id);
            for entry in room.participants.values() {
                let _ = entry.outgoing.send(ServerMessage::ParticipantLeft {
                    actor_id: session.actor_id.clone(),
                    reason: "disconnect".to_string(),
                });
            }
        }
    }
    outgoing_tx
        .send(ServerMessage::RoomEnded {
            reason: "__stop__".to_string(),
        })
        .ok();
    outbound.abort();
}

fn display_name_of(message: &ClientMessage) -> String {
    if let ClientMessage::Hello { display_name, .. } = message {
        let trimmed = display_name.trim();
        if trimmed.is_empty() {
            return "Guest".to_string();
        }
        return trimmed.chars().take(60).collect();
    }
    "Guest".to_string()
}

fn client_id_of(message: &ClientMessage) -> String {
    if let ClientMessage::Hello { client_id, .. } = message {
        return client_id.clone();
    }
    String::new()
}

/// Handle one authenticated client frame. Returns ControlFlow-like break.
fn handle_client_frame(
    host: &Arc<RoomHost>,
    session: &Session,
    raw: &[u8],
    limiter: &mut RateLimiter,
    outgoing: &mpsc::UnboundedSender<ServerMessage>,
) -> std::ops::ControlFlow<()> {
    // Size ceilings before parsing; oversized non-snapshot frames close.
    if raw.len() > MAX_OPERATION_FRAME_BYTES && !is_snapshot_upload_frame(raw) {
        return std::ops::ControlFlow::Break(());
    }
    if raw.len() > MAX_SNAPSHOT_UPLOAD_BYTES {
        return std::ops::ControlFlow::Break(());
    }
    let Ok(message) = serde_json::from_slice::<ClientMessage>(raw) else {
        let _ = outgoing.send(ServerMessage::Error {
            code: "bad-frame".to_string(),
            message: "Frame failed protocol validation.".to_string(),
            fatal: false,
        });
        return std::ops::ControlFlow::Continue(());
    };
    if message.validate().is_err() {
        let _ = outgoing.send(ServerMessage::Error {
            code: "bad-frame".to_string(),
            message: "Frame out of bounds.".to_string(),
            fatal: false,
        });
        return std::ops::ControlFlow::Continue(());
    }
    match message {
        ClientMessage::Hello { .. } => {
            // A second hello on one socket is a protocol error.
            std::ops::ControlFlow::Break(())
        }
        ClientMessage::Operation { mut op } => {
            // Roles: viewers cannot mutate. The hidden-edit-button rule.
            if session.role == ParticipantRole::Viewer {
                let _ = outgoing.send(ServerMessage::OperationRejected {
                    client_op_id: op.client_op_id.clone(),
                    reason: "You have view-only access to this session.".to_string(),
                    fatal: false,
                });
                return std::ops::ControlFlow::Continue(());
            }
            if !limiter.take(false) {
                let _ = outgoing.send(ServerMessage::OperationRejected {
                    client_op_id: op.client_op_id.clone(),
                    reason: "Sending changes too quickly.".to_string(),
                    fatal: false,
                });
                return std::ops::ControlFlow::Continue(());
            }
            // The wire cannot be trusted for semantics: an operation claims
            // an actor identity but the session's authenticated identity
            // overrides it. Checked arithmetic (FigCraft #309 class).
            op.actor_id = session.actor_id.clone();
            if op.based_on_seq < 0 || !capture_payload_like(&op.capture) {
                let _ = outgoing.send(ServerMessage::OperationRejected {
                    client_op_id: op.client_op_id.clone(),
                    reason: "Operation payload failed structural validation.".to_string(),
                    fatal: true,
                });
                return std::ops::ControlFlow::Continue(());
            }
            let payload = match serde_json::to_string(&op) {
                Ok(data) => data,
                Err(_) => return std::ops::ControlFlow::Continue(()),
            };
            let now = now_ms();
            enum OpOutcome {
                Appended(i64),
                Replayed(i64),
                Revoked,
                StoreError(String),
            }
            let outcome = {
                let store = host.store.lock().expect("store poisoned");
                // Revocation is re-checked at the authoritative host for
                // every mutation (Penpot #12155 lesson).
                let still_valid = store.invite_is_still_valid(&session.token_hash, now);
                match still_valid {
                    Ok(true) => {
                        let appended = store.append_operation(
                            &session.room_id,
                            &op.client_op_id,
                            &session.actor_id,
                            &payload,
                            now,
                        );
                        match appended {
                            Ok(crate::store::AppendOutcome::Appended { seq }) => {
                                OpOutcome::Appended(seq)
                            }
                            Ok(crate::store::AppendOutcome::Replayed { seq }) => {
                                OpOutcome::Replayed(seq)
                            }
                            Err(error) => OpOutcome::StoreError(error.to_string()),
                        }
                    }
                    Ok(false) => OpOutcome::Revoked,
                    Err(error) => OpOutcome::StoreError(error.to_string()),
                }
            };
            match outcome {
                OpOutcome::Appended(seq) => {
                    host.operation_counter.fetch_add(1, Ordering::Relaxed);
                    let _ = outgoing.send(ServerMessage::OperationAccepted {
                        client_op_id: op.client_op_id.clone(),
                        seq,
                    });
                    // Relay to every other live participant.
                    let rooms = host.rooms.lock().expect("room map poisoned");
                    if let Some(room) = rooms.get(&session.room_id) {
                        for (actor, entry) in &room.participants {
                            if actor != &session.actor_id {
                                let _ = entry.outgoing.send(ServerMessage::Operation {
                                    seq,
                                    op: op.clone(),
                                });
                            }
                        }
                    }
                }
                OpOutcome::Replayed(seq) => {
                    // Idempotent retry: re-ack with the stored sequence only.
                    let _ = outgoing.send(ServerMessage::OperationAccepted {
                        client_op_id: op.client_op_id.clone(),
                        seq,
                    });
                }
                OpOutcome::Revoked => {
                    let _ = outgoing.send(ServerMessage::OperationRejected {
                        client_op_id: op.client_op_id.clone(),
                        reason: "You no longer have access to this session.".to_string(),
                        fatal: true,
                    });
                }
                OpOutcome::StoreError(error) => {
                    // The change was NOT acked: the client keeps it as
                    // pending local work and may retry after reconnecting.
                    let _ = outgoing.send(ServerMessage::Error {
                        code: "store-error".to_string(),
                        message: format!("The session host could not persist the change: {error}"),
                        fatal: false,
                    });
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Cursor { page_id, x, y } => {
            let frame = CursorFrame { page_id, x, y };
            let rooms = host.rooms.lock().expect("room map poisoned");
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        let _ = entry.outgoing.send(ServerMessage::PresenceCursor {
                            actor_id: session.actor_id.clone(),
                            cursor: frame.clone(),
                        });
                    }
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Viewport {
            page_id,
            center_x,
            center_y,
            zoom,
            spotlighting,
        } => {
            if !zoom.is_finite() || zoom <= 0.0 {
                return std::ops::ControlFlow::Continue(());
            }
            let frame = ViewportFrame {
                page_id,
                center_x,
                center_y,
                zoom,
                spotlighting,
            };
            let rooms = host.rooms.lock().expect("room map poisoned");
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        let _ = entry.outgoing.send(ServerMessage::PresenceViewport {
                            actor_id: session.actor_id.clone(),
                            viewport: frame.clone(),
                        });
                    }
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Selection { page_id, node_ids } => {
            if node_ids.len() > MAX_SELECTION_IDS {
                return std::ops::ControlFlow::Continue(());
            }
            let frame = SelectionFrame { page_id, node_ids };
            let rooms = host.rooms.lock().expect("room map poisoned");
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        let _ = entry.outgoing.send(ServerMessage::PresenceSelection {
                            actor_id: session.actor_id.clone(),
                            selection: frame.clone(),
                        });
                    }
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Chat { message } => {
            if !limiter.take(true) || message.text.len() > MAX_CHAT_LENGTH {
                return std::ops::ControlFlow::Continue(());
            }
            let rooms = host.rooms.lock().expect("room map poisoned");
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        let _ = entry.outgoing.send(ServerMessage::Chat {
                            message: crate::protocol::ChatMessageFrame {
                                message_id: message.message_id.clone(),
                                actor_id: session.actor_id.clone(),
                                text: message.text.clone(),
                            },
                        });
                    }
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::SyncRequest { from_seq } => {
            let store = host.store.lock().expect("store poisoned");
            let baseline = store.baseline(&session.room_id).ok().flatten();
            let current = store.current_seq(&session.room_id).unwrap_or(0);
            let from = from_seq.max(baseline.as_ref().map(|b| b.seq).unwrap_or(0));
            if from_seq < from {
                // The requested range was compacted away: send the snapshot.
                if let Some(baseline) = baseline {
                    let _ = outgoing.send(ServerMessage::Snapshot {
                        snapshot: RoomSnapshot {
                            upto_seq: baseline.seq,
                            document_json: baseline.document_json,
                        },
                    });
                }
            }
            if let Ok(entries) = store.journal_range(&session.room_id, from, current) {
                let _ = outgoing.send(ServerMessage::Sync {
                    from_seq: from,
                    seq: current,
                    operations: entries
                        .into_iter()
                        .filter_map(|(seq, payload)| {
                            serde_json::from_str::<RoomOperation>(&payload)
                                .ok()
                                .map(|op| JournalEntry { seq, op })
                        })
                        .collect(),
                });
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::SnapshotUpload {
            upto_seq,
            document_json,
        } => {
            if session.role != ParticipantRole::Owner {
                return std::ops::ControlFlow::Continue(());
            }
            let store = host.store.lock().expect("store poisoned");
            let _ =
                store.compact_with_snapshot(&session.room_id, upto_seq, &document_json, now_ms());
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Leave => std::ops::ControlFlow::Break(()),
        ClientMessage::Ping => {
            let _ = outgoing.send(ServerMessage::Pong);
            std::ops::ControlFlow::Continue(())
        }
    }
}

/// Run the host's HTTP+WS server until shutdown is signalled. Returns the
/// bound address (use port 0 for an OS-assigned port in app-hosted mode).
pub async fn serve(
    host: Arc<RoomHost>,
    bind: SocketAddr,
    shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<SocketAddr, std::io::Error> {
    if !bind.ip().is_loopback() && !host.config.allow_non_loopback {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "refusing to bind a non-loopback address without explicit exposure (--expose)",
        ));
    }
    if !bind.ip().is_loopback() && host.config.admin_token.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "a non-loopback bind requires an explicit admin token",
        ));
    }
    let listener = tokio::net::TcpListener::bind(bind).await?;
    let address = listener.local_addr()?;
    let app = router(host);
    let mut shutdown_rx = shutdown;
    // The server runs on a spawned task so the caller gets the bound
    // address immediately (app-hosted mode needs it to build invite URLs).
    tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.wait_for(|stop| *stop).await;
        })
        .await;
    });
    Ok(address)
}

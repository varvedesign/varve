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
use axum::extract::{ConnectInfo, Path as AxumPath, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::{mpsc, watch};

use crate::protocol::{
    capture_payload_like, is_large_capable_frame, ClientMessage, CursorFrame, JournalEntry,
    ParticipantInfo, ParticipantRole, RoomOperation, RoomSnapshot, SelectionFrame, ServerMessage,
    ViewportFrame, MAX_CHAT_LENGTH, MAX_CHUNKED_OPERATION_BYTES, MAX_OPERATION_FRAME_BYTES,
    MAX_PARTICIPANTS, MAX_SELECTION_IDS, MAX_SNAPSHOT_UPLOAD_BYTES,
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
    /// Browser origins allowed to open a WebSocket beyond the always-allowed
    /// local set (loopback `http://` pages and the Tauri webview). The
    /// deployment's own page origin goes here when a server is exposed behind
    /// a reverse proxy. Exact match, case-insensitive.
    pub allowed_origins: Vec<String>,
    /// Extra Host header values accepted on the upgrade. A loopback bind
    /// additionally requires a loopback Host (DNS-rebinding defence); this
    /// list is the escape hatch for a same-host reverse proxy whose public
    /// name differs from the bind address.
    pub allowed_hosts: Vec<String>,
}

impl HostConfig {
    pub fn for_data_dir(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            allow_non_loopback: false,
            admin_token: None,
            max_rooms: 256,
            idle_timeout_ms: 15 * 60 * 1000,
            allowed_origins: Vec::new(),
            allowed_hosts: Vec::new(),
        }
    }
}

pub struct RoomHost {
    store: Mutex<RoomStore>,
    config: HostConfig,
    rooms: Mutex<HashMap<String, RoomState>>,
    operation_counter: AtomicU64,
    /// Identity of this process in the data directory's host lock.
    owner_id: String,
}

impl Drop for RoomHost {
    fn drop(&mut self) {
        // Release the directory's single-owner lock so the next process starts
        // without waiting for the staleness window. Never panics: a poisoned
        // lock at drop time must not abort the process.
        if let Ok(store) = self.store.lock() {
            let _ = store.release_host_lock(&self.owner_id);
        }
    }
}

/// How long a host may go without refreshing its lock before another process
/// treats it as abandoned. Three heartbeats of slack.
const HOST_LOCK_STALE_MS: i64 = 120_000;
/// Heartbeat interval for the host lock.
const HOST_LOCK_REFRESH_MS: u64 = 30_000;

struct ParticipantEntry {
    info: ParticipantInfo,
    token_hash: String,
    outgoing: mpsc::Sender<ServerMessage>,
    /// Host-initiated end of this connection (revocation, backpressure).
    /// Carries the reason the peer is told.
    terminate: watch::Sender<Option<String>>,
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

/// Cached answer to "is this session's invite still valid?".
///
/// Revocation must be re-checked at the host, but a presence stream is high
/// frequency: the store is asked at most once per VALIDITY_TTL, which bounds
/// how long a revoked session can keep talking to a few seconds. Mutations
/// (`handle_operation`) and snapshot uploads always check immediately.
struct ValidityCache {
    checked_at: Option<SystemTime>,
    valid: bool,
}

impl ValidityCache {
    fn new() -> Self {
        Self {
            checked_at: None,
            valid: true,
        }
    }

    /// Returns false the moment the invite is known to be revoked or expired.
    fn valid(&mut self, host: &Arc<RoomHost>, session: &Session) -> bool {
        let fresh = self
            .checked_at
            .is_some_and(|at| at.elapsed().unwrap_or(Duration::MAX) < VALIDITY_TTL);
        if fresh {
            return self.valid;
        }
        let store = lock(&host.store);
        let still_valid = store
            .invite_is_still_valid(&session.token_hash, now_ms())
            .unwrap_or(false);
        drop(store);
        self.checked_at = Some(SystemTime::now());
        self.valid = still_valid;
        still_valid
    }
}

/// Mutable per-connection session state.
///
/// Bundled so the frame handler keeps a readable signature; every field is
/// connection-local and dropped with the session.
struct SessionState {
    limiter: RateLimiter,
    upload: Option<PendingUpload>,
    validity: ValidityCache,
}

impl SessionState {
    fn new() -> Self {
        Self {
            limiter: RateLimiter::new(),
            upload: None,
            validity: ValidityCache::new(),
        }
    }
}

/// Per-connection token bucket (operations + chat; presence is relay-best-effort).
struct RateLimiter {
    op_tokens: f64,
    chat_tokens: f64,
    chat_draft_tokens: f64,
    last: SystemTime,
}

/// One in-flight chunked operation upload on a connection. At most one is
/// open at a time and its buffer is bounded by
/// `MAX_CHUNKED_OPERATION_BYTES`, so a client cannot make the host allocate
/// unbounded memory by starting many uploads.
struct PendingUpload {
    upload_id: String,
    total_bytes: usize,
    chunk_count: usize,
    digest: String,
    buffer: String,
    next_index: usize,
    received_bytes: usize,
}

const OPS_PER_SECOND: f64 = 30.0;
const OPS_BURST: f64 = 60.0;
/// Finalized chat messages: the authored messages a human sends.
const CHAT_PER_SECOND: f64 = 0.5;
const CHAT_BURST: f64 = 5.0;
/// Chat DRAFTS: lossy, client-coalesced live typing. A separate, generous
/// bucket because one frame per keystroke must never spend the budget that
/// belongs to the message the author actually sent.
const CHAT_DRAFT_PER_SECOND: f64 = 20.0;
const CHAT_DRAFT_BURST: f64 = 40.0;
/// Outbound queue bound per connection. A peer that cannot keep up is
/// disconnected with a reason instead of letting the host buffer without
/// limit (each accepted operation can be 64 MB and is relayed to every peer).
const OUTBOUND_QUEUE_CAPACITY: usize = 256;
/// How long a revocation check is trusted before re-reading the store.
const VALIDITY_TTL: Duration = Duration::from_secs(5);

impl RateLimiter {
    fn new() -> Self {
        Self {
            op_tokens: OPS_BURST,
            chat_tokens: CHAT_BURST,
            chat_draft_tokens: CHAT_DRAFT_BURST,
            last: SystemTime::now(),
        }
    }

    fn refill(&mut self) {
        let now = SystemTime::now();
        let elapsed = now
            .duration_since(self.last)
            .unwrap_or(Duration::ZERO)
            .as_secs_f64();
        self.last = now;
        self.op_tokens = (self.op_tokens + elapsed * OPS_PER_SECOND).min(OPS_BURST);
        self.chat_tokens = (self.chat_tokens + elapsed * CHAT_PER_SECOND).min(CHAT_BURST);
        self.chat_draft_tokens = (self.chat_draft_tokens + elapsed * CHAT_DRAFT_PER_SECOND)
            .min(CHAT_DRAFT_BURST);
    }

    fn take(&mut self, chat: bool) -> bool {
        self.refill();
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

    /// Draft frames have their own bucket, so they can never consume the
    /// finalized-message budget.
    fn take_draft(&mut self) -> bool {
        self.refill();
        if self.chat_draft_tokens >= 1.0 {
            self.chat_draft_tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Best-effort host name for the lock record (diagnostics only).
fn hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string())
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
        let owner_id = mint_token();
        match store.acquire_host_lock(
            &owner_id,
            std::process::id() as i64,
            &hostname(),
            now_ms(),
            HOST_LOCK_STALE_MS,
        )? {
            crate::store::LockOutcome::Acquired => {}
            crate::store::LockOutcome::Held {
                owner_pid,
                hostname: holder,
                ..
            } => {
                return Err(RoomStoreError::HostLocked {
                    owner_pid,
                    hostname: holder,
                })
            }
        }
        Ok(Arc::new(Self {
            store: Mutex::new(store),
            config,
            rooms: Mutex::new(HashMap::new()),
            operation_counter: AtomicU64::new(0),
            owner_id,
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
            let rooms = lock(&self.rooms);
            if rooms.len() >= self.config.max_rooms {
                return Err(RoomStoreError::SequenceExhausted); // capacity guard
            }
        }
        let store = lock(&self.store);
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
        let store = lock(&self.store);
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
            let store = lock(&self.store);
            if !store.revoke_invite(token_hash_value)? {
                return Ok(false);
            }
        }
        let mut rooms = lock(&self.rooms);
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
                    // Ending the SESSION, not merely asking it to leave: the
                    // session loop watches this channel and closes the socket.
                    // A cooperative client also acts on the room-ended frame; a
                    // hostile one must not keep a live authenticated socket that
                    // can still read the journal, inject presence, or upload a
                    // snapshot.
                    let _ = entry
                        .terminate
                        .send(Some("Your access was revoked".to_string()));
                    deliver_to(
                        &entry,
                        ServerMessage::RoomEnded {
                            reason: "Your access was revoked".to_string(),
                        },
                    );
                }
            }
        }
        Ok(true)
    }

    /// Admin API: end a room and disconnect everyone.
    pub fn admin_end_room(&self, room_id: &str) -> Result<bool, RoomStoreError> {
        let existed = {
            let store = lock(&self.store);
            let existed = store.room_exists(room_id)?;
            if existed {
                store.delete_room(room_id)?;
            }
            existed
        };
        if !existed {
            return Ok(false);
        }
        let mut rooms = lock(&self.rooms);
        if let Some(room) = rooms.remove(room_id) {
            for (_, entry) in room.participants {
                let _ = entry
                    .terminate
                    .send(Some("The session was ended by the host".to_string()));
                deliver_to(
                    &entry,
                    ServerMessage::RoomEnded {
                        reason: "The session was ended by the host".to_string(),
                    },
                );
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
    let cors_state = host.clone();
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/join", get(crate::join::join_page))
        .route("/join.js", get(crate::join::join_script))
        .route("/join.css", get(crate::join::join_styles))
        .route("/room/{room_id}", get(ws_upgrade))
        .route("/admin/rooms", post(admin_rooms))
        .route("/admin/rooms/{room_id}/invites", post(admin_invites))
        .route("/admin/invites/{token_hash}", delete(admin_revoke))
        .route("/admin/rooms/{room_id}", delete(admin_end_room))
        .layer(axum::middleware::from_fn_with_state(cors_state, cors))
        .with_state(host)
}

/// Is this browser origin allowed to talk to the HTTP surface?
///
/// Same answer the WebSocket upgrade gives: loopback pages and the Tauri
/// webview always, anything else only when `allowed_origins` names it.
fn browser_origin_allowed(host: &RoomHost, origin: &str) -> bool {
    is_local_origin(origin)
        || host
            .config
            .allowed_origins
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(origin.trim()))
}

fn apply_cors(response: &mut axum::response::Response, origin: Option<&str>, allowed: bool) {
    let headers = response.headers_mut();
    // `Vary` always: the answer depends on the request's Origin.
    headers.append(header::VARY, HeaderValue::from_static("origin"));
    if !allowed {
        return;
    }
    let Some(origin) = origin else { return };
    if let Ok(value) = HeaderValue::from_str(origin) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
    }
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, DELETE, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type, x-varve-admin-token"),
    );
    headers.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("600"),
    );
    // Never `*`: the admin API carries a credential in a request header.
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
}

/// CORS for the HTTP surface.
///
/// The desktop app's webview and the browser build are not served by the room
/// server, so "host on your own server" and `/join`-adjacent reads are
/// cross-origin requests. Without this the browser blocks them and the user
/// sees only "Failed to fetch" (measured: the app-hosted E2E could not create a
/// room on a user-run server). The allow-list is the WebSocket one — an
/// explicit origin list, never a wildcard, because the admin token travels in a
/// header.
async fn cors(State(host): State<Arc<RoomHost>>, request: Request, next: Next) -> axum::response::Response {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let allowed = origin
        .as_deref()
        .is_some_and(|origin| browser_origin_allowed(&host, origin));
    if request.method() == Method::OPTIONS {
        // Preflight: answer without touching the routes.
        let mut response = if allowed {
            StatusCode::NO_CONTENT.into_response()
        } else {
            StatusCode::FORBIDDEN.into_response()
        };
        apply_cors(&mut response, origin.as_deref(), allowed);
        return response;
    }
    let mut response = next.run(request).await;
    apply_cors(&mut response, origin.as_deref(), allowed);
    response
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

/// Loopback host spellings a browser may legitimately use for a local room.
/// Accepts `host`, `host:port`, `[v6]`, `[v6]:port`, and bare `v6`.
fn is_loopback_host(host: &str) -> bool {
    let lower = host.trim().to_ascii_lowercase();
    let bare = if let Some(rest) = lower.strip_prefix('[') {
        rest.split(']').next().unwrap_or(rest)
    } else if lower.matches(':').count() == 1 {
        lower.split(':').next().unwrap_or(&lower)
    } else {
        // No colon (plain host) or several (a bare IPv6 literal).
        &lower
    };
    matches!(bare, "localhost" | "127.0.0.1" | "::1" | "0.0.0.0") || bare.ends_with(".localhost")
}

fn is_local_origin(origin: &str) -> bool {
    let lower = origin.trim().to_ascii_lowercase();
    if lower == "tauri://localhost" || lower == "http://tauri.localhost" {
        return true;
    }
    let Some(rest) = lower
        .strip_prefix("http://")
        .or_else(|| lower.strip_prefix("https://"))
    else {
        return false;
    };
    is_loopback_host(rest)
}

fn is_loopback_bind(host: &RoomHost) -> bool {
    // Decided once at bind time; the upgrade check re-derives it from config.
    !host.config.allow_non_loopback
}

/// The cross-site WebSocket hijacking boundary.
///
/// - `Origin` is what a browser page reports. Native clients send none.
/// - Non-browser clients (the desktop app, tests, CLI tooling) send no Origin
///   and are unaffected.
/// - A browser page on a loopback origin, or in the Tauri webview, is
///   allowed; anything else must be listed in `allowed_origins`. "Any
///   `https://` origin" is NOT acceptable: an attacker page could then open a
///   socket to a locally hosted room.
/// - When the listener is loopback, the `Host` header must resolve to
///   loopback too. Without this a malicious site can point its own DNS at
///   127.0.0.1 and reach the local room from a page the browser believes is
///   remote (DNS rebinding); the rebinding attempt arrives with
///   `Host: evil.example`, which is refused here.
fn origin_allowed(host: &RoomHost, headers: &HeaderMap) -> bool {
    if let Some(origin) = headers.get("origin").and_then(|value| value.to_str().ok()) {
        let allowed = browser_origin_allowed(host, origin);
        if !allowed {
            return false;
        }
    }
    if let Some(header_host) = headers.get("host").and_then(|value| value.to_str().ok()) {
        let listed = host
            .config
            .allowed_hosts
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(header_host.trim()));
        if !listed && is_loopback_bind(host) && !is_loopback_host(header_host) {
            return false;
        }
    }
    true
}

async fn ws_upgrade(
    State(host): State<Arc<RoomHost>>,
    AxumPath(room_id): AxumPath<String>,
    headers: HeaderMap,
    ConnectInfo(_addr): ConnectInfo<SocketAddr>,
    upgrade: WebSocketUpgrade,
) -> impl IntoResponse {
    if !origin_allowed(&host, &headers) {
        return StatusCode::FORBIDDEN.into_response();
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

/// Take a host lock, recovering from poisoning.
///
/// Every lock here guards shared bookkeeping, not invariants a panic could
/// corrupt mid-write, and a poisoned lock must not turn one panic into a host
/// that panics on every later frame for every room.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Deliver a frame to one connection's outbound queue.
///
/// The queue is bounded: a peer whose socket has stalled is ended with a
/// reason (it reconnects and resyncs from the journal) rather than letting the
/// host queue operations without limit. Returns false when the peer is gone or
/// was ended here.
fn deliver(
    outgoing: &mpsc::Sender<ServerMessage>,
    terminate: &watch::Sender<Option<String>>,
    message: ServerMessage,
) -> bool {
    match outgoing.try_send(message) {
        Ok(()) => true,
        Err(mpsc::error::TrySendError::Full(_)) => {
            let _ = terminate.send(Some("Your connection fell behind and was closed.".to_string()));
            false
        }
        Err(mpsc::error::TrySendError::Closed(_)) => false,
    }
}

/// Deliver to a registered participant (looked up by the room map).
fn deliver_to(entry: &ParticipantEntry, message: ServerMessage) -> bool {
    deliver(&entry.outgoing, &entry.terminate, message)
}

/// Synchronous registration: takes every lock it needs and returns before
/// any await, so guards can never be held across the session's async paths.
fn register_participant(
    host: &Arc<RoomHost>,
    session: &Session,
    hello: &ClientMessage,
    outgoing: mpsc::Sender<ServerMessage>,
    terminate: watch::Sender<Option<String>>,
) -> Registration {
    let mut rooms = lock(&host.rooms);
    let store = lock(&host.store);
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
            terminate,
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
    // Bounded: a stalled peer is ended rather than letting the host queue
    // operations (each up to 64 MB, relayed to every peer) without limit.
    let (outgoing_tx, mut outgoing_rx) = mpsc::channel::<ServerMessage>(OUTBOUND_QUEUE_CAPACITY);
    // Host-initiated termination: revocation, backpressure, a room ending.
    let (terminate_tx, mut terminate_rx) = watch::channel::<Option<String>>(None);

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
        let store = lock(&host.store);
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
    let registration = register_participant(
        &host,
        &session,
        &client_message,
        outgoing_tx.clone(),
        terminate_tx.clone(),
    );
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
            let _ = outgoing_tx.try_send(ServerMessage::Error {
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
    let _ = deliver(&outgoing_tx, &terminate_tx, ServerMessage::Welcome {
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
            let store = lock(&host.store);
            store.journal_range(&room_id, snapshot_seq, current_seq)
        } {
            let _ = deliver(&outgoing_tx, &terminate_tx, ServerMessage::Sync {
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
        let rooms = lock(&host.rooms);
        if let Some(room) = rooms.get(&room_id) {
            let info = room
                .participants
                .get(&session.actor_id)
                .map(|entry| entry.info.clone());
            if let Some(info) = info {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        deliver_to(entry, ServerMessage::ParticipantJoined {
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

    // Inbound loop. A socket that sends nothing for the idle window is
    // treated exactly like a disconnect: it is deregistered and its
    // participant slot is released (a crashed tab must not hold a place in a
    // 10-participant room forever). Live clients send a `ping` heartbeat, so
    // a quiet-but-healthy participant is never reaped.
    let mut state = SessionState::new();
    let idle = Duration::from_millis(host.config.idle_timeout_ms);
    let mut end_reason: Option<String> = None;
    loop {
        // A revocation or a stalled outbound queue ends the session HERE, on
        // the socket, not merely in the client's UI.
        if terminate_rx.has_changed().unwrap_or(false) {
            end_reason = terminate_rx.borrow_and_update().clone();
            break;
        }
        let next = tokio::select! {
            biased;
            changed = terminate_rx.changed() => {
                if changed.is_ok() {
                    end_reason = terminate_rx.borrow_and_update().clone();
                }
                break;
            }
            next = tokio::time::timeout(idle, stream.next()) => match next {
                Ok(next) => next,
                Err(_) => break,
            },
        };
        let Some(frame) = next else { break };
        let Ok(message) = frame else { break };
        match message {
            WsMessage::Text(text) => {
                if handle_client_frame(
                    &host,
                    &session,
                    text.as_bytes(),
                    &mut state,
                    &outgoing_tx,
                    &terminate_tx,
                )
                .is_break()
                {
                    break;
                }
            }
            WsMessage::Binary(bytes) => {
                if handle_client_frame(
                    &host,
                    &session,
                    &bytes,
                    &mut state,
                    &outgoing_tx,
                    &terminate_tx,
                )
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
        let mut rooms = lock(&host.rooms);
        if let Some(room) = rooms.get_mut(&room_id) {
            room.participants.remove(&session.actor_id);
            for entry in room.participants.values() {
                deliver_to(entry, ServerMessage::ParticipantLeft {
                    actor_id: session.actor_id.clone(),
                    reason: "disconnect".to_string(),
                });
            }
        }
    }
    // Orderly end: report the reason when there is one (revocation,
    // backpressure), then drop the sender so the pump drains what is queued and
    // ends, which drops the socket and closes the connection normally. No
    // internal sentinel can leak into the UI, and no abort races the final
    // write.
    if let Some(reason) = end_reason {
        let _ = deliver(
            &outgoing_tx,
            &terminate_tx,
            ServerMessage::RoomEnded { reason },
        );
    }
    drop(outgoing_tx);
    if tokio::time::timeout(Duration::from_secs(2), outbound)
        .await
        .is_err()
    {
        // A peer that stopped reading must not pin this task; the socket is
        // closed either way.
    }
}

/// Apply one authenticated, structurally bounded operation: role check,
/// rate limit, actor stamping, durable append, ack, relay. Shared verbatim by
/// the inline and the chunked paths so framing can never change semantics.
fn handle_operation(
    host: &Arc<RoomHost>,
    session: &Session,
    mut op: RoomOperation,
    limiter: &mut RateLimiter,
    outgoing: &mpsc::Sender<ServerMessage>,
    terminate: &watch::Sender<Option<String>>,
) {
    // Roles: viewers cannot mutate. The hidden-edit-button rule.
    if session.role == ParticipantRole::Viewer {
        deliver(outgoing, terminate, ServerMessage::OperationRejected {
            client_op_id: op.client_op_id.clone(),
            reason: "You have view-only access to this session.".to_string(),
            fatal: false,
        });
        return;
    }
    if !limiter.take(false) {
        deliver(outgoing, terminate, ServerMessage::OperationRejected {
            client_op_id: op.client_op_id.clone(),
            reason: "Sending changes too quickly.".to_string(),
            fatal: false,
        });
        return;
    }
    // The wire cannot be trusted for semantics: an operation claims an actor
    // identity but the session's authenticated identity overrides it.
    // Checked arithmetic (FigCraft #309 class).
    op.actor_id = session.actor_id.clone();
    if op.based_on_seq < 0 || !capture_payload_like(&op.capture) {
        deliver(outgoing, terminate, ServerMessage::OperationRejected {
            client_op_id: op.client_op_id.clone(),
            reason: "Operation payload failed structural validation.".to_string(),
            fatal: true,
        });
        return;
    }
    let payload = match serde_json::to_string(&op) {
        Ok(data) => data,
        Err(_) => return,
    };
    let now = now_ms();
    enum OpOutcome {
        Appended(i64),
        Replayed(i64),
        Revoked,
        StoreError(String),
    }
    let outcome = {
        let store = lock(&host.store);
        // Revocation is re-checked at the authoritative host for every
        // mutation (Penpot #12155 lesson).
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
                    Ok(crate::store::AppendOutcome::Appended { seq }) => OpOutcome::Appended(seq),
                    Ok(crate::store::AppendOutcome::Replayed { seq }) => OpOutcome::Replayed(seq),
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
            deliver(outgoing, terminate, ServerMessage::OperationAccepted {
                client_op_id: op.client_op_id.clone(),
                seq,
            });
            // Relay to every other live participant.
            let rooms = lock(&host.rooms);
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        deliver_to(entry, ServerMessage::Operation {
                            seq,
                            op: op.clone(),
                        });
                    }
                }
            }
        }
        OpOutcome::Replayed(seq) => {
            // Idempotent retry: re-ack with the stored sequence only.
            deliver(outgoing, terminate, ServerMessage::OperationAccepted {
                client_op_id: op.client_op_id.clone(),
                seq,
            });
        }
        OpOutcome::Revoked => {
            deliver(outgoing, terminate, ServerMessage::OperationRejected {
                client_op_id: op.client_op_id.clone(),
                reason: "You no longer have access to this session.".to_string(),
                fatal: true,
            });
        }
        OpOutcome::StoreError(error) => {
            // The change was NOT acked: the client keeps it as pending local
            // work and may retry after reconnecting.
            deliver(outgoing, terminate, ServerMessage::Error {
                code: "store-error".to_string(),
                message: format!("The session host could not persist the change: {error}"),
                fatal: false,
            });
        }
    }
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

/// The `clientOpId` of an operation-shaped frame, without trusting the rest.
fn operation_id_of(raw: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(raw).ok()?;
    let op = value.get("op")?;
    let id = op.get("clientOpId")?.as_str()?;
    if id.is_empty() || id.len() > 128 {
        return None;
    }
    Some(id.to_string())
}

/// Refuse a frame, attributing it to its operation when one is known.
///
/// An unattributed refusal is a livelock: the operation stays pending on the
/// sender, is re-sent on every reconnect, and keeps blocking conflicting
/// remote changes for its keys. `operation-rejected` is the shape the client
/// already knows how to settle.
fn reject_frame(
    raw: &[u8],
    client_op_id: Option<String>,
    reason: &str,
    outgoing: &mpsc::Sender<ServerMessage>,
    terminate: &watch::Sender<Option<String>>,
) {
    let message = match client_op_id.or_else(|| operation_id_of(raw)) {
        Some(client_op_id) => ServerMessage::OperationRejected {
            client_op_id,
            reason: reason.to_string(),
            fatal: false,
        },
        None => ServerMessage::Error {
            code: "bad-frame".to_string(),
            message: reason.to_string(),
            fatal: false,
        },
    };
    deliver(outgoing, terminate, message);
}

/// Handle one authenticated client frame. Returns ControlFlow-like break.
fn handle_client_frame(
    host: &Arc<RoomHost>,
    session: &Session,
    raw: &[u8],
    state: &mut SessionState,
    outgoing: &mpsc::Sender<ServerMessage>,
    terminate: &watch::Sender<Option<String>>,
) -> std::ops::ControlFlow<()> {
    // Size ceilings before parsing; oversized frames must identify as a
    // multi-frame kind (chunked operation, snapshot upload) or the socket
    // is closed — an unknown oversized frame is a memory-exhaustion probe.
    if raw.len() > MAX_OPERATION_FRAME_BYTES && !is_large_capable_frame(raw) {
        return std::ops::ControlFlow::Break(());
    }
    if raw.len() > MAX_SNAPSHOT_UPLOAD_BYTES {
        return std::ops::ControlFlow::Break(());
    }
    let Ok(message) = serde_json::from_slice::<ClientMessage>(raw) else {
        // Attribute the refusal when the frame names an operation: an
        // unattributable error leaves that operation pending forever, so the
        // client re-sends it on every reconnect and it keeps blocking
        // conflicting remote changes.
        reject_frame(raw, None, "Frame failed protocol validation.", outgoing, terminate);
        return std::ops::ControlFlow::Continue(());
    };
    if message.validate().is_err() {
        let client_op_id = match &message {
            ClientMessage::Operation { op } => Some(op.client_op_id.clone()),
            _ => operation_id_of(raw),
        };
        reject_frame(raw, client_op_id, "Frame out of bounds.", outgoing, terminate);
        return std::ops::ControlFlow::Continue(());
    }
    match message {
        ClientMessage::Hello { .. } => {
            // A second hello on one socket is a protocol error.
            std::ops::ControlFlow::Break(())
        }
        ClientMessage::Operation { op } => {
            handle_operation(host, session, op, &mut state.limiter, outgoing, terminate);
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::OperationBegin {
            upload_id,
            total_bytes,
            chunk_count,
            digest,
        } => {
            if state.upload.is_some() {
                deliver(outgoing, terminate, ServerMessage::OperationUploadRejected {
                    upload_id,
                    reason: "Another upload is already in progress.".to_string(),
                });
                return std::ops::ControlFlow::Continue(());
            }
            state.upload = Some(PendingUpload {
                upload_id,
                total_bytes: total_bytes as usize,
                chunk_count: chunk_count as usize,
                digest: digest.to_ascii_lowercase(),
                buffer: String::with_capacity((total_bytes as usize).min(1 << 20)),
                next_index: 0,
                received_bytes: 0,
            });
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::OperationChunk {
            upload_id,
            index,
            data,
        } => {
            let mut reject: Option<String> = None;
            match state.upload.as_mut() {
                None => reject = Some("No upload is in progress.".to_string()),
                Some(pending) if pending.upload_id != upload_id => {
                    reject = Some("Chunk for an unknown state.upload.".to_string());
                }
                Some(pending) if index as usize != pending.next_index => {
                    reject = Some("Chunks arrived out of order.".to_string());
                }
                Some(pending) => {
                    let chunk_bytes = data.len();
                    if pending.received_bytes + chunk_bytes > pending.total_bytes
                        || pending.buffer.len() + chunk_bytes > MAX_CHUNKED_OPERATION_BYTES
                    {
                        reject = Some("Upload exceeds its declared size.".to_string());
                    } else {
                        pending.buffer.push_str(&data);
                        pending.received_bytes += chunk_bytes;
                        pending.next_index += 1;
                    }
                }
            }
            if let Some(reason) = reject {
                // Fail closed: the buffer is discarded, the operation stays
                // pending on the client, and the client may retry.
                let upload_id = state.upload.take().map(|p| p.upload_id).unwrap_or(upload_id);
                deliver(outgoing, terminate, ServerMessage::OperationUploadRejected {
                    upload_id,
                    reason,
                });
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::OperationEnd { upload_id } => {
            let Some(pending) = state.upload.take() else {
                deliver(outgoing, terminate, ServerMessage::OperationUploadRejected {
                    upload_id,
                    reason: "No upload is in progress.".to_string(),
                });
                return std::ops::ControlFlow::Continue(());
            };
            if pending.upload_id != upload_id {
                deliver(outgoing, terminate, ServerMessage::OperationUploadRejected {
                    upload_id,
                    reason: "Upload id mismatch.".to_string(),
                });
                return std::ops::ControlFlow::Continue(());
            }
            let mut reject_reason: Option<String> = None;
            if pending.next_index != pending.chunk_count {
                reject_reason = Some("Upload ended before every chunk arrived.".to_string());
            } else if pending.buffer.len() != pending.total_bytes {
                reject_reason = Some("Upload length did not match its declaration.".to_string());
            } else if crate::protocol::digest_hex(pending.buffer.as_bytes()) != pending.digest {
                // Integrity: the reassembled frame must hash to what the
                // client declared. WebSocket framing already protects the
                // bytes in transit; this catches truncation, interleaving
                // bugs, and a hostile frame that does not match its claim.
                reject_reason = Some("Upload digest did not match.".to_string());
            }
            if let Some(reason) = reject_reason {
                deliver(outgoing, terminate, ServerMessage::OperationUploadRejected {
                    upload_id,
                    reason,
                });
                return std::ops::ControlFlow::Continue(());
            }
            // The reassembled frame is validated exactly like an inline one:
            // chunking changes framing, never semantics.
            let parsed = serde_json::from_str::<ClientMessage>(&pending.buffer);
            match parsed {
                Ok(message @ ClientMessage::Operation { .. }) => {
                    if message.validate().is_err() {
                        let client_op_id = match &message {
                            ClientMessage::Operation { op } => Some(op.client_op_id.clone()),
                            _ => None,
                        };
                        reject_frame(
                            pending.buffer.as_bytes(),
                            client_op_id,
                            "Reassembled operation is out of bounds.",
                            outgoing,
                            terminate,
                        );
                        return std::ops::ControlFlow::Continue(());
                    }
                    if let ClientMessage::Operation { op } = message {
                        handle_operation(host, session, op, &mut state.limiter, outgoing, terminate);
                    }
                }
                _ => {
                    deliver(outgoing, terminate, ServerMessage::OperationUploadRejected {
                        upload_id,
                        // Only operation frames may be uploaded in chunks: a
                        // chunked hello would defeat the hello-once rule and a
                        // chunked snapshot upload the owner gate's shape.
                        reason: "A chunked upload must reassemble to a valid operation."
                            .to_string(),
                    });
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Cursor { page_id, x, y } => {
            if !state.validity.valid(host, session) {
                return std::ops::ControlFlow::Break(());
            }
            let frame = CursorFrame { page_id, x, y };
            let rooms = lock(&host.rooms);
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        deliver_to(entry, ServerMessage::PresenceCursor {
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
            if !state.validity.valid(host, session) {
                return std::ops::ControlFlow::Break(());
            }
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
            let rooms = lock(&host.rooms);
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        deliver_to(entry, ServerMessage::PresenceViewport {
                            actor_id: session.actor_id.clone(),
                            viewport: frame.clone(),
                        });
                    }
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Selection { page_id, node_ids } => {
            if !state.validity.valid(host, session) {
                return std::ops::ControlFlow::Break(());
            }
            if node_ids.len() > MAX_SELECTION_IDS {
                return std::ops::ControlFlow::Continue(());
            }
            let frame = SelectionFrame { page_id, node_ids };
            let rooms = lock(&host.rooms);
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        deliver_to(entry, ServerMessage::PresenceSelection {
                            actor_id: session.actor_id.clone(),
                            selection: frame.clone(),
                        });
                    }
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Chat { message } => {
            if !state.validity.valid(host, session) {
                return std::ops::ControlFlow::Break(());
            }
            // Drafts and finalized messages have separate budgets, so a draft
            // burst can never spend the message the author actually sent. A
            // refused FINAL message is reported: silently dropping the message
            // a person pressed Enter on is the worst possible outcome.
            let allowed = if message.composing {
                state.limiter.take_draft()
            } else if state.limiter.take(true) {
                true
            } else {
                let _ = deliver(
                    outgoing,
                    terminate,
                    ServerMessage::Error {
                        code: "chat-rate-limited".to_string(),
                        message: "That message was not sent: the room is receiving chat too quickly.".to_string(),
                        fatal: false,
                    },
                );
                false
            };
            if !allowed {
                return std::ops::ControlFlow::Continue(());
            }
            if message.text.chars().count() > MAX_CHAT_LENGTH {
                return std::ops::ControlFlow::Continue(());
            }
            let rooms = lock(&host.rooms);
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        deliver_to(entry, ServerMessage::Chat {
                            message: crate::protocol::ChatMessageFrame {
                                message_id: message.message_id.clone(),
                                actor_id: session.actor_id.clone(),
                                text: message.text.clone(),
                                composing: message.composing,
                            },
                        });
                    }
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::SyncRequest { from_seq } => {
            if !state.validity.valid(host, session) {
                return std::ops::ControlFlow::Break(());
            }
            let store = lock(&host.store);
            let baseline = store.baseline(&session.room_id).ok().flatten();
            let current = store.current_seq(&session.room_id).unwrap_or(0);
            let from = from_seq.max(baseline.as_ref().map(|b| b.seq).unwrap_or(0));
            if from_seq < from {
                // The requested range was compacted away: send the snapshot.
                if let Some(baseline) = baseline {
                    deliver(outgoing, terminate, ServerMessage::Snapshot {
                        snapshot: RoomSnapshot {
                            upto_seq: baseline.seq,
                            document_json: baseline.document_json,
                        },
                    });
                }
            }
            if let Ok(entries) = store.journal_range(&session.room_id, from, current) {
                deliver(outgoing, terminate, ServerMessage::Sync {
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
            // Snapshots replace the baseline every future joiner bootstraps
            // from, so this is a mutation like any other: the role is checked
            // AND the invite is re-checked against the store (a revoked owner
            // must not be able to move the baseline), and a refusal is visible
            // rather than a silent no-op.
            if session.role != ParticipantRole::Owner {
                let _ = deliver(
                    outgoing,
                    terminate,
                    ServerMessage::Error {
                        code: "snapshot-refused".to_string(),
                        message: "Only the room owner may upload a snapshot.".to_string(),
                        fatal: false,
                    },
                );
                return std::ops::ControlFlow::Continue(());
            }
            let now = now_ms();
            let store = lock(&host.store);
            let still_valid = store
                .invite_is_still_valid(&session.token_hash, now)
                .unwrap_or(false);
            if !still_valid {
                let _ = deliver(
                    outgoing,
                    terminate,
                    ServerMessage::Error {
                        code: "snapshot-refused".to_string(),
                        message: "Your access to this session ends with your invite.".to_string(),
                        fatal: true,
                    },
                );
                return std::ops::ControlFlow::Break(());
            }
            match store.compact_with_snapshot(&session.room_id, upto_seq, &document_json, now) {
                Ok(()) => {}
                Err(error) => {
                    let _ = deliver(
                        outgoing,
                        terminate,
                        ServerMessage::Error {
                            code: "snapshot-refused".to_string(),
                            message: format!("The snapshot was not stored: {error}"),
                            fatal: false,
                        },
                    );
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Leave => std::ops::ControlFlow::Break(()),
        ClientMessage::Ping => {
            deliver(outgoing, terminate, ServerMessage::Pong);
            std::ops::ControlFlow::Continue(())
        }
    }
}

/// Validate a requested bind against the exposure policy. A non-loopback
/// bind is an explicit decision (`--expose`) and requires an admin token.
fn validate_bind(host: &RoomHost, bind: SocketAddr) -> Result<(), std::io::Error> {
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
    Ok(())
}

/// Spawn the accept loop for an already-bound listener onto `handle`.
fn spawn_accept_loop(
    host: Arc<RoomHost>,
    listener: tokio::net::TcpListener,
    shutdown: tokio::sync::watch::Receiver<bool>,
    handle: &tokio::runtime::Handle,
) {
    spawn_lock_heartbeat(&host, handle, shutdown.clone());
    let app = router(host);
    let mut shutdown_rx = shutdown;
    handle.spawn(async move {
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.wait_for(|stop| *stop).await;
        })
        .await;
    });
}

/// Refresh the data-directory lock while this host is serving.
///
/// The heartbeat is what makes the lock's staleness window meaningful: a host
/// that crashes stops refreshing, and the next process may take the directory
/// over instead of being refused forever.
fn spawn_lock_heartbeat(
    host: &Arc<RoomHost>,
    handle: &tokio::runtime::Handle,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    let host = host.clone();
    handle.spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(HOST_LOCK_REFRESH_MS));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = ticker.tick() => {}
                _ = shutdown.wait_for(|stop| *stop) => return,
            }
            let outcome = {
                let store = lock(&host.store);
                store.refresh_host_lock(&host.owner_id, now_ms())
            };
            match outcome {
                // Another process took the directory over after a stall: this
                // one must stop writing rather than diverge.
                Ok(crate::store::LockHeartbeat::TakenOver { owner_pid }) => {
                    eprintln!(
                        "varve-room: the data directory was taken over by pid {owner_pid}; stopping"
                    );
                    std::process::exit(3);
                }
                // Our own clean release (the store dropped on shutdown).
                Ok(crate::store::LockHeartbeat::Released) => return,
                _ => {}
            }
        }
    });
}

/// Bind and serve on a runtime handle supplied by the caller.
///
/// This is the entry point for embedders that are ALREADY inside an async
/// runtime — the Tauri app-hosted desktop path. `serve` awaits
/// `TcpListener::bind`, and `Runtime::block_on` panics when called from
/// inside a runtime ("Cannot start a runtime from within a runtime"), so an
/// async command cannot use it. Here the listener is bound with
/// `std::net::TcpListener` (which needs no runtime), the bound address is
/// returned immediately for building invite URLs, and only the accept loop
/// is spawned onto the caller's runtime.
///
/// Returns the bound address (use port 0 for an OS-assigned port).
pub fn serve_with_handle(
    host: Arc<RoomHost>,
    bind: SocketAddr,
    shutdown: tokio::sync::watch::Receiver<bool>,
    handle: &tokio::runtime::Handle,
) -> Result<SocketAddr, std::io::Error> {
    validate_bind(&host, bind)?;
    let std_listener = std::net::TcpListener::bind(bind)?;
    std_listener.set_nonblocking(true)?;
    let address = std_listener.local_addr()?;
    let listener = tokio::net::TcpListener::from_std(std_listener)?;
    spawn_accept_loop(host, listener, shutdown, handle);
    Ok(address)
}

/// `serve_with_handle` against the current thread's runtime. Errors when no
/// runtime is entered on this thread rather than panicking.
pub fn serve_on_current_runtime(
    host: Arc<RoomHost>,
    bind: SocketAddr,
    shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<SocketAddr, std::io::Error> {
    let handle = tokio::runtime::Handle::try_current().map_err(|_| {
        std::io::Error::other(
            "serve_on_current_runtime requires an entered async runtime",
        )
    })?;
    serve_with_handle(host, bind, shutdown, &handle)
}

/// Run the host's HTTP+WS server until shutdown is signalled. Returns the
/// bound address (use port 0 for an OS-assigned port in app-hosted mode).
/// Awaits the bind, so this is for callers that are NOT already inside a
/// runtime; embedders inside one use `serve_on_current_runtime`.
pub async fn serve(
    host: Arc<RoomHost>,
    bind: SocketAddr,
    shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<SocketAddr, std::io::Error> {
    validate_bind(&host, bind)?;
    let listener = tokio::net::TcpListener::bind(bind).await?;
    let address = listener.local_addr()?;
    // The server runs on a spawned task so the caller gets the bound
    // address immediately (app-hosted mode needs it to build invite URLs).
    let handle = tokio::runtime::Handle::current();
    spawn_accept_loop(host, listener, shutdown, &handle);
    Ok(address)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_host(config: HostConfig) -> Arc<RoomHost> {
        let dir = std::env::temp_dir().join(format!(
            "varve-room-origin-{}-{}",
            std::process::id(),
            config.data_dir.display()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let mut config = config;
        config.data_dir = dir;
        RoomHost::open(config).expect("host opens")
    }

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                axum::http::HeaderName::from_bytes(name.as_bytes()).expect("header name"),
                value.parse().expect("header value"),
            );
        }
        map
    }

    #[test]
    fn loopback_pages_and_native_clients_can_open_a_socket() {
        let host = test_host(HostConfig::for_data_dir(PathBuf::from("loopback")));
        assert!(origin_allowed(&host, &headers(&[])));
        for origin in [
            "http://localhost:1420",
            "http://127.0.0.1:5173",
            "http://[::1]:8080",
            "tauri://localhost",
            "http://tauri.localhost",
        ] {
            assert!(
                origin_allowed(&host, &headers(&[("origin", origin), ("host", "127.0.0.1:8790")])),
                "{origin} must be allowed"
            );
        }
    }

    #[test]
    fn a_remote_page_origin_is_refused() {
        let host = test_host(HostConfig::for_data_dir(PathBuf::from("remote")));
        for origin in ["https://evil.example", "http://evil.example:8080"] {
            assert!(
                !origin_allowed(&host, &headers(&[("origin", origin), ("host", "127.0.0.1:8790")])),
                "{origin} must be refused"
            );
        }
    }

    #[test]
    fn a_configured_origin_is_allowed_and_nothing_else_is() {
        let mut config = HostConfig::for_data_dir(PathBuf::from("allowed"));
        config.allowed_origins = vec!["https://rooms.example.com".to_string()];
        let host = test_host(config);
        assert!(origin_allowed(
            &host,
            &headers(&[
                ("origin", "https://rooms.example.com"),
                ("host", "127.0.0.1:8790")
            ])
        ));
        assert!(!origin_allowed(
            &host,
            &headers(&[
                ("origin", "https://rooms.example.com.evil.test"),
                ("host", "127.0.0.1:8790")
            ])
        ));
    }

    #[test]
    fn a_rebinding_host_header_is_refused_on_a_loopback_listener() {
        let host = test_host(HostConfig::for_data_dir(PathBuf::from("rebind")));
        // The page's origin looks local because the attacker's DNS points at
        // 127.0.0.1, but the Host header still carries the attacker's name.
        assert!(!origin_allowed(
            &host,
            &headers(&[
                ("origin", "http://evil.example"),
                ("host", "evil.example")
            ])
        ));
        assert!(!origin_allowed(
            &host,
            &headers(&[("host", "evil.example:8790")])
        ));
    }

    #[test]
    fn a_listed_host_is_accepted_for_a_same_host_reverse_proxy() {
        let mut config = HostConfig::for_data_dir(PathBuf::from("proxy"));
        config.allowed_hosts = vec!["rooms.example.com".to_string()];
        let host = test_host(config);
        assert!(origin_allowed(
            &host,
            &headers(&[("host", "rooms.example.com")])
        ));
    }

    #[test]
    fn loopback_host_parsing_covers_ports_and_ipv6() {
        assert!(is_loopback_host("localhost:3000"));
        assert!(is_loopback_host("127.0.0.1"));
        assert!(is_loopback_host("[::1]:8790"));
        assert!(is_loopback_host("::1"));
        assert!(is_loopback_host("app.localhost:1420"));
        assert!(!is_loopback_host("localhost.evil.example"));
        assert!(!is_loopback_host("evil.example:1420"));
    }
}

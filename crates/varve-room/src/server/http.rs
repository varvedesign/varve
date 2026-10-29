//! HTTP surface: routing, CORS, health/readiness, the admin API, and the
//! origin/host policy shared with the WebSocket upgrade.

use super::connection::ws_upgrade;
use super::host::RoomHost;
use super::prelude::*;
use super::state::now_ms;

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

/// Loopback host spellings a browser may legitimately use for a local room.
/// Accepts `host`, `host:port`, `[v6]`, `[v6]:port`, and bare `v6`.
pub(super) fn is_loopback_host(host: &str) -> bool {
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
pub(super) fn origin_allowed(host: &RoomHost, headers: &HeaderMap) -> bool {
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

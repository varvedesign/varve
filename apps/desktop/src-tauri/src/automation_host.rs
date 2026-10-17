//! App-hosted automation control endpoint (ADR-0245).
//!
//! The desktop app is the only place connected mode can exist: a webview cannot
//! open a listener, so the socket lives in Rust and the *protocol* lives in the
//! webview. This module is the bridge, and deliberately no more than that:
//!
//! - it binds the endpoint and publishes the instance record
//!   (`varve-automation-host` owns the layout and the limits);
//! - it forwards each complete line to the webview as an event and waits for the
//!   answer, so the TypeScript `ControlConnection` stays the only implementation
//!   of the protocol — validation, credentials, grants, idempotency and receipts
//!   remain in one place;
//! - it hands the webview the credential the transport minted, because the
//!   credential is *compared* by the protocol, not by the transport.
//!
//! What this module must never grow: an idea of what a command is, which
//! credential is valid, or which client may edit. A transport that decided any of
//! those would be a second place for the security rules to be wrong.
//!
//! Policy belongs to the person. `automation_apply_policy` is called by the
//! webview, which reads the settings store, and it is the only way an endpoint
//! starts. Nothing here listens by default.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use futures_util::future::{BoxFuture, FutureExt};
use tauri::Emitter;
use tokio::sync::{oneshot, Mutex as AsyncMutex};

use varve_automation_host::endpoint::{
    write_record, AppIdentity, DocumentIdentity, InstanceRecord, Transport, INSTANCE_SCHEMA,
};
use varve_automation_host::relay::{ConnectionId, FrameRelay, RelayOutcome, TransportError};
use varve_automation_host::server::{start, HostConfig, HostLimits, InstanceIdentity, RunningHost};

/// Event carrying one complete request frame to the webview.
const FRAME_EVENT: &str = "automation:frame";
/// Event asking the webview for the frame to write when the transport refuses.
const TRANSPORT_ERROR_EVENT: &str = "automation:transport-error";
/// Event telling the webview a connection has ended. No answer is expected.
const CLOSED_EVENT: &str = "automation:closed";
/// The protocol this endpoint speaks. Owned by the webview; recorded here so a
/// client can refuse a version it does not speak before connecting.
const CONTROL_PROTOCOL: &str = "varve.control/1";

/// How long the webview has to answer before the connection is closed.
///
/// A busy render loop is not a reason to hold a socket open indefinitely, and
/// the client's own timeout is the honest signal that the answer never came.
const REPLY_TIMEOUT: Duration = Duration::from_secs(30);

/// Outstanding questions to the webview, keyed by request id.
///
/// Process-global rather than a field of the relay so `automation_reply`, which
/// arrives as an independent command, can resolve one without reaching into the
/// task that owns the relay.
type PendingReply = oneshot::Sender<(Option<String>, bool)>;
static WAITERS: OnceLock<Mutex<HashMap<String, PendingReply>>> = OnceLock::new();
static NEXT_REQUEST: AtomicU64 = AtomicU64::new(0);

fn waiters() -> &'static Mutex<HashMap<String, PendingReply>> {
    WAITERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Ask the webview and wait. `None` means it did not answer in time, which the
/// caller turns into a closed connection rather than an invented error.
async fn ask(
    app: &tauri::AppHandle,
    event: &'static str,
    mut payload: serde_json::Value,
) -> Option<(Option<String>, bool)> {
    let request_id = format!("r{}", NEXT_REQUEST.fetch_add(1, Ordering::Relaxed));
    let (sender, receiver) = oneshot::channel();
    if let Some(map) = payload.as_object_mut() {
        map.insert(
            "requestId".to_string(),
            serde_json::Value::String(request_id.clone()),
        );
    }
    waiters()
        .lock()
        .expect("relay waiter map")
        .insert(request_id.clone(), sender);
    let _ = app.emit(event, payload);

    let resolved = match tokio::time::timeout(REPLY_TIMEOUT, receiver).await {
        // The webview answered: it said what to write and whether to stop.
        Ok(Ok(value)) => Some(value),
        // A dropped sender means the application is going away, and a timeout
        // means it never answered. Both are "no answer", which is distinct from
        // an answer of "close" — the caller must not report a decision the
        // protocol never made.
        Ok(Err(_)) | Err(_) => None,
    };
    // Always clear the slot: a late reply must find nothing rather than
    // resolving a question nobody is waiting for any more.
    waiters()
        .lock()
        .expect("relay waiter map")
        .remove(&request_id);
    resolved
}

/// The transport-to-app relay for a hosted desktop session.
struct AppRelay {
    app: tauri::AppHandle,
}

impl FrameRelay for AppRelay {
    fn deliver(&self, connection: ConnectionId, frame: String) -> BoxFuture<'static, RelayOutcome> {
        let app = self.app.clone();
        let payload = serde_json::json!({
            "kind": "frame",
            "connectionId": connection.as_str(),
            "frame": frame,
        });
        async move {
            // The webview says whether the protocol wants the connection to
            // end after this frame; the transport does not decide that, but it
            // does need to know it, or a finished session would leave a socket
            // open until the reply timeout.
            let (frame, close_after) = match ask(&app, FRAME_EVENT, payload).await {
                Some(reply) => reply,
                None => return RelayOutcome::Close,
            };
            // Total, so no combination is silently unrepresentable.
            match (frame, close_after) {
                (Some(frame), false) => RelayOutcome::Reply(frame),
                (Some(frame), true) => RelayOutcome::ReplyAndClose(frame),
                (None, false) => RelayOutcome::Nothing,
                (None, true) => RelayOutcome::Close,
            }
        }
        .boxed()
    }

    fn connection_closed(&self, connection: ConnectionId) {
        // The webview keeps a protocol session per connection and cannot see
        // sockets, so without this a client that merely disconnects stays listed
        // as connected until the connection cap turns real clients away.
        let _ = self.app.emit(
            CLOSED_EVENT,
            serde_json::json!({ "connectionId": connection.as_str() }),
        );
    }

    fn transport_error(
        &self,
        connection: ConnectionId,
        error: TransportError,
    ) -> BoxFuture<'static, Option<String>> {
        let app = self.app.clone();
        let described = match error {
            TransportError::FrameTooLarge {
                limit,
                before_hello,
            } => serde_json::json!({
                "kind": "frame-too-large",
                "limit": limit,
                "beforeHello": before_hello,
            }),
            TransportError::InvalidUtf8 => serde_json::json!({ "kind": "invalid-utf8" }),
            TransportError::HelloTimeout => serde_json::json!({ "kind": "hello-timeout" }),
            TransportError::ResponseTooLarge { limit } => serde_json::json!({
                "kind": "response-too-large",
                "limit": limit,
            }),
        };
        let payload = serde_json::json!({
            "kind": "transport-error",
            "connectionId": connection.as_str(),
            "error": described,
        });
        // The protocol owns the wording, so a refusal it has no text for closes
        // the connection instead of inventing one here.
        async move {
            // A transport refusal always closes after its explanation.
            ask(&app, TRANSPORT_ERROR_EVENT, payload)
                .await
                .and_then(|(frame, _)| frame)
        }
        .boxed()
    }
}

struct Hosted {
    host: RunningHost,
    instance_id: String,
    grants: String,
    document: DocumentIdentity,
}

static HOSTED: OnceLock<AsyncMutex<Option<Hosted>>> = OnceLock::new();

fn state() -> &'static AsyncMutex<Option<Hosted>> {
    HOSTED.get_or_init(|| AsyncMutex::new(None))
}

/// Fallback identity when the webview does not supply one.
fn default_instance_id() -> String {
    format!("desktop-{}", std::process::id())
}

fn record_for(
    instance_id: &str,
    app: &tauri::AppHandle,
    host: &RunningHost,
    document: &DocumentIdentity,
) -> InstanceRecord {
    InstanceRecord {
        schema: INSTANCE_SCHEMA.to_string(),
        instance_id: instance_id.to_string(),
        mode: "connected".to_string(),
        pid: std::process::id(),
        started_at: now_iso8601(),
        app: AppIdentity {
            name: "Varve".to_string(),
            version: app.package_info().version.to_string(),
        },
        protocol: CONTROL_PROTOCOL.to_string(),
        endpoint: host.endpoint().to_string_lossy().into_owned(),
        token_file: host
            .directory()
            .join("token")
            .to_string_lossy()
            .into_owned(),
        document: document.clone(),
    }
}

/// RFC 3339 UTC with millisecond precision, matching what the CLI writes.
fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seconds = millis / 1000;
    let days = seconds / 86_400;
    let rem = seconds % 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        millis % 1000
    )
}

/// Howard Hinnant's days-to-civil algorithm.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

async fn stop_host() {
    let mut guard = state().lock().await;
    if let Some(hosted) = guard.take() {
        hosted.host.shutdown().await;
    }
}

/// Start, stop, or re-scope the control endpoint for the running application.
///
/// Returns the credential **once**, to the webview that will compare it. It is
/// never returned by `automation_status`, which is the inspectable surface.
/// Any change to `enabled`, `grants` or the document restarts the endpoint, so
/// there is exactly one code path that produces a live host and one that
/// removes it.
#[tauri::command]
pub async fn automation_apply_policy(
    app: tauri::AppHandle,
    enabled: bool,
    grants: String,
    document_id: String,
    document_name: String,
    instance_id: Option<String>,
) -> Result<serde_json::Value, String> {
    if !enabled {
        stop_host().await;
        return Ok(serde_json::json!({ "running": false }));
    }

    let mut guard = state().lock().await;
    let document = DocumentIdentity {
        id: document_id,
        name: document_name,
    };
    // The webview mints the instance id because it also reports it as the
    // session's identity; one value with one source means the discoverable
    // record and `session.hello` cannot disagree about which window a client is
    // attached to.
    let requested_instance = instance_id
        .filter(|value| !value.is_empty())
        .unwrap_or_else(default_instance_id);
    if let Some(hosted) = guard.as_ref() {
        if hosted.grants == grants
            && hosted.document == document
            && hosted.instance_id == requested_instance
        {
            // Nothing changed; do not bounce the socket under connected clients.
            return Ok(serde_json::json!({
                "running": true,
                "endpoint": hosted.host.endpoint().to_string_lossy(),
                "instanceId": hosted.instance_id,
            }));
        }
    }
    if let Some(hosted) = guard.take() {
        hosted.host.shutdown().await;
    }

    let relay: Arc<dyn FrameRelay> = Arc::new(AppRelay { app: app.clone() });
    let instance_id = requested_instance;
    let config = HostConfig {
        runtime_root: varve_automation_host::endpoint::runtime_directory()
            .map_err(|error| format!("runtime directory: {error}"))?,
        identity: InstanceIdentity {
            instance_id: instance_id.clone(),
            app_version: app.package_info().version.to_string(),
            document: document.clone(),
            protocol: CONTROL_PROTOCOL.to_string(),
        },
        relay,
        limits: HostLimits::default(),
        transport: Transport::for_this_platform(),
    };
    // Awaited, never `block_on`: this is an async command already running on the
    // runtime, and blocking a runtime from inside itself panics the task. The
    // panic is not reported to the webview, so the invoke promise never settles
    // and the Settings surface sits at "Starting" forever. Only a launched app
    // shows it; the crate's tests and `cargo check` cannot.
    let host = start(config)
        .await
        .map_err(|error| format!("control endpoint failed to start: {error}"))?;
    write_record(
        &host.directory().join("instance.json"),
        &record_for(&instance_id, &app, &host, &document),
    )
    .map_err(|error| format!("publish instance record: {error}"))?;

    // The credential is handed to the webview exactly once, below, because the
    // webview is what compares it. Keeping a copy here would be a second place
    // it could leak from, for no use.
    let credential = host.token().to_string();
    let endpoint = host.endpoint().to_string_lossy().into_owned();
    *guard = Some(Hosted {
        host,
        instance_id: instance_id.clone(),
        grants,
        document,
    });
    Ok(serde_json::json!({
        "running": true,
        "endpoint": endpoint,
        "instanceId": instance_id,
        // Handed back once, to the webview that will compare it. Never listed.
        "credential": credential,
    }))
}

/// Inspectable status. Carries no credential.
#[tauri::command]
pub async fn automation_status() -> Result<serde_json::Value, String> {
    let guard = state().lock().await;
    match guard.as_ref() {
        Some(hosted) => Ok(serde_json::json!({
            "running": true,
            "endpoint": hosted.host.endpoint().to_string_lossy(),
            "instanceId": hosted.instance_id,
            "grants": hosted.grants,
            "openConnections": hosted.host.open_connections(),
            "documentId": hosted.document.id,
            "documentName": hosted.document.name,
        })),
        None => Ok(serde_json::json!({ "running": false })),
    }
}

/// Close one live connection on the application's behalf.
///
/// The webview owns the protocol and cannot see sockets, so when it ends a
/// session itself (a person disconnects an agent) it has to ask for the socket
/// to be closed. Otherwise the socket, and its place under the connection cap,
/// outlive a session the window has already dropped. Returns whether a live
/// connection by that id was found; an id that is already gone is not an error.
#[tauri::command]
pub async fn automation_close_connection(connection_id: String) -> Result<bool, String> {
    let guard = state().lock().await;
    Ok(guard
        .as_ref()
        .map(|hosted| hosted.host.close_connection(&connection_id))
        .unwrap_or(false))
}

/// The webview's answer to one relayed frame.
///
/// `frame` is the line to write back; `None` closes without writing, which is
/// how the protocol says "stop" without the transport guessing why.
/// `close_after` writes the line and *then* closes, which is the common case:
/// one last explanation followed by an end to the session.
///
/// Returns `false` when nothing was waiting: a late answer to a timed-out
/// question must be visible rather than silently accepted as somebody else's
/// reply.
#[tauri::command]
pub async fn automation_reply(
    request_id: String,
    frame: Option<String>,
    close_after: bool,
) -> Result<bool, String> {
    let sender = waiters()
        .lock()
        .expect("relay waiter map")
        .remove(&request_id);
    match sender {
        Some(sender) => Ok(sender.send((frame, close_after)).is_ok()),
        None => Ok(false),
    }
}

/// Stop the endpoint and remove it from discovery.
#[tauri::command]
pub async fn automation_stop() -> Result<(), String> {
    stop_host().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_day_counts_to_civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(30), (1970, 1, 31));
        assert_eq!(civil_from_days(31), (1970, 2, 1));
        assert_eq!(civil_from_days(58), (1970, 2, 28));
        assert_eq!(civil_from_days(59), (1970, 3, 1));
        assert_eq!(civil_from_days(789), (1972, 2, 29));
    }

    #[test]
    fn formats_a_timestamp_the_cli_can_sort() {
        let stamp = now_iso8601();
        assert!(stamp.ends_with('Z'));
        assert_eq!(stamp.len(), 24, "got {stamp}");
        assert_eq!(stamp.as_bytes()[4], b'-');
        assert_eq!(stamp.as_bytes()[10], b'T');
    }
}

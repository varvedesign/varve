//! App-hosted collaboration sessions (ADR-0200).
//!
//! The desktop app runs the SAME room host as the self-hosted binary,
//! embedded in-process on an OS-assigned loopback port. Sessions started
//! this way are reachable from other applications and browser tabs on this
//! machine; LAN/internet reachability is deliberately NOT wired here —
//! that is the standalone `varve-room-server` with its explicit `--expose`
//! decision. The admin API stays loopback-only and the generated admin
//! token never leaves this process.
//!
//! Two host-lifecycle rules this module exists to keep:
//!
//! 1. **No `block_on`.** These are async Tauri commands, so they already run
//!    inside the Tauri tokio runtime; `Runtime::block_on` there panics
//!    ("Cannot start a runtime from within a runtime"), which took the whole
//!    "Host on this app" path down before it bound a socket. Binding goes
//!    through `varve_room::serve_on_current_runtime`, which binds with
//!    `std::net` and spawns only the accept loop.
//! 2. **Stop really stops, start really restarts.** The registry is a
//!    `Mutex<Option<_>>`, not a `OnceLock`: after `collab_host_stop` the
//!    handle is cleared, so the next `collab_host_start` binds a fresh
//!    listener instead of reporting a dead port. Rooms are durable across the
//!    restart — the same data directory is reopened and clients reconnect by
//!    invite token — but a stale port would strand every invite link.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use tauri::Manager;
use tokio::sync::watch;

use varve_room::{HostConfig, RoomHost};

pub(crate) struct HostedServer {
    pub(crate) host: Arc<RoomHost>,
    pub(crate) port: u16,
    pub(crate) admin_token: String,
    shutdown: watch::Sender<bool>,
}

fn registry() -> &'static Mutex<Option<HostedServer>> {
    static HOSTED: OnceLock<Mutex<Option<HostedServer>>> = OnceLock::new();
    HOSTED.get_or_init(|| Mutex::new(None))
}

fn lock_registry() -> MutexGuard<'static, Option<HostedServer>> {
    registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

static ROOM_COUNTER: AtomicU64 = AtomicU64::new(0);

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app data dir unavailable: {error}"))?;
    Ok(base.join("collab-rooms"))
}

/// Open the embedded host, starting it when it is not running.
///
/// Must be called from within the Tauri async runtime (every command in this
/// module is `async`, so that holds). It never blocks on a nested runtime.
fn ensure_host(app: &tauri::AppHandle) -> Result<(u16, String), String> {
    let mut guard = lock_registry();
    if let Some(hosted) = guard.as_ref() {
        return Ok((hosted.port, hosted.admin_token.clone()));
    }
    let dir = data_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("storage dir: {error}"))?;
    let config = HostConfig {
        admin_token: Some(varve_room::token::mint_token()),
        ..HostConfig::for_data_dir(dir)
    };
    let admin_token = config
        .admin_token
        .clone()
        .ok_or_else(|| "admin token missing".to_string())?;
    let host = varve_room::RoomHost::open(config).map_err(|error| error.to_string())?;
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let address = varve_room::serve_on_current_runtime(
        host.clone(),
        std::net::SocketAddr::from(([127, 0, 0, 1], 0)),
        shutdown_rx,
    )
    .map_err(|error| format!("room host failed to start: {error}"))?;
    *guard = Some(HostedServer {
        host,
        port: address.port(),
        admin_token: admin_token.clone(),
        shutdown: shutdown_tx,
    });
    Ok((address.port(), admin_token))
}

/// Start (or reuse) the embedded loopback room host.
#[tauri::command]
pub async fn collab_host_start(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let (port, _admin_token) = ensure_host(&app)?;
    Ok(serde_json::json!({ "port": port }))
}

/// Host status without side effects (joinability probe from the UI).
#[tauri::command]
pub async fn collab_host_status() -> Result<serde_json::Value, String> {
    // Opening lazily would bind a socket on a mere status check; report
    // not-running and let collab_host_start decide.
    let guard = lock_registry();
    match guard.as_ref() {
        Some(hosted) => Ok(serde_json::json!({ "running": true, "port": hosted.port })),
        None => Ok(serde_json::json!({ "running": false })),
    }
}

/// Create a room seeded with the current document snapshot.
#[tauri::command]
pub async fn collab_room_create(
    app: tauri::AppHandle,
    document_json: String,
) -> Result<serde_json::Value, String> {
    ensure_host(&app)?;
    let counter = ROOM_COUNTER.fetch_add(1, Ordering::Relaxed);
    let doc_id = format!("shared-{}", counter);
    let host = {
        let guard = lock_registry();
        guard
            .as_ref()
            .map(|hosted| hosted.host.clone())
            .ok_or_else(|| "room host unavailable".to_string())?
    };
    let room = host
        .admin_create_room(&doc_id, &document_json)
        .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({
        "roomId": room.room_id,
        "ownerInviteToken": room.owner_invite_token,
    }))
}

/// Mint an invite for a room the app is hosting.
///
/// The app-hosted path previously handed out the OWNER token only, so the
/// host's role enforcement (a viewer cannot mutate) was unreachable through the
/// UI: every link the user shared carried full owner rights.
#[tauri::command]
pub async fn collab_room_invite(
    app: tauri::AppHandle,
    room_id: String,
    role: String,
    expires_in_hours: Option<i64>,
) -> Result<serde_json::Value, String> {
    ensure_host(&app)?;
    let role = match role.as_str() {
        "editor" => varve_room::protocol::ParticipantRole::Editor,
        "viewer" => varve_room::protocol::ParticipantRole::Viewer,
        other => return Err(format!("unsupported invite role: {other}")),
    };
    let host = hosted_room_host()?;
    let expires_at = now_millis() + expires_in_hours.unwrap_or(24 * 7).max(1) * 3_600_000;
    let token = host
        .admin_create_invite(&room_id, role, expires_at)
        .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "inviteToken": token }))
}

/// Revoke an invite. Revocation is an event: matching live sockets end now.
#[tauri::command]
pub async fn collab_room_revoke(invite_token: String) -> Result<serde_json::Value, String> {
    let host = hosted_room_host()?;
    let hash = varve_room::token::token_hash(&invite_token);
    let revoked = host
        .admin_revoke_invite(&hash)
        .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "revoked": revoked }))
}

/// End a hosted room: its stored data is deleted and everyone is disconnected.
#[tauri::command]
pub async fn collab_room_end(room_id: String) -> Result<serde_json::Value, String> {
    let host = hosted_room_host()?;
    let ended = host
        .admin_end_room(&room_id)
        .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "ended": ended }))
}

fn hosted_room_host() -> Result<Arc<RoomHost>, String> {
    let guard = lock_registry();
    guard
        .as_ref()
        .map(|hosted| hosted.host.clone())
        .ok_or_else(|| "room host unavailable".to_string())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

/// Stop the embedded host. Rooms are durable: a later start reopens the same
/// store on a NEW port, and clients reconnect with backoff using their invite
/// tokens. The registry is cleared so the next start binds a live listener
/// rather than reporting a dead port.
#[tauri::command]
pub async fn collab_host_stop() -> Result<serde_json::Value, String> {
    let stopped = lock_registry().take();
    let running = stopped.is_some();
    if let Some(hosted) = stopped {
        let _ = hosted.shutdown.send(true);
    }
    Ok(serde_json::json!({ "running": false, "stopped": running }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The app-hosted bind must work from inside an async runtime. This is
    /// the regression for the `block_on` panic that broke "Host on this app":
    /// binding through `Runtime::block_on` from inside a runtime panics, and
    /// the async Tauri command is always inside one.
    #[tokio::test]
    async fn host_binds_and_serves_inside_a_running_runtime() {
        let dir = std::env::temp_dir().join(format!("varve-collab-host-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let host = RoomHost::open(HostConfig {
            admin_token: Some(varve_room::token::mint_token()),
            ..HostConfig::for_data_dir(dir.clone())
        })
        .expect("host opens");
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let address = varve_room::serve_on_current_runtime(
            host,
            std::net::SocketAddr::from(([127, 0, 0, 1], 0)),
            shutdown_rx,
        )
        .expect("binds inside a runtime");
        assert_ne!(address.port(), 0, "an OS-assigned port is reported back");
        // The listener is live: /health answers while the runtime is entered.
        let health = reqwest_like_get(address.port()).await;
        assert!(health, "the embedded host answers /health");
        let _ = shutdown_tx.send(true);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Minimal HTTP/1.1 GET over the loopback socket; avoids adding a test
    /// HTTP client dependency to the desktop crate.
    async fn reqwest_like_get(port: u16) -> bool {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let Ok(mut stream) = tokio::net::TcpStream::connect(("127.0.0.1", port)).await else {
            return false;
        };
        let request = format!(
            "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
        );
        if stream.write_all(request.as_bytes()).await.is_err() {
            return false;
        }
        let mut response = Vec::new();
        if stream.read_to_end(&mut response).await.is_err() {
            return false;
        }
        String::from_utf8_lossy(&response).contains("200 OK")
    }

    #[test]
    fn the_registry_clears_on_stop_so_the_next_start_rebinds() {
        // Mirrors collab_host_stop's contract without a Tauri app handle.
        {
            let mut guard = lock_registry();
            *guard = Some(HostedServer {
                host: RoomHost::open(HostConfig {
                    admin_token: Some("t".to_string()),
                    ..HostConfig::for_data_dir(std::env::temp_dir().join("varve-collab-registry"))
                })
                .expect("host opens"),
                port: 43210,
                admin_token: "t".to_string(),
                shutdown: watch::channel(false).0,
            });
            assert!(guard.is_some());
        }
        let stopped = lock_registry().take();
        assert!(stopped.is_some(), "stop clears the registry");
        assert!(lock_registry().is_none(), "a later start sees no live host");
    }
}

//! App-hosted collaboration sessions (ADR-0200).
//!
//! The desktop app runs the SAME room host as the self-hosted binary,
//! embedded in-process on an OS-assigned loopback port. Sessions started
//! this way are reachable from other applications and browser tabs on this
//! machine; LAN/internet reachability is deliberately NOT wired here —
//! that is the standalone `varve-room-server` with its explicit `--expose`
//! decision. The admin API stays loopback-only and the generated admin
//! token never leaves this process unless the caller asks for it.

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::Manager;
use tokio::sync::watch;

use varve_room::{HostConfig, RoomHost};

struct HostedServer {
    host: Arc<RoomHost>,
    port: u16,
    admin_token: String,
    shutdown: watch::Sender<bool>,
}

static HOSTED: OnceLock<HostedServer> = OnceLock::new();
static ROOM_COUNTER: AtomicU64 = AtomicU64::new(0);

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app data dir unavailable: {error}"))?;
    Ok(base.join("collab-rooms"))
}

fn open_host(app: &tauri::AppHandle) -> Result<&'static HostedServer, String> {
    if let Some(hosted) = HOSTED.get() {
        return Ok(hosted);
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
    let address = tauri::async_runtime::block_on(varve_room::serve(
        host.clone(),
        std::net::SocketAddr::from(([127, 0, 0, 1], 0)),
        shutdown_rx,
    ))
    .map_err(|error| format!("room host failed to start: {error}"))?;
    let _ = HOSTED.set(HostedServer {
        host,
        port: address.port(),
        admin_token,
        shutdown: shutdown_tx,
    });
    HOSTED.get().ok_or_else(|| "room host unavailable".to_string())
}

/// Start (or reuse) the embedded loopback room host.
#[tauri::command]
pub async fn collab_host_start(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let hosted = open_host(&app)?;
    Ok(serde_json::json!({ "port": hosted.port }))
}

/// Host status without side effects (joinability probe from the UI).
#[tauri::command]
pub async fn collab_host_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    match HOSTED.get() {
        Some(hosted) => Ok(serde_json::json!({ "running": true, "port": hosted.port })),
        None => {
            // Opening lazily would bind a socket on a mere status check;
            // report not-running and let collab_host_start decide.
            let _ = app;
            Ok(serde_json::json!({ "running": false }))
        }
    }
}

/// Create a room seeded with the current document snapshot.
#[tauri::command]
pub async fn collab_room_create(
    app: tauri::AppHandle,
    document_json: String,
) -> Result<serde_json::Value, String> {
    let hosted = open_host(&app)?;
    let counter = ROOM_COUNTER.fetch_add(1, Ordering::Relaxed);
    let doc_id = format!("shared-{}", counter);
    let room = hosted
        .host
        .admin_create_room(&doc_id, &document_json)
        .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({
        "roomId": room.room_id,
        "ownerInviteToken": room.owner_invite_token,
    }))
}

/// Stop the embedded host. Rooms are durable: a later start reopens the
/// same store and live clients reconnect with backoff.
#[tauri::command]
pub async fn collab_host_stop() -> Result<(), String> {
    if let Some(hosted) = HOSTED.get() {
        let _ = hosted.shutdown.send(true);
    }
    Ok(())
}

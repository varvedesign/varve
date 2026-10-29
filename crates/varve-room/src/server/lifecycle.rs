//! Listener binding, graceful-shutdown accept loop, host-lock heartbeat, and
//! the public serve entry points.

use super::host::{RoomHost, HOST_LOCK_REFRESH_MS};
use super::http::router;
use super::prelude::*;
use super::state::{lock, now_ms};

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

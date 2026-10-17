//! The host: one local endpoint, bounded framing, and a relay to the app.
//!
//! Responsibilities, and deliberately nothing more:
//!
//! - bind an owner-only endpoint and publish an instance record a client can
//!   find (`varve instances`);
//! - enforce byte limits, a handshake deadline and a connection cap;
//! - move complete lines to the application and write back what it returns;
//! - remove the endpoint when it stops.
//!
//! It does not authenticate, authorize, validate payloads or decide success.
//! The credential is *carried* to the application, which compares it; grants,
//! idempotency and receipts are the application's. A transport that decided any
//! of those would be a second place for the security rules to be wrong.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{watch, Mutex};
use tokio::task::JoinSet;

use crate::endpoint::{
    create_endpoint_at, write_record, AppIdentity, CreatedEndpoint, DocumentIdentity,
    InstanceRecord, Transport, INSTANCE_SCHEMA,
};
use crate::framing::{FrameEvent, LineFramer};
use crate::relay::{ConnectionId, FrameRelay, RelayOutcome, TransportError};

/// Transport limits. These bound memory and time; they are not policy.
#[derive(Debug, Clone)]
pub struct HostLimits {
    /// Largest accepted line after the handshake.
    pub max_frame_bytes: usize,
    /// Largest accepted line before the session is established.
    ///
    /// Enforced until the first complete line arrives, not until the application
    /// has accepted the handshake: the transport cannot know that a line *was* a
    /// valid handshake, and it must not decide protocol. The residual window is
    /// bounded and is not an authority weakness — an unauthenticated peer can
    /// hold at most one buffer of this size while the protocol refuses it, and a
    /// non-answering application is cut off by the relay's own deadline.
    pub max_hello_bytes: usize,
    /// How long a connection has to send its first complete frame.
    pub hello_timeout: Duration,
    /// Concurrent connections the endpoint will hold open.
    pub max_connections: usize,
    /// Largest reply the transport will write back.
    pub max_response_bytes: usize,
    /// How long one reply may take to write. A peer that stops reading would
    /// otherwise hold its connection slot, and with a small cap a few of them
    /// turn real clients away.
    pub write_timeout: Duration,
}

impl Default for HostLimits {
    fn default() -> Self {
        Self {
            max_frame_bytes: 4 * 1024 * 1024,
            max_hello_bytes: 4 * 1024,
            hello_timeout: Duration::from_secs(5),
            max_connections: 8,
            max_response_bytes: 16 * 1024 * 1024,
            write_timeout: Duration::from_secs(30),
        }
    }
}

#[derive(Debug, Clone)]
pub struct InstanceIdentity {
    pub instance_id: String,
    /// Version of the application, for the instance record.
    pub app_version: String,
    pub document: DocumentIdentity,
    pub protocol: String,
}

pub struct HostConfig {
    pub runtime_root: PathBuf,
    pub identity: InstanceIdentity,
    pub relay: Arc<dyn FrameRelay>,
    pub limits: HostLimits,
    /// Transport to bind. Defaults to the one this platform can provide.
    pub transport: Transport,
}

/// A bound endpoint. Dropping it without `shutdown` leaves the directory in
/// place, so callers should prefer `shutdown`.
pub struct RunningHost {
    created: CreatedEndpoint,
    stop: watch::Sender<bool>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    active: Arc<AtomicUsize>,
}

impl RunningHost {
    pub fn endpoint(&self) -> &Path {
        &self.created.endpoint
    }

    /// The credential a client must present in its first frame.
    pub fn token(&self) -> &str {
        &self.created.token
    }

    pub fn directory(&self) -> &Path {
        &self.created.dir
    }

    pub fn open_connections(&self) -> usize {
        self.active.load(Ordering::SeqCst)
    }

    /// Stop accepting, close live connections, and remove the endpoint.
    pub async fn shutdown(self) {
        let _ = self.stop.send(true);
        if let Some(task) = self.task.lock().await.take() {
            // The accept loop aborts its connection tasks before returning.
            let _ = tokio::time::timeout(Duration::from_secs(5), task).await;
        }
        let _ = std::fs::remove_dir_all(&self.created.dir);
    }
}

pub async fn start(config: HostConfig) -> io::Result<RunningHost> {
    let created = create_endpoint_at(
        &config.runtime_root,
        &config.identity.instance_id,
        config.transport,
    )?;

    let listener = match bind(&created)? {
        Some(listener) => listener,
        None => {
            let _ = std::fs::remove_dir_all(&created.dir);
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "no usable local transport on this platform",
            ));
        }
    };

    let record = InstanceRecord {
        schema: INSTANCE_SCHEMA.to_string(),
        instance_id: config.identity.instance_id.clone(),
        mode: "connected".to_string(),
        pid: std::process::id(),
        started_at: now_iso8601(),
        app: AppIdentity {
            name: "Varve".to_string(),
            version: config.identity.app_version.clone(),
        },
        protocol: config.identity.protocol.clone(),
        endpoint: created.endpoint.to_string_lossy().into_owned(),
        token_file: created.token_file.to_string_lossy().into_owned(),
        document: config.identity.document.clone(),
    };
    if let Err(error) = write_record(&created.record_path, &record) {
        let _ = std::fs::remove_dir_all(&created.dir);
        return Err(error);
    }

    let (stop, stop_rx) = watch::channel(false);
    let active = Arc::new(AtomicUsize::new(0));
    let relay = Arc::clone(&config.relay);
    let limits = config.limits.clone();
    let active_for_loop = Arc::clone(&active);
    let directory = created.dir.clone();

    let task = tokio::spawn(async move {
        accept_loop(listener, relay, limits, active_for_loop, stop_rx, directory).await;
    });

    Ok(RunningHost {
        created,
        stop,
        task: Mutex::new(Some(task)),
        active,
    })
}

#[cfg(unix)]
type Listener = tokio::net::UnixListener;

#[cfg(unix)]
fn bind(created: &CreatedEndpoint) -> io::Result<Option<Listener>> {
    use std::os::unix::fs::PermissionsExt;
    // A stale socket file would make bind fail with AddrInUse; the instance
    // directory was just created, so anything here is ours to remove.
    if created.endpoint.exists() {
        let _ = std::fs::remove_file(&created.endpoint);
    }
    let listener = tokio::net::UnixListener::bind(&created.endpoint)?;
    // The directory mode is the real access control; the socket mode is a
    // second, cheap one for tools that ignore the directory.
    std::fs::set_permissions(&created.endpoint, std::fs::Permissions::from_mode(0o600))?;
    Ok(Some(listener))
}

#[cfg(not(unix))]
type Listener = ();

#[cfg(not(unix))]
fn bind(_created: &CreatedEndpoint) -> io::Result<Option<Listener>> {
    Ok(None)
}

#[cfg(unix)]
async fn accept_loop(
    listener: Listener,
    relay: Arc<dyn FrameRelay>,
    limits: HostLimits,
    active: Arc<AtomicUsize>,
    mut stop: watch::Receiver<bool>,
    directory: PathBuf,
) {
    let mut connections: JoinSet<()> = JoinSet::new();
    let mut ordinal: u64 = 0;
    loop {
        tokio::select! {
            _ = stop.changed() => break,
            accepted = listener.accept() => {
                let Ok((stream, _addr)) = accepted else { continue };
                if active.load(Ordering::SeqCst) >= limits.max_connections {
                    // Refuse by closing: the connection cap is a resource
                    // guard, and the client's own retry/timeout path reports it.
                    drop(stream);
                    continue;
                }
                ordinal += 1;
                let id = ConnectionId::new(format!("c{ordinal}"));
                let relay = Arc::clone(&relay);
                let limits = limits.clone();
                let active = Arc::clone(&active);
                active.fetch_add(1, Ordering::SeqCst);
                connections.spawn(async move {
                    serve_connection(stream, id.clone(), Arc::clone(&relay), limits).await;
                    // However it ended, tell the application: it holds a session
                    // for this connection and cannot otherwise tell it is gone.
                    relay.connection_closed(id);
                    active.fetch_sub(1, Ordering::SeqCst);
                });
                // Reap finished connections so the set does not grow forever.
                while connections.try_join_next().is_some() {}
            }
        }
    }
    connections.abort_all();
    while connections.join_next().await.is_some() {}
    let _ = std::fs::remove_dir_all(&directory);
}

#[cfg(unix)]
async fn serve_connection(
    stream: tokio::net::UnixStream,
    id: ConnectionId,
    relay: Arc<dyn FrameRelay>,
    limits: HostLimits,
) {
    let (mut reader, mut writer) = stream.into_split();
    let mut framer = LineFramer::staged(limits.max_hello_bytes, limits.max_frame_bytes);
    let mut buffer = vec![0u8; 8192];
    let mut greeted = false;
    let deadline = tokio::time::Instant::now() + limits.hello_timeout;

    loop {
        let read = if greeted {
            reader.read(&mut buffer).await
        } else {
            match tokio::time::timeout_at(deadline, reader.read(&mut buffer)).await {
                Ok(result) => result,
                Err(_) => {
                    // No frame in time. The protocol's own error text is
                    // available through the relay; without it, close.
                    if let Some(frame) = relay
                        .transport_error(id.clone(), TransportError::HelloTimeout)
                        .await
                    {
                        let _ = write_frame(&mut writer, &frame, &limits).await;
                    }
                    return;
                }
            }
        };
        let Ok(count) = read else { return };
        if count == 0 {
            return; // client closed
        }
        let mut events = Vec::new();
        framer.push(&buffer[..count], &mut events);
        for event in events {
            match event {
                FrameEvent::Line(line) => {
                    // The framer widens its own limit the moment this first line
                    // is complete, so anything that arrived in the same packet
                    // was already judged by the wider one.
                    greeted = true;
                    match relay.deliver(id.clone(), line).await {
                        RelayOutcome::Reply(response) => {
                            if !write_bounded(&mut writer, &response, &limits, &relay, &id).await {
                                return;
                            }
                        }
                        RelayOutcome::ReplyAndClose(response) => {
                            let _ =
                                write_bounded(&mut writer, &response, &limits, &relay, &id).await;
                            let _ = writer.shutdown().await;
                            return;
                        }
                        RelayOutcome::Nothing => {}
                        RelayOutcome::Close => {
                            let _ = writer.shutdown().await;
                            return;
                        }
                    }
                }
                FrameEvent::Oversize => {
                    if let Some(frame) = relay
                        .transport_error(
                            id.clone(),
                            TransportError::FrameTooLarge {
                                limit: framer.limit(),
                                before_hello: !greeted,
                            },
                        )
                        .await
                    {
                        let _ = write_frame(&mut writer, &frame, &limits).await;
                    }
                    let _ = writer.shutdown().await;
                    return;
                }
                FrameEvent::InvalidUtf8 => {
                    if let Some(frame) = relay
                        .transport_error(id.clone(), TransportError::InvalidUtf8)
                        .await
                    {
                        let _ = write_frame(&mut writer, &frame, &limits).await;
                    }
                    let _ = writer.shutdown().await;
                    return;
                }
            }
        }
    }
}

/// Write a reply, or report that it is too large to write.
///
/// The size is checked before anything is written, so the socket never carries a
/// truncated frame, and the refusal is phrased by the application rather than by
/// the transport.
#[cfg(unix)]
async fn write_bounded(
    writer: &mut tokio::net::unix::OwnedWriteHalf,
    frame: &str,
    limits: &HostLimits,
    relay: &Arc<dyn FrameRelay>,
    id: &ConnectionId,
) -> bool {
    if frame.len() <= limits.max_response_bytes {
        return write_frame(writer, frame, limits).await.is_ok();
    }
    if let Some(notice) = relay
        .transport_error(
            id.clone(),
            TransportError::ResponseTooLarge {
                limit: limits.max_response_bytes,
            },
        )
        .await
    {
        let _ = write_frame(writer, &notice, limits).await;
    }
    let _ = writer.shutdown().await;
    false
}

#[cfg(unix)]
async fn write_frame(
    writer: &mut tokio::net::unix::OwnedWriteHalf,
    frame: &str,
    limits: &HostLimits,
) -> io::Result<()> {
    if frame.len() > limits.max_response_bytes {
        // The application already bounds its own replies; this is the transport
        // refusing to become the way around that.
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "response exceeds the transport limit",
        ));
    }
    // One deadline for the whole reply. A peer that stops reading must not hold
    // the connection (and its slot) forever; closing is the only honest answer.
    let write = async {
        writer.write_all(frame.as_bytes()).await?;
        writer.write_all(b"\n").await?;
        writer.flush().await
    };
    match tokio::time::timeout(limits.write_timeout, write).await {
        Ok(result) => result,
        Err(_) => Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "the peer did not read its reply in time",
        )),
    }
}

fn now_iso8601() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // Seconds precision on the date part is enough for ordering instances;
    // the CLI only sorts on this string.
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

/// Howard Hinnant's days-to-civil algorithm, so no date dependency is needed.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_day_counts_to_civil_dates() {
        // Anchors chosen so each one is checkable by hand, including the two
        // places this algorithm is easy to get wrong: the non-leap February in
        // 1970 and the leap day in 1972.
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(1), (1970, 1, 2));
        assert_eq!(civil_from_days(30), (1970, 1, 31));
        assert_eq!(civil_from_days(31), (1970, 2, 1));
        assert_eq!(civil_from_days(58), (1970, 2, 28));
        assert_eq!(civil_from_days(59), (1970, 3, 1));
        assert_eq!(civil_from_days(730), (1972, 1, 1));
        assert_eq!(civil_from_days(789), (1972, 2, 29));
        assert_eq!(civil_from_days(790), (1972, 3, 1));
    }

    #[test]
    fn formats_the_timestamp_the_cli_sorts_on() {
        let stamp = now_iso8601();
        assert!(stamp.ends_with('Z'));
        assert_eq!(
            stamp.len(),
            24,
            "expected 2026-10-15T00:00:00.000Z, got {stamp}"
        );
        // The date part must agree with the conversion the record is built from.
        let (year, month, day) = civil_from_days(0);
        assert_eq!(format!("{year:04}-{month:02}-{day:02}"), "1970-01-01");
    }
}

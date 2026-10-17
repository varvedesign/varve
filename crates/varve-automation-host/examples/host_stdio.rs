//! A host that relays over stdio, so the endpoint can be driven by a test
//! process instead of by a webview.
//!
//! This exists because the riskiest seam in the design is the one between two
//! languages: the Rust transport decides framing and limits, the TypeScript
//! protocol decides what a frame means, and the only thing joining them is the
//! shape of the relay payloads. Both defects found while wiring the desktop
//! bridge were exactly that class — a decision one side could make and the
//! other could not represent.
//!
//! The payloads are deliberately the ones the Tauri adapter emits, so a test
//! driving this binary exercises the real shapes rather than a simplified copy:
//!
//! ```text
//! host -> harness   {"kind":"frame","connectionId":"c1","requestId":"s1","frame":"…"}
//!                   {"kind":"transport-error","connectionId":"c1","requestId":"s2","error":{"kind":"hello-timeout"}}
//! harness -> host   {"kind":"reply","requestId":"s1","frame":"…","closeAfter":false}
//!                   {"kind":"reply","requestId":"s1","frame":null,"closeAfter":true}
//! ```
//!
//! The endpoint path is printed as `ENDPOINT <path>` on the first line, which is
//! the only line that is not a relay payload.
//!
//! Run with `cargo run -p varve-automation-host --example host_stdio -- <root>`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use futures_util::future::{BoxFuture, FutureExt};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

use varve_automation_host::endpoint::{DocumentIdentity, Transport};
use varve_automation_host::relay::{ConnectionId, FrameRelay, RelayOutcome, TransportError};
use varve_automation_host::server::{start, HostConfig, HostLimits, InstanceIdentity};

/// What the harness answered: the frame to write (if any) and whether to stop.
type PendingReply = oneshot::Sender<(Option<String>, bool)>;

struct RelayInner {
    writer: AsyncMutex<tokio::io::Stdout>,
    pending: Mutex<HashMap<String, PendingReply>>,
    next: Mutex<u64>,
}

impl RelayInner {
    /// Send one question and wait for the harness's answer.
    async fn ask(&self, mut payload: serde_json::Value) -> Option<(Option<String>, bool)> {
        let request_id = {
            let mut next = self.next.lock().expect("request counter");
            *next += 1;
            format!("s{}", *next)
        };
        let (sender, receiver) = oneshot::channel();
        if let Some(map) = payload.as_object_mut() {
            map.insert(
                "requestId".into(),
                serde_json::Value::String(request_id.clone()),
            );
        }
        self.pending
            .lock()
            .expect("pending map")
            .insert(request_id.clone(), sender);
        {
            let mut out = self.writer.lock().await;
            let line = format!("{payload}\n");
            if out.write_all(line.as_bytes()).await.is_err() {
                return None;
            }
            if out.flush().await.is_err() {
                return None;
            }
        }
        // No timeout: the harness is a test process, and a hang is a clearer
        // failure here than a connection that quietly closes.
        let answer = receiver.await.ok();
        self.pending
            .lock()
            .expect("pending map")
            .remove(&request_id);
        answer
    }
}

struct StdioRelay {
    inner: Arc<RelayInner>,
}

fn describe(error: &TransportError) -> serde_json::Value {
    match error {
        TransportError::FrameTooLarge {
            limit,
            before_hello,
        } => {
            serde_json::json!({ "kind": "frame-too-large", "limit": limit, "beforeHello": before_hello })
        }
        TransportError::InvalidUtf8 => serde_json::json!({ "kind": "invalid-utf8" }),
        TransportError::HelloTimeout => serde_json::json!({ "kind": "hello-timeout" }),
        TransportError::ResponseTooLarge { limit } => {
            serde_json::json!({ "kind": "response-too-large", "limit": limit })
        }
    }
}

impl FrameRelay for StdioRelay {
    fn deliver(&self, connection: ConnectionId, frame: String) -> BoxFuture<'static, RelayOutcome> {
        let inner = Arc::clone(&self.inner);
        let payload = serde_json::json!({
            "kind": "frame",
            "connectionId": connection.as_str(),
            "frame": frame,
        });
        async move {
            // The same total mapping the desktop adapter uses, so an outcome one
            // side cannot represent is a test failure rather than a surprise.
            match inner.ask(payload).await {
                Some((Some(frame), false)) => RelayOutcome::Reply(frame),
                Some((Some(frame), true)) => RelayOutcome::ReplyAndClose(frame),
                Some((None, false)) => RelayOutcome::Nothing,
                Some((None, true)) => RelayOutcome::Close,
                None => RelayOutcome::Close,
            }
        }
        .boxed()
    }

    fn connection_closed(&self, connection: ConnectionId) {
        // Fire-and-forget: there is no reply to wait for, so no request id.
        let inner = Arc::clone(&self.inner);
        let line = format!(
            "{}\n",
            serde_json::json!({ "kind": "closed", "connectionId": connection.as_str() })
        );
        tokio::spawn(async move {
            let mut out = inner.writer.lock().await;
            let _ = out.write_all(line.as_bytes()).await;
            let _ = out.flush().await;
        });
    }

    fn transport_error(
        &self,
        connection: ConnectionId,
        error: TransportError,
    ) -> BoxFuture<'static, Option<String>> {
        let inner = Arc::clone(&self.inner);
        let payload = serde_json::json!({
            "kind": "transport-error",
            "connectionId": connection.as_str(),
            "error": describe(&error),
        });
        async move { inner.ask(payload).await.and_then(|(frame, _)| frame) }.boxed()
    }
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("usage: host_stdio <runtime-root>");
    let instance_id =
        std::env::var("VARVE_TEST_INSTANCE").unwrap_or_else(|_| "stdio-1".to_string());
    let document_name =
        std::env::var("VARVE_TEST_DOCUMENT").unwrap_or_else(|_| "Stdio".to_string());

    let inner = Arc::new(RelayInner {
        writer: AsyncMutex::new(tokio::io::stdout()),
        pending: Mutex::new(HashMap::new()),
        next: Mutex::new(0),
    });

    let host = start(HostConfig {
        runtime_root: PathBuf::from(root),
        identity: InstanceIdentity {
            instance_id,
            app_version: "0.0.0-stdio".to_string(),
            document: DocumentIdentity {
                id: "doc-stdio".to_string(),
                name: document_name,
            },
            protocol: "varve.control/1".to_string(),
        },
        relay: Arc::new(StdioRelay {
            inner: Arc::clone(&inner),
        }),
        limits: HostLimits::default(),
        transport: Transport::UnixSocket,
    })
    .await
    .expect("host start");

    // One non-payload line, prefixed so the two can never be confused.
    println!("ENDPOINT {}", host.endpoint().to_string_lossy());

    let reader_inner = Arc::clone(&inner);
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        // The application ended a session on its own (a person disconnected an
        // agent): close that socket, as the desktop app's
        // `automation_close_connection` command does.
        if value.get("kind").and_then(|k| k.as_str()) == Some("close") {
            if let Some(id) = value.get("connectionId").and_then(|c| c.as_str()) {
                host.close_connection(id);
            }
            continue;
        }
        let Some(request_id) = value.get("requestId").and_then(|r| r.as_str()) else {
            continue;
        };
        let frame = value
            .get("frame")
            .and_then(|f| f.as_str())
            .map(|f| f.to_string());
        let close_after = value
            .get("closeAfter")
            .and_then(|c| c.as_bool())
            .unwrap_or(false);
        let sender = reader_inner
            .pending
            .lock()
            .expect("pending map")
            .remove(request_id);
        if let Some(sender) = sender {
            let _ = sender.send((frame, close_after));
        }
    }

    // stdin closed: the harness is gone, so stop and clean up the endpoint.
    host.shutdown().await;
}

//! End-to-end transport tests over a real socket.
//!
//! These connect a real client to a real bound endpoint and assert what the
//! transport does, not what a helper returns. The relay stands in for the
//! application, so these tests say nothing about the protocol — only about the
//! ring around it.

#![cfg(unix)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::{ready, BoxFuture, FutureExt};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;

use varve_automation_host::endpoint::{DocumentIdentity, InstanceRecord, Transport};
use varve_automation_host::relay::{ConnectionId, FrameRelay, RelayOutcome, TransportError};
use varve_automation_host::server::{start, HostConfig, HostLimits, InstanceIdentity, RunningHost};

/// Records what it was asked to relay and answers with a scripted reply.
#[derive(Default)]
struct TestRelay {
    seen: Mutex<Vec<(String, String)>>,
    error_frames: Mutex<Vec<String>>,
    /// Reply per delivery; the last entry repeats once exhausted.
    replies: Mutex<Vec<RelayOutcome>>,
    delivered: AtomicUsize,
    answer_transport_errors: bool,
}

impl TestRelay {
    fn with_replies(replies: Vec<RelayOutcome>) -> Arc<Self> {
        Arc::new(Self {
            replies: Mutex::new(replies),
            ..Default::default()
        })
    }

    /// Replies with a frame of a chosen size, and answers transport errors.
    fn with_big_reply(bytes: usize) -> Arc<Self> {
        Arc::new(Self {
            replies: Mutex::new(vec![RelayOutcome::Reply(format!(
                "{{\"pad\":\"{}\"}}",
                "z".repeat(bytes)
            ))]),
            answer_transport_errors: true,
            ..Default::default()
        })
    }

    fn answering_transport_errors() -> Arc<Self> {
        Arc::new(Self {
            answer_transport_errors: true,
            ..Default::default()
        })
    }

    fn frames(&self) -> Vec<(String, String)> {
        self.seen.lock().unwrap().clone()
    }
}

impl FrameRelay for TestRelay {
    fn deliver(&self, connection: ConnectionId, frame: String) -> BoxFuture<'static, RelayOutcome> {
        let index = self.delivered.fetch_add(1, Ordering::SeqCst);
        self.seen
            .lock()
            .unwrap()
            .push((connection.as_str().to_string(), frame));
        let replies = self.replies.lock().unwrap();
        let outcome = replies
            .get(index)
            .or_else(|| replies.last())
            .cloned()
            .unwrap_or(RelayOutcome::Reply("{\"ok\":true}".to_string()));
        ready(outcome).boxed()
    }

    fn transport_error(
        &self,
        _connection: ConnectionId,
        error: TransportError,
    ) -> BoxFuture<'static, Option<String>> {
        if !self.answer_transport_errors {
            return ready(None).boxed();
        }
        let frame = match error {
            TransportError::FrameTooLarge { limit, before_hello } => format!(
                "{{\"error\":{{\"code\":-32003,\"limit\":{limit},\"preHello\":{before_hello}}}}}"
            ),
            TransportError::InvalidUtf8 => "{\"error\":{\"code\":-32700}}".to_string(),
            TransportError::HelloTimeout => "{\"error\":{\"code\":-32002}}".to_string(),
            TransportError::ResponseTooLarge { limit } => {
                format!("{{\"error\":{{\"code\":-32005,\"limit\":{limit}}}}}")
            }
        };
        self.error_frames.lock().unwrap().push(frame.clone());
        ready(Some(frame)).boxed()
    }
}

struct Harness {
    host: RunningHost,
    root: PathBuf,
    relay: Arc<TestRelay>,
}

impl Harness {
    async fn start(replies: Vec<RelayOutcome>, limits: HostLimits) -> Self {
        Self::start_with(TestRelay::with_replies(replies), limits, "harness").await
    }

    async fn start_with(relay: Arc<TestRelay>, limits: HostLimits, name: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "varve-ah-host-test-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let host = start(HostConfig {
            runtime_root: root.clone(),
            identity: InstanceIdentity {
                instance_id: format!("test-{name}"),
                app_version: "0.0.0-test".to_string(),
                document: DocumentIdentity { id: "doc-1".into(), name: "Poster".into() },
                protocol: "varve.control/1".to_string(),
            },
            relay: relay.clone(),
            limits,
            transport: Transport::UnixSocket,
        })
        .await
        .expect("host start");
        Self { host, root, relay }
    }

    fn record(&self) -> InstanceRecord {
        let raw = std::fs::read_to_string(self.host.directory().join("instance.json")).unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    /// A connected client, split so the reader and writer are independent.
    async fn connect(&self) -> (BufReader<OwnedReadHalf>, OwnedWriteHalf) {
        let stream = UnixStream::connect(self.host.endpoint()).await.expect("connect");
        let (read, write) = stream.into_split();
        (BufReader::new(read), write)
    }
}

fn limits() -> HostLimits {
    HostLimits {
        hello_timeout: Duration::from_millis(400),
        ..HostLimits::default()
    }
}

async fn write_line(stream: &mut OwnedWriteHalf, line: &str) {
    stream.write_all(line.as_bytes()).await.unwrap();
    stream.write_all(b"\n").await.unwrap();
    stream.flush().await.unwrap();
}

#[tokio::test]
async fn publishes_a_discoverable_endpoint_and_relays_a_frame_to_a_reply() {
    let harness = Harness::start(vec![RelayOutcome::Reply("{\"result\":{}}".into())], limits()).await;

    // The instance record is what `varve instances` reads.
    let record = harness.record();
    assert_eq!(record.schema, "varve.instance/1");
    assert_eq!(record.mode, "connected");
    assert_eq!(record.protocol, "varve.control/1");
    assert_eq!(record.document.name, "Poster");
    assert_eq!(record.endpoint, harness.host.endpoint().to_string_lossy());
    assert!(
        !std::fs::read_to_string(harness.host.directory().join("instance.json"))
            .unwrap()
            .contains(harness.host.token()),
        "the discoverable record must not carry the credential"
    );

    let (mut reader, mut stream) = harness.connect().await;
    write_line(&mut stream, "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.hello\"}").await;

    let mut reply = String::new();
    reader.read_line(&mut reply).await.unwrap();
    assert_eq!(reply.trim_end(), "{\"result\":{}}");

    let frames = harness.relay.frames();
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].0, "c1");
    // The transport passes the frame through byte for byte; it does not
    // inspect, rewrite or authenticate it.
    assert_eq!(
        frames[0].1,
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session.hello\"}"
    );

    let directory = harness.host.directory().to_path_buf();
    harness.host.shutdown().await;
    assert!(!directory.exists(), "the endpoint directory is removed on shutdown");
}

#[tokio::test]
async fn keeps_connections_independent_and_ordered_within_one() {
    let harness = Harness::start(
        vec![
            RelayOutcome::Reply("{\"n\":1}".into()),
            RelayOutcome::Reply("{\"n\":2}".into()),
        ],
        limits(),
    )
    .await;

    let (mut first_reader, mut first) = harness.connect().await;
    let (mut second_reader, mut second) = harness.connect().await;

    write_line(&mut first, "one").await;
    write_line(&mut second, "two").await;
    write_line(&mut first, "three").await;

    let mut a = String::new();
    first_reader.read_line(&mut a).await.unwrap();
    let mut b = String::new();
    second_reader.read_line(&mut b).await.unwrap();
    let mut c = String::new();
    first_reader.read_line(&mut c).await.unwrap();

    assert_eq!(a.trim_end(), "{\"n\":1}");
    assert_eq!(b.trim_end(), "{\"n\":2}");
    assert_eq!(c.trim_end(), "{\"n\":2}", "the last reply repeats");

    let frames = harness.relay.frames();
    let ids: Vec<&str> = frames.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(ids.iter().filter(|id| **id == "c1").count(), 2);
    assert_eq!(ids.iter().filter(|id| **id == "c2").count(), 1);
    let _ = harness.host.shutdown().await;
}

#[tokio::test]
async fn reports_a_reply_it_cannot_write_instead_of_closing_in_silence() {
    // The limit sits above the size of the protocol's own refusal frame and well
    // below the reply, which is the real-world relationship: a limit tight
    // enough to reject its own error message would be unusable.
    let relay = TestRelay::with_big_reply(4096);
    let harness = Harness::start_with(
        Arc::clone(&relay),
        HostLimits {
            max_response_bytes: 256,
            hello_timeout: Duration::from_millis(400),
            ..HostLimits::default()
        },
        "bigreply",
    )
    .await;

    let (mut reader, mut stream) = harness.connect().await;
    write_line(&mut stream, "{\"jsonrpc\":\"2.0\",\"id\":1}").await;
    let mut reply = String::new();
    reader.read_line(&mut reply).await.unwrap();
    // The command behind this reply may already have applied, so the client must
    // be told the reply was too large rather than left with a bare EOF and an
    // unknown outcome.
    assert!(reply.contains("-32005"), "got {reply}");
    assert!(
        reply.len() <= 256,
        "the refusal itself must fit the limit it reports"
    );
    assert_eq!(reader.read_line(&mut String::new()).await.unwrap(), 0);
    let _ = harness.host.shutdown().await;
}

#[tokio::test]
async fn a_nothing_outcome_keeps_the_connection_open_without_a_reply() {
    // First frame: no reply at all (a notification). Second: the connection is
    // still usable, which is the point.
    let harness = Harness::start(
        vec![RelayOutcome::Nothing, RelayOutcome::Reply("{\"after\":true}".into())],
        limits(),
    )
    .await;
    let (mut reader, mut stream) = harness.connect().await;
    write_line(&mut stream, "{\"method\":\"note\",\"no\":\"id\"}").await;
    write_line(&mut stream, "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\"}").await;
    let mut reply = String::new();
    reader.read_line(&mut reply).await.unwrap();
    assert_eq!(reply.trim_end(), "{\"after\":true}");
    assert_eq!(harness.relay.frames().len(), 2);
    let _ = harness.host.shutdown().await;
}

#[tokio::test]
async fn a_reply_and_close_outcome_writes_the_last_word_then_closes() {
    let harness = Harness::start(
        vec![RelayOutcome::ReplyAndClose("{\"byebye\":true}".into())],
        limits(),
    )
    .await;
    let (mut reader, mut stream) = harness.connect().await;
    write_line(&mut stream, "hello").await;
    let mut reply = String::new();
    reader.read_line(&mut reply).await.unwrap();
    assert_eq!(reply.trim_end(), "{\"byebye\":true}");
    // And then the socket is closed rather than left open.
    let mut after = String::new();
    assert_eq!(reader.read_line(&mut after).await.unwrap(), 0);
    let _ = harness.host.shutdown().await;
}

#[tokio::test]
async fn a_close_outcome_ends_the_connection_without_writing() {
    let harness = Harness::start(vec![RelayOutcome::Close], limits()).await;
    let (mut reader, mut stream) = harness.connect().await;
    write_line(&mut stream, "hello").await;
    let mut reply = String::new();
    // EOF rather than a frame: the application said stop, and the transport
    // has no business inventing a farewell.
    assert_eq!(reader.read_line(&mut reply).await.unwrap(), 0);
    let _ = harness.host.shutdown().await;
}

#[tokio::test]
async fn refuses_an_oversize_first_frame_and_asks_the_app_for_the_error_text() {
    let relay = TestRelay::answering_transport_errors();
    let harness = Harness::start_with(
        Arc::clone(&relay),
        HostLimits { max_hello_bytes: 16, hello_timeout: Duration::from_millis(400), ..HostLimits::default() },
        "oversize",
    )
    .await;

    let (mut reader, mut stream) = harness.connect().await;
    write_line(&mut stream, &"x".repeat(64)).await;
    let mut reply = String::new();
    reader.read_line(&mut reply).await.unwrap();
    assert!(reply.contains("-32003"), "got {reply}");
    assert!(reply.contains("\"preHello\":true"), "the phase is reported: {reply}");
    // Nothing was relayed: an over-limit line never reaches the application.
    assert!(relay.frames().is_empty());
    let _ = harness.host.shutdown().await;
}

#[tokio::test]
async fn applies_the_wider_limit_only_after_the_handshake() {
    let relay = TestRelay::answering_transport_errors();
    let harness = Harness::start_with(
        Arc::clone(&relay),
        HostLimits {
            max_hello_bytes: 16,
            max_frame_bytes: 4096,
            hello_timeout: Duration::from_millis(400),
            ..HostLimits::default()
        },
        "phase",
    )
    .await;

    let (mut reader, mut stream) = harness.connect().await;
    write_line(&mut stream, "{\"hello\":1}").await;
    let mut ack = String::new();
    reader.read_line(&mut ack).await.unwrap();
    assert_eq!(ack.trim_end(), "{\"ok\":true}");

    // 200 bytes is over the handshake limit and well under the session limit.
    let padded = format!("{{\"pad\":\"{}\"}}", "y".repeat(180));
    write_line(&mut stream, &padded).await;
    let mut second = String::new();
    reader.read_line(&mut second).await.unwrap();
    assert_eq!(second.trim_end(), "{\"ok\":true}");

    let frames = relay.frames();
    assert_eq!(frames.len(), 2, "both frames are relayed");
    assert_eq!(frames[0].1, "{\"hello\":1}");
    assert_eq!(
        frames[1].1, padded,
        "a frame over the handshake limit must be accepted once the session is open"
    );
    let _ = harness.host.shutdown().await;
}

#[tokio::test]
async fn closes_a_connection_that_never_handshakes() {
    let relay = TestRelay::answering_transport_errors();
    let harness = Harness::start_with(
        Arc::clone(&relay),
        HostLimits { hello_timeout: Duration::from_millis(120), ..HostLimits::default() },
        "idle",
    )
    .await;

    let (mut reader, stream) = harness.connect().await;
    let mut reply = String::new();
    let read = tokio::time::timeout(Duration::from_secs(3), reader.read_line(&mut reply))
        .await
        .expect("the deadline must fire well before this");
    read.unwrap();
    assert!(reply.contains("-32002"), "got {reply}");
    // The credential-holding half of the socket is gone.
    drop(stream);
    assert!(relay.frames().is_empty());
    let _ = harness.host.shutdown().await;
}

#[tokio::test]
async fn refuses_connections_beyond_the_cap_without_disturbing_the_rest() {
    let harness = Harness::start(
        vec![RelayOutcome::Reply("{\"ok\":true}".into())],
        HostLimits { max_connections: 1, hello_timeout: Duration::from_millis(400), ..HostLimits::default() },
    )
    .await;

    let (mut first_reader, mut first) = harness.connect().await;
    write_line(&mut first, "{\"a\":1}").await;
    let mut a = String::new();
    first_reader.read_line(&mut a).await.unwrap();
    assert_eq!(a.trim_end(), "{\"ok\":true}");

    // A second connection is accepted by the kernel then closed by the host.
    let (mut second_reader, _second_writer) = harness.connect().await;
    let mut buf = String::new();
    let read = tokio::time::timeout(Duration::from_secs(2), second_reader.read_line(&mut buf))
        .await
        .expect("the refused connection should not hang");
    assert_eq!(read.unwrap(), 0, "the refused connection sees EOF");

    // The first connection is unaffected.
    write_line(&mut first, "{\"b\":2}").await;
    let mut b = String::new();
    first_reader.read_line(&mut b).await.unwrap();
    assert_eq!(b.trim_end(), "{\"ok\":true}");
    let _ = harness.host.shutdown().await;
}

#[tokio::test]
async fn shutdown_removes_the_endpoint_directory() {
    let harness = Harness::start(vec![RelayOutcome::Reply("{}".into())], limits()).await;
    let directory = harness.host.directory().to_path_buf();
    assert!(directory.exists());
    harness.host.shutdown().await;
    assert!(!directory.exists(), "a stopped host must not leave a findable endpoint");
    let _ = std::fs::remove_dir_all(&harness.root);
}

//! The seam between the transport and the application's protocol.
//!
//! The transport deliberately does not understand JSON-RPC, `session.hello`,
//! method names or receipts. It moves complete lines and enforces transport
//! limits; **the application owns the protocol**, so there is exactly one
//! implementation of it (the TypeScript `ControlConnection`) whether the
//! endpoint is a headless CLI session or the running application.
//!
//! That split is what makes this crate small enough to trust: it cannot
//! disagree with the CLI about validation, because it performs none.

use futures_util::future::{ready, BoxFuture, FutureExt};

/// Identifies one accepted connection for the lifetime of the process.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConnectionId(String);

impl ConnectionId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ConnectionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// What the application wants the transport to do after a frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelayOutcome {
    /// Write this line back to the client and keep the connection open.
    Reply(String),
    /// Write this line back and then close.
    ///
    /// Distinct from [`RelayOutcome::Reply`] on purpose: the protocol often has
    /// one last thing to say *and* a reason to stop — a rejection that ends the
    /// session, a final acknowledgement before the client is refused. Closing
    /// without writing would lose the explanation, and writing without closing
    /// would leave a socket the application believes is finished.
    ReplyAndClose(String),
    /// Send nothing further on this connection and close it.
    Close,
    /// Write nothing and keep the connection open.
    ///
    /// A JSON-RPC notification has no response, and the protocol is explicit
    /// that a notification is never executed as authored work. It must not
    /// close a healthy connection either, so "no reply" is a decision the
    /// transport has to be able to hear rather than infer.
    Nothing,
}

/// A reason the transport itself must refuse something, before or instead of
/// the application seeing a frame.
///
/// The transport cannot phrase these: `-32003` and the human sentence that goes
/// with it belong to the protocol. So it asks, and the application answers with
/// the frame its own connection object would have produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    /// A line exceeded the byte limit for its phase and was discarded.
    FrameTooLarge { limit: usize, before_hello: bool },
    /// A complete line was not valid UTF-8.
    InvalidUtf8,
    /// No frame arrived within the handshake deadline.
    HelloTimeout,
    /// The application produced a reply larger than the transport will write.
    ///
    /// Reported rather than closed in silence because the command behind it has
    /// already been applied: a bare EOF leaves the client believing the outcome
    /// is unknown, when in fact the work landed and only the description of it
    /// was too large to send.
    ResponseTooLarge { limit: usize },
}

/// Moves frames between the transport and the application.
pub trait FrameRelay: Send + Sync + 'static {
    /// Deliver one complete request frame and resolve with what to write back.
    fn deliver(&self, connection: ConnectionId, frame: String) -> BoxFuture<'static, RelayOutcome>;

    /// Ask for the frame to write when the transport refuses something.
    ///
    /// Returning `None` closes the connection without writing, which is the
    /// default: a transport that invents an error format would be a second
    /// protocol.
    fn transport_error(
        &self,
        _connection: ConnectionId,
        _error: TransportError,
    ) -> BoxFuture<'static, Option<String>> {
        ready(None).boxed()
    }

    /// The connection has ended, for any reason: the peer left, a read failed, a
    /// limit closed it, or the application asked for it.
    ///
    /// Without this the application cannot know. It keeps a protocol session per
    /// connection, and a client that simply disconnects (every short-lived CLI
    /// call does) would leave that session listed as connected forever, until the
    /// connection cap turned new clients away. Fire-and-forget by design: the
    /// socket is already gone, so there is nothing to wait for or to decide.
    fn connection_closed(&self, _connection: ConnectionId) {}
}

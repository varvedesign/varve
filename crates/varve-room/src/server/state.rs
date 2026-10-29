//! Shared room and session state: participants, rate limits, uploads, and
//! the lock and outbound-delivery helpers every server module uses.

use super::host::RoomHost;
use super::prelude::*;

pub(super) struct ParticipantEntry {
    pub(super) info: ParticipantInfo,
    pub(super) token_hash: String,
    pub(super) outgoing: mpsc::Sender<ServerMessage>,
    /// Host-initiated end of this connection (revocation, backpressure).
    /// Carries the reason the peer is told.
    pub(super) terminate: watch::Sender<Option<String>>,
}

#[derive(Default)]
pub(super) struct RoomState {
    pub(super) participants: HashMap<String, ParticipantEntry>,
}

/// A connected, authenticated session (host-side view).
pub(super) struct Session {
    pub(super) room_id: String,
    pub(super) token_hash: String,
    pub(super) role: ParticipantRole,
    pub(super) actor_id: String,
    pub(super) display_name: String,
}

/// Cached answer to "is this session's invite still valid?".
///
/// Revocation must be re-checked at the host, but a presence stream is high
/// frequency: the store is asked at most once per VALIDITY_TTL, which bounds
/// how long a revoked session can keep talking to a few seconds. Mutations
/// (`handle_operation`) and snapshot uploads always check immediately.
pub(super) struct ValidityCache {
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
    pub(super) fn valid(&mut self, host: &Arc<RoomHost>, session: &Session) -> bool {
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
pub(super) struct SessionState {
    pub(super) limiter: RateLimiter,
    pub(super) upload: Option<PendingUpload>,
    pub(super) validity: ValidityCache,
}

impl SessionState {
    pub(super) fn new() -> Self {
        Self {
            limiter: RateLimiter::new(),
            upload: None,
            validity: ValidityCache::new(),
        }
    }
}

/// Per-connection token bucket (operations + chat; presence is relay-best-effort).
pub(super) struct RateLimiter {
    op_tokens: f64,
    chat_tokens: f64,
    chat_draft_tokens: f64,
    last: SystemTime,
}

/// One in-flight chunked operation upload on a connection. At most one is
/// open at a time and its buffer is bounded by
/// `MAX_CHUNKED_OPERATION_BYTES`, so a client cannot make the host allocate
/// unbounded memory by starting many uploads.
pub(super) struct PendingUpload {
    pub(super) upload_id: String,
    pub(super) total_bytes: usize,
    pub(super) chunk_count: usize,
    pub(super) digest: String,
    pub(super) buffer: String,
    pub(super) next_index: usize,
    pub(super) received_bytes: usize,
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
pub(super) const OUTBOUND_QUEUE_CAPACITY: usize = 256;
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

    pub(super) fn take(&mut self, chat: bool) -> bool {
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
    pub(super) fn take_draft(&mut self) -> bool {
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
pub(super) fn hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string())
}

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Take a host lock, recovering from poisoning.
///
/// Every lock here guards shared bookkeeping, not invariants a panic could
/// corrupt mid-write, and a poisoned lock must not turn one panic into a host
/// that panics on every later frame for every room.
pub(super) fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Deliver a frame to one connection's outbound queue.
///
/// The queue is bounded: a peer whose socket has stalled is ended with a
/// reason (it reconnects and resyncs from the journal) rather than letting the
/// host queue operations without limit. Returns false when the peer is gone or
/// was ended here.
pub(super) fn deliver(
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
pub(super) fn deliver_to(entry: &ParticipantEntry, message: ServerMessage) -> bool {
    deliver(&entry.outgoing, &entry.terminate, message)
}

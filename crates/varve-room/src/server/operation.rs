//! Authenticated operation handling and refusal attribution.

use super::host::RoomHost;
use super::prelude::*;
use super::state::{deliver, deliver_to, lock, now_ms, RateLimiter, Session};

/// Apply one authenticated, structurally bounded operation: role check,
/// rate limit, actor stamping, durable append, ack, relay. Shared verbatim by
/// the inline and the chunked paths so framing can never change semantics.
pub(super) fn handle_operation(
    host: &Arc<RoomHost>,
    session: &Session,
    mut op: RoomOperation,
    limiter: &mut RateLimiter,
    outgoing: &mpsc::Sender<ServerMessage>,
    terminate: &watch::Sender<Option<String>>,
) {
    // Roles: viewers cannot mutate. The hidden-edit-button rule.
    if session.role == ParticipantRole::Viewer {
        deliver(outgoing, terminate, ServerMessage::OperationRejected {
            client_op_id: op.client_op_id.clone(),
            reason: "You have view-only access to this session.".to_string(),
            fatal: false,
        });
        return;
    }
    if !limiter.take(false) {
        deliver(outgoing, terminate, ServerMessage::OperationRejected {
            client_op_id: op.client_op_id.clone(),
            reason: "Sending changes too quickly.".to_string(),
            fatal: false,
        });
        return;
    }
    // The wire cannot be trusted for semantics: an operation claims an actor
    // identity but the session's authenticated identity overrides it.
    // Checked arithmetic (FigCraft #309 class).
    op.actor_id = session.actor_id.clone();
    if op.based_on_seq < 0 || !capture_payload_like(&op.capture) {
        deliver(outgoing, terminate, ServerMessage::OperationRejected {
            client_op_id: op.client_op_id.clone(),
            reason: "Operation payload failed structural validation.".to_string(),
            fatal: true,
        });
        return;
    }
    let payload = match serde_json::to_string(&op) {
        Ok(data) => data,
        Err(_) => return,
    };
    let now = now_ms();
    enum OpOutcome {
        Appended(i64),
        Replayed(i64),
        Revoked,
        StoreError(String),
    }
    let outcome = {
        let store = lock(&host.store);
        // Revocation is re-checked at the authoritative host for every
        // mutation (Penpot #12155 lesson).
        let still_valid = store.invite_is_still_valid(&session.token_hash, now);
        match still_valid {
            Ok(true) => {
                let appended = store.append_operation(
                    &session.room_id,
                    &op.client_op_id,
                    &session.actor_id,
                    &payload,
                    now,
                );
                match appended {
                    Ok(crate::store::AppendOutcome::Appended { seq }) => OpOutcome::Appended(seq),
                    Ok(crate::store::AppendOutcome::Replayed { seq }) => OpOutcome::Replayed(seq),
                    Err(error) => OpOutcome::StoreError(error.to_string()),
                }
            }
            Ok(false) => OpOutcome::Revoked,
            Err(error) => OpOutcome::StoreError(error.to_string()),
        }
    };
    match outcome {
        OpOutcome::Appended(seq) => {
            host.operation_counter.fetch_add(1, Ordering::Relaxed);
            deliver(outgoing, terminate, ServerMessage::OperationAccepted {
                client_op_id: op.client_op_id.clone(),
                seq,
            });
            // Relay to every other live participant.
            let rooms = lock(&host.rooms);
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        deliver_to(entry, ServerMessage::Operation {
                            seq,
                            op: op.clone(),
                        });
                    }
                }
            }
        }
        OpOutcome::Replayed(seq) => {
            // Idempotent retry: re-ack with the stored sequence only.
            deliver(outgoing, terminate, ServerMessage::OperationAccepted {
                client_op_id: op.client_op_id.clone(),
                seq,
            });
        }
        OpOutcome::Revoked => {
            deliver(outgoing, terminate, ServerMessage::OperationRejected {
                client_op_id: op.client_op_id.clone(),
                reason: "You no longer have access to this session.".to_string(),
                fatal: true,
            });
        }
        OpOutcome::StoreError(error) => {
            // The change was NOT acked: the client keeps it as pending local
            // work and may retry after reconnecting.
            deliver(outgoing, terminate, ServerMessage::Error {
                code: "store-error".to_string(),
                message: format!("The session host could not persist the change: {error}"),
                fatal: false,
            });
        }
    }
}

/// The `clientOpId` of an operation-shaped frame, without trusting the rest.
pub(super) fn operation_id_of(raw: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(raw).ok()?;
    let op = value.get("op")?;
    let id = op.get("clientOpId")?.as_str()?;
    if id.is_empty() || id.len() > 128 {
        return None;
    }
    Some(id.to_string())
}

/// Refuse a frame, attributing it to its operation when one is known.
///
/// An unattributed refusal is a livelock: the operation stays pending on the
/// sender, is re-sent on every reconnect, and keeps blocking conflicting
/// remote changes for its keys. `operation-rejected` is the shape the client
/// already knows how to settle.
pub(super) fn reject_frame(
    raw: &[u8],
    client_op_id: Option<String>,
    reason: &str,
    outgoing: &mpsc::Sender<ServerMessage>,
    terminate: &watch::Sender<Option<String>>,
) {
    let message = match client_op_id.or_else(|| operation_id_of(raw)) {
        Some(client_op_id) => ServerMessage::OperationRejected {
            client_op_id,
            reason: reason.to_string(),
            fatal: false,
        },
        None => ServerMessage::Error {
            code: "bad-frame".to_string(),
            message: reason.to_string(),
            fatal: false,
        },
    };
    deliver(outgoing, terminate, message);
}

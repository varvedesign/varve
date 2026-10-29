//! Inbound client-frame dispatch for one authenticated WebSocket session.

use super::host::RoomHost;
use super::operation::{handle_operation, operation_id_of, reject_frame};
use super::prelude::*;
use super::state::{deliver, deliver_to, lock, now_ms, PendingUpload, Session, SessionState};

/// Handle one authenticated client frame. Returns ControlFlow-like break.
pub(super) fn handle_client_frame(
    host: &Arc<RoomHost>,
    session: &Session,
    raw: &[u8],
    state: &mut SessionState,
    outgoing: &mpsc::Sender<ServerMessage>,
    terminate: &watch::Sender<Option<String>>,
) -> std::ops::ControlFlow<()> {
    // Size ceilings before parsing; oversized frames must identify as a
    // multi-frame kind (chunked operation, snapshot upload) or the socket
    // is closed — an unknown oversized frame is a memory-exhaustion probe.
    if raw.len() > MAX_OPERATION_FRAME_BYTES && !is_large_capable_frame(raw) {
        return std::ops::ControlFlow::Break(());
    }
    if raw.len() > MAX_SNAPSHOT_UPLOAD_BYTES {
        return std::ops::ControlFlow::Break(());
    }
    let Ok(message) = serde_json::from_slice::<ClientMessage>(raw) else {
        // Attribute the refusal when the frame names an operation: an
        // unattributable error leaves that operation pending forever, so the
        // client re-sends it on every reconnect and it keeps blocking
        // conflicting remote changes.
        reject_frame(raw, None, "Frame failed protocol validation.", outgoing, terminate);
        return std::ops::ControlFlow::Continue(());
    };
    if message.validate().is_err() {
        let client_op_id = match &message {
            ClientMessage::Operation { op } => Some(op.client_op_id.clone()),
            _ => operation_id_of(raw),
        };
        reject_frame(raw, client_op_id, "Frame out of bounds.", outgoing, terminate);
        return std::ops::ControlFlow::Continue(());
    }
    match message {
        ClientMessage::Hello { .. } => {
            // A second hello on one socket is a protocol error.
            std::ops::ControlFlow::Break(())
        }
        ClientMessage::Operation { op } => {
            handle_operation(host, session, op, &mut state.limiter, outgoing, terminate);
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::OperationBegin {
            upload_id,
            total_bytes,
            chunk_count,
            digest,
        } => {
            if state.upload.is_some() {
                deliver(outgoing, terminate, ServerMessage::OperationUploadRejected {
                    upload_id,
                    reason: "Another upload is already in progress.".to_string(),
                });
                return std::ops::ControlFlow::Continue(());
            }
            state.upload = Some(PendingUpload {
                upload_id,
                total_bytes: total_bytes as usize,
                chunk_count: chunk_count as usize,
                digest: digest.to_ascii_lowercase(),
                buffer: String::with_capacity((total_bytes as usize).min(1 << 20)),
                next_index: 0,
                received_bytes: 0,
            });
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::OperationChunk {
            upload_id,
            index,
            data,
        } => {
            let mut reject: Option<String> = None;
            match state.upload.as_mut() {
                None => reject = Some("No upload is in progress.".to_string()),
                Some(pending) if pending.upload_id != upload_id => {
                    reject = Some("Chunk for an unknown state.upload.".to_string());
                }
                Some(pending) if index as usize != pending.next_index => {
                    reject = Some("Chunks arrived out of order.".to_string());
                }
                Some(pending) => {
                    let chunk_bytes = data.len();
                    if pending.received_bytes + chunk_bytes > pending.total_bytes
                        || pending.buffer.len() + chunk_bytes > MAX_CHUNKED_OPERATION_BYTES
                    {
                        reject = Some("Upload exceeds its declared size.".to_string());
                    } else {
                        pending.buffer.push_str(&data);
                        pending.received_bytes += chunk_bytes;
                        pending.next_index += 1;
                    }
                }
            }
            if let Some(reason) = reject {
                // Fail closed: the buffer is discarded, the operation stays
                // pending on the client, and the client may retry.
                let upload_id = state.upload.take().map(|p| p.upload_id).unwrap_or(upload_id);
                deliver(outgoing, terminate, ServerMessage::OperationUploadRejected {
                    upload_id,
                    reason,
                });
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::OperationEnd { upload_id } => {
            let Some(pending) = state.upload.take() else {
                deliver(outgoing, terminate, ServerMessage::OperationUploadRejected {
                    upload_id,
                    reason: "No upload is in progress.".to_string(),
                });
                return std::ops::ControlFlow::Continue(());
            };
            if pending.upload_id != upload_id {
                deliver(outgoing, terminate, ServerMessage::OperationUploadRejected {
                    upload_id,
                    reason: "Upload id mismatch.".to_string(),
                });
                return std::ops::ControlFlow::Continue(());
            }
            let mut reject_reason: Option<String> = None;
            if pending.next_index != pending.chunk_count {
                reject_reason = Some("Upload ended before every chunk arrived.".to_string());
            } else if pending.buffer.len() != pending.total_bytes {
                reject_reason = Some("Upload length did not match its declaration.".to_string());
            } else if crate::protocol::digest_hex(pending.buffer.as_bytes()) != pending.digest {
                // Integrity: the reassembled frame must hash to what the
                // client declared. WebSocket framing already protects the
                // bytes in transit; this catches truncation, interleaving
                // bugs, and a hostile frame that does not match its claim.
                reject_reason = Some("Upload digest did not match.".to_string());
            }
            if let Some(reason) = reject_reason {
                deliver(outgoing, terminate, ServerMessage::OperationUploadRejected {
                    upload_id,
                    reason,
                });
                return std::ops::ControlFlow::Continue(());
            }
            // The reassembled frame is validated exactly like an inline one:
            // chunking changes framing, never semantics.
            let parsed = serde_json::from_str::<ClientMessage>(&pending.buffer);
            match parsed {
                Ok(message @ ClientMessage::Operation { .. }) => {
                    if message.validate().is_err() {
                        let client_op_id = match &message {
                            ClientMessage::Operation { op } => Some(op.client_op_id.clone()),
                            _ => None,
                        };
                        reject_frame(
                            pending.buffer.as_bytes(),
                            client_op_id,
                            "Reassembled operation is out of bounds.",
                            outgoing,
                            terminate,
                        );
                        return std::ops::ControlFlow::Continue(());
                    }
                    if let ClientMessage::Operation { op } = message {
                        handle_operation(host, session, op, &mut state.limiter, outgoing, terminate);
                    }
                }
                _ => {
                    deliver(outgoing, terminate, ServerMessage::OperationUploadRejected {
                        upload_id,
                        // Only operation frames may be uploaded in chunks: a
                        // chunked hello would defeat the hello-once rule and a
                        // chunked snapshot upload the owner gate's shape.
                        reason: "A chunked upload must reassemble to a valid operation."
                            .to_string(),
                    });
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Cursor { page_id, x, y } => {
            if !state.validity.valid(host, session) {
                return std::ops::ControlFlow::Break(());
            }
            let frame = CursorFrame { page_id, x, y };
            let rooms = lock(&host.rooms);
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        deliver_to(entry, ServerMessage::PresenceCursor {
                            actor_id: session.actor_id.clone(),
                            cursor: frame.clone(),
                        });
                    }
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Viewport {
            page_id,
            center_x,
            center_y,
            zoom,
            spotlighting,
        } => {
            if !state.validity.valid(host, session) {
                return std::ops::ControlFlow::Break(());
            }
            if !zoom.is_finite() || zoom <= 0.0 {
                return std::ops::ControlFlow::Continue(());
            }
            let frame = ViewportFrame {
                page_id,
                center_x,
                center_y,
                zoom,
                spotlighting,
            };
            let rooms = lock(&host.rooms);
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        deliver_to(entry, ServerMessage::PresenceViewport {
                            actor_id: session.actor_id.clone(),
                            viewport: frame.clone(),
                        });
                    }
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Selection { page_id, node_ids } => {
            if !state.validity.valid(host, session) {
                return std::ops::ControlFlow::Break(());
            }
            if node_ids.len() > MAX_SELECTION_IDS {
                return std::ops::ControlFlow::Continue(());
            }
            let frame = SelectionFrame { page_id, node_ids };
            let rooms = lock(&host.rooms);
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        deliver_to(entry, ServerMessage::PresenceSelection {
                            actor_id: session.actor_id.clone(),
                            selection: frame.clone(),
                        });
                    }
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Chat { message } => {
            if !state.validity.valid(host, session) {
                return std::ops::ControlFlow::Break(());
            }
            // Drafts and finalized messages have separate budgets, so a draft
            // burst can never spend the message the author actually sent. A
            // refused FINAL message is reported: silently dropping the message
            // a person pressed Enter on is the worst possible outcome.
            let allowed = if message.composing {
                state.limiter.take_draft()
            } else if state.limiter.take(true) {
                true
            } else {
                let _ = deliver(
                    outgoing,
                    terminate,
                    ServerMessage::Error {
                        code: "chat-rate-limited".to_string(),
                        message: "That message was not sent: the room is receiving chat too quickly.".to_string(),
                        fatal: false,
                    },
                );
                false
            };
            if !allowed {
                return std::ops::ControlFlow::Continue(());
            }
            if message.text.chars().count() > MAX_CHAT_LENGTH {
                return std::ops::ControlFlow::Continue(());
            }
            let rooms = lock(&host.rooms);
            if let Some(room) = rooms.get(&session.room_id) {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        deliver_to(entry, ServerMessage::Chat {
                            message: crate::protocol::ChatMessageFrame {
                                message_id: message.message_id.clone(),
                                actor_id: session.actor_id.clone(),
                                text: message.text.clone(),
                                composing: message.composing,
                            },
                        });
                    }
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::SyncRequest { from_seq } => {
            if !state.validity.valid(host, session) {
                return std::ops::ControlFlow::Break(());
            }
            let store = lock(&host.store);
            let baseline = store.baseline(&session.room_id).ok().flatten();
            let current = store.current_seq(&session.room_id).unwrap_or(0);
            let from = from_seq.max(baseline.as_ref().map(|b| b.seq).unwrap_or(0));
            if from_seq < from {
                // The requested range was compacted away: send the snapshot.
                if let Some(baseline) = baseline {
                    deliver(outgoing, terminate, ServerMessage::Snapshot {
                        snapshot: RoomSnapshot {
                            upto_seq: baseline.seq,
                            document_json: baseline.document_json,
                        },
                    });
                }
            }
            if let Ok(entries) = store.journal_range(&session.room_id, from, current) {
                deliver(outgoing, terminate, ServerMessage::Sync {
                    from_seq: from,
                    seq: current,
                    operations: entries
                        .into_iter()
                        .filter_map(|(seq, payload)| {
                            serde_json::from_str::<RoomOperation>(&payload)
                                .ok()
                                .map(|op| JournalEntry { seq, op })
                        })
                        .collect(),
                });
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::SnapshotUpload {
            upto_seq,
            document_json,
        } => {
            // Snapshots replace the baseline every future joiner bootstraps
            // from, so this is a mutation like any other: the role is checked
            // AND the invite is re-checked against the store (a revoked owner
            // must not be able to move the baseline), and a refusal is visible
            // rather than a silent no-op.
            if session.role != ParticipantRole::Owner {
                let _ = deliver(
                    outgoing,
                    terminate,
                    ServerMessage::Error {
                        code: "snapshot-refused".to_string(),
                        message: "Only the room owner may upload a snapshot.".to_string(),
                        fatal: false,
                    },
                );
                return std::ops::ControlFlow::Continue(());
            }
            let now = now_ms();
            let store = lock(&host.store);
            let still_valid = store
                .invite_is_still_valid(&session.token_hash, now)
                .unwrap_or(false);
            if !still_valid {
                let _ = deliver(
                    outgoing,
                    terminate,
                    ServerMessage::Error {
                        code: "snapshot-refused".to_string(),
                        message: "Your access to this session ends with your invite.".to_string(),
                        fatal: true,
                    },
                );
                return std::ops::ControlFlow::Break(());
            }
            match store.compact_with_snapshot(&session.room_id, upto_seq, &document_json, now) {
                Ok(()) => {}
                Err(error) => {
                    let _ = deliver(
                        outgoing,
                        terminate,
                        ServerMessage::Error {
                            code: "snapshot-refused".to_string(),
                            message: format!("The snapshot was not stored: {error}"),
                            fatal: false,
                        },
                    );
                }
            }
            std::ops::ControlFlow::Continue(())
        }
        ClientMessage::Leave => std::ops::ControlFlow::Break(()),
        ClientMessage::Ping => {
            deliver(outgoing, terminate, ServerMessage::Pong);
            std::ops::ControlFlow::Continue(())
        }
    }
}

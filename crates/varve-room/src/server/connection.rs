//! WebSocket session lifecycle: upgrade, registration, and the inbound and
//! outbound session loop.

use super::frames::handle_client_frame;
use super::host::RoomHost;
use super::http::origin_allowed;
use super::prelude::*;
use super::state::{
    deliver, deliver_to, lock, now_ms, ParticipantEntry, Session, SessionState,
    OUTBOUND_QUEUE_CAPACITY,
};

// ── WebSocket session ─────────────────────────────────────────────────────────

pub(super) async fn ws_upgrade(
    State(host): State<Arc<RoomHost>>,
    AxumPath(room_id): AxumPath<String>,
    headers: HeaderMap,
    ConnectInfo(_addr): ConnectInfo<SocketAddr>,
    upgrade: WebSocketUpgrade,
) -> impl IntoResponse {
    if !origin_allowed(&host, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    upgrade.on_upgrade(move |socket| run_session(host, room_id, socket))
}

enum Registration {
    Ok {
        baseline: Option<crate::store::RoomBaseline>,
        current_seq: i64,
        participants: Vec<ParticipantInfo>,
    },
    ServerFull,
    RoomFull,
}

/// Synchronous registration: takes every lock it needs and returns before
/// any await, so guards can never be held across the session's async paths.
fn register_participant(
    host: &Arc<RoomHost>,
    session: &Session,
    hello: &ClientMessage,
    outgoing: mpsc::Sender<ServerMessage>,
    terminate: watch::Sender<Option<String>>,
) -> Registration {
    let mut rooms = lock(&host.rooms);
    let store = lock(&host.store);
    let live_count: usize = rooms.values().map(|room| room.participants.len()).sum();
    if live_count >= host.config.max_rooms * MAX_PARTICIPANTS {
        return Registration::ServerFull;
    }
    let room = rooms.entry(session.room_id.clone()).or_default();
    if room.participants.len() >= MAX_PARTICIPANTS {
        return Registration::RoomFull;
    }
    let color_index = (0..8)
        .find(|index| {
            !room
                .participants
                .values()
                .any(|entry| entry.info.color_index == *index as i64)
        })
        .unwrap_or(0);
    room.participants.insert(
        session.actor_id.clone(),
        ParticipantEntry {
            info: ParticipantInfo {
                actor_id: session.actor_id.clone(),
                display_name: session.display_name.clone(),
                color_index: color_index as i64,
                role: session.role,
                client_id: client_id_of(hello),
            },
            token_hash: session.token_hash.clone(),
            outgoing,
            terminate,
        },
    );
    let baseline = store.baseline(&session.room_id).ok().flatten();
    let current_seq = store.current_seq(&session.room_id).unwrap_or(0);
    let participants: Vec<ParticipantInfo> = room
        .participants
        .values()
        .map(|entry| entry.info.clone())
        .collect();
    Registration::Ok {
        baseline,
        current_seq,
        participants,
    }
}

async fn run_session(host: Arc<RoomHost>, room_id: String, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    // Bounded: a stalled peer is ended rather than letting the host queue
    // operations (each up to 64 MB, relayed to every peer) without limit.
    let (outgoing_tx, mut outgoing_rx) = mpsc::channel::<ServerMessage>(OUTBOUND_QUEUE_CAPACITY);
    // Host-initiated termination: revocation, backpressure, a room ending.
    let (terminate_tx, mut terminate_rx) = watch::channel::<Option<String>>(None);

    // First frame must be hello within the idle timeout.
    let hello = tokio::time::timeout(
        Duration::from_millis(host.config.idle_timeout_ms),
        stream.next(),
    )
    .await;
    let Ok(Some(Ok(WsMessage::Text(text)))) = hello else {
        let _ = sink
            .send(WsMessage::Close(Some(CloseFrame {
                code: 4400,
                reason: "expected hello".into(),
            })))
            .await;
        return;
    };
    let Ok(client_message) = serde_json::from_str::<ClientMessage>(&text) else {
        let _ = sink.close().await;
        return;
    };
    let ClientMessage::Hello { token, .. } = &client_message else {
        let _ = sink
            .send(WsMessage::Close(Some(CloseFrame {
                code: 4400,
                reason: "expected hello".into(),
            })))
            .await;
        return;
    };

    // Authenticate: hash lookup, expiry, revocation, room existence.
    let digest = token_hash(token);
    let auth = {
        let store = lock(&host.store);
        store.resolve_invite(&digest, now_ms())
    };
    let invite = match auth {
        Ok(Some(invite)) if invite.room_id == room_id => invite,
        _ => {
            let _ = sink
                .send(WsMessage::Close(Some(CloseFrame {
                    code: 4401,
                    reason: "invite invalid".into(),
                })))
                .await;
            return;
        }
    };

    // Register: assign actor identity and the lowest free palette slot.
    // All locking happens inside the synchronous helper — no lock guard can
    // overlap an await point.
    let session = Session {
        room_id: room_id.clone(),
        token_hash: digest,
        role: invite.role,
        actor_id: format!("actor-{}", &mint_token()[..12]),
        display_name: display_name_of(&client_message),
    };
    let registration = register_participant(
        &host,
        &session,
        &client_message,
        outgoing_tx.clone(),
        terminate_tx.clone(),
    );
    let (baseline, current_seq, participants) = match registration {
        Registration::Ok {
            baseline,
            current_seq,
            participants,
        } => (baseline, current_seq, participants),
        full @ (Registration::ServerFull | Registration::RoomFull) => {
            let (code, reason) = if matches!(full, Registration::ServerFull) {
                ("server-full", "The collaboration service is at capacity.")
            } else {
                ("room-full", "This session is at the participant limit.")
            };
            let _ = outgoing_tx.try_send(ServerMessage::Error {
                code: code.to_string(),
                message: reason.to_string(),
                fatal: true,
            });
            let _ = sink
                .send(WsMessage::Close(Some(CloseFrame {
                    code: 4429,
                    reason: "full".into(),
                })))
                .await;
            return;
        }
    };

    // Welcome: the baseline snapshot; the journal replay follows as sync.
    let snapshot_seq = baseline.as_ref().map(|b| b.seq).unwrap_or(0);
    let _ = deliver(&outgoing_tx, &terminate_tx, ServerMessage::Welcome {
        protocol: 1,
        room_seq: current_seq,
        actor_id: session.actor_id.clone(),
        role: session.role,
        participants: participants.clone(),
        snapshot: RoomSnapshot {
            upto_seq: snapshot_seq,
            document_json: baseline
                .map(|b| b.document_json)
                .unwrap_or_else(|| "null".to_string()),
        },
        shared_baseline_seq: 0,
    });
    if current_seq > snapshot_seq {
        if let Ok(entries) = {
            let store = lock(&host.store);
            store.journal_range(&room_id, snapshot_seq, current_seq)
        } {
            let _ = deliver(&outgoing_tx, &terminate_tx, ServerMessage::Sync {
                from_seq: snapshot_seq,
                seq: current_seq,
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
    }

    // Announce the join to other participants.
    {
        let rooms = lock(&host.rooms);
        if let Some(room) = rooms.get(&room_id) {
            let info = room
                .participants
                .get(&session.actor_id)
                .map(|entry| entry.info.clone());
            if let Some(info) = info {
                for (actor, entry) in &room.participants {
                    if actor != &session.actor_id {
                        deliver_to(entry, ServerMessage::ParticipantJoined {
                            participant: info.clone(),
                        });
                    }
                }
            }
        }
    }

    // Outbound pump.
    let outbound = tokio::spawn(async move {
        while let Some(message) = outgoing_rx.recv().await {
            let Ok(data) = serde_json::to_string(&message) else {
                continue;
            };
            if sink.send(WsMessage::Text(data.into())).await.is_err() {
                break;
            }
        }
    });

    // Inbound loop. A socket that sends nothing for the idle window is
    // treated exactly like a disconnect: it is deregistered and its
    // participant slot is released (a crashed tab must not hold a place in a
    // 10-participant room forever). Live clients send a `ping` heartbeat, so
    // a quiet-but-healthy participant is never reaped.
    let mut state = SessionState::new();
    let idle = Duration::from_millis(host.config.idle_timeout_ms);
    let mut end_reason: Option<String> = None;
    loop {
        // A revocation or a stalled outbound queue ends the session HERE, on
        // the socket, not merely in the client's UI.
        if terminate_rx.has_changed().unwrap_or(false) {
            end_reason = terminate_rx.borrow_and_update().clone();
            break;
        }
        let next = tokio::select! {
            biased;
            changed = terminate_rx.changed() => {
                if changed.is_ok() {
                    end_reason = terminate_rx.borrow_and_update().clone();
                }
                break;
            }
            next = tokio::time::timeout(idle, stream.next()) => match next {
                Ok(next) => next,
                Err(_) => break,
            },
        };
        let Some(frame) = next else { break };
        let Ok(message) = frame else { break };
        match message {
            WsMessage::Text(text) => {
                if handle_client_frame(
                    &host,
                    &session,
                    text.as_bytes(),
                    &mut state,
                    &outgoing_tx,
                    &terminate_tx,
                )
                .is_break()
                {
                    break;
                }
            }
            WsMessage::Binary(bytes) => {
                if handle_client_frame(
                    &host,
                    &session,
                    &bytes,
                    &mut state,
                    &outgoing_tx,
                    &terminate_tx,
                )
                .is_break()
                {
                    break;
                }
            }
            WsMessage::Close(_) => break,
            WsMessage::Ping(_) | WsMessage::Pong(_) => {}
        }
    }

    // Deregister and announce departure.
    {
        let mut rooms = lock(&host.rooms);
        if let Some(room) = rooms.get_mut(&room_id) {
            room.participants.remove(&session.actor_id);
            for entry in room.participants.values() {
                deliver_to(entry, ServerMessage::ParticipantLeft {
                    actor_id: session.actor_id.clone(),
                    reason: "disconnect".to_string(),
                });
            }
        }
    }
    // Orderly end: report the reason when there is one (revocation,
    // backpressure), then drop the sender so the pump drains what is queued and
    // ends, which drops the socket and closes the connection normally. No
    // internal sentinel can leak into the UI, and no abort races the final
    // write.
    if let Some(reason) = end_reason {
        let _ = deliver(
            &outgoing_tx,
            &terminate_tx,
            ServerMessage::RoomEnded { reason },
        );
    }
    drop(outgoing_tx);
    if tokio::time::timeout(Duration::from_secs(2), outbound)
        .await
        .is_err()
    {
        // A peer that stopped reading must not pin this task; the socket is
        // closed either way.
    }
}

fn display_name_of(message: &ClientMessage) -> String {
    if let ClientMessage::Hello { display_name, .. } = message {
        let trimmed = display_name.trim();
        if trimmed.is_empty() {
            return "Guest".to_string();
        }
        return trimmed.chars().take(60).collect();
    }
    "Guest".to_string()
}

fn client_id_of(message: &ClientMessage) -> String {
    if let ClientMessage::Hello { client_id, .. } = message {
        return client_id.clone();
    }
    String::new()
}

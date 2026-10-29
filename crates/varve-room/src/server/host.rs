//! Host configuration, lifecycle, and the admin operations on a room host.

use super::prelude::*;
use super::state::{deliver_to, hostname, lock, now_ms, RoomState};

#[derive(Debug, Clone)]
pub struct HostConfig {
    pub data_dir: PathBuf,
    /// Loopback-only when false; binding a non-loopback address requires
    /// `true` (set by the CLI's `--expose`), an explicit decision.
    pub allow_non_loopback: bool,
    /// Admin API token. Generated at startup when absent; a server exposed
    /// beyond loopback refuses to start without an explicit token.
    pub admin_token: Option<String>,
    pub max_rooms: usize,
    /// Milliseconds a client may stay silent before the host closes it.
    pub idle_timeout_ms: u64,
    /// Browser origins allowed to open a WebSocket beyond the always-allowed
    /// local set (loopback `http://` pages and the Tauri webview). The
    /// deployment's own page origin goes here when a server is exposed behind
    /// a reverse proxy. Exact match, case-insensitive.
    pub allowed_origins: Vec<String>,
    /// Extra Host header values accepted on the upgrade. A loopback bind
    /// additionally requires a loopback Host (DNS-rebinding defence); this
    /// list is the escape hatch for a same-host reverse proxy whose public
    /// name differs from the bind address.
    pub allowed_hosts: Vec<String>,
}

impl HostConfig {
    pub fn for_data_dir(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            allow_non_loopback: false,
            admin_token: None,
            max_rooms: 256,
            idle_timeout_ms: 15 * 60 * 1000,
            allowed_origins: Vec::new(),
            allowed_hosts: Vec::new(),
        }
    }
}

pub struct RoomHost {
    pub(super) store: Mutex<RoomStore>,
    pub(super) config: HostConfig,
    pub(super) rooms: Mutex<HashMap<String, RoomState>>,
    pub(super) operation_counter: AtomicU64,
    /// Identity of this process in the data directory's host lock.
    pub(super) owner_id: String,
}

impl Drop for RoomHost {
    fn drop(&mut self) {
        // Release the directory's single-owner lock so the next process starts
        // without waiting for the staleness window. Never panics: a poisoned
        // lock at drop time must not abort the process.
        if let Ok(store) = self.store.lock() {
            let _ = store.release_host_lock(&self.owner_id);
        }
    }
}

/// How long a host may go without refreshing its lock before another process
/// treats it as abandoned. Three heartbeats of slack.
const HOST_LOCK_STALE_MS: i64 = 120_000;
/// Heartbeat interval for the host lock.
pub(super) const HOST_LOCK_REFRESH_MS: u64 = 30_000;

impl RoomHost {
    pub fn open(config: HostConfig) -> Result<Arc<Self>, RoomStoreError> {
        std::fs::create_dir_all(&config.data_dir).map_err(|error| {
            RoomStoreError::Sqlite(rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
        })?;
        let store = RoomStore::open(&config.data_dir.join("rooms.db"))?;
        let owner_id = mint_token();
        match store.acquire_host_lock(
            &owner_id,
            std::process::id() as i64,
            &hostname(),
            now_ms(),
            HOST_LOCK_STALE_MS,
        )? {
            crate::store::LockOutcome::Acquired => {}
            crate::store::LockOutcome::Held {
                owner_pid,
                hostname: holder,
                ..
            } => {
                return Err(RoomStoreError::HostLocked {
                    owner_pid,
                    hostname: holder,
                })
            }
        }
        Ok(Arc::new(Self {
            store: Mutex::new(store),
            config,
            rooms: Mutex::new(HashMap::new()),
            operation_counter: AtomicU64::new(0),
            owner_id,
        }))
    }

    /// Admin API: create a room seeded with the owner's document snapshot.
    pub fn admin_create_room(
        &self,
        doc_id: &str,
        document_json: &str,
    ) -> Result<AdminRoom, RoomStoreError> {
        if document_json.len() > MAX_SNAPSHOT_UPLOAD_BYTES {
            return Err(RoomStoreError::SnapshotAheadOfJournal); // size guard
        }
        {
            let rooms = lock(&self.rooms);
            if rooms.len() >= self.config.max_rooms {
                return Err(RoomStoreError::SequenceExhausted); // capacity guard
            }
        }
        let store = lock(&self.store);
        if store.room_count()? as usize >= self.config.max_rooms {
            return Err(RoomStoreError::SequenceExhausted);
        }
        let room_id = format!("room-{}", &mint_token()[..16]);
        let now = now_ms();
        store.create_room(&room_id, doc_id, now)?;
        store.compact_with_snapshot(&room_id, 0, document_json, now)?;
        let owner_token = mint_token();
        store.create_invite(
            &token_hash(&owner_token),
            &room_id,
            ParticipantRole::Owner,
            i64::MAX / 2,
            now,
        )?;
        Ok(AdminRoom {
            room_id,
            owner_invite_token: owner_token,
        })
    }

    /// Admin API: mint an additional invite for a room.
    pub fn admin_create_invite(
        &self,
        room_id: &str,
        role: ParticipantRole,
        expires_at: i64,
    ) -> Result<String, RoomStoreError> {
        let store = lock(&self.store);
        if !store.room_exists(room_id)? {
            return Err(RoomStoreError::Sqlite(rusqlite::Error::QueryReturnedNoRows));
        }
        let token = mint_token();
        store.create_invite(&token_hash(&token), room_id, role, expires_at, now_ms())?;
        Ok(token)
    }

    /// Admin API: revoke an invite and disconnect its live sessions.
    /// Revocation is an event: the sockets close now, not at their next
    /// convenience.
    pub fn admin_revoke_invite(&self, token_hash_value: &str) -> Result<bool, RoomStoreError> {
        {
            let store = lock(&self.store);
            if !store.revoke_invite(token_hash_value)? {
                return Ok(false);
            }
        }
        let mut rooms = lock(&self.rooms);
        for room in rooms.values_mut() {
            let actors: Vec<String> = room
                .participants
                .iter()
                .filter(|(_, entry)| entry.token_hash == token_hash_value)
                .map(|(actor, _)| actor.clone())
                .collect();
            for actor in actors {
                let entry = room.participants.remove(&actor);
                if let Some(entry) = entry {
                    // Ending the SESSION, not merely asking it to leave: the
                    // session loop watches this channel and closes the socket.
                    // A cooperative client also acts on the room-ended frame; a
                    // hostile one must not keep a live authenticated socket that
                    // can still read the journal, inject presence, or upload a
                    // snapshot.
                    let _ = entry
                        .terminate
                        .send(Some("Your access was revoked".to_string()));
                    deliver_to(
                        &entry,
                        ServerMessage::RoomEnded {
                            reason: "Your access was revoked".to_string(),
                        },
                    );
                }
            }
        }
        Ok(true)
    }

    /// Admin API: end a room and disconnect everyone.
    pub fn admin_end_room(&self, room_id: &str) -> Result<bool, RoomStoreError> {
        let existed = {
            let store = lock(&self.store);
            let existed = store.room_exists(room_id)?;
            if existed {
                store.delete_room(room_id)?;
            }
            existed
        };
        if !existed {
            return Ok(false);
        }
        let mut rooms = lock(&self.rooms);
        if let Some(room) = rooms.remove(room_id) {
            for (_, entry) in room.participants {
                let _ = entry
                    .terminate
                    .send(Some("The session was ended by the host".to_string()));
                deliver_to(
                    &entry,
                    ServerMessage::RoomEnded {
                        reason: "The session was ended by the host".to_string(),
                    },
                );
            }
        }
        Ok(true)
    }
}

pub struct AdminRoom {
    pub room_id: String,
    pub owner_invite_token: String,
}

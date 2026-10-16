//! Durable room storage (SQLite, WAL).
//!
//! Durability contract (the FigCraft #183/#407/#408 class of failures is
//! the design pressure here):
//! - An operation may be ACKED to the network only after its journal
//!   INSERT has committed (`synchronous=FULL`).
//! - Compaction replaces the snapshot and truncates the log inside ONE
//!   transaction — there is no partial-compaction window where an
//!   acknowledged edit could be lost on restart.
//! - Damage is an error, never a silent truncate: a store that cannot be
//!   opened fails startup loudly.
//! - Sequence numbers use checked arithmetic; a corrupt or exhausted
//!   counter raises instead of wrapping.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::protocol::ParticipantRole;

pub struct RoomStore {
    conn: Connection,
}

#[derive(Debug, Clone)]
pub struct InviteRecord {
    pub room_id: String,
    pub role: ParticipantRole,
    pub expires_at: i64,
    pub revoked: bool,
}

#[derive(Debug, Clone)]
pub struct RoomBaseline {
    pub seq: i64,
    pub document_json: String,
}

impl RoomStore {
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS rooms (
                room_id       TEXT PRIMARY KEY,
                doc_id        TEXT NOT NULL,
                created_at    INTEGER NOT NULL,
                last_activity INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS invites (
                token_hash TEXT PRIMARY KEY,
                room_id    TEXT NOT NULL REFERENCES rooms(room_id),
                role       TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                revoked    INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS invites_by_room ON invites(room_id);
            CREATE TABLE IF NOT EXISTS snapshots (
                room_id       TEXT PRIMARY KEY REFERENCES rooms(room_id),
                seq           INTEGER NOT NULL,
                document_json TEXT NOT NULL,
                created_at    INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS operations (
                room_id       TEXT NOT NULL REFERENCES rooms(room_id),
                seq           INTEGER NOT NULL,
                client_op_id  TEXT NOT NULL,
                actor_id      TEXT NOT NULL,
                payload       TEXT NOT NULL,
                created_at    INTEGER NOT NULL,
                PRIMARY KEY (room_id, seq)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS ops_by_client_op
                ON operations(room_id, client_op_id);
            CREATE TABLE IF NOT EXISTS room_sequences (
                room_id TEXT PRIMARY KEY REFERENCES rooms(room_id),
                seq     INTEGER NOT NULL
            );
            -- Single-owner enforcement: one process per data directory.
            -- Two hosts on one store can write divergent histories and corrupt
            -- the journal, so this is a lock rather than a documented hope.
            CREATE TABLE IF NOT EXISTS host_lock (
                id           INTEGER PRIMARY KEY CHECK (id = 1),
                owner_id     TEXT NOT NULL,
                owner_pid    INTEGER NOT NULL,
                hostname     TEXT NOT NULL,
                refreshed_at INTEGER NOT NULL
            );
            "#,
        )?;
        Ok(Self { conn })
    }

    pub fn in_memory() -> Result<Self, rusqlite::Error> {
        Self::open(Path::new(":memory:"))
    }

    // ── Single-owner lock ─────────────────────────────────────────────────

    /// Take the data directory's host lock, or report who holds it.
    ///
    /// A lock whose heartbeat is older than `stale_after_ms` is treated as
    /// abandoned (the holder crashed) and taken over: refusing forever would
    /// make a crash unrecoverable without manual database surgery.
    pub fn acquire_host_lock(
        &self,
        owner_id: &str,
        owner_pid: i64,
        hostname: &str,
        now: i64,
        stale_after_ms: i64,
    ) -> Result<LockOutcome, rusqlite::Error> {
        let tx = self.conn.unchecked_transaction()?;
        let existing: Option<(String, i64, String, i64)> = tx
            .query_row(
                "SELECT owner_id, owner_pid, hostname, refreshed_at FROM host_lock WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?;
        if let Some((held_by, held_pid, held_host, refreshed_at)) = existing {
            let stale = now.saturating_sub(refreshed_at) > stale_after_ms;
            if !stale && held_by != owner_id {
                return Ok(LockOutcome::Held {
                    owner_id: held_by,
                    owner_pid: held_pid,
                    hostname: held_host,
                    refreshed_at,
                });
            }
        }
        tx.execute(
            "INSERT INTO host_lock (id, owner_id, owner_pid, hostname, refreshed_at)
             VALUES (1, ?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
                owner_id = excluded.owner_id,
                owner_pid = excluded.owner_pid,
                hostname = excluded.hostname,
                refreshed_at = excluded.refreshed_at",
            params![owner_id, owner_pid, hostname, now],
        )?;
        tx.commit()?;
        Ok(LockOutcome::Acquired)
    }

    /// Heartbeat for the data-directory lock.
    ///
    /// Distinguishes "we still own it" from "another process took it over"
    /// (stop writing, loudly) and from "the row is gone" (this host released it
    /// while shutting down — stop the heartbeat, do not treat our own clean exit
    /// as a takeover).
    pub fn refresh_host_lock(
        &self,
        owner_id: &str,
        now: i64,
    ) -> Result<LockHeartbeat, rusqlite::Error> {
        let updated = self.conn.execute(
            "UPDATE host_lock SET refreshed_at = ?2 WHERE id = 1 AND owner_id = ?1",
            params![owner_id, now],
        )?;
        if updated == 1 {
            return Ok(LockHeartbeat::Refreshed);
        }
        let holder: Option<(String, i64)> = self
            .conn
            .query_row(
                "SELECT owner_id, owner_pid FROM host_lock WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        Ok(match holder {
            Some((other, pid)) if other != owner_id => LockHeartbeat::TakenOver { owner_pid: pid },
            Some(_) => LockHeartbeat::Refreshed,
            None => LockHeartbeat::Released,
        })
    }

    /// Release the lock when this process stops owning the store.
    pub fn release_host_lock(&self, owner_id: &str) -> Result<(), rusqlite::Error> {
        self.conn.execute(
            "DELETE FROM host_lock WHERE id = 1 AND owner_id = ?1",
            params![owner_id],
        )?;
        Ok(())
    }

    // ── Rooms and invites ─────────────────────────────────────────────────

    pub fn create_room(
        &self,
        room_id: &str,
        doc_id: &str,
        now: i64,
    ) -> Result<(), rusqlite::Error> {
        self.conn.execute(
            "INSERT INTO rooms(room_id, doc_id, created_at, last_activity) VALUES (?1, ?2, ?3, ?3)",
            params![room_id, doc_id, now],
        )?;
        self.conn.execute(
            "INSERT INTO room_sequences(room_id, seq) VALUES (?1, 0)",
            params![room_id],
        )?;
        self.conn.execute(
            "INSERT INTO snapshots(room_id, seq, document_json, created_at) VALUES (?1, 0, ?2, ?3)",
            params![room_id, Value::Null.to_string(), now],
        )?;
        Ok(())
    }

    pub fn create_invite(
        &self,
        token_hash: &str,
        room_id: &str,
        role: ParticipantRole,
        expires_at: i64,
        now: i64,
    ) -> Result<(), rusqlite::Error> {
        self.conn.execute(
            "INSERT INTO invites(token_hash, room_id, role, expires_at, revoked, created_at)
             VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            params![token_hash, room_id, role_str(role), expires_at, now],
        )?;
        Ok(())
    }

    pub fn revoke_invite(&self, token_hash: &str) -> Result<bool, rusqlite::Error> {
        let changed = self.conn.execute(
            "UPDATE invites SET revoked = 1 WHERE token_hash = ?1",
            params![token_hash],
        )?;
        Ok(changed > 0)
    }

    /// Resolve an invite by token hash, enforcing expiry and revocation.
    /// Revocation is an event, not a flag left to be re-read later: a
    /// revoked invite resolves to `None` from this moment on.
    pub fn resolve_invite(
        &self,
        token_hash: &str,
        now: i64,
    ) -> Result<Option<InviteRecord>, rusqlite::Error> {
        let row = self
            .conn
            .query_row(
                "SELECT room_id, role, expires_at, revoked FROM invites WHERE token_hash = ?1",
                params![token_hash],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()?;
        let Some((room_id, role, expires_at, revoked)) = row else {
            return Ok(None);
        };
        if revoked != 0 || expires_at <= now {
            return Ok(None);
        }
        Ok(Some(InviteRecord {
            room_id,
            role: role_from_str(&role)?,
            expires_at,
            revoked: false,
        }))
    }

    /// Live sockets re-check their authorization on every mutation; a
    /// revoked token must stop granting rights immediately.
    pub fn invite_is_still_valid(
        &self,
        token_hash: &str,
        now: i64,
    ) -> Result<bool, rusqlite::Error> {
        Ok(self.resolve_invite(token_hash, now)?.is_some())
    }

    // ── Journal and snapshots ─────────────────────────────────────────────

    /// Append one operation with the next sequence and commit it. The
    /// caller may ack to the network only after this returns Ok.
    /// A client op id that was already journaled yields `Replayed` with the
    /// stored sequence (idempotent retry — never a duplicate entry).
    pub fn append_operation(
        &self,
        room_id: &str,
        client_op_id: &str,
        actor_id: &str,
        payload: &str,
        now: i64,
    ) -> Result<AppendOutcome, RoomStoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let current: i64 = tx.query_row(
            "SELECT seq FROM room_sequences WHERE room_id = ?1",
            params![room_id],
            |row| row.get(0),
        )?;
        let next = current
            .checked_add(1)
            .ok_or(RoomStoreError::SequenceExhausted)?;
        let inserted = tx.execute(
            "INSERT OR IGNORE INTO operations(room_id, seq, client_op_id, actor_id, payload, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![room_id, next, client_op_id, actor_id, payload, now],
        )?;
        if inserted == 0 {
            // Idempotent retry: report the stored sequence.
            let stored: i64 = tx.query_row(
                "SELECT seq FROM operations WHERE room_id = ?1 AND client_op_id = ?2",
                params![room_id, client_op_id],
                |row| row.get(0),
            )?;
            tx.finish()?;
            return Ok(AppendOutcome::Replayed { seq: stored });
        }
        tx.execute(
            "UPDATE room_sequences SET seq = ?2 WHERE room_id = ?1",
            params![room_id, next],
        )?;
        tx.execute(
            "UPDATE rooms SET last_activity = ?2 WHERE room_id = ?1",
            params![room_id, now],
        )?;
        tx.commit()?;
        Ok(AppendOutcome::Appended { seq: next })
    }

    /// Journal entries with seq in (from_seq, to_seq].
    pub fn journal_range(
        &self,
        room_id: &str,
        from_seq: i64,
        to_seq: i64,
    ) -> Result<Vec<(i64, String)>, rusqlite::Error> {
        let mut stmt = self.conn.prepare(
            "SELECT seq, payload FROM operations
             WHERE room_id = ?1 AND seq > ?2 AND seq <= ?3 ORDER BY seq ASC",
        )?;
        let rows = stmt.query_map(params![room_id, from_seq, to_seq], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect()
    }

    pub fn current_seq(&self, room_id: &str) -> Result<i64, rusqlite::Error> {
        self.conn.query_row(
            "SELECT seq FROM room_sequences WHERE room_id = ?1",
            params![room_id],
            |row| row.get(0),
        )
    }

    pub fn baseline(&self, room_id: &str) -> Result<Option<RoomBaseline>, rusqlite::Error> {
        let row = self
            .conn
            .query_row(
                "SELECT seq, document_json FROM snapshots WHERE room_id = ?1",
                params![room_id],
                |row| {
                    Ok(RoomBaseline {
                        seq: row.get(0)?,
                        document_json: row.get(1)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Replace the baseline snapshot and truncate the journal through the
    /// replaced range in ONE transaction (no partial-compaction window).
    /// The `upto_seq` must match the current head: an owner snapshot from a
    /// stale state is rejected rather than silently regressing the room.
    pub fn compact_with_snapshot(
        &self,
        room_id: &str,
        upto_seq: i64,
        document_json: &str,
        now: i64,
    ) -> Result<(), RoomStoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let current: i64 = tx.query_row(
            "SELECT seq FROM room_sequences WHERE room_id = ?1",
            params![room_id],
            |row| row.get(0),
        )?;
        if upto_seq > current {
            return Err(RoomStoreError::SnapshotAheadOfJournal);
        }
        // A snapshot BEHIND the stored baseline would leave a baseline older
        // than the journal range already truncated from it. Refuse instead of
        // silently moving every future joiner backwards.
        let stored: Option<i64> = tx
            .query_row(
                "SELECT seq FROM snapshots WHERE room_id = ?1",
                params![room_id],
                |row| row.get(0),
            )
            .optional()?;
        if stored.is_some_and(|seq| upto_seq < seq) {
            return Err(RoomStoreError::SnapshotBehindBaseline);
        }
        tx.execute(
            "UPDATE snapshots SET seq = ?2, document_json = ?3, created_at = ?4 WHERE room_id = ?1",
            params![room_id, upto_seq, document_json, now],
        )?;
        tx.execute(
            "DELETE FROM operations WHERE room_id = ?1 AND seq <= ?2",
            params![room_id, upto_seq],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn delete_room(&self, room_id: &str) -> Result<(), rusqlite::Error> {
        self.conn.execute(
            "DELETE FROM operations WHERE room_id = ?1",
            params![room_id],
        )?;
        self.conn
            .execute("DELETE FROM snapshots WHERE room_id = ?1", params![room_id])?;
        self.conn
            .execute("DELETE FROM invites WHERE room_id = ?1", params![room_id])?;
        self.conn.execute(
            "DELETE FROM room_sequences WHERE room_id = ?1",
            params![room_id],
        )?;
        self.conn
            .execute("DELETE FROM rooms WHERE room_id = ?1", params![room_id])?;
        Ok(())
    }

    pub fn room_exists(&self, room_id: &str) -> Result<bool, rusqlite::Error> {
        Ok(self
            .conn
            .query_row(
                "SELECT 1 FROM rooms WHERE room_id = ?1",
                params![room_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    pub fn room_doc_id(&self, room_id: &str) -> Result<Option<String>, rusqlite::Error> {
        self.conn
            .query_row(
                "SELECT doc_id FROM rooms WHERE room_id = ?1",
                params![room_id],
                |row| row.get(0),
            )
            .optional()
    }

    /// Room count for the server-wide capacity limit.
    pub fn room_count(&self) -> Result<i64, rusqlite::Error> {
        self.conn
            .query_row("SELECT COUNT(*) FROM rooms", [], |row| row.get(0))
    }
}

/// Outcome of a lock heartbeat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockHeartbeat {
    Refreshed,
    /// Another process owns the directory now.
    TakenOver { owner_pid: i64 },
    /// The lock row is gone: this host released it (shutting down).
    Released,
}

/// Result of taking the data-directory lock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LockOutcome {
    Acquired,
    Held {
        owner_id: String,
        owner_pid: i64,
        hostname: String,
        refreshed_at: i64,
    },
}

/// Outcome of a journal append (see `append_operation`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppendOutcome {
    /// New entry committed at `seq`; safe to ack and relay.
    Appended { seq: i64 },
    /// Already journaled under this client op id at `seq`; re-ack only.
    Replayed { seq: i64 },
}

#[derive(Debug)]
pub enum RoomStoreError {
    /// A snapshot older than the stored baseline was refused.
    SnapshotBehindBaseline,
    /// Another live process owns this data directory.
    HostLocked {
        owner_pid: i64,
        hostname: String,
    },
    Sqlite(rusqlite::Error),
    SequenceExhausted,
    SnapshotAheadOfJournal,
}

impl From<rusqlite::Error> for RoomStoreError {
    fn from(value: rusqlite::Error) -> Self {
        RoomStoreError::Sqlite(value)
    }
}

impl std::fmt::Display for RoomStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RoomStoreError::Sqlite(error) => write!(f, "room store: {error}"),
            RoomStoreError::SequenceExhausted => write!(f, "room sequence exhausted"),
            RoomStoreError::SnapshotAheadOfJournal => {
                write!(f, "snapshot seq is ahead of the journal head")
            }
            RoomStoreError::SnapshotBehindBaseline => {
                write!(f, "snapshot seq is behind the stored baseline")
            }
            RoomStoreError::HostLocked {
                owner_pid,
                hostname,
            } => write!(
                f,
                "another room host (pid {owner_pid} on {hostname}) owns this data directory;                  run one process per data directory"
            ),
        }
    }
}

impl std::error::Error for RoomStoreError {}

pub fn role_str(role: ParticipantRole) -> &'static str {
    match role {
        ParticipantRole::Owner => "owner",
        ParticipantRole::Editor => "editor",
        ParticipantRole::Viewer => "viewer",
    }
}

fn role_from_str(value: &str) -> Result<ParticipantRole, rusqlite::Error> {
    match value {
        "owner" => Ok(ParticipantRole::Owner),
        "editor" => Ok(ParticipantRole::Editor),
        "viewer" => Ok(ParticipantRole::Viewer),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("unknown role: {other}").into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_is_idempotent_by_client_op_id() {
        let store = RoomStore::in_memory().unwrap();
        store.create_room("r1", "doc-1", 1).unwrap();
        let first = store.append_operation("r1", "op-1", "a", "{}", 2).unwrap();
        let retry = store.append_operation("r1", "op-1", "a", "{}", 3).unwrap();
        assert_eq!(first, AppendOutcome::Appended { seq: 1 });
        assert_eq!(retry, AppendOutcome::Replayed { seq: 1 }); // never duplicated
        assert_eq!(store.current_seq("r1").unwrap(), 1);
    }

    #[test]
    fn compaction_refuses_a_snapshot_behind_the_stored_baseline() {
        // Moving the baseline backwards would leave it older than the journal
        // range already truncated from it, and every future joiner would
        // bootstrap from a document the room has moved past.
        let store = RoomStore::in_memory().expect("store");
        store.create_room("r1", "doc", 1).expect("room");
        for seq in 0..3 {
            store
                .append_operation("r1", &format!("op-{seq}"), "actor", "{}", 1)
                .expect("append");
        }
        store
            .compact_with_snapshot("r1", 3, "{\"at\":3}", 1)
            .expect("forward compaction");
        assert!(matches!(
            store.compact_with_snapshot("r1", 1, "{\"at\":1}", 1),
            Err(RoomStoreError::SnapshotBehindBaseline)
        ));
        // The stored baseline is untouched by the refusal.
        let baseline = store.baseline("r1").expect("baseline").expect("some");
        assert_eq!(baseline.seq, 3);
        assert_eq!(baseline.document_json, "{\"at\":3}");
    }

    #[test]
    fn compaction_is_atomic_and_rejects_ahead_of_head() {
        let store = RoomStore::in_memory().unwrap();
        store.create_room("r1", "doc-1", 1).unwrap();
        store.append_operation("r1", "op-1", "a", "{}", 2).unwrap();
        assert!(matches!(
            store.compact_with_snapshot("r1", 5, "{}", 3),
            Err(RoomStoreError::SnapshotAheadOfJournal)
        ));
        store
            .compact_with_snapshot("r1", 1, "{\"id\":\"d\"}", 3)
            .unwrap();
        assert_eq!(store.current_seq("r1").unwrap(), 1);
        assert!(store.journal_range("r1", 0, 1).unwrap().is_empty());
        assert_eq!(store.baseline("r1").unwrap().unwrap().seq, 1);
    }

    #[test]
    fn revoked_and_expired_invites_do_not_resolve() {
        let store = RoomStore::in_memory().unwrap();
        store.create_room("r1", "doc-1", 1).unwrap();
        store
            .create_invite("hash-1", "r1", ParticipantRole::Editor, 1_000, 1)
            .unwrap();
        assert!(store.resolve_invite("hash-1", 500).unwrap().is_some());
        assert!(store.resolve_invite("hash-1", 2_000).unwrap().is_none()); // expired
        store.revoke_invite("hash-1").unwrap();
        assert!(store.resolve_invite("hash-1", 500).unwrap().is_none()); // revoked
    }
}

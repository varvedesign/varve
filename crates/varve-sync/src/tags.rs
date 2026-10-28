//! Home workspace tags and file-tag associations.
//!
//! Additive schema (v3): `home_tags` is workspace-scoped with a unique
//! `(workspace_id, name)` constraint; `home_file_tags` is the association table.
//! Timestamps are epoch milliseconds to match the TypeScript `Tag` contract in
//! `packages/platform/src/types.ts`.

use rusqlite::params;

use crate::{DocumentStore, FileRow};

/// A workspace tag row (mirrors the TS `Tag`).
#[derive(Debug, Clone)]
pub struct TagRow {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Additive schema for workspace tags (version 3).
pub(crate) fn migrate(transaction: &rusqlite::Transaction<'_>) -> Result<(), rusqlite::Error> {
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS home_tags (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            name TEXT NOT NULL,
            color TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE (workspace_id, name)
        );
        CREATE TABLE IF NOT EXISTS home_file_tags (
            file_id TEXT NOT NULL,
            tag_id TEXT NOT NULL,
            added_at INTEGER NOT NULL,
            PRIMARY KEY (file_id, tag_id)
        );
        CREATE INDEX IF NOT EXISTS home_file_tags_tag ON home_file_tags(tag_id);
        CREATE INDEX IF NOT EXISTS home_tags_workspace ON home_tags(workspace_id);",
    )
}

impl DocumentStore {
    fn row_to_tag(row: &rusqlite::Row) -> rusqlite::Result<TagRow> {
        Ok(TagRow {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            name: row.get(2)?,
            color: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    }

    pub fn list_tags(&self, workspace_id: &str) -> Result<Vec<TagRow>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, workspace_id, name, color, created_at, updated_at
             FROM home_tags WHERE workspace_id = ?1 ORDER BY name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map(params![workspace_id], Self::row_to_tag)?;
        rows.collect()
    }

    /// Insert a tag. A duplicate `(workspace_id, name)` is an error the caller
    /// reports; it is not silently merged.
    pub fn create_tag(
        &self,
        id: &str,
        workspace_id: &str,
        name: &str,
        color: Option<&str>,
        now: i64,
    ) -> Result<TagRow, rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO home_tags (id, workspace_id, name, color, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, workspace_id, name, color, now],
        )?;
        Ok(TagRow {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            name: name.to_string(),
            color: color.map(str::to_string),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn rename_tag(&self, id: &str, name: &str, now: i64) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "UPDATE home_tags SET name = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, name, now],
        )?;
        Ok(())
    }

    /// Delete a tag and its associations in one transaction.
    pub fn delete_tag(&self, id: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute("DELETE FROM home_file_tags WHERE tag_id = ?1", params![id])?;
        conn.execute("DELETE FROM home_tags WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_file_tags(&self, file_id: &str) -> Result<Vec<TagRow>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT t.id, t.workspace_id, t.name, t.color, t.created_at, t.updated_at
             FROM home_tags t
             JOIN home_file_tags ft ON ft.tag_id = t.id
             WHERE ft.file_id = ?1 ORDER BY t.name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map(params![file_id], Self::row_to_tag)?;
        rows.collect()
    }

    /// Idempotent: re-adding an existing association keeps the original time.
    pub fn add_file_tag(
        &self,
        file_id: &str,
        tag_id: &str,
        now: i64,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "INSERT OR IGNORE INTO home_file_tags (file_id, tag_id, added_at)
             VALUES (?1, ?2, ?3)",
            params![file_id, tag_id, now],
        )?;
        Ok(())
    }

    pub fn remove_file_tag(&self, file_id: &str, tag_id: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn();
        conn.execute(
            "DELETE FROM home_file_tags WHERE file_id = ?1 AND tag_id = ?2",
            params![file_id, tag_id],
        )?;
        Ok(())
    }

    pub fn list_files_by_tag(&self, tag_id: &str) -> Result<Vec<FileRow>, rusqlite::Error> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT f.id, f.name, f.kind, f.project_id, f.created_at, f.updated_at,
                    f.opened_at, f.size, f.pinned, f.trashed_at, f.file_path,
                    f.ordering, f.content_hash, f.favorited_at
             FROM files f
             JOIN home_file_tags ft ON ft.file_id = f.id
             WHERE ft.tag_id = ?1 AND f.trashed_at IS NULL
             ORDER BY f.name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map(params![tag_id], Self::row_to_file)?;
        rows.collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn store(label: &str) -> (DocumentStore, PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "varve-sync-tags-{}-{}.sqlite",
            label,
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        (DocumentStore::new(&path).expect("store"), path)
    }

    #[test]
    fn tags_round_trip_and_scope_by_workspace() {
        let (store, path) = store("round-trip");
        store
            .create_tag("t1", "w1", "alpha", Some("#ff0000"), 10)
            .unwrap();
        store.create_tag("t2", "w1", "beta", None, 11).unwrap();
        store.create_tag("t3", "w2", "gamma", None, 12).unwrap();

        let w1 = store.list_tags("w1").unwrap();
        assert_eq!(w1.len(), 2);
        assert_eq!(w1[0].name, "alpha");
        assert_eq!(w1[0].color.as_deref(), Some("#ff0000"));
        assert_eq!(store.list_tags("w2").unwrap().len(), 1);

        store.rename_tag("t1", "alpha-renamed", 20).unwrap();
        assert_eq!(store.list_tags("w1").unwrap()[0].name, "alpha-renamed");
        assert_eq!(store.list_tags("w1").unwrap()[0].updated_at, 20);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn duplicate_tag_name_in_one_workspace_is_rejected() {
        let (store, path) = store("duplicate");
        store.create_tag("t1", "w1", "dup", None, 1).unwrap();
        assert!(store.create_tag("t2", "w1", "dup", None, 2).is_err());
        // The same name in another workspace is allowed.
        assert!(store.create_tag("t3", "w2", "dup", None, 3).is_ok());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn file_tags_are_idempotent_and_removable() {
        let (store, path) = store("file-tags");
        store.create_tag("t1", "w1", "alpha", None, 1).unwrap();
        store.add_file_tag("f1", "t1", 5).unwrap();
        store.add_file_tag("f1", "t1", 9).unwrap();
        assert_eq!(store.list_file_tags("f1").unwrap().len(), 1);
        store.remove_file_tag("f1", "t1").unwrap();
        assert!(store.list_file_tags("f1").unwrap().is_empty());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn deleting_a_tag_removes_its_associations() {
        let (store, path) = store("delete");
        store.create_tag("t1", "w1", "alpha", None, 1).unwrap();
        store.add_file_tag("f1", "t1", 5).unwrap();
        store.delete_tag("t1").unwrap();
        assert!(store.list_file_tags("f1").unwrap().is_empty());
        assert!(store.list_tags("w1").unwrap().is_empty());
        let _ = std::fs::remove_file(path);
    }
}

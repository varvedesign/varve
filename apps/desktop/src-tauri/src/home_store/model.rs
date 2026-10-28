//! Home wire types shared by the native command modules.
//!
//! Wire structs keep the existing camelCase field renames so the TypeScript
//! adapters in `packages/platform/src/tauri.ts` remain the contract.

use serde::{Deserialize, Serialize};

// ── Home IPC Commands ────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub(crate) struct HomeFile {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) project_id: Option<String>,
    #[serde(rename = "createdAt")]
    pub(crate) created_at: i64,
    #[serde(rename = "updatedAt")]
    pub(crate) updated_at: i64,
    #[serde(rename = "openedAt")]
    pub(crate) opened_at: i64,
    pub(crate) size: i64,
    pub(crate) pinned: bool,
    #[serde(rename = "trashedAt")]
    pub(crate) trashed_at: Option<i64>,
    #[serde(rename = "filePath")]
    pub(crate) file_path: Option<String>,
    pub(crate) ordering: String,
    #[serde(rename = "contentHash")]
    pub(crate) content_hash: String,
    #[serde(rename = "favoritedAt", skip_serializing_if = "Option::is_none")]
    pub(crate) favorited_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeFileInput {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) project_id: Option<String>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
    pub(crate) opened_at: i64,
    pub(crate) size: i64,
    pub(crate) pinned: bool,
    #[serde(default)]
    pub(crate) trashed_at: Option<i64>,
    #[serde(default)]
    pub(crate) file_path: Option<String>,
    #[serde(default)]
    pub(crate) ordering: String,
    pub(crate) content_hash: String,
    #[serde(default)]
    pub(crate) favorited_at: Option<i64>,
}

#[derive(Debug, Serialize)]
pub(crate) struct HomeProject {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) color: Option<String>,
    #[serde(rename = "createdAt")]
    pub(crate) created_at: i64,
    #[serde(rename = "updatedAt")]
    pub(crate) updated_at: i64,
    pub(crate) pinned: bool,
    #[serde(rename = "trashedAt")]
    pub(crate) trashed_at: Option<i64>,
}

pub(crate) fn file_to_home(f: varve_sync::FileRow) -> HomeFile {
    HomeFile {
        id: f.id,
        name: f.name,
        kind: f.kind,
        project_id: f.project_id,
        created_at: rfc3339_to_epoch_ms(&f.created_at),
        updated_at: rfc3339_to_epoch_ms(&f.updated_at),
        opened_at: rfc3339_to_epoch_ms(&f.opened_at),
        size: f.size,
        pinned: f.pinned,
        trashed_at: f.trashed_at.as_ref().map(|s| rfc3339_to_epoch_ms(s)),
        file_path: f.file_path,
        ordering: f.ordering,
        content_hash: f.content_hash,
        favorited_at: f.favorited_at.filter(|&t| t > 0),
    }
}

pub(crate) fn project_to_home(p: varve_sync::ProjectRow) -> HomeProject {
    HomeProject {
        id: p.id,
        name: p.name,
        color: p.color,
        created_at: rfc3339_to_epoch_ms(&p.created_at),
        updated_at: rfc3339_to_epoch_ms(&p.updated_at),
        pinned: p.pinned,
        trashed_at: p.trashed_at.as_ref().map(|s| rfc3339_to_epoch_ms(s)),
    }
}

/// Recent-file record, mirroring the TS `RecentFileRecord` shape.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentFileRecord {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) last_opened_at: i64,
    pub(crate) opened_count: i64,
    pub(crate) pinned: bool,
    pub(crate) hidden: bool,
    pub(crate) workspace_relevance: Vec<String>,
    pub(crate) user_workspace_tag: Option<String>,
    pub(crate) encrypted: bool,
    pub(crate) missing: bool,
    pub(crate) version: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source_workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) content_hash: Option<String>,
}

pub(crate) fn recent_to_home(r: varve_sync::RecentRow) -> RecentFileRecord {
    let workspace_relevance = serde_json::from_str(&r.workspace_relevance).unwrap_or_default();
    RecentFileRecord {
        id: r.id,
        name: r.name,
        last_opened_at: r.last_opened_at,
        opened_count: r.opened_count,
        pinned: r.pinned,
        hidden: r.hidden,
        workspace_relevance,
        user_workspace_tag: r.user_workspace_tag,
        encrypted: r.encrypted,
        missing: r.missing,
        version: r.version,
        source_workspace_id: r.source_workspace_id,
        content_hash: r.content_hash,
    }
}

/// Frontend-editable recent-file fields. Identity and counters are owned by
/// the store and are never accepted from the frontend.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct RecentFilePatch {
    pub(crate) pinned: Option<bool>,
    pub(crate) hidden: Option<bool>,
    pub(crate) user_workspace_tag: Option<Option<String>>,
    pub(crate) name: Option<String>,
    pub(crate) missing: Option<bool>,
}

pub(crate) fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub(crate) fn rfc3339_to_epoch_ms(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

pub(crate) fn epoch_ms_to_rfc3339(ms: i64) -> String {
    let secs = ms / 1000;
    let nanos = ((ms % 1000) * 1_000_000) as u32;
    match chrono::DateTime::from_timestamp(secs, nanos) {
        Some(dt) => dt.to_rfc3339(),
        None => now_rfc3339(),
    }
}

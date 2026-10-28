//! Home thumbnails, search, recent files and on-disk text IO commands.

use super::model::*;
use crate::{filesystem, resolve_user_path, resolve_user_path_approved, write_file_atomic};
use serde::Deserialize;

// ── Thumbnails ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThumbnailInput {
    hash: String,
    data_url: String,
    width: i64,
    height: i64,
    created_at: i64,
}

#[tauri::command]
pub(crate) fn home_get_thumbnail(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    hash: String,
) -> Result<Option<String>, String> {
    store.get_thumbnail(&hash).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_put_thumbnail(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    input: ThumbnailInput,
) -> Result<(), String> {
    store
        .put_thumbnail(
            &input.hash,
            &input.data_url,
            input.width,
            input.height,
            &epoch_ms_to_rfc3339(input.created_at),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_evict_thumbnails(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    keep_count: i64,
) -> Result<i64, String> {
    store
        .evict_thumbnails(keep_count)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_delete_thumbnail(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    hash: String,
) -> Result<(), String> {
    store.delete_thumbnail(&hash).map_err(|e| e.to_string())
}

// ── Search ───────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn home_search_files(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    query: String,
) -> Result<Vec<HomeFile>, String> {
    store
        .search_files(&query)
        .map(|v| v.into_iter().map(file_to_home).collect())
        .map_err(|e| e.to_string())
}

// ── Reorder ──────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn home_reorder_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    ordering: String,
) -> Result<(), String> {
    store
        .reorder_file(&id, &ordering)
        .map_err(|e| e.to_string())
}

// ── Recent files ─────────────────────────────────────────────────────────
//
// The recent list lives in the same SQLite store as the Home index, so it
// survives restarts and stays consistent with file rows. Records keep
// `missing` and `hidden` state instead of being deleted when a path is
// temporarily unavailable (network/removable volumes), so a reconnect does
// not lose history.

#[tauri::command]
pub(crate) fn home_list_recent_files(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    limit: Option<i64>,
) -> Result<Vec<RecentFileRecord>, String> {
    let limit = limit.unwrap_or(50).clamp(1, 200);
    store
        .list_recent_files(limit)
        .map(|rows| rows.into_iter().map(recent_to_home).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_touch_recent_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    name: String,
    source_workspace_id: Option<String>,
    content_hash: Option<String>,
) -> Result<RecentFileRecord, String> {
    store
        .touch_recent_file(
            &id,
            &name,
            source_workspace_id.as_deref(),
            content_hash.as_deref(),
        )
        .map(recent_to_home)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_patch_recent_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    patch: RecentFilePatch,
) -> Result<(), String> {
    store
        .patch_recent_file(
            &id,
            patch.pinned,
            patch.hidden,
            patch.user_workspace_tag,
            patch.name,
            patch.missing,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_remove_recent_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<(), String> {
    store.remove_recent_file(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_clear_recent_history(
    store: tauri::State<'_, varve_sync::DocumentStore>,
) -> Result<(), String> {
    store.clear_recent_history().map_err(|e| e.to_string())
}

// ── File-system read/write (for open/save from disk) ─────────────────────

#[tauri::command]
pub(crate) fn home_read_text_file(path: String) -> Result<String, String> {
    let resolved = resolve_user_path(&path)?;
    std::fs::read_to_string(&resolved).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_write_text_file(path: String, contents: String) -> Result<(), String> {
    let resolved = resolve_user_path(&path)?;
    write_file_atomic(&resolved, contents.as_bytes())
}

// Dialog-approved variants: paths chosen through the native open/save
// dialogs (see resolve_user_path_approved). Documents may legitimately live
// outside $HOME (other drives, removable media, network mounts); the strict
// home-scope variants above remain for anything whose path did not come
// from a user dialog.

#[tauri::command]
pub(crate) fn home_read_text_file_approved(path: String) -> Result<String, filesystem::FsError> {
    let resolved = resolve_user_path_approved(&path).map_err(|message| {
        // The only resolver rejection that means "the file and its parent
        // chain are gone" is the no-existing-ancestor case; every other
        // rejection is an invalid or traversing path.
        let kind = if message.contains("does not resolve to any existing ancestor") {
            filesystem::FsErrorKind::NotFound
        } else {
            filesystem::FsErrorKind::InvalidPath
        };
        filesystem::FsError::new(kind, message)
    })?;
    std::fs::read_to_string(&resolved)
        .map_err(|error| filesystem::FsError::from_io("read", &resolved, &error))
}

#[tauri::command]
pub(crate) fn home_write_text_file_approved(path: String, contents: String) -> Result<(), String> {
    let resolved = resolve_user_path_approved(&path)?;
    write_file_atomic(&resolved, contents.as_bytes())
}

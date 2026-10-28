//! Home workspace-tag commands (pilot group for the `varve-sync`-backed Home
//! surface). See `docs/plans/agent-infrastructure-campaign-2026-10-28.md`.

use serde::Serialize;

use crate::home_store::model::file_to_home;
use crate::uuid;

/// A workspace tag (mirrors the TS `Tag` in `packages/platform/src/types.ts`).
#[derive(Debug, Serialize)]
pub(crate) struct HomeTag {
    pub(crate) id: String,
    #[serde(rename = "workspaceId")]
    pub(crate) workspace_id: String,
    pub(crate) name: String,
    pub(crate) color: Option<String>,
    #[serde(rename = "createdAt")]
    pub(crate) created_at: i64,
    #[serde(rename = "updatedAt")]
    pub(crate) updated_at: i64,
}

fn to_home_tag(row: varve_sync::TagRow) -> HomeTag {
    HomeTag {
        id: row.id,
        workspace_id: row.workspace_id,
        name: row.name,
        color: row.color,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[tauri::command]
pub(crate) fn home_list_tags(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    workspace_id: String,
) -> Result<Vec<HomeTag>, String> {
    store
        .list_tags(&workspace_id)
        .map(|rows| rows.into_iter().map(to_home_tag).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_create_tag(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    workspace_id: String,
    name: String,
    color: Option<String>,
) -> Result<HomeTag, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("tag name must not be empty".to_string());
    }
    let row = store
        .create_tag(&uuid(), &workspace_id, trimmed, color.as_deref(), now_ms())
        .map_err(|e| e.to_string())?;
    Ok(to_home_tag(row))
}

#[tauri::command]
pub(crate) fn home_rename_tag(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    name: String,
) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("tag name must not be empty".to_string());
    }
    store
        .rename_tag(&id, trimmed, now_ms())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_delete_tag(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<(), String> {
    store.delete_tag(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_list_file_tags(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    file_id: String,
) -> Result<Vec<HomeTag>, String> {
    store
        .list_file_tags(&file_id)
        .map(|rows| rows.into_iter().map(to_home_tag).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_add_file_tag(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    file_id: String,
    tag_id: String,
) -> Result<(), String> {
    store
        .add_file_tag(&file_id, &tag_id, now_ms())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_remove_file_tag(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    file_id: String,
    tag_id: String,
) -> Result<(), String> {
    store
        .remove_file_tag(&file_id, &tag_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_list_files_by_tag(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    tag_id: String,
) -> Result<Vec<crate::home_store::model::HomeFile>, String> {
    store
        .list_files_by_tag(&tag_id)
        .map(|rows| rows.into_iter().map(file_to_home).collect())
        .map_err(|e| e.to_string())
}

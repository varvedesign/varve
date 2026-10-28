//! Home document, project, settings and view-state commands.

use super::model::*;
use crate::uuid;

// Files
#[tauri::command]
pub(crate) fn home_list_files(
    store: tauri::State<'_, varve_sync::DocumentStore>,
) -> Result<Vec<HomeFile>, String> {
    store
        .list_files()
        .map(|v| v.into_iter().map(file_to_home).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_list_trashed(
    store: tauri::State<'_, varve_sync::DocumentStore>,
) -> Result<Vec<HomeFile>, String> {
    store
        .list_trashed_files()
        .map(|v| v.into_iter().map(file_to_home).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_get_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<Option<HomeFile>, String> {
    store
        .get_file(&id)
        .map(|opt| opt.map(file_to_home))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_read_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<Option<String>, String> {
    store.load_document(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_file_exists(path: String) -> bool {
    is_probeable_absolute_path(&path).is_some() && std::path::Path::new(&path).exists()
}

/// Batch existence probe for Home's missing-file sweep. One IPC round-trip
/// instead of one per file row. Per-path validation failures report `false`
/// (never-found), which is the conservative reading for an invalid input.
#[tauri::command]
pub(crate) fn home_check_files_exist(paths: Vec<String>) -> Vec<bool> {
    paths
        .into_iter()
        .map(|path| match is_probeable_absolute_path(&path) {
            Some(validated) => validated.exists(),
            None => false,
        })
        .collect()
}

/// An existence probe must never accept relative or NUL-containing input, so
/// a compromised renderer cannot turn this command into a path oracle for
/// arbitrary strings. Only absolute OS paths (the shape native dialogs and
/// drag/drop produce) are probed.
pub(crate) fn is_probeable_absolute_path(path: &str) -> Option<&std::path::Path> {
    if path.is_empty() || path.contains('\0') {
        return None;
    }
    let parsed = std::path::Path::new(path);
    if !parsed.is_absolute() {
        return None;
    }
    Some(parsed)
}

#[tauri::command]
pub(crate) fn home_upsert_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    entry: HomeFileInput,
    json: String,
) -> Result<(), String> {
    // Single transaction: the document JSON and its file row are committed
    // together — a crash between the two statements must not leave a row
    // pointing at missing content (save_document_with_file).
    let row = varve_sync::FileRow {
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        project_id: entry.project_id,
        created_at: epoch_ms_to_rfc3339(entry.created_at),
        updated_at: epoch_ms_to_rfc3339(entry.updated_at),
        opened_at: epoch_ms_to_rfc3339(entry.opened_at),
        size: entry.size,
        pinned: entry.pinned,
        trashed_at: entry.trashed_at.map(epoch_ms_to_rfc3339),
        file_path: entry.file_path,
        ordering: entry.ordering,
        content_hash: entry.content_hash,
        favorited_at: entry.favorited_at.filter(|&t| t > 0),
    };
    store
        .save_document_with_file(&json, &row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_touch_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    opened_at: Option<i64>,
) -> Result<(), String> {
    let ts = opened_at
        .map(epoch_ms_to_rfc3339)
        .unwrap_or_else(now_rfc3339);
    store.touch_file(&id, &ts).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_rename_file(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    name: String,
) -> Result<(), String> {
    store.rename_file(&id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_set_pinned(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    store
        .set_file_pinned(&id, pinned)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_set_favorited(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    favorited_at: Option<i64>,
) -> Result<(), String> {
    let at = favorited_at.filter(|&t| t > 0);
    store.set_file_favorited(&id, at).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_move_project(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    project_id: Option<String>,
) -> Result<(), String> {
    store
        .move_file_to_project(&id, project_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_trash(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<(), String> {
    store
        .trash_file(&id, &now_rfc3339())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_restore(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<(), String> {
    store.restore_file(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_purge(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<(), String> {
    store.purge_file(&id).map_err(|e| e.to_string())
}

// Projects
#[tauri::command]
pub(crate) fn home_list_projects(
    store: tauri::State<'_, varve_sync::DocumentStore>,
) -> Result<Vec<HomeProject>, String> {
    store
        .list_projects()
        .map(|v| v.into_iter().map(project_to_home).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_create_project(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    name: String,
) -> Result<HomeProject, String> {
    let id = uuid();
    let now_rfc = now_rfc3339();
    let now_ms = chrono::Utc::now().timestamp_millis();
    store
        .create_project(&id, &name, None, &now_rfc)
        .map_err(|e| e.to_string())?;
    Ok(HomeProject {
        id,
        name: name.clone(),
        color: None,
        created_at: now_ms,
        updated_at: now_ms,
        pinned: false,
        trashed_at: None,
    })
}

#[tauri::command]
pub(crate) fn home_rename_project(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    name: String,
) -> Result<(), String> {
    store.rename_project(&id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_delete_project(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
) -> Result<(), String> {
    store.delete_project(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_set_project_pinned(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    store
        .set_project_pinned(&id, pinned)
        .map_err(|e| e.to_string())
}

// View State
#[tauri::command]
pub(crate) fn home_get_view_state(
    store: tauri::State<'_, varve_sync::DocumentStore>,
) -> Result<Option<String>, String> {
    store.get_view_state("home").map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn home_set_view_state(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    value: String,
) -> Result<(), String> {
    store
        .set_view_state("home", &value)
        .map_err(|e| e.to_string())
}

// Generic small app settings (e.g. onboarding-complete) — persisted in the
// same native SQLite store as documents, rather than WebView localStorage,
// which is not guaranteed to survive between separate app launches on every
// platform/WebView engine.
#[tauri::command]
pub(crate) fn app_get_setting(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    key: String,
) -> Result<Option<String>, String> {
    store
        .get_view_state(&format!("app-setting:{key}"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn app_set_setting(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    key: String,
    value: String,
) -> Result<(), String> {
    store
        .set_view_state(&format!("app-setting:{key}"), &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn app_compare_and_set_setting(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    key: String,
    expected_value: Option<String>,
    next_value: String,
) -> Result<bool, String> {
    store
        .compare_and_set_view_state(
            &format!("app-setting:{key}"),
            expected_value.as_deref(),
            &next_value,
        )
        .map_err(|e| e.to_string())
}

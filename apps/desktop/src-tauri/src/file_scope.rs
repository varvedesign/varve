//! Rust-side allowlist for frontend-supplied filesystem paths.
//!
//! Tauri's `fs` plugin scope does not apply to custom `#[tauri::command]`
//! functions that call `std::fs` directly. A path becomes allowed only when
//! it originated from one of:
//!
//! - a native open/save/folder dialog invoked from this module
//! - an OS drag-and-drop event recorded on the Rust side
//! - a file-association or CLI open argument
//! - the app's own data, config, cache, state, log, temp, and resource dirs
//! - a recent file the user previously picked, persisted and re-validated
//!
//! Sibling access is granted only for an opened or saved document: the
//! document's parent directory tree, so linked assets beside the file (and
//! in adjacent asset folders) can be read. An export folder the user picked
//! grants the directory tree under that folder. Dropped files and imported
//! models are exact-path grants.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;

use crate::filesystem::AppDirectories;

const SCOPE_UNAVAILABLE: &str = "File scope is unavailable";
const OUTSIDE_SCOPE: &str = "Path is outside the allowed file scope. Open it with a file dialog, drop it on the window, or choose a file you previously opened.";
const PERSIST_NAME: &str = "file-scope.json";
const PERSIST_VERSION: u32 = 1;

/// How far a grant extends from its canonical path.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GrantKind {
    /// Only this exact file (dropped files, imported models, binary saves).
    Exact,
    /// The opened/saved document plus its parent directory tree.
    ///
    /// Needed so linked assets next to a document remain readable without
    /// granting the rest of the volume.
    DocumentSiblings,
    /// A user-picked export (or other) folder and every descendant.
    DirectoryTree,
}

/// Why a path was admitted. App-directory grants are computed, not persisted.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GrantSource {
    Dialog,
    Drop,
    CliOrAssociation,
    AppDirectory,
    Recent,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Grant {
    path: PathBuf,
    kind: GrantKind,
    source: GrantSource,
}

#[derive(Serialize, Deserialize)]
struct PersistFile {
    version: u32,
    grants: Vec<Grant>,
}

/// In-memory allowlist plus optional persistence under the app data dir.
pub struct FileScope {
    grants: Vec<Grant>,
    persist_path: Option<PathBuf>,
}

impl FileScope {
    pub fn new() -> Self {
        Self {
            grants: Vec::new(),
            persist_path: None,
        }
    }

    pub fn set_persist_path(&mut self, path: PathBuf) {
        self.persist_path = Some(path);
    }

    pub fn persist_path_for(directories: &AppDirectories) -> PathBuf {
        directories.data.join(PERSIST_NAME)
    }

    pub fn allow_app_directories(&mut self, directories: &AppDirectories) {
        for root in [
            &directories.data,
            &directories.config,
            &directories.cache,
            &directories.state,
            &directories.temporary,
            &directories.resources,
            &directories.fonts,
            &directories.models,
            &directories.recovery,
            &directories.crash_reports,
            &directories.logs,
            &directories.thumbnails,
            &directories.staging,
        ] {
            if let Ok(canonical) = canonicalize_existing_or_self(root) {
                self.upsert(Grant {
                    path: canonical,
                    kind: GrantKind::DirectoryTree,
                    source: GrantSource::AppDirectory,
                });
            }
        }
    }

    pub fn grant(
        &mut self,
        raw: &str,
        kind: GrantKind,
        source: GrantSource,
    ) -> Result<PathBuf, String> {
        let path = canonicalize_user_path(raw)?;
        self.upsert(Grant {
            path: path.clone(),
            kind,
            source,
        });
        Ok(path)
    }

    /// Re-validate previously picked document paths. Only `.varve` / `.strata`
    /// files are admitted, so a planted `/etc/hosts` recent cannot become a
    /// grant. Used for the one-time upgrade from the pre-scope store.
    pub fn hydrate_recent(&mut self, paths: impl IntoIterator<Item = impl AsRef<str>>) {
        for path in paths {
            let raw = path.as_ref();
            if raw.is_empty() {
                continue;
            }
            let candidate = Path::new(raw);
            if !is_document_path(candidate) {
                continue;
            }
            match canonicalize_user_path(raw) {
                Ok(canonical) => self.upsert(Grant {
                    path: canonical,
                    kind: GrantKind::DocumentSiblings,
                    source: GrantSource::Recent,
                }),
                Err(_) => continue,
            }
        }
    }

    pub fn resolve(&self, raw: &str) -> Result<PathBuf, String> {
        let canonical = canonicalize_user_path(raw)?;
        if self.is_allowed(&canonical) {
            Ok(canonical)
        } else {
            Err(OUTSIDE_SCOPE.to_string())
        }
    }

    pub fn is_allowed(&self, canonical: &Path) -> bool {
        self.grants.iter().any(|grant| match grant.kind {
            GrantKind::Exact => canonical == grant.path,
            GrantKind::DocumentSiblings => {
                if canonical == grant.path {
                    return true;
                }
                let Some(parent) = grant.path.parent() else {
                    return false;
                };
                canonical.starts_with(parent)
            }
            GrantKind::DirectoryTree => canonical.starts_with(&grant.path),
        })
    }

    pub fn load_persisted(&mut self) -> Result<(), String> {
        let Some(path) = &self.persist_path else {
            return Ok(());
        };
        if !path.exists() {
            return Ok(());
        }
        let bytes = std::fs::read(path).map_err(|e| format!("Failed to read file scope: {e}"))?;
        let parsed: PersistFile = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Failed to parse file scope: {e}"))?;
        if parsed.version != PERSIST_VERSION {
            return Ok(());
        }
        for grant in parsed.grants {
            if grant.source == GrantSource::AppDirectory {
                continue;
            }
            match canonicalize_user_path(&path_to_ipc(&grant.path).unwrap_or_default()) {
                Ok(canonical) => self.upsert(Grant {
                    path: canonical,
                    kind: grant.kind,
                    source: grant.source,
                }),
                Err(_) => continue,
            }
        }
        Ok(())
    }

    pub fn persist(&self) -> Result<(), String> {
        let Some(path) = &self.persist_path else {
            return Ok(());
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create file-scope directory: {e}"))?;
        }
        let grants = self
            .grants
            .iter()
            .filter(|grant| grant.source != GrantSource::AppDirectory)
            .cloned()
            .collect::<Vec<_>>();
        let payload = PersistFile {
            version: PERSIST_VERSION,
            grants,
        };
        let bytes = serde_json::to_vec_pretty(&payload)
            .map_err(|e| format!("Failed to serialize file scope: {e}"))?;
        std::fs::write(path, bytes).map_err(|e| format!("Failed to persist file scope: {e}"))
    }

    fn upsert(&mut self, grant: Grant) {
        if let Some(existing) = self
            .grants
            .iter_mut()
            .find(|candidate| candidate.path == grant.path && candidate.source == grant.source)
        {
            if grant_rank(grant.kind) > grant_rank(existing.kind) {
                existing.kind = grant.kind;
            }
            return;
        }
        self.grants.push(grant);
    }
}

fn grant_rank(kind: GrantKind) -> u8 {
    match kind {
        GrantKind::Exact => 0,
        GrantKind::DocumentSiblings => 1,
        GrantKind::DirectoryTree => 2,
    }
}

/// Canonicalize an untrusted, frontend-supplied path.
///
/// Existing paths are resolved through the kernel (symlinks included).
/// Not-yet-existing paths walk up to the nearest existing ancestor, then
/// re-join the remaining components. Lexical `.` / `..` are rejected before
/// any syscall so `existing/../../etc/passwd` cannot sneak through.
pub fn canonicalize_user_path(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() {
        return Err("Path must not be empty".into());
    }
    if raw.contains('\0') {
        return Err("Path must not contain NUL bytes".into());
    }
    let path = Path::new(raw);
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Path must not contain '..'".into());
    }

    if path.exists() {
        return std::fs::canonicalize(path).map_err(|e| format!("Failed to resolve path: {e}"));
    }

    let mut ancestor = path;
    let mut suffix: Vec<&std::ffi::OsStr> = Vec::new();
    loop {
        if ancestor.exists() {
            break;
        }
        let Some(name) = ancestor.file_name() else {
            return Err("Path does not resolve to any existing ancestor directory".into());
        };
        if name != "." {
            suffix.push(name);
        }
        let Some(parent) = ancestor.parent() else {
            return Err("Path does not resolve to any existing ancestor directory".into());
        };
        ancestor = parent;
    }
    let mut resolved = std::fs::canonicalize(ancestor).map_err(|e| {
        format!(
            "Failed to resolve existing ancestor {}: {e}",
            ancestor.display()
        )
    })?;
    for component in suffix.into_iter().rev() {
        resolved.push(component);
    }
    Ok(resolved)
}

fn is_document_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            extension.eq_ignore_ascii_case("varve") || extension.eq_ignore_ascii_case("strata")
        })
        .unwrap_or(false)
}

fn canonicalize_existing_or_self(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        std::fs::canonicalize(path).map_err(|e| format!("Failed to resolve path: {e}"))
    } else {
        Ok(path.to_path_buf())
    }
}

fn path_to_ipc(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "Path cannot be represented by the desktop IPC boundary".to_string())
}

/// Managed mutex wrapper installed on the Tauri app.
pub struct FileScopeState(pub Mutex<FileScope>);

impl FileScopeState {
    pub fn new(scope: FileScope) -> Self {
        Self(Mutex::new(scope))
    }

    pub fn resolve(&self, raw: &str) -> Result<PathBuf, String> {
        self.lock()?.resolve(raw)
    }

    pub fn grant(
        &self,
        raw: &str,
        kind: GrantKind,
        source: GrantSource,
    ) -> Result<PathBuf, String> {
        let mut scope = self.lock()?;
        let path = scope.grant(raw, kind, source)?;
        let _ = scope.persist();
        Ok(path)
    }

    pub fn grant_path(
        &self,
        path: &Path,
        kind: GrantKind,
        source: GrantSource,
    ) -> Result<PathBuf, String> {
        let raw = path_to_ipc(path)?;
        self.grant(&raw, kind, source)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, FileScope>, String> {
        self.0.lock().map_err(|_| SCOPE_UNAVAILABLE.to_string())
    }
}

/// Record OS drag-and-drop paths on the Rust side. The frontend still
/// receives Tauri's drag events, but `read_dropped_file` will refuse any
/// path that was not actually dropped.
pub fn record_drag_drop(app: &AppHandle, event: &WindowEvent) {
    let WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event else {
        return;
    };
    let Some(scope) = app.try_state::<FileScopeState>() else {
        return;
    };
    for path in paths {
        let _ = scope.grant_path(path, GrantKind::Exact, GrantSource::Drop);
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogFilter {
    name: String,
    extensions: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DialogOptions {
    multiple: Option<bool>,
    directory: Option<bool>,
    filters: Option<Vec<DialogFilter>>,
    default_path: Option<String>,
}

fn grant_kind_for_open(options: &DialogOptions) -> GrantKind {
    if options.directory.unwrap_or(false) {
        return GrantKind::DirectoryTree;
    }
    let Some(filters) = &options.filters else {
        return GrantKind::DocumentSiblings;
    };
    let only_models = !filters.is_empty()
        && filters.iter().all(|filter| {
            filter
                .extensions
                .iter()
                .all(|ext| matches!(ext.as_str(), "safetensors" | "gguf"))
        });
    if only_models {
        GrantKind::Exact
    } else {
        GrantKind::DocumentSiblings
    }
}

fn grant_kind_for_save(options: &DialogOptions) -> GrantKind {
    let Some(filters) = &options.filters else {
        return GrantKind::Exact;
    };
    let document = filters.iter().any(|filter| {
        filter
            .extensions
            .iter()
            .any(|ext| matches!(ext.as_str(), "varve" | "strata"))
    });
    if document {
        GrantKind::DocumentSiblings
    } else {
        GrantKind::Exact
    }
}

fn apply_filters<'a>(
    mut dialog: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
    filters: &'a [DialogFilter],
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    for filter in filters {
        let extensions = filter
            .extensions
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        dialog = dialog.add_filter(&filter.name, &extensions);
    }
    dialog
}

fn apply_default_path(
    mut dialog: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
    default_path: &str,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let path = Path::new(default_path);
    if path.is_absolute() {
        if path.is_dir() {
            dialog = dialog.set_directory(path);
        } else if let Some(parent) = path.parent() {
            if parent.as_os_str().len() > 0 {
                dialog = dialog.set_directory(parent);
            }
            if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                dialog = dialog.set_file_name(name);
            }
        }
    } else if !default_path.is_empty() {
        dialog = dialog.set_file_name(default_path);
    }
    dialog
}

fn file_path_to_string(path: tauri_plugin_dialog::FilePath) -> Result<String, String> {
    let native = path
        .into_path()
        .map_err(|error| format!("Dialog path is not a local file: {error}"))?;
    path_to_ipc(&native)
}

/// Native open/folder dialog. The returned path is recorded before JS sees it.
#[tauri::command]
pub async fn pick_open_path(
    app: AppHandle,
    scope: State<'_, FileScopeState>,
    options: Option<DialogOptions>,
) -> Result<Option<String>, String> {
    let options = options.unwrap_or_default();
    let kind = grant_kind_for_open(&options);
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if let Some(filters) = &options.filters {
            dialog = apply_filters(dialog, filters);
        }
        if let Some(default_path) = &options.default_path {
            dialog = apply_default_path(dialog, default_path);
        }
        if options.directory.unwrap_or(false) {
            dialog.blocking_pick_folder()
        } else if options.multiple.unwrap_or(false) {
            dialog
                .blocking_pick_files()
                .and_then(|paths| paths.into_iter().next())
        } else {
            dialog.blocking_pick_file()
        }
    })
    .await
    .map_err(|error| format!("File dialog worker failed: {error}"))?;

    let Some(path) = picked else {
        return Ok(None);
    };
    let raw = file_path_to_string(path)?;
    let granted = scope.grant(&raw, kind, GrantSource::Dialog)?;
    Ok(Some(path_to_ipc(&granted)?))
}

/// Native save dialog. The returned path is recorded before JS sees it.
#[tauri::command]
pub async fn pick_save_path(
    app: AppHandle,
    scope: State<'_, FileScopeState>,
    options: Option<DialogOptions>,
) -> Result<Option<String>, String> {
    let options = options.unwrap_or_default();
    let kind = grant_kind_for_save(&options);
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if let Some(filters) = &options.filters {
            dialog = apply_filters(dialog, filters);
        }
        if let Some(default_path) = &options.default_path {
            dialog = apply_default_path(dialog, default_path);
        }
        dialog.blocking_save_file()
    })
    .await
    .map_err(|error| format!("File dialog worker failed: {error}"))?;

    let Some(path) = picked else {
        return Ok(None);
    };
    let raw = file_path_to_string(path)?;
    let granted = scope.grant(&raw, kind, GrantSource::Dialog)?;
    Ok(Some(path_to_ipc(&granted)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "varve_file_scope_{label}_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    #[test]
    fn rejects_empty_and_nul_paths() {
        let scope = FileScope::new();
        assert!(scope.resolve("").is_err());
        assert!(scope.resolve("/tmp/foo\0bar").is_err());
    }

    #[test]
    fn rejects_unpicked_absolute_paths() {
        let scope = FileScope::new();
        let err = scope
            .resolve("/etc/hosts")
            .expect_err("/etc/hosts must be rejected without a grant");
        assert!(err.contains("outside the allowed file scope"));
    }

    #[test]
    fn rejects_traversal() {
        let dir = unique_dir("traversal");
        let escaping = dir.join("..").join("..").join("etc").join("passwd");
        let scope = FileScope::new();
        assert!(
            scope.resolve(escaping.to_str().expect("utf8")).is_err(),
            "lexical traversal must be rejected"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let dir = unique_dir("symlink");
        let link = dir.join("escape");
        std::os::unix::fs::symlink("/etc", &link).expect("symlink");
        let mut scope = FileScope::new();
        scope
            .grant(
                dir.to_str().expect("utf8"),
                GrantKind::DirectoryTree,
                GrantSource::Dialog,
            )
            .expect("grant test dir");
        let result = scope.resolve(link.join("hosts").to_str().expect("utf8"));
        assert!(
            result.is_err(),
            "a symlink that leaves the grant must be rejected, got {result:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_picked_paths() {
        let dir = unique_dir("picked");
        let file = dir.join("document.varve");
        std::fs::write(&file, b"{}").expect("write");
        let mut scope = FileScope::new();
        let granted = scope
            .grant(
                file.to_str().expect("utf8"),
                GrantKind::Exact,
                GrantSource::Dialog,
            )
            .expect("grant");
        let resolved = scope
            .resolve(file.to_str().expect("utf8"))
            .expect("picked path must resolve");
        assert_eq!(resolved, granted);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn document_siblings_allow_linked_assets() {
        let dir = unique_dir("siblings");
        let document = dir.join("poster.varve");
        let asset = dir.join("logo.png");
        let nested = dir.join("assets").join("mark.svg");
        std::fs::write(&document, b"{}").expect("write document");
        std::fs::write(&asset, b"png").expect("write asset");
        std::fs::create_dir_all(nested.parent().expect("parent")).expect("assets dir");
        std::fs::write(&nested, b"<svg/>").expect("write nested");

        let mut scope = FileScope::new();
        scope
            .grant(
                document.to_str().expect("utf8"),
                GrantKind::DocumentSiblings,
                GrantSource::Dialog,
            )
            .expect("grant document");

        assert!(scope.resolve(asset.to_str().expect("utf8")).is_ok());
        assert!(scope.resolve(nested.to_str().expect("utf8")).is_ok());

        let outsider = unique_dir("outsider");
        let secret = outsider.join("secret.txt");
        std::fs::write(&secret, b"no").expect("write secret");
        assert!(scope.resolve(secret.to_str().expect("utf8")).is_err());

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outsider);
    }

    #[test]
    fn export_folder_allows_descendants_only() {
        let dir = unique_dir("export");
        let mut scope = FileScope::new();
        scope
            .grant(
                dir.to_str().expect("utf8"),
                GrantKind::DirectoryTree,
                GrantSource::Dialog,
            )
            .expect("grant export folder");
        let target = dir.join("icons").join("logo.svg");
        assert!(
            scope.resolve(target.to_str().expect("utf8")).is_ok(),
            "not-yet-existing export files under a picked folder must be allowed"
        );
        assert!(scope.resolve("/etc/hosts").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn persisted_recent_paths_are_revalidated() {
        let dir = unique_dir("persist");
        let file = dir.join("recent.varve");
        std::fs::write(&file, b"{}").expect("write");
        let persist = dir.join("file-scope.json");

        let mut scope = FileScope::new();
        scope.set_persist_path(persist.clone());
        scope
            .grant(
                file.to_str().expect("utf8"),
                GrantKind::DocumentSiblings,
                GrantSource::Recent,
            )
            .expect("grant");
        scope.persist().expect("persist");

        let mut reloaded = FileScope::new();
        reloaded.set_persist_path(persist);
        reloaded.load_persisted().expect("load");
        assert!(reloaded.resolve(file.to_str().expect("utf8")).is_ok());

        std::fs::remove_file(&file).expect("remove");
        let mut vanished = FileScope::new();
        vanished.set_persist_path(dir.join("file-scope.json"));
        vanished.load_persisted().expect("load missing file");
        // The parent still exists, so a re-save to the same path stays allowed.
        assert!(vanished.resolve(file.to_str().expect("utf8")).is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn hydrate_recent_skips_invalid_entries() {
        let dir = unique_dir("hydrate");
        let file = dir.join("ok.varve");
        std::fs::write(&file, b"{}").expect("write");
        let mut scope = FileScope::new();
        scope.hydrate_recent([
            file.to_string_lossy().into_owned(),
            String::new(),
            "/etc/hosts".to_string(),
            "/definitely/not/a/previously-picked/file.varve".to_string(),
        ]);
        assert!(scope.resolve(file.to_str().expect("utf8")).is_ok());
        assert!(
            scope.resolve("/etc/hosts").is_err(),
            "hydrate must not invent grants for non-document or unpicked paths"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

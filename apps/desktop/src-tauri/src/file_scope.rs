//! Rust-side allowlist for frontend-supplied filesystem paths.
//!
//! Tauri's `fs` plugin scope does not apply to custom `#[tauri::command]`
//! functions that call `std::fs` directly. A path becomes allowed only when
//! it originated from one of:
//!
//! - a native open/save/folder dialog invoked from this module
//! - an OS drag-and-drop event recorded on the Rust side
//! - a file-association or CLI open argument
//! - the app's own mutable data, config, state, log, cache-thumbnail, and
//!   temp directories (never packaged resources or staging)
//! - a recent *document* the user previously picked, persisted and
//!   re-validated as an existing regular `.varve` / `.strata` file
//!
//! Sibling access is granted only for an existing regular `.varve` /
//! `.strata` file whose parent is not a volume root, a UNC share root, the
//! home directory, or an ancestor of home. An export folder the user picked
//! grants that directory tree only when the folder itself passes the same
//! breadth guard. Dropped files and imported models are exact-path grants
//! and are never persisted.
//!
//! `file-scope.json` is never readable or writable through these commands,
//! even though it lives under the app data directory. On load, persisted
//! grants are re-validated by kind; a tampered file that names `/` or
//! `$HOME` is ignored.
//!
//! Accepted residual risk: canonicalize-then-open is TOCTOU. A symlink can
//! be swapped after `resolve` and before `std::fs` opens the path. Closing
//! that race on every command would need fd-based open-then-fstat across
//! platforms. Lexical `..` is rejected, existing paths are symlink-resolved
//! at check time, and the persist file plus over-broad roots are refused.

use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;

use crate::filesystem::AppDirectories;

const SCOPE_UNAVAILABLE: &str = "File scope is unavailable";
const OUTSIDE_SCOPE: &str = "Path is outside the allowed file scope. Open it with a file dialog, drop it on the window, or choose a file you previously opened.";
const PERSIST_PROTECTED: &str =
    "The file-scope registry cannot be read or written through desktop file commands.";
const FOLDER_TOO_BROAD: &str = "This folder is too broad to grant. Choose a project or export folder, not the home directory or a volume root.";
const RELATIVE_PATH: &str = "Path must be absolute";
const PERSIST_NAME: &str = "file-scope.json";
const PERSIST_VERSION: u32 = 1;

/// How far a grant extends from its canonical path.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GrantKind {
    /// Only this exact file (dropped files, imported models, new saves).
    Exact,
    /// An existing document plus its parent directory tree.
    ///
    /// Needed so linked assets next to a document remain readable and so
    /// export next to the document keeps working, without granting a volume
    /// or the home directory.
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

thread_local! {
    static TEST_HOME: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
}

/// In-memory allowlist plus optional persistence under the app data dir.
pub struct FileScope {
    grants: Vec<Grant>,
    persist_path: Option<PathBuf>,
    /// Code-loading and scratch roots that must stay unreachable even when
    /// they sit under a writable app-data DirectoryTree grant.
    protected_roots: Vec<PathBuf>,
    /// App data, config, and resources. Persisted folder grants that cover
    /// these are dropped on load so a planted tree cannot keep them.
    app_sensitive: Vec<PathBuf>,
}

impl FileScope {
    pub fn new() -> Self {
        Self {
            grants: Vec::new(),
            persist_path: None,
            protected_roots: Vec::new(),
            app_sensitive: Vec::new(),
        }
    }

    pub fn set_persist_path(&mut self, path: PathBuf) {
        self.persist_path = Some(canonicalize_persist_path(&path));
    }

    pub fn persist_path_for(directories: &AppDirectories) -> PathBuf {
        directories.data.join(PERSIST_NAME)
    }

    /// Writable application directories only. Packaged resources hold native
    /// code (onnxruntime, the generative helper) and must never be granted.
    /// Staging and the cache root are also omitted: they sit above helper
    /// scratch and must not be writable from the webview.
    pub fn allow_app_directories(&mut self, directories: &AppDirectories) {
        for root in [
            &directories.data,
            &directories.config,
            &directories.state,
            &directories.temporary,
            &directories.recovery,
            &directories.crash_reports,
            &directories.logs,
        ] {
            let canonical = canonicalize_existing_or_self(root);
            self.upsert(Grant {
                path: canonical,
                kind: GrantKind::DirectoryTree,
                source: GrantSource::AppDirectory,
            });
        }
        // Resources hold onnxruntime and the generative helper. Models are
        // executed after download. Staging and the cache root sit above
        // helper scratch. None of these may be writable from the webview.
        for root in [
            &directories.resources,
            &directories.models,
            &directories.cache,
            &directories.staging,
        ] {
            let canonical = canonicalize_existing_or_self(root);
            if !self
                .protected_roots
                .iter()
                .any(|existing| paths_equivalent(existing, &canonical))
            {
                self.protected_roots.push(canonical);
            }
        }
        for root in [
            &directories.data,
            &directories.config,
            &directories.resources,
        ] {
            let canonical = canonicalize_existing_or_self(root);
            if !self
                .app_sensitive
                .iter()
                .any(|existing| paths_equivalent(existing, &canonical))
            {
                self.app_sensitive.push(canonical);
            }
        }
    }

    pub fn grant(
        &mut self,
        raw: &str,
        requested: GrantKind,
        source: GrantSource,
    ) -> Result<PathBuf, String> {
        let path = canonicalize_user_path(raw)?;
        if let Some(error) = self.protected_error(&path) {
            return Err(error);
        }
        let kind = effective_grant_kind(&path, requested, source)?;
        if kind == GrantKind::DirectoryTree && self.covers_sensitive(&path) {
            return Err(FOLDER_TOO_BROAD.to_string());
        }
        self.upsert(Grant {
            path: path.clone(),
            kind,
            source,
        });
        Ok(path)
    }

    /// After a successful write, promote an Exact grant on a new `.varve` /
    /// `.strata` file to DocumentSiblings when the parent is not over-broad.
    pub fn note_existing_document(&mut self, path: &Path) {
        if !is_existing_regular_document(path) {
            return;
        }
        let Ok(canonical) = canonicalize_existing(path) else {
            return;
        };
        if self.is_protected(&canonical) {
            return;
        }
        if self.grants.iter().any(|grant| {
            paths_equivalent(&grant.path, &canonical) && grant.source == GrantSource::Drop
        }) {
            return;
        }
        let Ok(kind) = grant_kind_for_existing_path(&canonical) else {
            return;
        };
        if kind != GrantKind::DocumentSiblings {
            return;
        }
        let source = self
            .grants
            .iter()
            .find(|grant| paths_equivalent(&grant.path, &canonical))
            .map(|grant| grant.source)
            .unwrap_or(GrantSource::Dialog);
        self.upsert(Grant {
            path: canonical,
            kind,
            source,
        });
        let _ = self.persist();
    }

    /// Re-validate previously picked document paths. Only an existing regular
    /// `.varve` / `.strata` file is admitted.
    pub fn hydrate_recent(&mut self, paths: impl IntoIterator<Item = impl AsRef<str>>) {
        for path in paths {
            let raw = path.as_ref();
            if raw.is_empty() {
                continue;
            }
            let Ok(canonical) = canonicalize_user_path(raw) else {
                continue;
            };
            if !is_existing_regular_document(&canonical) {
                continue;
            }
            if self.is_protected(&canonical) {
                continue;
            }
            let Ok(kind) = grant_kind_for_existing_path(&canonical) else {
                continue;
            };
            self.upsert(Grant {
                path: canonical,
                kind,
                source: GrantSource::Recent,
            });
        }
    }

    pub fn resolve(&self, raw: &str) -> Result<PathBuf, String> {
        let canonical = canonicalize_user_path(raw)?;
        if let Some(error) = self.protected_error(&canonical) {
            return Err(error);
        }
        if self.is_allowed(&canonical) {
            Ok(canonical)
        } else {
            Err(OUTSIDE_SCOPE.to_string())
        }
    }

    pub fn is_allowed(&self, canonical: &Path) -> bool {
        if self.is_protected(canonical) {
            return false;
        }
        self.grants.iter().any(|grant| match grant.kind {
            GrantKind::Exact => paths_equivalent(canonical, &grant.path),
            GrantKind::DocumentSiblings => {
                if paths_equivalent(canonical, &grant.path) {
                    return true;
                }
                let Some(parent) = grant.path.parent() else {
                    return false;
                };
                if is_overbroad_directory(parent) {
                    return false;
                }
                path_is_under(parent, canonical)
            }
            GrantKind::DirectoryTree => {
                if is_overbroad_directory(&grant.path) {
                    return false;
                }
                path_is_under(&grant.path, canonical)
            }
        })
    }

    pub fn load_persisted(&mut self) -> Result<(), String> {
        let Some(path) = self.persist_path.clone() else {
            return Ok(());
        };
        if !path.exists() {
            return Ok(());
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read file scope: {e}"))?;
        let parsed: PersistFile = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Failed to parse file scope: {e}"))?;
        if parsed.version != PERSIST_VERSION {
            return Ok(());
        }
        for grant in parsed.grants {
            if grant.source == GrantSource::AppDirectory || grant.source == GrantSource::Drop {
                continue;
            }
            if grant.kind == GrantKind::Exact {
                continue;
            }
            let Ok(raw) = path_to_ipc(&grant.path) else {
                continue;
            };
            let Ok(canonical) = canonicalize_user_path(&raw) else {
                continue;
            };
            if self.is_protected(&canonical) {
                continue;
            }
            match grant.kind {
                GrantKind::DocumentSiblings => {
                    if !is_existing_regular_document(&canonical) {
                        continue;
                    }
                    let Ok(kind) = grant_kind_for_existing_path(&canonical) else {
                        continue;
                    };
                    self.upsert(Grant {
                        path: canonical,
                        kind,
                        source: grant.source,
                    });
                }
                GrantKind::DirectoryTree => {
                    if !canonical.is_dir()
                        || is_overbroad_directory(&canonical)
                        || self.covers_sensitive(&canonical)
                    {
                        continue;
                    }
                    self.upsert(Grant {
                        path: canonical,
                        kind: GrantKind::DirectoryTree,
                        source: grant.source,
                    });
                }
                GrantKind::Exact => {}
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
            .filter(|grant| should_persist(grant))
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

    fn is_protected(&self, canonical: &Path) -> bool {
        if let Some(persist) = &self.persist_path {
            if paths_equivalent(canonical, persist) {
                return true;
            }
        }
        self.protected_roots
            .iter()
            .any(|root| paths_equivalent(canonical, root) || path_is_under(root, canonical))
    }

    fn protected_error(&self, canonical: &Path) -> Option<String> {
        if !self.is_protected(canonical) {
            return None;
        }
        if self
            .persist_path
            .as_ref()
            .is_some_and(|persist| paths_equivalent(persist, canonical))
        {
            Some(PERSIST_PROTECTED.to_string())
        } else {
            Some(OUTSIDE_SCOPE.to_string())
        }
    }

    fn covers_sensitive(&self, path: &Path) -> bool {
        if is_system_directory(path) {
            return true;
        }
        for sensitive in self.sensitive_roots() {
            if trees_overlap(path, &sensitive) {
                return true;
            }
        }
        false
    }

    fn sensitive_roots(&self) -> Vec<PathBuf> {
        let mut roots = self.app_sensitive.clone();
        if let Some(home) = home_directory() {
            let home = canonicalize_existing_or_self(&home);
            roots.push(home.join(".ssh"));
            roots.push(home.join(".gnupg"));
        }
        roots
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

fn should_persist(grant: &Grant) -> bool {
    if grant.source == GrantSource::AppDirectory || grant.source == GrantSource::Drop {
        return false;
    }
    matches!(
        grant.kind,
        GrantKind::DocumentSiblings | GrantKind::DirectoryTree
    )
}

fn grant_rank(kind: GrantKind) -> u8 {
    match kind {
        GrantKind::Exact => 0,
        GrantKind::DocumentSiblings => 1,
        GrantKind::DirectoryTree => 2,
    }
}

fn effective_grant_kind(
    path: &Path,
    requested: GrantKind,
    source: GrantSource,
) -> Result<GrantKind, String> {
    if source == GrantSource::Drop {
        return Ok(GrantKind::Exact);
    }
    if requested == GrantKind::DirectoryTree {
        if path.exists() && !path.is_dir() {
            return Err("Export destination is not a directory".into());
        }
        if is_overbroad_directory(path) {
            return Err(FOLDER_TOO_BROAD.to_string());
        }
        return Ok(GrantKind::DirectoryTree);
    }
    if is_existing_regular_document(path) {
        grant_kind_for_existing_path(path)
    } else {
        Ok(GrantKind::Exact)
    }
}

/// Kind for a path the user actually picked. Directory picks become
/// `DirectoryTree` only when they pass the breadth guard.
pub fn grant_kind_for_open(path: &Path, directory: bool) -> Result<GrantKind, String> {
    grant_kind_for_picked_path(path, directory)
}

/// Kind for a save-dialog path. Existing `.varve` / `.strata` files get
/// siblings unless the parent is over-broad; everything else is Exact.
pub fn grant_kind_for_save(path: &Path) -> Result<GrantKind, String> {
    grant_kind_for_picked_path(path, false)
}

/// Kind for a path the user actually picked. Directory picks become
/// `DirectoryTree` only when they pass the breadth guard.
pub fn grant_kind_for_picked_path(path: &Path, directory: bool) -> Result<GrantKind, String> {
    if directory {
        if is_overbroad_directory(path) {
            return Err(FOLDER_TOO_BROAD.to_string());
        }
        return Ok(GrantKind::DirectoryTree);
    }
    if is_existing_regular_document(path) {
        grant_kind_for_existing_path(path)
    } else {
        Ok(GrantKind::Exact)
    }
}

fn grant_kind_for_existing_path(path: &Path) -> Result<GrantKind, String> {
    let Some(parent) = path.parent() else {
        return Ok(GrantKind::Exact);
    };
    if is_overbroad_directory(parent) {
        return Ok(GrantKind::Exact);
    }
    Ok(GrantKind::DocumentSiblings)
}

fn is_existing_regular_document(path: &Path) -> bool {
    if !is_document_extension(path) {
        return false;
    }
    let Ok(meta) = path.symlink_metadata() else {
        return false;
    };
    meta.file_type().is_file() && !meta.file_type().is_symlink()
}

fn is_document_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            extension.eq_ignore_ascii_case("varve") || extension.eq_ignore_ascii_case("strata")
        })
        .unwrap_or(false)
}

/// True for a volume root, a UNC share root, the home directory, or any
/// ancestor of home. Those directories must never receive a tree grant.
pub fn is_overbroad_directory(path: &Path) -> bool {
    let path = normalize_for_breadth(path);
    if is_volume_or_share_root(&path) {
        return true;
    }
    let Some(home) = home_directory() else {
        return false;
    };
    let home = normalize_for_breadth(&home);
    paths_equivalent(&path, &home) || path_is_under(&path, &home)
}

fn is_volume_or_share_root(path: &Path) -> bool {
    let comps: Vec<Component<'_>> = path.components().collect();
    if matches!(
        comps.as_slice(),
        [Component::RootDir] | [Component::Prefix(_)] | [Component::Prefix(_), Component::RootDir]
    ) {
        return true;
    }
    // Persist files and tests can name Windows roots on any host.
    is_windows_volume_or_share_root(&path.to_string_lossy())
}

fn is_windows_volume_or_share_root(raw: &str) -> bool {
    let normalized = raw.replace('/', "\\");
    let trimmed = normalized.trim_end_matches('\\');
    let bytes = trimmed.as_bytes();
    if bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return true;
    }
    if let Some(rest) = trimmed.strip_prefix(r"\\?\") {
        let rest_bytes = rest.as_bytes();
        if rest_bytes.len() == 2 && rest_bytes[0].is_ascii_alphabetic() && rest_bytes[1] == b':' {
            return true;
        }
        if let Some(unc) = rest.strip_prefix("UNC\\") {
            return unc_share_root(unc);
        }
        return false;
    }
    if let Some(unc) = trimmed.strip_prefix(r"\\") {
        return unc_share_root(unc) || windows_admin_share_root(unc);
    }
    false
}

fn windows_admin_share_root(unc: &str) -> bool {
    let parts: Vec<&str> = unc.split('\\').filter(|part| !part.is_empty()).collect();
    parts.len() == 2 && is_admin_drive_share(parts[1])
}

fn is_admin_drive_share(share: &str) -> bool {
    let bytes = share.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b'$'
}

fn unc_share_root(unc: &str) -> bool {
    let parts: Vec<&str> = unc.split('\\').filter(|part| !part.is_empty()).collect();
    parts.len() == 2
}

fn home_directory() -> Option<PathBuf> {
    let test_home = TEST_HOME.with(|slot| slot.borrow().clone());
    if test_home.is_some() {
        return test_home;
    }
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Canonicalize an untrusted, frontend-supplied path.
///
/// Existing paths are resolved through the kernel (symlinks included) and
/// then simplified so Windows `\\?\` prefixes never leak to JS. Not-yet-
/// existing paths walk up to the nearest existing ancestor, then re-join
/// the remaining components. Relative paths, NUL, and lexical `..` are
/// rejected before any syscall.
pub fn canonicalize_user_path(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() {
        return Err("Path must not be empty".into());
    }
    if raw.contains('\0') {
        return Err("Path must not contain NUL bytes".into());
    }
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err(RELATIVE_PATH.into());
    }
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Path must not contain '..'".into());
    }

    if path.exists() {
        return canonicalize_existing(path);
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
    let mut resolved = canonicalize_existing(ancestor).map_err(|e| {
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

fn canonicalize_existing(path: &Path) -> Result<PathBuf, String> {
    let raw = std::fs::canonicalize(path).map_err(|e| format!("Failed to resolve path: {e}"))?;
    Ok(simplify_path(&raw))
}

fn canonicalize_existing_or_self(path: &Path) -> PathBuf {
    canonicalize_existing(path).unwrap_or_else(|_| simplify_path(path))
}

/// Resolve the persist path even when the file does not exist yet: canonicalize
/// the parent directory (so a symlinked app-data dir cannot bypass the
/// protected name) and join the file name.
fn canonicalize_persist_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(std::ffi::OsStr::to_os_string)
        .unwrap_or_else(|| std::ffi::OsString::from(PERSIST_NAME));
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => {
            canonicalize_existing_or_self(parent).join(name)
        }
        _ => simplify_path(path),
    }
}

fn normalize_for_breadth(path: &Path) -> PathBuf {
    let canonical = canonicalize_existing_or_self(path);
    if let Some(mapped) = map_localhost_admin_share(&canonical) {
        return mapped;
    }
    if let Some(mapped) = map_macos_data_volume(&canonical) {
        return mapped;
    }
    canonical
}

fn map_localhost_admin_share(path: &Path) -> Option<PathBuf> {
    let raw = path.to_string_lossy().replace('/', "\\");
    let trimmed = raw.trim_end_matches('\\');
    let rest = trimmed.strip_prefix(r"\\")?;
    let mut parts = rest.split('\\').filter(|part| !part.is_empty());
    let host = parts.next()?.to_ascii_lowercase();
    if host != "localhost" && host != "127.0.0.1" {
        return None;
    }
    let share = parts.next()?;
    if !is_admin_drive_share(share) {
        return None;
    }
    let drive = share.chars().next()?.to_ascii_uppercase();
    let mut mapped = PathBuf::from(format!("{drive}:\\"));
    for part in parts {
        mapped.push(part);
    }
    if mapped.components().count() <= 2 {
        return Some(PathBuf::from(format!("{drive}:\\")));
    }
    Some(mapped)
}

fn map_macos_data_volume(path: &Path) -> Option<PathBuf> {
    const PREFIX: &str = "/System/Volumes/Data";
    let raw = path.to_string_lossy();
    if raw == PREFIX || raw == "/System/Volumes/Data/" {
        return Some(PathBuf::from("/"));
    }
    raw.strip_prefix("/System/Volumes/Data/")
        .map(|rest| PathBuf::from("/").join(rest))
}

fn paths_equivalent(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    if !case_insensitive_paths() {
        return false;
    }
    left.to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy())
}

fn path_is_under(prefix: &Path, child: &Path) -> bool {
    if child.starts_with(prefix) {
        return true;
    }
    if !case_insensitive_paths() {
        return false;
    }
    let prefix_comps: Vec<_> = prefix.components().collect();
    let child_comps: Vec<_> = child.components().collect();
    if prefix_comps.len() > child_comps.len() {
        return false;
    }
    prefix_comps
        .iter()
        .zip(&child_comps)
        .all(|(a, b)| components_equivalent(*a, *b))
}

fn components_equivalent(left: Component<'_>, right: Component<'_>) -> bool {
    match (left, right) {
        (Component::Normal(a), Component::Normal(b)) => {
            a == b || (case_insensitive_paths() && a.eq_ignore_ascii_case(b))
        }
        _ => left == right,
    }
}

fn case_insensitive_paths() -> bool {
    cfg!(any(windows, target_os = "macos"))
}

fn trees_overlap(left: &Path, right: &Path) -> bool {
    let left = canonicalize_existing_or_self(left);
    let right = canonicalize_existing_or_self(right);
    paths_equivalent(&left, &right) || path_is_under(&left, &right) || path_is_under(&right, &left)
}

fn is_system_directory(path: &Path) -> bool {
    let normalized = normalize_for_breadth(path);
    if is_volume_or_share_root(&normalized) {
        return true;
    }
    const UNIX_SYSTEM: &[&str] = &[
        "/etc",
        "/sys",
        "/proc",
        "/dev",
        "/boot",
        "/root",
        "/System",
        "/Library",
        "/private/etc",
        "/System/Volumes/Data",
    ];
    for root in UNIX_SYSTEM {
        if trees_overlap(&normalized, Path::new(root)) {
            return true;
        }
    }
    let raw = normalized.to_string_lossy();
    let lower = raw.to_ascii_lowercase().replace('/', "\\");
    lower.starts_with("c:\\windows")
        || lower.starts_with("c:\\program files")
        || lower.starts_with("c:\\programdata")
}

fn simplify_path(path: &Path) -> PathBuf {
    // dunce only strips verbatim prefixes on Windows. Dialog and persist
    // paths still need the same display form when tests run on Linux.
    dunce::simplified(&strip_windows_verbatim_prefix(path)).to_path_buf()
}

fn strip_windows_verbatim_prefix(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

pub(crate) fn path_to_ipc(path: &Path) -> Result<String, String> {
    simplify_path(path)
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| "Path cannot be represented by the desktop IPC boundary".to_string())
}

/// Make a CLI / file-association argument absolute before it enters scope.
pub fn absolutize_user_path(raw: &str) -> Result<String, String> {
    if raw.is_empty() {
        return Err("Path must not be empty".into());
    }
    let path = Path::new(raw);
    if path.is_absolute() {
        return path_to_ipc(path);
    }
    let cwd =
        std::env::current_dir().map_err(|e| format!("Failed to resolve working directory: {e}"))?;
    path_to_ipc(&cwd.join(path))
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

    pub fn note_existing_document(&self, path: &Path) {
        if let Ok(mut scope) = self.lock() {
            scope.note_existing_document(path);
        }
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

fn apply_filters(
    mut dialog: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
    filters: &[DialogFilter],
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
            if !parent.as_os_str().is_empty() {
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
/// Kind is decided from the picked path, not from JS-supplied filters.
#[tauri::command]
pub async fn pick_open_path(
    app: AppHandle,
    scope: State<'_, FileScopeState>,
    options: Option<DialogOptions>,
) -> Result<Option<String>, String> {
    let options = options.unwrap_or_default();
    if options.multiple.unwrap_or(false) {
        return Err(
            "Opening multiple files in one dialog is not supported. Open one file at a time."
                .into(),
        );
    }
    let directory = options.directory.unwrap_or(false);
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if let Some(filters) = &options.filters {
            dialog = apply_filters(dialog, filters);
        }
        if let Some(default_path) = &options.default_path {
            dialog = apply_default_path(dialog, default_path);
        }
        if directory {
            dialog.blocking_pick_folder()
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
    let kind = grant_kind_for_open(Path::new(&raw), directory)?;
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
    let kind = grant_kind_for_save(Path::new(&raw))?;
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

    fn with_test_home<T>(home: PathBuf, f: impl FnOnce() -> T) -> T {
        TEST_HOME.with(|slot| *slot.borrow_mut() = Some(home));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
        TEST_HOME.with(|slot| *slot.borrow_mut() = None);
        result.unwrap()
    }

    #[test]
    fn rejects_empty_and_nul_paths() {
        let scope = FileScope::new();
        assert!(scope.resolve("").is_err());
        assert!(scope.resolve("/tmp/foo\0bar").is_err());
    }

    #[test]
    fn rejects_relative_paths() {
        let scope = FileScope::new();
        let err = scope
            .resolve("poster.varve")
            .expect_err("relative paths must be rejected");
        assert!(err.contains("absolute"));
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
    fn document_in_home_is_exact_only() {
        let home = unique_dir("home");
        with_test_home(home.clone(), || {
            let document = home.join("poster.varve");
            let sibling = home.join("secret.txt");
            std::fs::write(&document, b"{}").expect("write document");
            std::fs::write(&sibling, b"no").expect("write sibling");
            let mut scope = FileScope::new();
            scope
                .grant(
                    document.to_str().expect("utf8"),
                    GrantKind::DocumentSiblings,
                    GrantSource::Dialog,
                )
                .expect("grant");
            assert!(scope.resolve(document.to_str().expect("utf8")).is_ok());
            assert!(
                scope.resolve(sibling.to_str().expect("utf8")).is_err(),
                "a document in $HOME must not grant the rest of home"
            );
        });
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn document_under_home_ancestor_is_exact_only() {
        let root = unique_dir("users");
        let home = root.join("alice");
        std::fs::create_dir_all(&home).expect("home");
        with_test_home(home, || {
            let document = root.join("poster.varve");
            let sibling = root.join("secret.txt");
            std::fs::write(&document, b"{}").expect("write document");
            std::fs::write(&sibling, b"no").expect("write sibling");
            let mut scope = FileScope::new();
            scope
                .grant(
                    document.to_str().expect("utf8"),
                    GrantKind::DocumentSiblings,
                    GrantSource::Dialog,
                )
                .expect("grant");
            assert!(scope.resolve(document.to_str().expect("utf8")).is_ok());
            assert!(
                scope.resolve(sibling.to_str().expect("utf8")).is_err(),
                "a parent that is an ancestor of home must not grant siblings"
            );
        });
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn volume_and_home_roots_are_overbroad() {
        assert!(is_overbroad_directory(Path::new("/")));
        assert!(is_overbroad_directory(Path::new(r"C:\")));
        assert!(is_overbroad_directory(Path::new(r"\\server\share")));
        assert!(is_overbroad_directory(Path::new(r"\\localhost\C$")));
        assert!(is_overbroad_directory(Path::new("/System/Volumes/Data")));
        let home = unique_dir("overbroad-home");
        with_test_home(home.clone(), || {
            assert!(is_overbroad_directory(&home));
            assert!(
                is_overbroad_directory(home.parent().expect("parent")),
                "an ancestor of home is over-broad"
            );
        });
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn directory_tree_rejects_home_and_root() {
        let home = unique_dir("tree-home");
        with_test_home(home.clone(), || {
            let mut scope = FileScope::new();
            assert!(scope
                .grant(
                    home.to_str().expect("utf8"),
                    GrantKind::DirectoryTree,
                    GrantSource::Dialog,
                )
                .is_err());
            assert!(scope
                .grant("/", GrantKind::DirectoryTree, GrantSource::Dialog)
                .is_err());
        });
        let _ = std::fs::remove_dir_all(&home);
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

    #[cfg(unix)]
    #[test]
    fn persist_path_is_protected_when_parent_is_a_symlink_and_file_is_absent() {
        let root = unique_dir("persist-symlink");
        let real = root.join("real-data");
        let link = root.join("link-data");
        std::fs::create_dir_all(&real).expect("real data");
        std::os::unix::fs::symlink(&real, &link).expect("symlink app data");
        let persist_via_link = link.join("file-scope.json");
        assert!(
            !persist_via_link.exists(),
            "first-run persist file must be absent"
        );

        let mut scope = FileScope::new();
        scope.set_persist_path(persist_via_link.clone());
        let mut directories = dummy_directories(&root);
        directories.data = real.clone();
        scope.allow_app_directories(&directories);

        let via_real = real.join("file-scope.json");
        let err = scope
            .resolve(via_real.to_str().expect("utf8"))
            .expect_err("resolved persist path must be refused before the file exists");
        assert!(err.contains("file-scope registry"));
        let err = scope
            .resolve(persist_via_link.to_str().expect("utf8"))
            .expect_err("symlinked persist path must be refused before the file exists");
        assert!(err.contains("file-scope registry"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn persist_path_is_never_resolvable() {
        let dir = unique_dir("persist-protect");
        let persist = dir.join("file-scope.json");
        std::fs::write(&persist, b"{}").expect("write persist");
        let mut scope = FileScope::new();
        scope.set_persist_path(persist.clone());
        let mut directories = dummy_directories(&dir);
        directories.data = dir.clone();
        scope.allow_app_directories(&directories);
        let err = scope
            .resolve(persist.to_str().expect("utf8"))
            .expect_err("persist file must be refused even under app data");
        assert!(err.contains("file-scope registry"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resources_and_staging_are_not_granted() {
        let dir = unique_dir("appdirs");
        let resources = dir.join("resources");
        let staging = dir.join("cache").join("staging");
        let data = dir.join("data");
        let models = data.join("models");
        std::fs::create_dir_all(&resources).expect("resources");
        std::fs::create_dir_all(&staging).expect("staging");
        std::fs::create_dir_all(&models).expect("models");
        std::fs::write(resources.join("helper"), b"bin").expect("helper");
        std::fs::write(models.join("steal.onnx"), b"onnx").expect("model");
        let mut directories = dummy_directories(&dir);
        directories.data = data;
        directories.resources = resources.clone();
        directories.models = models.clone();
        directories.staging = staging.clone();
        let mut scope = FileScope::new();
        scope.allow_app_directories(&directories);
        assert!(
            scope
                .resolve(resources.join("helper").to_str().expect("utf8"))
                .is_err(),
            "packaged resources must not be writable through file commands"
        );
        assert!(
            scope
                .resolve(staging.join("payload").to_str().expect("utf8"))
                .is_err(),
            "staging must not be writable through file commands"
        );
        assert!(
            scope
                .resolve(models.join("steal.onnx").to_str().expect("utf8"))
                .is_err(),
            "the models directory must not be writable through the app-data grant"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_next_to_a_project_document_keeps_write_access() {
        let dir = unique_dir("qualify");
        let document = dir.join("poster.varve");
        std::fs::write(&document, b"{}").expect("write document");
        let mut scope = FileScope::new();
        scope
            .grant(
                document.to_str().expect("utf8"),
                GrantKind::DocumentSiblings,
                GrantSource::CliOrAssociation,
            )
            .expect("grant opened document");
        let export = dir.join("poster.pdf");
        assert!(
            scope.resolve(export.to_str().expect("utf8")).is_ok(),
            "export next to an opened project document must stay writable"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn saving_a_dropped_document_does_not_promote_to_siblings() {
        let dir = unique_dir("drop-promote");
        let file = dir.join("dropped.varve");
        let sibling = dir.join("secret.txt");
        std::fs::write(&file, b"{}").expect("write document");
        std::fs::write(&sibling, b"no").expect("write sibling");
        let persist = dir.join("file-scope.json");
        let mut scope = FileScope::new();
        scope.set_persist_path(persist.clone());
        scope
            .grant(
                file.to_str().expect("utf8"),
                GrantKind::Exact,
                GrantSource::Drop,
            )
            .expect("grant drop");
        scope.note_existing_document(&file);
        assert!(
            scope.resolve(sibling.to_str().expect("utf8")).is_err(),
            "a dropped document must not become a folder-wide grant"
        );
        scope.persist().expect("persist");
        if persist.exists() {
            let stored = std::fs::read_to_string(&persist).expect("read");
            assert!(
                !stored.contains("dropped.varve"),
                "a drop must stay session-only, got {stored}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn new_save_promotes_to_siblings_after_write() {
        let dir = unique_dir("promote");
        let file = dir.join("new.varve");
        let sibling = dir.join("new.pdf");
        let mut scope = FileScope::new();
        scope
            .grant(
                file.to_str().expect("utf8"),
                GrantKind::Exact,
                GrantSource::Dialog,
            )
            .expect("grant new save");
        assert!(
            scope.resolve(sibling.to_str().expect("utf8")).is_err(),
            "a not-yet-written save is Exact only"
        );
        std::fs::write(&file, b"{}").expect("write document");
        scope.note_existing_document(&file);
        assert!(
            scope.resolve(sibling.to_str().expect("utf8")).is_ok(),
            "after the document exists, siblings stay writable for export"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tampered_persist_rejects_root_and_home() {
        let dir = unique_dir("tamper");
        let persist = dir.join("file-scope.json");
        let home = unique_dir("tamper-home");
        with_test_home(home.clone(), || {
            let payload = serde_json::json!({
                "version": 1,
                "grants": [
                    {"path": "/", "kind": "directoryTree", "source": "dialog"},
                    {"path": home, "kind": "directoryTree", "source": "dialog"},
                    {"path": "/", "kind": "documentSiblings", "source": "dialog"}
                ]
            });
            std::fs::write(&persist, payload.to_string()).expect("write tampered persist");
            let mut scope = FileScope::new();
            scope.set_persist_path(persist);
            scope.load_persisted().expect("load");
            assert!(
                scope.resolve("/etc/hosts").is_err(),
                "a tampered grant of / must be ignored"
            );
            assert!(
                scope
                    .resolve(home.join("secret.txt").to_str().expect("utf8"))
                    .is_err(),
                "a tampered grant of $HOME must be ignored"
            );
        });
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn load_rejects_sensitive_directory_trees() {
        let dir = unique_dir("sensitive");
        let home = unique_dir("sensitive-home");
        let ssh = home.join(".ssh");
        let gnupg = home.join(".gnupg");
        let data = dir.join("data");
        std::fs::create_dir_all(&ssh).expect("ssh");
        std::fs::create_dir_all(&gnupg).expect("gnupg");
        std::fs::create_dir_all(&data).expect("data");
        let persist = dir.join("file-scope.json");
        with_test_home(home.clone(), || {
            let payload = serde_json::json!({
                "version": 1,
                "grants": [
                    {"path": "/etc", "kind": "directoryTree", "source": "dialog"},
                    {"path": ssh, "kind": "directoryTree", "source": "dialog"},
                    {"path": gnupg, "kind": "directoryTree", "source": "dialog"},
                    {"path": data, "kind": "directoryTree", "source": "dialog"}
                ]
            });
            std::fs::write(&persist, payload.to_string()).expect("write tampered persist");
            let mut scope = FileScope::new();
            scope.set_persist_path(persist.clone());
            let mut directories = dummy_directories(&dir);
            directories.data = data.clone();
            scope.allow_app_directories(&directories);
            scope.load_persisted().expect("load");
            assert!(
                scope.resolve("/etc/passwd").is_err(),
                "a saved grant of /etc must be ignored"
            );
            assert!(
                scope
                    .resolve(ssh.join("id_rsa").to_str().expect("utf8"))
                    .is_err(),
                "a saved grant of ~/.ssh must be ignored"
            );
            assert!(
                scope
                    .resolve(gnupg.join("secring.gpg").to_str().expect("utf8"))
                    .is_err(),
                "a saved grant of ~/.gnupg must be ignored"
            );
            scope.persist().expect("rewrite");
            let stored = std::fs::read_to_string(&persist).expect("read rewritten persist");
            assert!(
                !stored.contains("/etc") && !stored.contains(".ssh") && !stored.contains(".gnupg"),
                "sensitive folder grants must not be written back, got {stored}"
            );
        });
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn overbroad_compares_canonical_paths() {
        let root = unique_dir("canon-home");
        let real = root.join("var-home");
        let alias = root.join("home");
        let alice = real.join("alice");
        std::fs::create_dir_all(&alice).expect("home");
        std::os::unix::fs::symlink(&real, &alias).expect("symlink home root");
        with_test_home(alice, || {
            assert!(
                is_overbroad_directory(&alias),
                "a symlink ancestor of home must be over-broad after canonicalize"
            );
        });
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn exact_and_drop_grants_are_not_persisted() {
        let dir = unique_dir("session-only");
        let file = dir.join("shot.png");
        std::fs::write(&file, b"png").expect("write");
        let persist = dir.join("file-scope.json");
        let mut scope = FileScope::new();
        scope.set_persist_path(persist.clone());
        scope
            .grant(
                file.to_str().expect("utf8"),
                GrantKind::Exact,
                GrantSource::Drop,
            )
            .expect("grant drop");
        scope.persist().expect("persist");
        let stored = std::fs::read_to_string(&persist).expect("read");
        assert!(
            !stored.contains("shot.png"),
            "Exact/Drop grants must not be written to disk, got {stored}"
        );
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
        assert!(
            vanished.resolve(file.to_str().expect("utf8")).is_err(),
            "a vanished document must not keep its grant"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn hydrate_recent_requires_existing_regular_document() {
        let dir = unique_dir("hydrate");
        let other = unique_dir("hydrate-missing");
        let file = dir.join("ok.varve");
        let missing = other.join("gone.varve");
        std::fs::write(&file, b"{}").expect("write");
        let mut scope = FileScope::new();
        scope.hydrate_recent([
            file.to_string_lossy().into_owned(),
            missing.to_string_lossy().into_owned(),
            String::new(),
            "/etc/hosts".to_string(),
            "relative.varve".to_string(),
        ]);
        assert!(scope.resolve(file.to_str().expect("utf8")).is_ok());
        assert!(
            scope.resolve(missing.to_str().expect("utf8")).is_err(),
            "a path that is not an existing regular document must not be hydrated"
        );
        assert!(
            scope.resolve("/etc/hosts").is_err(),
            "hydrate must not invent grants for non-document or unpicked paths"
        );
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&other);
    }

    #[cfg(windows)]
    #[test]
    fn windows_canonicalize_does_not_leak_verbatim_prefix() {
        let dir = unique_dir("verbatim");
        let file = dir.join("doc.varve");
        std::fs::write(&file, b"{}").expect("write");
        let mut scope = FileScope::new();
        let granted = scope
            .grant(
                file.to_str().expect("utf8"),
                GrantKind::Exact,
                GrantSource::Dialog,
            )
            .expect("grant");
        let text = path_to_ipc(&granted).expect("ipc");
        assert!(
            !text.starts_with(r"\\?\"),
            "verbatim prefix must not leak to JS, got {text}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn strips_windows_verbatim_prefix() {
        let verbatim_drive = PathBuf::from(r"\\?\C:\Users\test\doc.varve");
        assert_eq!(
            simplify_path(&verbatim_drive),
            Path::new(r"C:\Users\test\doc.varve")
        );
        let verbatim_unc = PathBuf::from(r"\\?\UNC\server\share\doc.varve");
        assert_eq!(
            simplify_path(&verbatim_unc),
            Path::new(r"\\server\share\doc.varve")
        );
    }

    #[test]
    fn kind_comes_from_the_real_path_not_the_requested_kind() {
        let dir = unique_dir("kind");
        let document = dir.join("poster.varve");
        let image = dir.join("mark.png");
        std::fs::write(&document, b"{}").expect("write document");
        std::fs::write(&image, b"png").expect("write image");
        assert_eq!(
            grant_kind_for_open(&document, false).expect("doc"),
            GrantKind::DocumentSiblings
        );
        assert_eq!(
            grant_kind_for_save(&image).expect("image"),
            GrantKind::Exact
        );
        assert_eq!(
            grant_kind_for_open(&dir, true).expect("folder"),
            GrantKind::DirectoryTree
        );
        assert_eq!(
            grant_kind_for_save(&document).expect("existing save"),
            GrantKind::DocumentSiblings
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn dummy_directories(root: &Path) -> AppDirectories {
        AppDirectories {
            data: root.join("data"),
            config: root.join("config"),
            cache: root.join("cache"),
            state: root.join("state"),
            temporary: root.join("tmp"),
            resources: root.join("resources"),
            fonts: root.join("fonts"),
            models: root.join("models"),
            recovery: root.join("recovery"),
            crash_reports: root.join("crash"),
            logs: root.join("logs"),
            thumbnails: root.join("thumbs"),
            staging: root.join("cache").join("staging"),
        }
    }
}

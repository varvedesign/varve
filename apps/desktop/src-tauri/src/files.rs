//! User-path approval and binary file write commands extracted from the crate root (Batch B/B-01).

#[cfg(test)]
mod tests;

use crate::filesystem;
use crate::uuid;
use std::io::Write;

/// Resolve the user's home directory without pulling in a new dependency
/// for it. `dirs`-crate-equivalent behavior for the two platforms this app
/// ships on.
fn user_home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
}

/// Canonicalize an untrusted, frontend-supplied path and verify it resolves
/// under an allowed scope (the user's home directory or the OS temp
/// directory) before any read/write happens.
///
/// This exists because Tauri's fs-plugin capability scope
/// (`capabilities/default.json`'s `fs:allow-read`/`fs:allow-write`) only
/// governs the `@tauri-apps/plugin-fs` JS API — it does NOT apply to custom
/// `#[tauri::command]` functions that call `std::fs` directly, which is
/// what every file-touching command in this file does. Without this check,
/// any JS running in the webview — not only code that went through a native
/// open/save dialog — could invoke a command like `write_binary_file` with
/// an arbitrary path (e.g. `~/.ssh/authorized_keys`) and overwrite it
/// directly. Handles both directions of the symlink/traversal problem:
/// - If the path already exists, canonicalizing it directly resolves any
///   symlink in the chain.
/// - If it doesn't exist yet (a "Save As" to a new file, possibly in a new
///   subfolder), walks up to the nearest existing ancestor, canonicalizes
///   *that* (so a symlinked parent still can't escape scope), and rejects
///   `..`/`.` components in the not-yet-existing suffix rather than
///   naively re-joining them (which would otherwise let
///   `existing_dir/../../etc/passwd` slip through as an "existing ancestor"
///   plus a traversal suffix).
pub(crate) fn resolve_user_path(raw: &str) -> Result<std::path::PathBuf, String> {
    if raw.is_empty() {
        return Err("Path must not be empty".into());
    }
    if raw.contains('\0') {
        return Err("Path must not contain NUL bytes".into());
    }
    let path = std::path::Path::new(raw);

    let canonical = if path.exists() {
        std::fs::canonicalize(path).map_err(|e| format!("Failed to resolve path: {e}"))?
    } else {
        // Reject '.' / '..' components lexically, independent of the
        // filesystem. On Windows, Path::exists() collapses a trailing
        // `X\..` (Temp\X\.. resolves to Temp even when X doesn't exist),
        // so the walk-up loop below never observes the '..' component and
        // the traversal would be silently accepted. The lexical check runs
        // before any syscall so behaviour is identical across platforms.
        if path.components().any(|c| {
            matches!(
                c,
                std::path::Component::CurDir | std::path::Component::ParentDir
            )
        }) {
            return Err("Path must not contain '.' or '..' in a not-yet-existing segment".into());
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
            suffix.push(name);
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
        resolved
    };

    let allowed_roots: Vec<std::path::PathBuf> = [user_home_dir(), Some(std::env::temp_dir())]
        .into_iter()
        .flatten()
        .filter_map(|p| std::fs::canonicalize(&p).ok())
        .collect();

    if allowed_roots.is_empty() {
        return Err("Unable to determine an allowed path scope on this system".into());
    }
    if allowed_roots.iter().any(|root| canonical.starts_with(root)) {
        Ok(canonical)
    } else {
        Err(format!(
            "Path '{}' is outside the allowed scope (must be under the user's home or temp directory)",
            canonical.display()
        ))
    }
}

/// Write bytes to `path` atomically: write to a temporary sibling file,
/// flush to disk (`sync_all`), then `rename` over the target. A crash
/// mid-write leaves the original file intact; only the temp is abandoned
/// (cleaned up by the OS or next successful write).
///
/// Pattern already proven for ONNX model download (line ~279-354).
pub(crate) fn write_file_atomic(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Err("Invalid path: no parent directory".to_string());
    };
    if !parent.exists() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
    }
    // The temporary name is app-generated, so it does not need to round-trip
    // the target's native filename through UTF-8.  This keeps non-UTF-8 Unix
    // filenames native and avoids using lossy text for path identity.
    let tmp = parent.join(format!(".varve-write-{}.tmp", uuid()));
    let result = (|| -> Result<(), String> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| format!("Failed to create temp file {}: {e}", tmp.display()))?;
        file.write_all(data)
            .map_err(|e| format!("Failed to write temp file: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Failed to flush temp file: {e}"))?;
        drop(file);
        filesystem::replace_file(&tmp, path).map_err(|error| error.message)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result?;
    // Best-effort directory fsync so the rename itself is durable, not just
    // the file contents. Not supported on every OS/filesystem (NFS, some
    // Windows volumes); failure here is ignored rather than failing the save.
    #[cfg(unix)]
    {
        if let Ok(dir) = std::fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

/// Canonicalize an untrusted path exactly like `resolve_user_path`, but
/// WITHOUT the home/temp scope restriction.
///
/// Used ONLY by commands whose paths originate from the native OS dialog
/// (`plugin:dialog|open` / `plugin:dialog|save`). The dialog is the trust
/// boundary: the user explicitly chose these locations, and legitimate
/// documents live anywhere the user keeps them — other drives, removable
/// media, network mounts, iCloud/Documents on macOS. Restricting them to
/// $HOME would make the app silently unable to open or save its own
/// documents outside the home directory.
///
/// The same canonicalization (symlink resolution via the nearest existing
/// ancestor) and the same lexical traversal rejection still apply, so a
/// webview bug can never escape a real directory via `..` tricks.
pub(crate) fn resolve_user_path_approved(raw: &str) -> Result<std::path::PathBuf, String> {
    if raw.is_empty() {
        return Err("Path must not be empty".into());
    }
    if raw.contains('\0') {
        return Err("Path must not contain NUL bytes".into());
    }
    let path = std::path::Path::new(raw);

    // Lexical traversal rejection runs BEFORE any syscall: the kernel
    // resolves '..' inside existing paths, so `path.exists()` would
    // happily report `existing_dir/../../etc/passwd` as present and the
    // canonicalize branch would accept it.
    if path.components().any(|c| {
        matches!(
            c,
            std::path::Component::CurDir | std::path::Component::ParentDir
        )
    }) {
        return Err("Path must not contain '.' or '..' in a not-yet-existing segment".into());
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
        suffix.push(name);
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

#[tauri::command]
pub(crate) fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    let resolved = resolve_user_path(&path)?;
    write_file_atomic(&resolved, &data)
}

/// Write an export below a directory the user selected in the native folder
/// dialog. The relative path is a portable export-plan path, not a native
/// path; it is validated component-by-component before native joining.
#[tauri::command]
pub(crate) fn write_binary_file_to_folder(
    folder: String,
    relative_path: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let components = filesystem::validate_portable_relative_path(&relative_path)
        .map_err(|error| error.message)?;

    let root = resolve_user_path_approved(&folder)?;
    if !root.is_dir() {
        return Err("Export destination is not a directory".into());
    }
    let mut target = root.clone();
    for component in components {
        target.push(component);
    }
    let resolved = resolve_user_path_approved(target.to_str().ok_or_else(|| {
        "Export path cannot be represented by the desktop IPC boundary".to_string()
    })?)?;
    if !resolved.starts_with(&root) {
        return Err("Export path escapes the selected directory".into());
    }
    write_file_atomic(&resolved, &data)?;
    Ok(filesystem::display_path(&resolved))
}

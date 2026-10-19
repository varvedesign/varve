//! The desktop filesystem boundary.
//!
//! This module is the one place where Varve decides where application-owned
//! data lives.  Callers keep the returned values as `PathBuf`s and only turn
//! them into display text at the UI/diagnostics boundary.

use serde::Serialize;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Stable logical categories used by the application storage policy.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FsErrorKind {
    NotFound,
    AlreadyExists,
    NotAFile,
    NotADirectory,
    PermissionDenied,
    ReadOnly,
    DiskFull,
    InvalidPath,
    InvalidFilename,
    PathTooLong,
    TraversalBlocked,
    NetworkUnavailable,
    VolumeDisconnected,
    IoError,
}

/// Native error details retained for diagnostics without making callers parse
/// platform-specific English messages.
#[derive(Debug, Clone, Serialize)]
pub struct FsError {
    pub kind: FsErrorKind,
    pub message: String,
}

impl FsError {
    pub fn new(kind: FsErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn from_io(operation: &str, path: &Path, error: &io::Error) -> Self {
        let kind = match error.kind() {
            io::ErrorKind::NotFound => FsErrorKind::NotFound,
            io::ErrorKind::AlreadyExists => FsErrorKind::AlreadyExists,
            io::ErrorKind::PermissionDenied => FsErrorKind::PermissionDenied,
            io::ErrorKind::InvalidInput | io::ErrorKind::InvalidFilename => {
                FsErrorKind::InvalidPath
            }
            io::ErrorKind::ReadOnlyFilesystem => FsErrorKind::ReadOnly,
            io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded => FsErrorKind::DiskFull,
            io::ErrorKind::FileTooLarge => FsErrorKind::PathTooLong,
            _ => FsErrorKind::IoError,
        };
        Self::new(kind, format!("{operation} {}: {error}", display_path(path)))
    }
}

/// All mutable locations owned by Varve.  The roots come from Tauri's current
/// platform resolver; the child paths are policy, not OS-specific guesses.
#[derive(Debug, Clone)]
pub struct AppDirectories {
    pub data: PathBuf,
    pub config: PathBuf,
    pub cache: PathBuf,
    pub state: PathBuf,
    #[allow(dead_code)]
    pub temporary: PathBuf,
    #[allow(dead_code)]
    pub resources: PathBuf,
    pub fonts: PathBuf,
    pub models: PathBuf,
    pub recovery: PathBuf,
    pub crash_reports: PathBuf,
    pub logs: PathBuf,
    pub thumbnails: PathBuf,
    pub staging: PathBuf,
}

impl AppDirectories {
    pub fn resolve(app: &AppHandle) -> Result<Self, FsError> {
        let path = app.path();
        let data = resolve(path.app_data_dir(), "application data")?;
        let config = resolve(path.app_config_dir(), "configuration")?;
        let cache = resolve(path.app_cache_dir(), "cache")?;
        let state = resolve(path.app_local_data_dir(), "application state")?;
        let temporary = resolve(path.temp_dir(), "temporary storage")?.join("varve");
        let resources = resolve(path.resource_dir(), "packaged resources")?;

        Ok(Self {
            fonts: data.join("fonts"),
            models: data.join("models"),
            recovery: state.join("recovery"),
            crash_reports: state.join("crash-reports"),
            logs: resolve(path.app_log_dir(), "logs")?,
            thumbnails: cache.join("thumbnails"),
            staging: cache.join("staging"),
            data,
            config,
            cache,
            state,
            temporary,
            resources,
        })
    }

    /// Create only application-owned roots. Resources are intentionally never
    /// created or written by this service.
    pub fn ensure_mutable_roots(&self) -> Result<(), FsError> {
        for root in [
            &self.data,
            &self.config,
            &self.cache,
            &self.state,
            &self.fonts,
            &self.models,
            &self.recovery,
            &self.crash_reports,
            &self.logs,
            &self.thumbnails,
            &self.staging,
        ] {
            std::fs::create_dir_all(root)
                .map_err(|error| FsError::from_io("create directory", root, &error))?;
        }
        Ok(())
    }
}

fn resolve(result: Result<PathBuf, tauri::Error>, label: &str) -> Result<PathBuf, FsError> {
    result.map_err(|error| {
        FsError::new(
            FsErrorKind::InvalidPath,
            format!("resolve {label}: {error}"),
        )
    })
}

/// Storage keys are generated identifiers, not paths.  Keeping this check at
/// the boundary prevents model/cache commands from turning `join` into an
/// arbitrary filesystem operation.
pub fn validate_storage_key(value: &str) -> Result<(), FsError> {
    if value.is_empty() || value.len() > 160 || value == "." || value == ".." {
        return Err(FsError::new(
            FsErrorKind::InvalidFilename,
            "invalid storage key",
        ));
    }
    if value.contains('/')
        || value.contains('\\')
        || value.contains('\0')
        || value
            .chars()
            .any(|character| matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        || value.chars().any(|character| character.is_control())
    {
        return Err(FsError::new(
            FsErrorKind::TraversalBlocked,
            "storage key is not a filename",
        ));
    }
    Ok(())
}

/// Validate a document/export logical relative path without asking the host
/// `Path` parser to interpret Windows syntax on Unix (or vice versa).
pub fn validate_portable_relative_path(value: &str) -> Result<Vec<&str>, FsError> {
    if value.is_empty()
        || value.starts_with('/')
        || value.starts_with('\\')
        || (value.len() >= 2 && value.as_bytes()[1] == b':')
        || value.contains('\\')
        || value.contains('\0')
    {
        return Err(FsError::new(
            FsErrorKind::InvalidPath,
            "path is not a portable relative path",
        ));
    }
    let components = value.split('/').collect::<Vec<_>>();
    if components
        .iter()
        .any(|component| component.is_empty() || *component == "." || *component == "..")
    {
        return Err(FsError::new(
            FsErrorKind::TraversalBlocked,
            "portable path contains an invalid component",
        ));
    }
    Ok(components)
}

/// Diagnostics-only path rendering.  It is intentionally lossy and must not
/// be used for filesystem identity or security checks.
pub fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Replace a file with a fully-written sibling temporary file. Windows uses
/// ReplaceFileW for existing targets so ACLs, attributes, creation time, and
/// named streams survive. A sibling backup allows recovery from documented
/// partial-failure states; new targets use MoveFileExW.
pub fn replace_file(temporary: &Path, destination: &Path) -> Result<(), FsError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let source = temporary
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let target = destination
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let replaced = if destination.exists() {
            let backup_path = destination
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join(format!(
                    ".varve-write-{}-{}.tmp.bak",
                    std::process::id(),
                    crate::uuid()
                ));
            let backup = backup_path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>();
            let replaced = unsafe {
                windows_sys::Win32::Storage::FileSystem::ReplaceFileW(
                    target.as_ptr(),
                    source.as_ptr(),
                    backup.as_ptr(),
                    0,
                    std::ptr::null(),
                    std::ptr::null(),
                )
            };
            if replaced == 0 {
                let replace_error = io::Error::last_os_error();
                // ReplaceFileW documents failure states that can leave the
                // original at the backup name. Restore it before returning.
                if backup_path.exists() {
                    let restored = unsafe {
                        windows_sys::Win32::Storage::FileSystem::MoveFileExW(
                            backup.as_ptr(),
                            target.as_ptr(),
                            windows_sys::Win32::Storage::FileSystem::MOVEFILE_REPLACE_EXISTING
                                | windows_sys::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH,
                        )
                    };
                    if restored == 0 {
                        return Err(FsError::from_io(
                            "Could not restore save backup after replacement failed",
                            &backup_path,
                            &io::Error::last_os_error(),
                        ));
                    }
                }
                return Err(FsError::from_io(
                    "Could not replace file",
                    destination,
                    &replace_error,
                ));
            }
            // A crash between replacement and cleanup leaves a uniquely
            // named backup; the regular stale-temp sweep also removes it.
            let _ = std::fs::remove_file(&backup_path);
            replaced
        } else {
            let flags = windows_sys::Win32::Storage::FileSystem::MOVEFILE_REPLACE_EXISTING
                | windows_sys::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH;
            unsafe {
                windows_sys::Win32::Storage::FileSystem::MoveFileExW(
                    source.as_ptr(),
                    target.as_ptr(),
                    flags,
                )
            }
        };
        if replaced == 0 {
            return Err(FsError::from_io(
                "replace file",
                destination,
                &io::Error::last_os_error(),
            ));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        std::fs::rename(temporary, destination)
            .map_err(|error| FsError::from_io("replace file", destination, &error))
    }
}

/// Match `@varve/platform`'s FNV-1a hash of JavaScript UTF-16 code units while
/// reading a native document in bounded chunks. The save-conflict check needs
/// a digest, not a second in-memory copy of the complete document text.
pub fn hash_text_file(path: &Path) -> io::Result<String> {
    const CHUNK_BYTES: usize = 64 * 1024;

    let file = std::fs::File::open(path)?;
    let mut reader = file;
    let mut chunk = [0; CHUNK_BYTES];
    // A UTF-8 code point is at most four bytes. `pending` keeps only an
    // incomplete trailing code point from the previous chunk.
    let mut pending = Vec::with_capacity(4);
    let mut hash = 0x811c9dc5_u32;

    loop {
        let read = reader.read(&mut chunk)?;
        if read == 0 {
            if !pending.is_empty() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "document ends with an incomplete UTF-8 sequence",
                ));
            }
            break;
        }
        pending.extend_from_slice(&chunk[..read]);
        match std::str::from_utf8(&pending) {
            Ok(text) => {
                update_utf16_fnv1a(&mut hash, text);
                pending.clear();
            }
            Err(error) => {
                if error.error_len().is_some() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "document contains invalid UTF-8",
                    ));
                }
                let valid_bytes = error.valid_up_to();
                let valid_text = std::str::from_utf8(&pending[..valid_bytes])
                    .expect("UTF-8 prefix reported as valid");
                update_utf16_fnv1a(&mut hash, valid_text);
                pending.drain(..valid_bytes);
            }
        }
    }

    Ok(format!("{hash:08x}"))
}

fn update_utf16_fnv1a(hash: &mut u32, text: &str) {
    let mut units = [0; 2];
    for character in text.chars() {
        for unit in character.encode_utf16(&mut units).iter() {
            *hash = (*hash ^ u32::from(*unit)).wrapping_mul(0x01000193);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{hash_text_file, validate_portable_relative_path, validate_storage_key};

    #[test]
    fn storage_keys_are_not_paths() {
        assert!(validate_storage_key("model-id").is_ok());
        assert!(validate_storage_key("../outside").is_err());
        assert!(validate_storage_key(r"..\outside").is_err());
        assert!(validate_storage_key("C:relative").is_err());
    }

    #[test]
    fn portable_relative_paths_reject_host_absolute_and_traversal_forms() {
        for value in [
            "../secret",
            r"..\secret",
            "/absolute/file",
            r"C:\absolute\file",
            r"\\server\share\file",
            r"\\?\C:\path\file",
            "file:///etc/passwd",
        ] {
            assert!(
                validate_portable_relative_path(value).is_err(),
                "accepted {value:?}"
            );
        }
        assert!(validate_portable_relative_path("assets/%2e%2e/file.png").is_ok());
        assert!(validate_portable_relative_path("assets/设计/file.png").is_ok());
    }

    #[test]
    fn streamed_text_hash_matches_utf16_fnv_across_utf8_chunk_boundaries() {
        let path =
            std::env::temp_dir().join(format!("varve_streamed_hash_test_{}.varve", crate::uuid()));
        let text = format!("{}🌱é{}", "A".repeat(64 * 1024 - 1), "tail");
        std::fs::write(&path, text.as_bytes()).expect("write hash fixture");

        assert_eq!(hash_text_file(&path).expect("hash valid UTF-8"), "1adc54fe");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn streamed_text_hash_rejects_invalid_utf8() {
        let path = std::env::temp_dir().join(format!(
            "varve_streamed_hash_invalid_test_{}.varve",
            crate::uuid()
        ));
        std::fs::write(&path, [b'{', 0xff, b'}']).expect("write invalid UTF-8 fixture");

        assert_eq!(
            hash_text_file(&path)
                .expect_err("invalid UTF-8 must match read_to_string behavior")
                .kind(),
            std::io::ErrorKind::InvalidData
        );
        let _ = std::fs::remove_file(path);
    }
}

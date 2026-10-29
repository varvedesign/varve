//! Legacy Strata application-data-directory migration extracted from the crate root (Batch B/B-01).

#[cfg(test)]
mod tests;

use crate::logs;

/// Application-data directory used before the Strata -> Varve rename.
const LEGACY_APP_DIR: &str = "dev.strata.desktop";

/// What a migration attempt actually did. Returned so the behaviour can be
/// asserted in tests; the caller at startup ignores it.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum LegacyMigration {
    /// The current data directory already exists — migration already happened,
    /// or this is a fresh install that has been run before.
    AlreadyPresent,
    /// No legacy directory to copy from.
    NoLegacyData,
    /// Legacy data was copied into the current directory.
    Copied,
    /// The copy failed partway; the incomplete destination was removed.
    Failed,
}

pub(crate) fn migrate_legacy_data_dir(data_dir: &std::path::Path) -> LegacyMigration {
    let Some(base) = legacy_data_base() else {
        return LegacyMigration::NoLegacyData;
    };
    migrate_legacy_data_dir_from(&base, data_dir)
}

/// Copy the pre-rename application-data directory into the current one.
///
/// Split from `migrate_legacy_data_dir` so the base directory can be injected:
/// the public entry point resolves it from `$XDG_DATA_HOME`/`$HOME`/`$APPDATA`,
/// which a test cannot vary without mutating process-global environment state.
///
/// Copies rather than moves, so an older build pointed at the legacy directory
/// keeps working and a bad migration can be undone by deleting the new one.
fn migrate_legacy_data_dir_from(
    legacy_base: &std::path::Path,
    data_dir: &std::path::Path,
) -> LegacyMigration {
    if data_dir.exists() {
        return LegacyMigration::AlreadyPresent;
    }
    let legacy = legacy_base.join(LEGACY_APP_DIR);
    if !legacy.is_dir() {
        return LegacyMigration::NoLegacyData;
    }

    match copy_dir_all(&legacy, data_dir) {
        Ok(()) => LegacyMigration::Copied,
        Err(err) => {
            // A failed copy must not leave the destination behind. `copy_dir_all`
            // creates it before copying anything, so an error partway through
            // (disk full, unreadable source) leaves a directory that exists but
            // is incomplete — and the `data_dir.exists()` check above would then
            // treat that partial copy as a finished migration on every later
            // launch, silently stranding the rest of the user's data.
            //
            // Removing it means the next launch retries from a clean state.
            let _ = std::fs::remove_dir_all(data_dir);
            let message = format!(
                "could not migrate data from {}: {err}. The previous directory \
                 is untouched; retrying on next launch.",
                legacy.display()
            );
            eprintln!("[varve] {message}");
            logs::log_line("migration", &logs::redact_for_log(&message));
            LegacyMigration::Failed
        }
    }
}

fn legacy_data_base() -> Option<std::path::PathBuf> {
    if cfg!(target_os = "linux") {
        std::env::var_os("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local/share"))
            })
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME")
            .map(|h| std::path::PathBuf::from(h).join("Library/Application Support"))
    } else if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(std::path::PathBuf::from)
    } else {
        None
    }
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else if ty.is_file() {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

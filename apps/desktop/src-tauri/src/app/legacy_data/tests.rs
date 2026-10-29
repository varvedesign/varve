//! Unit tests for app/legacy_data (moved verbatim from lib.rs #[cfg(test)] mod tests; Batch B/B-01).

use super::*;
use crate::uuid;

// ── Legacy application-data migration ───────────────────────────────────
//
// This runs once, at startup, before anything opens the document store, and
// it moves a user's whole history: documents, backups, model cache, recent
// files. A silent failure here is the kind that is discovered days later,
// when the data it should have carried is already assumed lost.

/// Fresh scratch directory holding `legacy_base` and the not-yet-created
/// `data_dir` the migration writes into.
fn migration_fixture() -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
    let root = std::env::temp_dir().join(format!("varve_migration_test_{}", uuid()));
    let legacy_base = root.join("legacy_base");
    let data_dir = root.join("dev.varve.desktop");
    std::fs::create_dir_all(&legacy_base).expect("create legacy base");
    (root, legacy_base, data_dir)
}

fn seed_legacy_dir(legacy_base: &std::path::Path) -> std::path::PathBuf {
    let legacy = legacy_base.join(LEGACY_APP_DIR);
    std::fs::create_dir_all(legacy.join("backups")).expect("create legacy backups");
    std::fs::write(legacy.join("documents.db"), b"db").expect("write legacy db");
    std::fs::write(legacy.join("backups").join("a.json"), b"{}").expect("write legacy backup");
    legacy
}

#[test]
fn migration_copies_legacy_tree_including_nested_files() {
    let (root, legacy_base, data_dir) = migration_fixture();
    seed_legacy_dir(&legacy_base);

    let outcome = migrate_legacy_data_dir_from(&legacy_base, &data_dir);

    assert_eq!(outcome, LegacyMigration::Copied);
    assert_eq!(
        std::fs::read(data_dir.join("documents.db")).expect("read migrated db"),
        b"db"
    );
    assert_eq!(
        std::fs::read(data_dir.join("backups").join("a.json")).expect("read migrated backup"),
        b"{}"
    );

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn migration_copies_rather_than_moves_so_rollback_stays_possible() {
    let (root, legacy_base, data_dir) = migration_fixture();
    let legacy = seed_legacy_dir(&legacy_base);

    migrate_legacy_data_dir_from(&legacy_base, &data_dir);

    // An older build still points at the legacy directory. If migration
    // moved instead of copied, downgrading would lose everything.
    assert!(
        legacy.join("documents.db").exists(),
        "legacy data was removed"
    );

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn migration_does_not_overwrite_an_existing_data_dir() {
    let (root, legacy_base, data_dir) = migration_fixture();
    seed_legacy_dir(&legacy_base);
    std::fs::create_dir_all(&data_dir).expect("create current data dir");
    std::fs::write(data_dir.join("documents.db"), b"current").expect("write current db");

    let outcome = migrate_legacy_data_dir_from(&legacy_base, &data_dir);

    assert_eq!(outcome, LegacyMigration::AlreadyPresent);
    assert_eq!(
        std::fs::read(data_dir.join("documents.db")).expect("read current db"),
        b"current",
        "existing data must never be clobbered by the migration"
    );

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn migration_is_a_no_op_without_legacy_data() {
    let (root, legacy_base, data_dir) = migration_fixture();

    let outcome = migrate_legacy_data_dir_from(&legacy_base, &data_dir);

    assert_eq!(outcome, LegacyMigration::NoLegacyData);
    assert!(
        !data_dir.exists(),
        "a fresh install must not get an empty data dir from the migration"
    );

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn migration_ignores_a_legacy_path_that_is_a_file() {
    let (root, legacy_base, data_dir) = migration_fixture();
    std::fs::write(legacy_base.join(LEGACY_APP_DIR), b"not a directory")
        .expect("write legacy file");

    let outcome = migrate_legacy_data_dir_from(&legacy_base, &data_dir);

    assert_eq!(outcome, LegacyMigration::NoLegacyData);

    let _ = std::fs::remove_dir_all(&root);
}

/// The regression this whole split exists for.
///
/// `copy_dir_all` creates the destination before it copies anything, so a
/// failure partway leaves a directory that exists but is incomplete. The
/// `data_dir.exists()` early return would then read that partial copy as a
/// completed migration on every subsequent launch and never retry.
#[cfg(unix)]
#[test]
fn failed_migration_removes_the_partial_copy_so_the_next_launch_retries() {
    use std::os::unix::fs::PermissionsExt;

    let (root, legacy_base, data_dir) = migration_fixture();
    let legacy = seed_legacy_dir(&legacy_base);

    // An unreadable subdirectory makes read_dir fail mid-copy.
    let locked = legacy.join("locked");
    std::fs::create_dir_all(&locked).expect("create locked dir");
    std::fs::write(locked.join("secret"), b"x").expect("write locked file");
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000))
        .expect("chmod locked dir");

    let outcome = migrate_legacy_data_dir_from(&legacy_base, &data_dir);

    // Restore permissions first so cleanup can run even if asserts fail.
    let _ = std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755));

    assert_eq!(outcome, LegacyMigration::Failed);
    assert!(
        !data_dir.exists(),
        "a partial copy was left behind; the next launch would treat it as migrated"
    );

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn copy_dir_all_recreates_nested_structure() {
    let root = std::env::temp_dir().join(format!("varve_copy_test_{}", uuid()));
    let src = root.join("src");
    let dst = root.join("dst");
    std::fs::create_dir_all(src.join("a").join("b")).expect("create nested src");
    std::fs::write(src.join("top.txt"), b"top").expect("write top");
    std::fs::write(src.join("a").join("b").join("deep.txt"), b"deep").expect("write deep");

    copy_dir_all(&src, &dst).expect("copy should succeed");

    assert_eq!(
        std::fs::read(dst.join("top.txt")).expect("read top"),
        b"top"
    );
    assert_eq!(
        std::fs::read(dst.join("a").join("b").join("deep.txt")).expect("read deep"),
        b"deep"
    );

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn legacy_data_base_resolves_on_supported_platforms() {
    // cfg! makes this a per-platform constant; on the three we ship, a base
    // must resolve or the migration silently never runs.
    let base = legacy_data_base();
    if cfg!(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "windows"
    )) {
        assert!(
            base.is_some(),
            "no legacy data base on a supported platform"
        );
    }
}

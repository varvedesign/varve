//! Unit tests for files (moved verbatim from lib.rs #[cfg(test)] mod tests; Batch B/B-01).

use super::*;
use crate::uuid;

// ── resolve_user_path ──────────────────────────────────────────────

#[test]
fn resolve_user_path_rejects_empty_path() {
    assert!(resolve_user_path("").is_err());
}

#[test]
fn atomic_write_replaces_content_without_leaving_staging_files() {
    let dir = std::env::temp_dir().join(format!("varve_atomic_write_test_{}", uuid()));
    std::fs::create_dir_all(&dir).expect("create test dir");
    let target = dir.join("document.varve");
    std::fs::write(&target, b"old").expect("write initial content");

    write_file_atomic(&target, b"new").expect("atomic write succeeds");

    assert_eq!(std::fs::read(&target).expect("read final content"), b"new");
    let leftovers = std::fs::read_dir(&dir)
        .expect("read test dir")
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".varve-write-")
        })
        .count();
    assert_eq!(
        leftovers, 0,
        "successful writes should consume their staging file"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn resolve_user_path_rejects_nul_byte() {
    assert!(resolve_user_path("/tmp/foo\0bar").is_err());
}

#[test]
fn resolve_user_path_accepts_existing_file_under_temp() {
    let dir = std::env::temp_dir().join(format!("varve_path_test_{}", uuid()));
    std::fs::create_dir_all(&dir).expect("create test dir");
    let file = dir.join("existing.txt");
    std::fs::write(&file, b"hi").expect("write test file");

    let resolved = resolve_user_path(file.to_str().expect("utf8 path"))
        .expect("path under temp dir should resolve");
    assert_eq!(
        std::fs::canonicalize(&resolved).expect("canonicalize resolved"),
        std::fs::canonicalize(&file).expect("canonicalize expected")
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn resolve_user_path_accepts_not_yet_existing_file_under_temp() {
    let dir = std::env::temp_dir().join(format!("varve_path_test_new_{}", uuid()));
    std::fs::create_dir_all(&dir).expect("create test dir");
    let target = dir.join("subdir").join("brand-new.txt");

    let resolved = resolve_user_path(target.to_str().expect("utf8 path"))
        .expect("not-yet-existing path under an existing temp ancestor should resolve");
    assert!(
        resolved.ends_with("subdir/brand-new.txt") || resolved.ends_with("subdir\\brand-new.txt")
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn resolve_user_path_rejects_traversal_outside_scope() {
    // A path that resolves to a system file outside both the home and
    // temp directories must be rejected regardless of the '..' trick
    // used to construct it.
    let err = resolve_user_path("/etc/passwd");
    // /etc/passwd exists on Linux CI runners and dev machines; if it
    // doesn't (e.g. some minimal containers), the "does not exist"
    // path is exercised instead — both are acceptable rejections here,
    // the point is that it must never resolve successfully.
    assert!(
        err.is_err(),
        "/etc/passwd must never resolve as an allowed path"
    );
}

#[test]
fn resolve_user_path_rejects_dotdot_in_not_yet_existing_suffix() {
    let dir = std::env::temp_dir().join(format!("varve_path_test_dotdot_{}", uuid()));
    std::fs::create_dir_all(&dir).expect("create test dir");
    let escaping = dir.join("..").join("..").join("etc").join("passwd");

    let result = resolve_user_path(escaping.to_str().expect("utf8 path"));
    assert!(
        result.is_err(),
        "'..' segments in a not-yet-existing suffix must be rejected, not silently joined"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn resolve_user_path_approved_accepts_paths_outside_home() {
    // The approved resolver is what lets documents on other drives and
    // removable media open/save. An existing system file outside $HOME
    // (e.g. /etc/hosts on Linux) must canonicalize successfully here —
    // unlike resolve_user_path, which rejects it. /etc/hosts exists on
    // every Linux/macOS dev machine.
    let resolved = resolve_user_path_approved("/etc/hosts")
        .expect("approved resolver accepts an existing out-of-home path");
    assert!(resolved.is_absolute());
}

#[test]
fn resolve_user_path_approved_still_rejects_traversal() {
    let dir = std::env::temp_dir().join(format!("varve_path_test_approved_{}", uuid()));
    std::fs::create_dir_all(&dir).expect("create test dir");
    let escaping = dir.join("..").join("..").join("etc").join("passwd");

    assert!(
        resolve_user_path_approved(escaping.to_str().expect("utf8 path")).is_err(),
        "approved resolver must still reject '..' in a not-yet-existing suffix"
    );
    assert!(resolve_user_path_approved("").is_err());
    assert!(resolve_user_path_approved("/tmp/foo\0bar").is_err());

    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn resolve_user_path_rejects_symlink_escape() {
    let dir = std::env::temp_dir().join(format!("varve_path_test_symlink_{}", uuid()));
    std::fs::create_dir_all(&dir).expect("create test dir");
    let link = dir.join("escape");
    // Point a symlink at a real out-of-scope directory (a fresh temp
    // dir it also happens to be under /tmp is fine here — the actual
    // security-relevant case is the home/temp scope check itself,
    // already covered above; this test specifically proves symlinks
    // are resolved rather than trusted at face value).
    std::os::unix::fs::symlink("/etc", &link).expect("create symlink");
    let target = link.join("passwd");

    let result = resolve_user_path(target.to_str().expect("utf8 path"));
    assert!(
        result.is_err(),
        "a symlink pointing outside the allowed scope must not be trusted at face value"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

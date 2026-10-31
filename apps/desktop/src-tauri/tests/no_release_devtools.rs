//! Release builds must not ship the webview inspector.
//!
//! Tauri only enables "Inspect Element" and devtools in release builds when
//! the `tauri/devtools` Cargo feature is on, or a window config sets
//! `"devtools": true`. Debug builds keep devtools for development. This test
//! fails if either switch sneaks into the manifest or a release config.

use std::path::Path;

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

#[test]
fn cargo_manifest_does_not_enable_devtools() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let manifest = read(&root.join("Cargo.toml"));
    for (n, line) in manifest.lines().enumerate() {
        let code = line.split('#').next().unwrap_or("");
        assert!(
            !code.contains("devtools"),
            "Cargo.toml line {} enables devtools, which would allow Inspect Element in release builds: {line}",
            n + 1
        );
    }
}

#[test]
fn release_configs_do_not_enable_devtools() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut checked = 0;
    for entry in std::fs::read_dir(root).expect("list src-tauri") {
        let path = entry.expect("dir entry").path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !(name.starts_with("tauri.") && name.ends_with(".json")) {
            continue;
        }
        // Test-only configs are used with debug builds, which keep devtools anyway.
        if name.contains(".test.") || name.contains(".smoke.") {
            continue;
        }
        let compact: String = read(&path).chars().filter(|c| !c.is_whitespace()).collect();
        assert!(
            !compact.contains("\"devtools\":true"),
            "{name} sets \"devtools\": true, which would allow Inspect Element in release builds"
        );
        checked += 1;
    }
    assert!(checked > 0, "expected to check at least tauri.conf.json");
}

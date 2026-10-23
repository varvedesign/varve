use std::{fs, path::PathBuf};
use varve_desktop_lib::policy::{read_policy_at, PolicyState};

#[test]
fn corrupt_policy_blocks_network_access() {
    let path: PathBuf = std::env::temp_dir().join(format!(
        "varve-corrupt-policy-{}.json",
        std::process::id()
    ));
    fs::write(&path, b"{ this is not valid JSON").expect("write corrupt policy");
    let state: PolicyState = read_policy_at(&path);
    let _ = fs::remove_file(&path);
    assert!(state.restricted);
    assert!(!state.permits_network_url("https://example.org"));
}

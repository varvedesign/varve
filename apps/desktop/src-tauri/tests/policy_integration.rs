use std::{fs, path::PathBuf, sync::atomic::{AtomicUsize, Ordering}};
use varve_desktop_lib::policy::{read_policy_at, PolicyState};

#[test]
fn corrupt_policy_blocks_network_calls() {
    let path: PathBuf = std::env::temp_dir().join(format!("varve-corrupt-policy-{}.json", std::process::id()));
    fs::write(&path, b"{ this is not valid JSON").expect("write corrupt policy");
    let state: PolicyState = read_policy_at(&path);
    let _ = fs::remove_file(&path);
    assert!(state.restricted);

    let network_call_count = AtomicUsize::new(0);
    let mut guarded_request = |url: &str| {
        if state.permits_network_url(url) { network_call_count.fetch_add(1, Ordering::SeqCst); }
    };
    guarded_request("https://example.org/icons");
    assert_eq!(network_call_count.load(Ordering::SeqCst), 0);
}

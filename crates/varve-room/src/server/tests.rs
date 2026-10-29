use super::host::{HostConfig, RoomHost};
use super::http::{is_loopback_host, origin_allowed};
use super::prelude::*;

fn test_host(config: HostConfig) -> Arc<RoomHost> {
    let dir = std::env::temp_dir().join(format!(
        "varve-room-origin-{}-{}",
        std::process::id(),
        config.data_dir.display()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    let mut config = config;
    config.data_dir = dir;
    RoomHost::open(config).expect("host opens")
}

fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
    let mut map = HeaderMap::new();
    for (name, value) in pairs {
        map.insert(
            axum::http::HeaderName::from_bytes(name.as_bytes()).expect("header name"),
            value.parse().expect("header value"),
        );
    }
    map
}

#[test]
fn loopback_pages_and_native_clients_can_open_a_socket() {
    let host = test_host(HostConfig::for_data_dir(PathBuf::from("loopback")));
    assert!(origin_allowed(&host, &headers(&[])));
    for origin in [
        "http://localhost:1420",
        "http://127.0.0.1:5173",
        "http://[::1]:8080",
        "tauri://localhost",
        "http://tauri.localhost",
    ] {
        assert!(
            origin_allowed(&host, &headers(&[("origin", origin), ("host", "127.0.0.1:8790")])),
            "{origin} must be allowed"
        );
    }
}

#[test]
fn a_remote_page_origin_is_refused() {
    let host = test_host(HostConfig::for_data_dir(PathBuf::from("remote")));
    for origin in ["https://evil.example", "http://evil.example:8080"] {
        assert!(
            !origin_allowed(&host, &headers(&[("origin", origin), ("host", "127.0.0.1:8790")])),
            "{origin} must be refused"
        );
    }
}

#[test]
fn a_configured_origin_is_allowed_and_nothing_else_is() {
    let mut config = HostConfig::for_data_dir(PathBuf::from("allowed"));
    config.allowed_origins = vec!["https://rooms.example.com".to_string()];
    let host = test_host(config);
    assert!(origin_allowed(
        &host,
        &headers(&[
            ("origin", "https://rooms.example.com"),
            ("host", "127.0.0.1:8790")
        ])
    ));
    assert!(!origin_allowed(
        &host,
        &headers(&[
            ("origin", "https://rooms.example.com.evil.test"),
            ("host", "127.0.0.1:8790")
        ])
    ));
}

#[test]
fn a_rebinding_host_header_is_refused_on_a_loopback_listener() {
    let host = test_host(HostConfig::for_data_dir(PathBuf::from("rebind")));
    // The page's origin looks local because the attacker's DNS points at
    // 127.0.0.1, but the Host header still carries the attacker's name.
    assert!(!origin_allowed(
        &host,
        &headers(&[
            ("origin", "http://evil.example"),
            ("host", "evil.example")
        ])
    ));
    assert!(!origin_allowed(
        &host,
        &headers(&[("host", "evil.example:8790")])
    ));
}

#[test]
fn a_listed_host_is_accepted_for_a_same_host_reverse_proxy() {
    let mut config = HostConfig::for_data_dir(PathBuf::from("proxy"));
    config.allowed_hosts = vec!["rooms.example.com".to_string()];
    let host = test_host(config);
    assert!(origin_allowed(
        &host,
        &headers(&[("host", "rooms.example.com")])
    ));
}

#[test]
fn loopback_host_parsing_covers_ports_and_ipv6() {
    assert!(is_loopback_host("localhost:3000"));
    assert!(is_loopback_host("127.0.0.1"));
    assert!(is_loopback_host("[::1]:8790"));
    assert!(is_loopback_host("::1"));
    assert!(is_loopback_host("app.localhost:1420"));
    assert!(!is_loopback_host("localhost.evil.example"));
    assert!(!is_loopback_host("evil.example:1420"));
}

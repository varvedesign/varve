//! Machine-wide administrator policy, loaded before application services start.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{path::{Path, PathBuf}, sync::LazyLock};

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub updates: Updates,
    pub ai: Ai,
    pub network: Network,
    pub crash_reports: CrashReports,
    pub ui: Ui,
    pub security: Security,
}
#[derive(Clone, Debug, Default, Serialize)]
pub struct Updates { pub check: Option<bool> }
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ai { pub enabled: Option<AiMode>, pub model_downloads: Option<bool>, pub local_model_dir: Option<PathBuf> }
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AiMode { On, Off, User }
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Network { pub allowed_hosts: Option<Vec<String>>, pub offline: Option<bool> }
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReports { pub local_only: Option<bool> }
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ui { pub locked_settings: Option<Vec<String>> }
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Security { pub offline_mode: bool, pub model_downloads_blocked: bool, pub updates_disabled: bool, pub crash_upload_disabled: bool, pub telemetry_disabled: bool }

#[derive(Clone, Debug)]
pub struct PolicyState { pub policy: Policy, pub present: bool, pub restricted: bool, pub error: Option<String> }
impl PolicyState {
    fn missing() -> Self { Self { policy: Policy::default(), present: false, restricted: false, error: None } }
    fn restricted(error: String) -> Self {
        Self { policy: Policy { updates: Updates { check: Some(false) }, ai: Ai { enabled: None, model_downloads: Some(false), local_model_dir: None }, network: Network { allowed_hosts: Some(vec![]), offline: Some(true) }, crash_reports: CrashReports { local_only: Some(true) }, ui: Ui::default(), security: Security { offline_mode: true, model_downloads_blocked: true, updates_disabled: true, crash_upload_disabled: true, telemetry_disabled: true } }, present: true, restricted: true, error: Some(error) }
    }
    pub fn permits_updates(&self) -> bool { !self.policy.security.updates_disabled && self.policy.updates.check != Some(false) && self.permits_network_url("https://varve.studio/updates/stable.json") }
    pub fn permits_model_downloads(&self) -> bool { !self.policy.security.model_downloads_blocked && self.policy.ai.model_downloads != Some(false) && self.policy.ai.enabled.is_none_or(|m| !matches!(m, AiMode::Off)) && !self.policy.security.offline_mode && self.policy.network.offline != Some(true) }
    pub fn allows_setting_write(&self, key: &str, value: &str) -> Result<(), String> {
        if self.policy.ui.locked_settings.as_ref().is_some_and(|keys| keys.iter().any(|item| item == key)) { return Err("Managed by your organisation".into()); }
        if key == "ai.enabled" { match self.policy.ai.enabled { Some(AiMode::Off) if value != "false" => return Err("AI is disabled by your organisation's policy".into()), Some(AiMode::On) if value == "false" => return Err("AI is enabled by your organisation's policy".into()), _ => {} } }
        if key == "updates.check" && !self.permits_updates() && value == "true" { return Err("Update checks are disabled by your organisation's policy".into()); }
        if key == "ai.modelDownloads" && !self.permits_model_downloads() && value == "true" { return Err("Model downloads are disabled by your organisation's policy".into()); }
        Ok(())
    }
    pub fn permits_network_url(&self, url: &str) -> bool {
        if self.policy.security.offline_mode || self.policy.network.offline == Some(true) { return false; }
        let lower = url.to_ascii_lowercase();
        if self.policy.security.telemetry_disabled && ["analytics", "telemetry", "goatcounter", "/collect", "/count?"].iter().any(|marker| lower.contains(marker)) { return false; }
        if self.policy.security.crash_upload_disabled && ["crash-report", "crashreport", "/crashes", "/sentry/"].iter().any(|marker| lower.contains(marker)) { return false; }
        let Ok(parsed) = reqwest::Url::parse(url) else { return false; };
        let Some(host) = parsed.host_str() else { return false; };
        self.policy.network.allowed_hosts.as_ref().is_none_or(|hosts| hosts.iter().any(|h| h.eq_ignore_ascii_case(host)))
    }
}

pub fn default_path() -> PathBuf {
    #[cfg(target_os = "windows")] { return std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\ProgramData")).join("Varve/policy.json"); }
    #[cfg(target_os = "macos")] { return PathBuf::from("/Library/Application Support/Varve/policy.json"); }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))] { PathBuf::from("/etc/varve/policy.json") }
}
fn policy_paths() -> Vec<PathBuf> {
    #[cfg(debug_assertions)] if let Some(path) = std::env::var_os("VARVE_POLICY_FILE") { return vec![PathBuf::from(path)]; }
    let primary = default_path();
    #[cfg(target_os = "linux")] { let mut paths = vec![primary]; match std::fs::read_dir("/etc/varve/policy.d") { Ok(entries) => { let mut more: Vec<_> = entries.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect(); more.sort(); paths.extend(more); }, Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}, Err(error) => { eprintln!("[policy] /etc/varve/policy.d: {error}"); paths.push(PathBuf::from("/etc/varve/policy.d")); } } return paths; }
    vec![primary]
}
fn fail<T>(why: impl std::fmt::Display) -> Result<T, String> { Err(why.to_string()) }
fn warn_unknown(map: &Map<String, Value>, allowed: &[&str]) { for key in map.keys() { if key == "_comment" { continue; } if !allowed.contains(&key.as_str()) { eprintln!("[policy] unknown policy key: {key}"); } } }
fn take<T: for<'de> Deserialize<'de>>(map: &Map<String, Value>, key: &str) -> Option<T> {
    map.get(key).and_then(|value| match serde_json::from_value(value.clone()) {
        Ok(parsed) => Some(parsed),
        Err(error) => { eprintln!("[policy] invalid value for {key}: {error}; using the application default"); None }
    })
}
fn secure_bool(map: &Map<String, Value>, key: &str, default: bool, invalid: bool) -> bool {
    match map.get(key) {
        None => default,
        Some(Value::Bool(value)) => *value,
        Some(_) => { eprintln!("[policy] invalid x-varve-security.{key}; using the most restrictive value"); invalid }
    }
}
fn nested(map: &Map<String, Value>, key: &str) -> Map<String, Value> {
    match map.get(key) {
        None => Map::new(),
        Some(Value::Object(value)) => value.clone(),
        Some(_) => { eprintln!("[policy] invalid {key} section; using application defaults"); Map::new() }
    }
}

pub fn parse_contents(text: &str) -> Result<Policy, String> {
    let root: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let object = root.as_object().ok_or("policy must be a JSON object")?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) { return fail("schemaVersion must be 1"); }
    warn_unknown(object, &["schemaVersion", "policies", "recommended", "x-varve-security", "_comment"]);
    let policies = object.get("policies").and_then(Value::as_object).ok_or("policies must be an object")?;
    if object.get("recommended").is_some_and(|value| !value.is_object()) { eprintln!("[policy] invalid recommended section; using application defaults"); }
    warn_unknown(policies, &["updates", "ai", "network", "crashReports", "ui", "x-varve-security", "_comment"]);
    let updates = nested(policies, "updates"); let ai = nested(policies, "ai"); let network = nested(policies, "network"); let crash = nested(policies, "crashReports"); let ui = nested(policies, "ui");
    warn_unknown(&updates, &["check", "_comment"]); warn_unknown(&ai, &["enabled", "modelDownloads", "localModelDir", "_comment"]); warn_unknown(&network, &["allowedHosts", "offline", "_comment"]); warn_unknown(&crash, &["localOnly", "_comment"]); warn_unknown(&ui, &["lockedSettings", "_comment"]);
    let mut p = Policy::default();
    p.updates.check = take(&updates, "check");
    p.ai.enabled = take(&ai, "enabled"); p.ai.model_downloads = take(&ai, "modelDownloads");
    p.ai.local_model_dir = take::<String>(&ai, "localModelDir").and_then(|s| { let p = PathBuf::from(s); if p.is_absolute() { Some(p) } else { eprintln!("[policy] relative ai.localModelDir ignored"); None } });
    p.network.allowed_hosts = take(&network, "allowedHosts"); p.network.offline = take(&network, "offline");
    p.crash_reports.local_only = take(&crash, "localOnly"); if p.crash_reports.local_only == Some(false) { eprintln!("[policy] crashReports.localOnly must be true; using true"); p.crash_reports.local_only = Some(true); }
    p.ui.locked_settings = take::<Vec<String>>(&ui, "lockedSettings").map(|keys| {
        keys.into_iter().filter(|key| {
            let valid = matches!(key.as_str(), "ai.enabled" | "lastSaveDirectory" | "presets:library" | "brushes:library" | "workspace-preferences" | "workspace-layouts" | "onboarding" | "presets:gradient-map");
            if !valid { eprintln!("[policy] ui.lockedSettings key is not an app setting: {key}"); }
            valid
        }).collect()
    });
    if let Some(hosts) = &p.network.allowed_hosts { if hosts.iter().any(|h| h.is_empty() || h.contains('/') || h.contains(':') || h.chars().any(char::is_whitespace)) { eprintln!("[policy] invalid network.allowedHosts ignored"); p.network.allowed_hosts = None; } }
    let security_value = object.get("x-varve-security").or_else(|| policies.get("x-varve-security"));
    let sec = security_value.and_then(Value::as_object).cloned().unwrap_or_default();
    let invalid_security_object = security_value.is_some() && security_value.and_then(Value::as_object).is_none();
    warn_unknown(&sec, &["offlineMode", "modelDownloads", "updates", "crashUpload", "telemetry", "allowedHosts", "_comment"]);
    p.security.offline_mode = secure_bool(&sec, "offlineMode", false, true);
    p.security.model_downloads_blocked = secure_bool(&sec, "modelDownloads", false, true);
    p.security.updates_disabled = secure_bool(&sec, "updates", false, true);
    p.security.crash_upload_disabled = secure_bool(&sec, "crashUpload", false, true);
    p.security.telemetry_disabled = secure_bool(&sec, "telemetry", false, true);
    if p.security.offline_mode { p.network.offline = Some(true); }
    if let Some(value) = sec.get("allowedHosts") { let hs = value.as_array().and_then(|values| values.iter().map(|v| v.as_str().map(str::to_owned)).collect::<Option<Vec<_>>>()); if hs.is_none() { eprintln!("[policy] invalid x-varve-security.allowedHosts; blocking all hosts"); } p.network.allowed_hosts = Some(hs.unwrap_or_default()); }
    if invalid_security_object { p.security = Security { offline_mode: true, model_downloads_blocked: true, updates_disabled: true, crash_upload_disabled: true, telemetry_disabled: true }; }
    if p.security.updates_disabled { p.updates.check = Some(false); }
    if p.security.model_downloads_blocked { p.ai.model_downloads = Some(false); }
    Ok(p)
}
fn read_bounded(path: &Path) -> Result<String, String> {
    if !path.is_absolute() { return fail("policy path must be absolute"); }
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        if let Ok(meta) = std::fs::symlink_metadata(&current) {
            if meta.file_type().is_symlink() { return fail("policy path must not contain symlinks"); }
        }
    }
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() { return fail("policy file must not be a symlink"); }
    if meta.len() > 65_536 { return fail("policy file exceeds 64 KB"); }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() > 65_536 { return fail("policy file exceeds 64 KB"); }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}
pub fn read_policy_at(path: &Path) -> PolicyState {
    match std::fs::symlink_metadata(path) { Err(e) if e.kind() == std::io::ErrorKind::NotFound => return PolicyState::missing(), Err(e) => { eprintln!("[policy] {}: {e}", path.display()); return PolicyState::restricted(e.to_string()); }, Ok(_) => {} }
    match read_bounded(path).and_then(|text| parse_contents(&text)) { Ok(policy) => PolicyState { policy, present: true, restricted: false, error: None }, Err(error) => { eprintln!("[policy] {}: {error}", path.display()); PolicyState::restricted(format!("Invalid policy {}: {error}", path.display())) } }
}
fn merge_dropin(base: &mut Policy, next: Policy) {
    if next.updates.check.is_some() { base.updates.check = next.updates.check; }
    if next.ai.enabled.is_some() { base.ai.enabled = next.ai.enabled; }
    if next.ai.model_downloads.is_some() { base.ai.model_downloads = next.ai.model_downloads; }
    if next.ai.local_model_dir.is_some() { base.ai.local_model_dir = next.ai.local_model_dir; }
    base.network.allowed_hosts = match (base.network.allowed_hosts.take(), next.network.allowed_hosts) {
        (Some(allowed), Some(next_allowed)) => Some(allowed.into_iter().filter(|host| next_allowed.iter().any(|candidate| candidate.eq_ignore_ascii_case(host))).collect()),
        (None, Some(next_allowed)) => Some(next_allowed),
        (allowed, None) => allowed,
    };
    base.network.offline = Some(base.network.offline == Some(true) || next.network.offline == Some(true));
    base.crash_reports.local_only = next.crash_reports.local_only.or(base.crash_reports.local_only);
    if next.ui.locked_settings.is_some() { base.ui.locked_settings = next.ui.locked_settings; }
    base.security.offline_mode |= next.security.offline_mode;
    base.security.model_downloads_blocked |= next.security.model_downloads_blocked;
    base.security.updates_disabled |= next.security.updates_disabled;
    base.security.crash_upload_disabled |= next.security.crash_upload_disabled;
    base.security.telemetry_disabled |= next.security.telemetry_disabled;
}
pub static POLICY: LazyLock<PolicyState> = LazyLock::new(|| {
    let mut combined = PolicyState::missing();
    for path in policy_paths() {
        let state = read_policy_at(&path);
        if state.restricted { return state; }
        if state.present { merge_dropin(&mut combined.policy, state.policy); combined.present = true; }
    }
    combined
});
pub fn initialize() { let _ = &*POLICY; }
pub fn model_directory() -> Option<PathBuf> { POLICY.policy.ai.local_model_dir.clone() }
pub fn validate_file(path: &Path) -> Result<(), String> { parse_contents(&read_bounded(path)?)?; Ok(()) }

#[cfg(test)]
mod tests {
    use super::*;
    fn wrap(policies: &str) -> String { format!(r#"{{"schemaVersion":1,"policies":{policies},"recommended":{{}}}}"#) }
    fn state(text: &str) -> PolicyState { static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0); let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed); let path = std::env::temp_dir().join(format!("policy-test-{}-{id}.json", std::process::id())); std::fs::write(&path, text).unwrap(); let value = read_policy_at(&path); let _ = std::fs::remove_file(path); value }
    #[test] fn schema_version_is_required_and_supported() { assert!(parse_contents(r#"{"policies":{}}"#).is_err()); assert!(parse_contents(r#"{"schemaVersion":2,"policies":{}}"#).is_err()); assert!(parse_contents(r#"{"schemaVersion":1,"policies":{}}"#).is_ok()); }
    #[test] fn missing_file_is_no_policy() { let s=read_policy_at(Path::new("/definitely/missing/policy.json")); assert!(!s.present && !s.restricted); }
    #[test] fn unusable_files_restrict() { let too_big = " ".repeat(65_537); for content in ["{bad", "\u{fffd}", too_big.as_str(), r#"{"schemaVersion":7,"policies":{}}"#] { let s=state(content); assert!(s.restricted); assert!(!s.permits_network_url("https://example.org")); assert!(!s.permits_model_downloads()); assert!(!s.permits_updates()); assert!(s.allows_setting_write("appearance.theme", "dark").is_ok()); } }
    #[test] fn unreadable_path_is_restricted() { let dir=std::env::temp_dir().join(format!("policy-dir-{}",std::process::id())); std::fs::create_dir_all(&dir).unwrap(); assert!(read_policy_at(&dir).restricted); let _=std::fs::remove_dir(dir); }
    #[test] fn invalid_utf8_is_restricted() { let path=std::env::temp_dir().join(format!("policy-utf8-{}.json",std::process::id())); std::fs::write(&path,[0xff,0xfe]).unwrap(); assert!(read_policy_at(&path).restricted); let _=std::fs::remove_file(path); }
    #[cfg(unix)] #[test] fn symlink_is_rejected() { use std::os::unix::fs::symlink; let p=std::env::temp_dir().join(format!("policy-link-{}.json",std::process::id())); let t=std::env::temp_dir().join(format!("policy-target-{}.json",std::process::id())); std::fs::write(&t, r#"{"schemaVersion":1,"policies":{}}"#).unwrap(); let _=std::fs::remove_file(&p); symlink(&t,&p).unwrap(); assert!(read_policy_at(&p).restricted); let _=std::fs::remove_file(p); let _=std::fs::remove_file(t); }
    #[test] fn keys_are_applied_and_invalid_ordinary_values_default() { let p=parse_contents(&wrap(r#"{"updates":{"check":false},"ai":{"enabled":"off","modelDownloads":false,"localModelDir":"relative"},"network":{"allowedHosts":["allowed.example"],"offline":false},"crashReports":{"localOnly":false},"ui":{"lockedSettings":["ai.enabled"]}}"#)).unwrap(); assert_eq!(p.updates.check,Some(false)); assert!(matches!(p.ai.enabled,Some(AiMode::Off))); assert_eq!(p.ai.local_model_dir,None); assert_eq!(p.network.allowed_hosts,Some(vec!["allowed.example".into()])); assert_eq!(p.crash_reports.local_only,Some(true)); assert_eq!(p.ui.locked_settings,Some(vec!["ai.enabled".into()])); }
    #[test] fn network_allowlist_blocks_unlisted_host() { let s=state(&wrap(r#"{"network":{"allowedHosts":["allowed.example"]}}"#)); assert!(s.permits_network_url("https://allowed.example/path")); assert!(!s.permits_network_url("https://other.example")); }
    #[test] fn offline_and_security_invalid_values_fail_closed() { let s=state(r#"{"schemaVersion":1,"policies":{},"x-varve-security":{"offlineMode":"bad","updates":"bad","modelDownloads":"bad","crashUpload":"bad","telemetry":"bad"}}"#); assert!(!s.permits_network_url("https://example.org")); assert!(!s.permits_updates()); assert!(!s.permits_model_downloads()); assert!(s.policy.security.crash_upload_disabled && s.policy.security.telemetry_disabled); }
    #[test] fn telemetry_security_switch_blocks_telemetry_requests_only() { let s=state(r#"{"schemaVersion":1,"policies":{},"x-varve-security":{"telemetry":true}}"#); assert!(!s.permits_network_url("https://metrics.example/count?site=varve")); assert!(s.permits_network_url("https://api.iconify.design/search")); }
    #[test] fn _comment_is_accepted_and_unknown_keys_do_not_invalidate() { assert!(parse_contents(r#"{"schemaVersion":1,"_comment":"hello","policies":{"_comment":"fine","unknownKey":1},"recommended":{}}"#).is_ok()); }
    #[test] fn settings_writes_are_only_denied_for_managed_keys() { let s=state(&wrap(r#"{"ui":{"lockedSettings":["ai.enabled"]},"ai":{"enabled":"off"}}"#)); assert!(s.allows_setting_write("ai.enabled","true").is_err()); assert!(s.allows_setting_write("document.defaultUnit","px").is_ok()); assert_eq!(s.policy.ui.locked_settings,Some(vec!["ai.enabled".into()])); }
}

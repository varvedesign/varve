//! Machine-wide administrator policy. Policy is read before Tauri starts so
//! malformed files cannot accidentally leave network capabilities enabled.
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::LazyLock,
};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Policy {
    #[serde(default)]
    pub updates: Updates,
    #[serde(default)]
    pub ai: Ai,
    #[serde(default)]
    pub network: Network,
    #[serde(default)]
    pub crash_reports: CrashReports,
    #[serde(default)]
    pub ui: Ui,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Updates {
    pub check: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Ai {
    pub enabled: Option<AiMode>,
    pub model_downloads: Option<bool>,
    pub local_model_dir: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AiMode {
    On,
    Off,
    User,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Network {
    pub allowed_hosts: Option<Vec<String>>,
    pub offline: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CrashReports {
    pub local_only: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Ui {
    pub locked_settings: Option<Vec<String>>,
}

#[derive(Clone, Debug)]
pub struct PolicyState {
    pub policy: Policy,
    pub present: bool,
    pub restricted: bool,
    pub error: Option<String>,
}

impl PolicyState {
    fn missing() -> Self {
        Self {
            policy: Policy::default(),
            present: false,
            restricted: false,
            error: None,
        }
    }

    fn restricted(error: String) -> Self {
        Self {
            policy: Policy {
                updates: Updates { check: Some(false) },
                ai: Ai {
                    enabled: Some(AiMode::Off),
                    model_downloads: Some(false),
                    local_model_dir: None,
                },
                network: Network {
                    allowed_hosts: Some(vec![]),
                    offline: Some(true),
                },
                crash_reports: CrashReports {
                    local_only: Some(true),
                },
                ui: Ui::default(),
            },
            present: true,
            restricted: true,
            error: Some(error),
        }
    }

    pub fn permits_updates(&self) -> bool {
        !self.restricted
            && self.policy.updates.check != Some(false)
            && self.permits_network_url("https://varve.studio/updates/stable.json")
    }

    pub fn permits_model_downloads(&self) -> bool {
        !self.restricted
            && self.policy.ai.model_downloads != Some(false)
            && self
                .policy
                .ai
                .enabled
                .is_none_or(|mode| !matches!(mode, AiMode::Off))
            && self.policy.network.offline != Some(true)
    }

    pub fn allows_setting_write(&self, key: &str, value: &str) -> Result<(), String> {
        if self.restricted
            || self
                .policy
                .ui
                .locked_settings
                .as_ref()
                .is_some_and(|keys| keys.iter().any(|item| item == key))
        {
            return Err("Managed by your organisation".into());
        }
        if key == "ai.enabled" {
            match self.policy.ai.enabled {
                Some(AiMode::Off) if value != "false" => {
                    return Err("AI is disabled by your organisation's policy".into());
                }
                Some(AiMode::On) if value == "false" => {
                    return Err("AI is enabled by your organisation's policy".into());
                }
                _ => {}
            }
        }
        if key == "updates.check"
            && self.policy.updates.check == Some(false)
            && value == "true"
        {
            return Err("Update checks are disabled by your organisation's policy".into());
        }
        if key == "ai.modelDownloads"
            && self.policy.ai.model_downloads == Some(false)
            && value == "true"
        {
            return Err("Model downloads are disabled by your organisation's policy".into());
        }
        Ok(())
    }

    pub fn permits_network_url(&self, url: &str) -> bool {
        if self.restricted || self.policy.network.offline == Some(true) {
            return false;
        }
        let Some(hosts) = &self.policy.network.allowed_hosts else {
            return true;
        };
        let Ok(parsed) = reqwest::Url::parse(url) else {
            return false;
        };
        let Some(host) = parsed.host_str() else {
            return false;
        };
        hosts
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(host))
    }
}

pub fn default_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return std::env::var_os("ProgramData")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
            .join("Varve/policy.json");
    }
    #[cfg(target_os = "macos")]
    {
        return PathBuf::from("/Library/Application Support/Varve/policy.json");
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        PathBuf::from("/etc/varve/policy.json")
    }
}

fn policy_path() -> PathBuf {
    #[cfg(test)]
    if let Some(path) = std::env::var_os("VARVE_POLICY_PATH") {
        return PathBuf::from(path);
    }
    default_path()
}

pub fn parse_contents(text: &str) -> Result<Policy, String> {
    let policy: Policy = serde_json::from_str(text).map_err(|error| error.to_string())?;
    if policy.crash_reports.local_only == Some(false) {
        return Err("crashReports.localOnly must be true".into());
    }
    if let Some(hosts) = &policy.network.allowed_hosts {
        if hosts.iter().any(|host| {
            host.is_empty()
                || host.contains('/')
                || host.contains(':')
                || host.chars().any(char::is_whitespace)
        }) {
            return Err("network.allowedHosts entries must be bare host names".into());
        }
    }
    Ok(policy)
}

pub fn read_policy_at(path: &Path) -> PolicyState {
    match std::fs::read_to_string(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => PolicyState::missing(),
        Err(error) => PolicyState::restricted(format!(
            "Could not read {}: {error}",
            path.display()
        )),
        Ok(text) => match parse_contents(&text) {
            Ok(policy) => PolicyState {
                policy,
                present: true,
                restricted: false,
                error: None,
            },
            Err(error) => PolicyState::restricted(format!(
                "Invalid policy {}: {error}",
                path.display()
            )),
        },
    }
}

pub static POLICY: LazyLock<PolicyState> = LazyLock::new(|| read_policy_at(&policy_path()));

pub fn initialize() {
    let _ = &*POLICY;
}

pub fn model_directory() -> Option<PathBuf> {
    POLICY.policy.ai.local_model_dir.clone()
}

pub fn validate_file(path: &Path) -> Result<(), String> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    parse_contents(&text)
        .map(|_| ())
        .map_err(|error| format!("Invalid policy: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_not_a_policy() {
        let state = read_policy_at(Path::new("/definitely/missing/varve-policy.json"));
        assert!(!state.present && !state.restricted);
    }

    #[test]
    fn parses_every_key() {
        let policy = parse_contents(
            r#"{"updates":{"check":false},"ai":{"enabled":"user","modelDownloads":false,"localModelDir":"/models"},"network":{"allowedHosts":["school.example"],"offline":true},"crashReports":{"localOnly":true},"ui":{"lockedSettings":["ai.enabled"]}}"#,
        )
        .unwrap();
        assert_eq!(policy.updates.check, Some(false));
        assert!(matches!(policy.ai.enabled, Some(AiMode::User)));
        assert_eq!(policy.ai.model_downloads, Some(false));
        assert_eq!(policy.ai.local_model_dir, Some(PathBuf::from("/models")));
        assert_eq!(policy.network.allowed_hosts.unwrap(), vec!["school.example"]);
        assert_eq!(policy.network.offline, Some(true));
        assert_eq!(policy.crash_reports.local_only, Some(true));
        assert_eq!(policy.ui.locked_settings.unwrap(), vec!["ai.enabled"]);
    }

    #[test]
    fn invalid_schema_fails_closed() {
        let state = read_policy_at_with_text(r#"{"telemetry":{"websiteDemo":false}}"#);
        assert!(state.restricted);
        assert!(!state.permits_updates());
        assert!(!state.permits_model_downloads());
        assert!(!state.permits_network_url("https://example.org"));
    }

    fn read_policy_at_with_text(text: &str) -> PolicyState {
        static NEXT_ID: std::sync::atomic::AtomicUsize =
            std::sync::atomic::AtomicUsize::new(0);
        let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "varve-policy-{}-{id}",
            std::process::id()
        ));
        std::fs::write(&path, text).unwrap();
        let state = read_policy_at(&path);
        let _ = std::fs::remove_file(path);
        state
    }

    #[test]
    fn each_control_is_enforced() {
        let state = PolicyState {
            policy: parse_contents(
                r#"{"updates":{"check":false},"ai":{"enabled":"off","modelDownloads":false},"network":{"allowedHosts":["allowed.example"]}}"#,
            )
            .unwrap(),
            present: true,
            restricted: false,
            error: None,
        };
        assert!(!state.permits_updates());
        assert!(!state.permits_model_downloads());
        assert!(state.permits_network_url("https://allowed.example/path"));
        assert!(!state.permits_network_url("https://other.example"));
    }

    #[test]
    fn locked_settings_and_forced_modes_reject_writes() {
        let policy = parse_contents(
            r#"{"updates":{"check":false},"ai":{"enabled":"off","modelDownloads":false},"ui":{"lockedSettings":["ui.theme"]}}"#,
        )
        .unwrap();
        let state = PolicyState {
            policy,
            present: true,
            restricted: false,
            error: None,
        };
        assert!(state.allows_setting_write("ui.theme", "dark").is_err());
        assert!(state.allows_setting_write("ai.enabled", "true").is_err());
        assert!(state.allows_setting_write("updates.check", "true").is_err());
        assert!(state
            .allows_setting_write("ai.modelDownloads", "true")
            .is_err());
    }

    #[test]
    fn offline_and_crash_report_policy_are_validated() {
        assert!(parse_contents(r#"{"crashReports":{"localOnly":false}}"#).is_err());
        let state = read_policy_at_with_text(r#"{"network":{"offline":true}}"#);
        assert!(!state.permits_network_url("https://example.org"));
    }
}

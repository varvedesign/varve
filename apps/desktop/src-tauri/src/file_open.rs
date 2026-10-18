//! OS "Open With" intake for `.varve` / `.strata` file associations.
//!
//! The associations in `tauri.conf.json` used to declare MIME types the app
//! never acted on: double-clicking a document launched the app and opened
//! nothing (current-state audit 2026-08-17).
//!
//! Two intake paths exist, funnelled into one managed queue the frontend
//! drains over IPC:
//!   - `argv[1..]` on Windows/Linux: the first process opens startup files;
//!     later launches are forwarded by Tauri's single-instance plugin.
//!   - `RunEvent::Opened` on macOS/iOS/Android: LaunchServices delivers
//!     `file://` URLs, usually to the already-running instance.
//!
//! Why a queue instead of an event alone: on macOS the `Opened` event can
//! fire before the webview's JS listener exists, and the event is not
//! replayed. The queue is the durable channel, and the `varve:file-open`
//! event is only the live wake-up for when the webview is already up.

use std::path::Path;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

/// Pending document paths and window activation the app has not handled yet.
pub struct PendingFileOpens {
    pending: Mutex<Vec<String>>,
    activation_requested: Mutex<bool>,
}

impl Default for PendingFileOpens {
    fn default() -> Self {
        Self {
            pending: Mutex::new(Vec::new()),
            activation_requested: Mutex::new(false),
        }
    }
}

fn is_document_path(path: &str) -> bool {
    let file = Path::new(path);
    let document_extension = file
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            extension.eq_ignore_ascii_case("varve") || extension.eq_ignore_ascii_case("strata")
        })
        .unwrap_or(false);
    document_extension && file.is_file()
}

/// Queue a document path unless it is already pending. Returns true when the
/// path was newly queued (the event should be emitted).
fn queue_path(state: &PendingFileOpens, path: &str) -> bool {
    if !is_document_path(path) {
        return false;
    }
    state
        .pending
        .lock()
        .map(|mut pending| {
            if pending.iter().any(|existing| existing == path) {
                false
            } else {
                pending.push(path.to_string());
                true
            }
        })
        .unwrap_or(false)
}

fn push_open(app: &AppHandle, state: &PendingFileOpens, path: String) {
    if queue_path(state, &path) {
        let _ = app.emit("varve:file-open", vec![path]);
    }
}

/// Collect document paths passed as `argv[1..]` (Windows/Linux open-with).
/// Runs at startup, before the webview exists, so the emit is lost by design;
/// the frontend drains the queue after mount.
pub fn register_startup_args(app: &AppHandle) {
    let state = app.state::<PendingFileOpens>();
    for argument in std::env::args_os().skip(1) {
        if let Ok(path) = argument.into_string() {
            push_open(app, &state, path);
        }
    }
}

/// Open files forwarded from a second Windows/Linux launch. Tauri's callback
/// includes the second process's executable as `args[0]`; relative document
/// paths are resolved against that process's working directory before the
/// existing queue validates and delivers them.
pub fn handle_forwarded_args(app: &AppHandle, args: Vec<String>, cwd: String) {
    let state = app.state::<PendingFileOpens>();
    request_activation(&state);
    for path in resolve_forwarded_paths(&args, &cwd) {
        push_open(app, &state, path);
    }
    activate_if_requested(app, &state);
}

/// Apply a forwarded launch's activation request when the configured window
/// exists. Tauri can invoke the single-instance callback before `Ready`, so
/// retain the request until the run-event loop can retry it.
fn activate_if_requested(app: &AppHandle, state: &PendingFileOpens) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if !activation_is_requested(state) {
        return;
    }
    let focus_handled = window.set_focus().is_ok();
    #[cfg(target_os = "linux")]
    let attention_handled = window
        .request_user_attention(Some(tauri::UserAttentionType::Informational))
        .is_ok();
    #[cfg(target_os = "linux")]
    let handled = focus_handled || attention_handled;
    #[cfg(not(target_os = "linux"))]
    let handled = focus_handled;
    acknowledge_activation_request(state, handled);
}

fn request_activation(state: &PendingFileOpens) {
    if let Ok(mut requested) = state.activation_requested.lock() {
        *requested = true;
    }
}

fn activation_is_requested(state: &PendingFileOpens) -> bool {
    state
        .activation_requested
        .lock()
        .map(|requested| *requested)
        .unwrap_or(false)
}

fn acknowledge_activation_request(state: &PendingFileOpens, handled: bool) {
    if !handled {
        return;
    }
    if let Ok(mut requested) = state.activation_requested.lock() {
        *requested = false;
    }
}

fn resolve_forwarded_paths(args: &[String], cwd: &str) -> Vec<String> {
    args.iter()
        .skip(1)
        .map(|argument| {
            let path = Path::new(argument);
            if path.is_absolute() {
                path.to_string_lossy().into_owned()
            } else {
                Path::new(cwd).join(path).to_string_lossy().into_owned()
            }
        })
        .collect()
}

/// macOS/iOS/Android LaunchServices "Open With" requests arrive as URLs and
/// may target a running instance.
pub fn handle_run_event(app: &AppHandle, event: &RunEvent) {
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    if matches!(event, RunEvent::Ready) {
        let state = app.state::<PendingFileOpens>();
        activate_if_requested(app, &state);
    }
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
    {
        if let RunEvent::Opened { urls } = event {
            let state = app.state::<PendingFileOpens>();
            for url in urls {
                if url.scheme() == "file" {
                    if let Ok(path) = url.to_file_path() {
                        push_open(app, &state, path.to_string_lossy().into_owned());
                    }
                }
            }
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    let _ = (app, event);
}

/// Drain the pending-open queue exactly once. The frontend calls this after
/// mount (startup case) and after every `varve:file-open` event, and dedupes
/// by path, so the same file can never open twice.
fn drain_pending(state: &PendingFileOpens) -> Vec<String> {
    state
        .pending
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

#[tauri::command]
pub fn take_pending_open_files(state: State<'_, PendingFileOpens>) -> Vec<String> {
    drain_pending(state.inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_document(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("varve-file-open-test-{name}"));
        std::fs::write(&path, b"{\"varve\":1}").expect("write temp document");
        path
    }

    #[test]
    fn accepts_existing_document_paths_only() {
        // Case-insensitive extensions are accepted.
        let path = temp_document("sample.VARVE");
        assert!(is_document_path(path.to_str().unwrap()));
        let _ = std::fs::remove_file(&path);

        let path = temp_document("legacy.strata");
        assert!(is_document_path(path.to_str().unwrap()));
        let _ = std::fs::remove_file(&path);

        // Wrong extension (even an existing file) is rejected.
        let path = temp_document("notes.txt");
        assert!(!is_document_path(path.to_str().unwrap()));
        let _ = std::fs::remove_file(&path);

        // Non-existent document path is rejected.
        assert!(!is_document_path("/definitely/not/here/anywhere.varve"));
    }

    #[test]
    fn queues_each_path_once() {
        let state = PendingFileOpens::default();
        let path = temp_document("dedupe.varve");
        let path_string = path.to_string_lossy().into_owned();

        assert!(queue_path(&state, &path_string), "first push queues");
        assert!(
            !queue_path(&state, &path_string),
            "same path must not double-queue"
        );
        assert_eq!(
            drain_pending(&state),
            vec![path_string.clone()],
            "drain returns each pending path once"
        );
        assert!(
            queue_path(&state, &path_string),
            "after a drain the path can queue again"
        );
        let _ = std::fs::remove_file(&path);

        // A non-document path never reaches the queue.
        assert!(!queue_path(&state, "/tmp/whatever.varve"));
        assert_eq!(
            drain_pending(&state).len(),
            1,
            "only the document was queued"
        );
    }

    #[test]
    fn forwarded_arguments_skip_executable_and_resolve_relative_documents() {
        let args = vec![
            "/opt/varve/varve".to_string(),
            "artboards/poster.varve".to_string(),
            "/tmp/other.strata".to_string(),
        ];

        assert_eq!(
            resolve_forwarded_paths(&args, "/home/user/projects"),
            vec![
                "/home/user/projects/artboards/poster.varve",
                "/tmp/other.strata"
            ]
        );
    }

    #[test]
    fn activation_request_is_retained_until_consumed() {
        let state = PendingFileOpens::default();

        assert!(!activation_is_requested(&state));
        request_activation(&state);
        assert!(activation_is_requested(&state));
        acknowledge_activation_request(&state, false);
        assert!(activation_is_requested(&state));
        acknowledge_activation_request(&state, true);
        assert!(!activation_is_requested(&state));
    }
}

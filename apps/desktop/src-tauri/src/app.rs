//! App builder setup internals extracted from the crate root; statement order is the startup contract (Batch B/B-01).

mod legacy_data;
#[cfg(target_os = "linux")]
mod pinch_linux;
#[cfg(test)]
mod tests;

use crate::acceleration;
use crate::app::legacy_data::migrate_legacy_data_dir;
use crate::crash;
use crate::file_open;
use crate::filesystem;
use crate::inference::content_fill::LamaCancelState;
use crate::lifecycle;
use crate::logs;
use crate::native_presenter;
use crate::native_raster;
use crate::trace::TraceCancelState;
use crate::upscale::UpscaleCancelState;
use notify::Watcher;
use tauri::Emitter;
use tauri::Manager;

pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Native ONNX Runtime init deliberately does NOT happen here.
    // Loading a native dylib this early — before the webview has
    // finished initializing — risks racing WebKitGTK's own
    // process/thread startup (onnxruntime can spawn its own thread
    // pool and install its own signal handlers). It's initialized
    // lazily instead, the first time the frontend calls
    // native_ai_status (see that command below), which can only
    // happen once the webview is already up and running JS.

    let directories = filesystem::AppDirectories::resolve(app.handle())
        .map_err(|error| error.message.clone())
        .expect("resolve Varve application directories");
    // Migrate before creating new roots. The migration itself is
    // per-file and leaves legacy data in place; this ordering keeps a
    // fresh Varve directory distinguishable from a completed copy.
    let migration = migrate_legacy_data_dir(&directories.data);
    directories
        .ensure_mutable_roots()
        .map_err(|error| error.message.clone())
        .expect("create Varve application directories");
    // The standalone inference crates use a platform-neutral fallback
    // for non-Tauri callers, but the desktop process always injects
    // the authoritative Tauri-resolved model root.
    varve_bgremove::model::configure_models_dir(directories.models.clone());
    varve_upscale::configure_model_directory(directories.models.clone());
    let model_migration = varve_bgremove::model::migrate_legacy_models();
    let data_dir = directories.data.clone();
    logs::init(&directories.logs);
    logs::log_line(
        "migration",
        &logs::redact_for_log(&format!(
            "legacy data migration: {migration:?}; legacy model migration: {model_migration:?}"
        )),
    );
    // Native crash capture: panic hook + sandboxed report filesystem.
    // Deliberately before any other subsystem — a panic later still
    // lands an emergency record.
    crash::install(&directories.crash_reports);
    let db_path = data_dir.join("documents.db");
    let store = varve_sync::DocumentStore::new(&db_path).expect("init document store");
    // Read the prior native process outcome and synchronously arm this
    // process as unclean before the webview can create recovery state.
    // WebView localStorage is not the desktop shutdown authority.
    let native_shutdown = lifecycle::NativeShutdownState::begin(&store)
        .expect("initialize native shutdown recovery state");
    app.manage(store);
    app.manage(native_shutdown);
    app.manage(UpscaleCancelState::new());
    app.manage(std::sync::Arc::new(acceleration::AccelerationState::new()));
    app.manage(std::sync::Arc::new(native_raster::NativeRasterState::new()));
    app.manage(LamaCancelState::new());
    app.manage(TraceCancelState::new());
    app.manage(lifecycle::LifecycleGuard::new());
    // OS file-association intake (.varve / .strata "Open With").
    app.manage(file_open::PendingFileOpens::default());
    file_open::register_startup_args(app.handle());

    #[cfg(target_os = "linux")]
    if let Some(window) = app.get_webview_window("main") {
        native_presenter::attach_if_requested(&window);
    }

    // Touchpad pinch on WebKitGTK. WebKitGTK performs NO pinch zoom of
    // its own — the GTK3 API has no ZoomGestureController (verified
    // against the 2.52.6 source tree and the installed library) — so
    // the GDK touchpad-pinch stream it receives simply dies: a
    // trackpad pinch did nothing on the canvas.
    //
    // Primary arm: handle GDK's TouchpadPinch event on the webview and
    // forward its cumulative scale to the frontend, which zooms the
    // artwork about the gesture centre.
    //
    // Fallback arm: WebKit builds that DO page-zoom on pinch move
    // `zoom_level`. Levels are cumulative within a gesture, so the
    // emitted factor must be a delta against a per-gesture baseline —
    // emitting the raw level per notify would compound it (zoom ×=
    // level on every notify). The fallback is suppressed while our
    // gesture owns the pinch so the two arms can never double-apply.
    // The pinch bridge moves with the app module; the call site stays here.
    #[cfg(target_os = "linux")]
    pinch_linux::attach_pinch_zoom(app);

    // Listen for native menu item clicks and forward to webview
    app.on_menu_event(|app_handle, event| {
        let id = event.id();
        if !id.0.starts_with("__tauri_") {
            let _ = app_handle.emit("menu://action", serde_json::json!({ "action": id.0 }));
        }
    });

    // Start file-system watcher for home directory
    let watch_handle = app.handle().clone();
    let watch_path = data_dir.clone();
    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let mut watcher =
            match notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
                if let Ok(event) = res {
                    let has_document_ext = event.paths.iter().any(|p| {
                        p.extension()
                            .map(|e| e == "varve" || e == "strata")
                            .unwrap_or(false)
                    });
                    if has_document_ext {
                        let _ = tx.send(());
                    }
                }
            }) {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("Failed to create file watcher: {}", e);
                    return;
                }
            };
        if let Err(e) = watcher.watch(&watch_path, notify::RecursiveMode::Recursive) {
            eprintln!("Failed to watch directory {}: {}", watch_path.display(), e);
            return;
        }
        while rx.recv().is_ok() {
            let _ = watch_handle.emit("home:files-changed", ());
        }
    });
    Ok(())
}

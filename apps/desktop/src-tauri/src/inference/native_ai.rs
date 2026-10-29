//! Native AI availability status, lazy init and onnxruntime resolution (Batch B/B-01).

use tauri::Manager;

/// Whether native ONNX inference is actually usable right now — the `ai`
/// Cargo feature is compiled in *and* the bundled onnxruntime dylib loads
/// successfully.
///
/// This is a runtime-verified check, not a build-flag check: a build with
/// `ai` compiled in but a missing/incompatible dylib for this platform
/// correctly reports `false` here, so the frontend's provider chain won't
/// keep routing `ai-quality` at a native path that fails every time.
///
/// Deliberately lazy: the dylib is only loaded the first time this command
/// is actually invoked (cached after that — see
/// `varve_bgremove::runtime::init_native_runtime`), never during app
/// startup. Loading a native library that may spawn its own thread pool or
/// install its own signal handlers (onnxruntime does both) before the
/// webview has finished initializing risks racing WebKitGTK's own
/// process/thread startup; by the time frontend JS can call this command,
/// the webview is already fully up, so that risk doesn't apply here.
#[tauri::command]
pub(crate) async fn native_ai_status(_app: tauri::AppHandle) -> bool {
    #[cfg(feature = "ai")]
    {
        tauri::async_runtime::spawn_blocking(move || ensure_native_ai(&_app))
            .await
            .unwrap_or(false)
    }
    #[cfg(not(feature = "ai"))]
    {
        false
    }
}
/// Reserved native ONNX inference command for colorization workflows.
///
/// This route must report itself as unavailable until it performs verified
/// inference. Returning an empty output map with a native execution-provider
/// label would make capability diagnostics and provider routing misleading.
#[allow(unused_variables)]
/// Idempotently initialize the native ONNX Runtime from the bundled dylib
/// and report whether it is actually usable. Must be called before ANY code
/// path that could touch `ort` session APIs (`remove_background` with an AI
/// method, `native_ai_status`) — `ort` with `load-dynamic` panics rather
/// than erroring when its API is used with no dylib loaded.
#[cfg(feature = "ai")]
pub(crate) fn ensure_native_ai(app: &tauri::AppHandle) -> bool {
    if !varve_bgremove::runtime::native_ai_ready() {
        match resolve_onnxruntime_dylib(app) {
            Some(path) => {
                match varve_bgremove::runtime::init_native_runtime(&path) {
                    Ok(()) => println!("[bgremove] native ONNX Runtime ready: {}", path.display()),
                    Err(e) => {
                        eprintln!("[bgremove] native ONNX Runtime init failed ({e}); falling back to WASM")
                    }
                }
            }
            None => {
                eprintln!(
                    "[bgremove] no bundled onnxruntime dylib found for this platform ({}-{}); \
                     falling back to WASM inference. Run `node scripts/fetch-onnxruntime.mjs` \
                     from the repo root to stage the native library.",
                    std::env::consts::OS,
                    std::env::consts::ARCH,
                );
            }
        }
    }
    let ready = varve_bgremove::runtime::native_ai_ready();
    if ready
        && matches!(
            varve_bgremove::webgpu_ep::status(),
            varve_bgremove::webgpu_ep::WebGpuEpStatus::NotAttempted
        )
    {
        match resolve_onnxruntime_plugin(app) {
            Some(plugin) => match varve_bgremove::webgpu_ep::register(&plugin) {
                Ok(()) => println!(
                    "[bgremove] WebGPU execution provider registered: {}",
                    plugin.display()
                ),
                Err(err) => eprintln!(
                    "[bgremove] WebGPU execution provider unavailable ({err}); \
                     CPU inference remains active"
                ),
            },
            None => eprintln!(
                "[bgremove] WebGPU plugin library not staged for {}-{}; \
                 CPU inference remains active. Optional WebGPU acceleration: \
                 run `node scripts/fetch-onnxruntime.mjs` after updating the pins.",
                std::env::consts::OS,
                std::env::consts::ARCH,
            ),
        }
    }
    ready
}
/// Resolve the bundled native onnxruntime dylib for the current platform,
/// if one was staged by `scripts/fetch-onnxruntime.mjs`.
///
/// Checks the production resource directory first (populated by
/// `tauri.conf.json`'s `bundle.resources` during `tauri build`), then falls
/// back to the dev-time staging path directly under the crate manifest dir
/// — `tauri dev` runs `cargo run` without a bundling step, so
/// `app.path().resource_dir()` may not contain files declared as bundle
/// resources yet.
#[cfg(feature = "ai")]
fn resolve_onnxruntime_dylib(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let platform_key = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let lib_name = if cfg!(target_os = "windows") {
        "onnxruntime.dll"
    } else if cfg!(target_os = "macos") {
        "libonnxruntime.dylib"
    } else {
        "libonnxruntime.so"
    };
    let relative = std::path::Path::new("onnxruntime-libs")
        .join(&platform_key)
        .join(lib_name);

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join(&relative);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let dev_candidate = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(&relative);
    if dev_candidate.exists() {
        return Some(dev_candidate);
    }

    None
}

fn resolve_onnxruntime_plugin(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let platform_key = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let lib_name = if cfg!(target_os = "windows") {
        "onnxruntime_providers_webgpu.dll"
    } else if cfg!(target_os = "macos") {
        "libonnxruntime_providers_webgpu.dylib"
    } else {
        "libonnxruntime_providers_webgpu.so"
    };
    let relative = std::path::Path::new("onnxruntime-libs")
        .join(&platform_key)
        .join(lib_name);

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join(&relative);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let dev_candidate = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(&relative);
    if dev_candidate.exists() {
        return Some(dev_candidate);
    }

    None
}

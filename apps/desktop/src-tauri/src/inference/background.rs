//! Native background-removal commands and their cancellable core (Batch B/B-01).

pub(crate) mod models;

#[cfg(test)]
mod tests;

use crate::clipboard::validate_bounded_image_dimensions;
use crate::inference::background::models::encode_bg_remove_binary;
use crate::inference::background::models::encoded_image_dimensions;
use crate::inference::background::models::native_background_model_id;
use crate::inference::background::models::preflight_native_model;
use crate::inference::background::models::BgRemoveOptions;
use crate::inference::background::models::BgRemoveResult;
use crate::inference::native_ai::ensure_native_ai;
use crate::native_jobs;
use image::load_from_memory;
use std::sync::LazyLock;
use tauri::ipc::Response;

/// Remove background from an image via the native `varve-bgremove` crate.
///
/// `method: "quick"` always uses the heuristic engine (always available).
/// `"ai-balanced"` / `"ai-quality"` use ONNX inference when this binary was
/// built with the `ai` Cargo feature (opt-in, requires a downloaded model).
/// Builds without that feature reject AI requests instead of mislabelling a
/// heuristic result as AI output.
/// Async command wrapper around [`remove_background_cancellable`].
///
/// Two hard requirements drive this shape:
///
/// 1. **The ONNX Runtime dylib must be initialized before any AI inference.**
///    `ort` with `load-dynamic` *panics* (it does not return a `Result`) the
///    first time its API is touched with no dylib available. Since native
///    init became lazy (see `native_ai_status`), this command is reachable
///    without init having ever run — the JS provider chain only pre-checks
///    `native_ai_status` for ai-quality, and for ai-balanced it can land
///    here directly when the Worker WASM path fails. Guarding here converts
///    "whole app closes" into a clean `Err` the JS chain can fall back from.
///
/// 2. **Inference must not run on the main thread.** A synchronous command
///    executes on the GTK main thread: u2netp takes ~0.5s and BiRefNet
///    15-18s, which would freeze the UI — and any panic there kills the
///    process outright. `spawn_blocking` moves the work to a worker thread
///    and converts panics into a `JoinError` we can report as an error.
#[tauri::command]
pub(crate) async fn remove_background(
    app: tauri::AppHandle,
    image_data: Vec<u8>,
    options: BgRemoveOptions,
) -> Result<BgRemoveResult, String> {
    remove_background_command(app, image_data, options).await
}

/// Binary IPC variant: the encoded source image travels as the request body;
/// options travel as a compact JSON header and the mask returns as a binary
/// envelope. The legacy JSON command above remains for older clients and
/// tests, but the current desktop provider uses this path.
#[tauri::command]
pub(crate) async fn remove_background_binary(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, String> {
    const OPTIONS_HEADER: &str = "x-varve-bg-remove-options";
    let image_data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err(
                "Binary background removal requires an application/octet-stream body".into(),
            )
        }
    };
    let options_json = request
        .headers()
        .get(OPTIONS_HEADER)
        .ok_or_else(|| format!("Missing {OPTIONS_HEADER} header"))?
        .to_str()
        .map_err(|_| format!("Invalid {OPTIONS_HEADER} header"))?
        .to_owned();
    let options: BgRemoveOptions = serde_json::from_str(&options_json)
        .map_err(|error| format!("Invalid background-removal options: {error}"))?;
    let result = remove_background_command(app, image_data, options).await?;
    encode_bg_remove_binary(result)
}

static BACKGROUND_REMOVAL_JOBS: LazyLock<native_jobs::NativeJobs> =
    LazyLock::new(native_jobs::NativeJobs::default);

#[tauri::command]
pub(crate) fn cancel_background_removal(request_id: String) -> Result<(), String> {
    BACKGROUND_REMOVAL_JOBS.cancel(&request_id)
}

async fn remove_background_command(
    app: tauri::AppHandle,
    image_data: Vec<u8>,
    options: BgRemoveOptions,
) -> Result<BgRemoveResult, String> {
    let job = BACKGROUND_REMOVAL_JOBS.start(options.request_id.as_deref())?;
    #[cfg(feature = "ai")]
    if let Some(model_id) = native_background_model_id(&options)? {
        let (width, height) = encoded_image_dimensions(&image_data)?;
        validate_bounded_image_dimensions(width, height, "background-removal image")?;
        // This check happens before ONNX Runtime initialization and is
        // repeated inside the worker immediately before session checkout.
        // That matters on Crostini/ARM systems where host memory can look
        // healthy while the process is under a smaller cgroup limit.
        preflight_native_model("Native background removal", model_id, width, height)?;
    }
    #[cfg(not(feature = "ai"))]
    let _ = &app;

    tauri::async_runtime::spawn_blocking(move || {
        // Keep the whole guard in the blocking task, not just a cloned token.
        let job = job;
        #[cfg(feature = "ai")]
        if let Some(model_id) = native_background_model_id(&options)? {
            if job.cancellation.is_cancelled() {
                return Err("Inference cancelled".into());
            }
            if !ensure_native_ai(&app) {
                return Err(
                    "Native AI runtime is unavailable on this system; use the in-app (WASM) model instead"
                        .into(),
                );
            }
            let (width, height) = encoded_image_dimensions(&image_data)?;
            validate_bounded_image_dimensions(width, height, "background-removal image")?;
            preflight_native_model("Native background removal", model_id, width, height)?;
        }
        remove_background_cancellable(image_data, options, &job.cancellation)
    })
        .await
        .map_err(|e| format!("Background removal task failed: {e}"))?
}

#[cfg(test)]
fn remove_background_impl(
    image_data: Vec<u8>,
    options: BgRemoveOptions,
) -> Result<BgRemoveResult, String> {
    remove_background_cancellable(
        image_data,
        options,
        &varve_bgremove::InferenceCancellationToken::default(),
    )
}

fn remove_background_cancellable(
    image_data: Vec<u8>,
    options: BgRemoveOptions,
    cancellation: &varve_bgremove::InferenceCancellationToken,
) -> Result<BgRemoveResult, String> {
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".into());
    }
    let model_id = native_background_model_id(&options)?;
    let img = load_from_memory(&image_data).map_err(|e| format!("Image decode error: {e}"))?;

    #[cfg(feature = "ai")]
    let method = match options.method.as_str() {
        "quick" => varve_bgremove::RemovalMethod::Quick,
        "ai-balanced" => varve_bgremove::RemovalMethod::AiBalanced,
        "ai-quality" => varve_bgremove::RemovalMethod::AiQuality,
        "portrait" => varve_bgremove::RemovalMethod::Portrait,
        method => return Err(format!("Unsupported background removal method '{method}'")),
    };
    #[cfg(not(feature = "ai"))]
    let method = match options.method.as_str() {
        "quick" => varve_bgremove::RemovalMethod::Quick,
        _ => return Err("AI background removal is not enabled in this desktop build".into()),
    };

    let remove_opts = varve_bgremove::RemovalOptions {
        method,
        tolerance: options.tolerance,
        feather_radius: options.feather_radius,
        decontaminate: options.decontaminate,
        click_x: options.click_x,
        click_y: options.click_y,
        preview_max_dimension: options.preview_max_dimension,
    };

    #[cfg(feature = "ai")]
    let result = match model_id {
        Some(model_id) => varve_bgremove::inference::remove_ai_cancellable(
            &img,
            &remove_opts,
            model_id,
            cancellation,
        )?,
        None => varve_bgremove::remove_background(&img, &remove_opts)?,
    };
    #[cfg(not(feature = "ai"))]
    let result = varve_bgremove::remove_background(&img, &remove_opts)?;

    if cancellation.is_cancelled() {
        return Err("Inference cancelled".into());
    }
    Ok(BgRemoveResult {
        mask_base64: result.mask_base64,
        confidence: result.confidence,
        method: result.method,
        model_id: model_id.map(str::to_owned),
        processing_time_ms: result.processing_time_ms,
        width: result.width,
        height: result.height,
        execution_provider: result.execution_provider,
    })
}

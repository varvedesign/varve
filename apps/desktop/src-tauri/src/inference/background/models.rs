//! Background-removal model status, download and preflight helpers (Batch B/B-01).

use crate::clipboard::validate_bounded_image_dimensions;
use crate::generative_resources;
use crate::inference::native_ai::ensure_native_ai;
use crate::inference_models;
use crate::models::INFERENCE_MODEL_DOWNLOADS;
use base64::Engine as _;
use serde::Deserialize;
use serde::Serialize;
use tauri::ipc::Response;
use tauri::Emitter;

// ── Background Removal ──────────────────────────────────

/// Wire format matches the `BackgroundRemovalOptions` shape sent by
/// `@varve/engine`'s `invokeTauriRemoveBackground` — camelCase, since
/// (unlike top-level command argument names) Tauri does NOT auto-convert
/// casing for fields nested inside a command's argument structs.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BgRemoveOptions {
    pub(crate) request_id: Option<String>,
    pub(crate) method: String,
    pub(crate) model_id: Option<String>,
    pub(crate) tolerance: Option<u8>,
    pub(crate) feather_radius: Option<f32>,
    pub(crate) decontaminate: Option<bool>,
    pub(crate) click_x: Option<u32>,
    pub(crate) click_y: Option<u32>,
    pub(crate) preview_max_dimension: Option<u32>,
}

/// Wire format matches `BackgroundRemovalResult` in `@varve/engine` —
/// see the `BgRemoveOptions` note on casing above; this applies
/// symmetrically to values returned from the command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BgRemoveResult {
    pub(crate) mask_base64: String,
    pub(crate) confidence: f32,
    pub(crate) method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) model_id: Option<String>,
    pub(crate) processing_time_ms: u64,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) execution_provider: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BgRemoveBinaryMetadata {
    pub(crate) confidence: f32,
    pub(crate) method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) model_id: Option<String>,
    pub(crate) processing_time_ms: u64,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) execution_provider: String,
}

pub(crate) const BG_REMOVE_BINARY_MAGIC: &[u8; 4] = b"VBG1";

/// Encode background-removal metadata and the PNG mask in one bounded binary
/// response. The metadata length is a little-endian u32 immediately after the
/// magic; the remaining bytes are the PNG. This keeps large images and masks
/// out of JSON/base64 IPC while preserving the small, versioned response
/// contract needed by the webview.
pub(crate) fn encode_bg_remove_binary(result: BgRemoveResult) -> Result<Response, String> {
    let mask_png = base64::engine::general_purpose::STANDARD
        .decode(result.mask_base64)
        .map_err(|error| format!("Native mask base64 decode failed: {error}"))?;
    if mask_png.is_empty() {
        return Err("Native background-removal mask is empty".into());
    }
    let metadata = serde_json::to_vec(&BgRemoveBinaryMetadata {
        confidence: result.confidence,
        method: result.method,
        model_id: result.model_id,
        processing_time_ms: result.processing_time_ms,
        width: result.width,
        height: result.height,
        execution_provider: result.execution_provider,
    })
    .map_err(|error| format!("Native mask metadata serialize failed: {error}"))?;
    let metadata_len = u32::try_from(metadata.len())
        .map_err(|_| "Native mask metadata is too large for binary IPC".to_string())?;
    let capacity = BG_REMOVE_BINARY_MAGIC
        .len()
        .saturating_add(std::mem::size_of::<u32>())
        .saturating_add(metadata.len())
        .saturating_add(mask_png.len());
    let mut wire = Vec::with_capacity(capacity);
    wire.extend_from_slice(BG_REMOVE_BINARY_MAGIC);
    wire.extend_from_slice(&metadata_len.to_le_bytes());
    wire.extend_from_slice(&metadata);
    wire.extend_from_slice(&mask_png);
    Ok(Response::new(wire))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeBgModelStatus {
    pub(crate) runtime_ready: bool,
    pub(crate) installed: bool,
    pub(crate) size_bytes: u64,
    pub(crate) peak_memory_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostMemoryStatus {
    /// Bytes the OS reports as available to this process right now.
    pub(crate) available_bytes: Option<u64>,
    /// constrained / standard / high / unknown, matching native resource tiers.
    pub(crate) resource_tier: String,
}

/// Report measured host memory to the renderer.
///
/// The renderer's shared derived-work ledger needs a real ceiling: WebKitGTK
/// does not expose `navigator.deviceMemory`, so without this command every
/// desktop session would keep the 400 MB placeholder and refuse AI work the
/// machine can easily run. Read-only, allocation-free, and safe to call before
/// any model or runtime is loaded.
#[tauri::command]
pub(crate) fn host_memory_status() -> HostMemoryStatus {
    let available_memory_bytes = generative_resources::available_memory_bytes();
    HostMemoryStatus {
        available_bytes: available_memory_bytes,
        resource_tier: generative_resources::resource_tier(available_memory_bytes).to_string(),
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeBgModelProgress {
    pub(crate) request_id: String,
    pub(crate) model_id: String,
    pub(crate) loaded: u64,
    pub(crate) total: u64,
}

fn background_removal_model_info(
    model_id: &str,
) -> Result<&'static varve_bgremove::model::ModelInfo, String> {
    varve_bgremove::model::model_info(model_id)
        .ok_or_else(|| format!("Unknown background-removal model: {model_id}"))
}

pub(crate) fn native_background_model_id(
    options: &BgRemoveOptions,
) -> Result<Option<&'static str>, String> {
    // Do not use the generic native model catalog as this allowlist: it also
    // contains denoisers/OCR/inpainting graphs with incompatible tensor contracts.
    match (options.method.as_str(), options.model_id.as_deref()) {
        ("quick", None) => Ok(None),
        ("ai-balanced", None | Some("isnet-general-use")) => Ok(Some("isnet-general-use")),
        ("ai-balanced", Some("u2netp")) => Ok(Some("u2netp")),
        ("ai-balanced", Some("u2netp-int8")) => Ok(Some("u2netp-int8")),
        ("portrait", None | Some("modnet-portrait")) => Ok(Some("modnet-portrait")),
        ("ai-quality", None | Some("birefnet-general-lite")) => Ok(Some("birefnet-general-lite")),
        ("ai-quality", Some("birefnet-general")) => Ok(Some("birefnet-general")),
        _ => Err(format!(
            "Unsupported native background-removal method/model pair: '{}' / '{}'",
            options.method,
            options.model_id.as_deref().unwrap_or("default")
        )),
    }
}

pub(crate) fn encoded_image_dimensions(image_data: &[u8]) -> Result<(u32, u32), String> {
    image::ImageReader::new(std::io::Cursor::new(image_data))
        .with_guessed_format()
        .map_err(|error| format!("Image format error: {error}"))?
        .into_dimensions()
        .map_err(|error| format!("Image dimensions error: {error}"))
}

pub(crate) fn preflight_native_model(
    operation: &str,
    model_id: &str,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let model = background_removal_model_info(model_id)?;
    let measured_peak_memory_bytes = model.peak_memory_bytes.ok_or_else(|| {
        format!(
            "{operation} cannot start because native model '{model_id}' has no measured memory profile"
        )
    })?;
    generative_resources::preflight_model(operation, width, height, measured_peak_memory_bytes)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn native_background_removal_model_status(
    app: tauri::AppHandle,
    model_id: String,
) -> Result<NativeBgModelStatus, String> {
    let model = background_removal_model_info(&model_id)?;
    // Loading the native ONNX Runtime and registering its optional provider
    // can enter a platform loader and create runtime threads. Keep that work
    // off the Tauri/GTK event thread even though this command only returns a
    // small status object.
    let (runtime_ready, installed, size_bytes) = tauri::async_runtime::spawn_blocking(move || {
        // Bundled graphs are already shipped, but ORT requires a verified disk
        // path. Materialize them before reporting a spurious download requirement.
        let installed = inference_models::prepare_path(&app, &model_id)?.is_some();
        Ok::<_, String>((
            ensure_native_ai(&app),
            installed,
            varve_bgremove::model::downloaded_model_size(&model_id),
        ))
    })
    .await
    .map_err(|error| format!("Native AI status task failed: {error}"))??;
    Ok(NativeBgModelStatus {
        runtime_ready,
        installed,
        size_bytes,
        peak_memory_bytes: model.peak_memory_bytes,
    })
}

/// Preflight a native background-removal request before the renderer allocates
/// a full-resolution canvas/PNG. The command deliberately accepts dimensions,
/// not image bytes: low-memory ChromeOS/Crostini and ARM devices must be able
/// to receive a refusal without first crossing the webview allocation boundary.
/// `remove_background` repeats the same check immediately before native
/// session checkout because available memory can change while a request waits.
#[tauri::command]
pub(crate) fn preflight_native_background_removal(
    model_id: String,
    width: u32,
    height: u32,
) -> Result<(), String> {
    background_removal_model_info(&model_id)?;
    if !varve_bgremove::model::is_model_downloaded(&model_id) {
        return Err(format!(
            "Native background-removal model '{model_id}' is not installed"
        ));
    }
    validate_bounded_image_dimensions(width, height, "background-removal image")?;
    preflight_native_model("Native background removal", &model_id, width, height)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn cancel_background_removal_model_download(request_id: String) -> Result<(), String> {
    INFERENCE_MODEL_DOWNLOADS.cancel(&request_id)
}

#[tauri::command]
pub(crate) fn delete_background_removal_model(model_id: String) -> Result<(), String> {
    background_removal_model_info(&model_id)?;
    inference_models::delete_at(&varve_bgremove::model::models_dir(), &model_id)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn download_background_removal_model(
    app: tauri::AppHandle,
    request_id: String,
    model_id: String,
) -> Result<u64, String> {
    let model = background_removal_model_info(&model_id)?;
    let job = INFERENCE_MODEL_DOWNLOADS.start(Some(&request_id))?;
    // Runtime/provider loading is lazy, but it is not UI-thread safe. Do it
    // before the network future starts so model download progress remains
    // responsive and a loader failure becomes a normal command error.
    let runtime_app = app.clone();
    let runtime_ready =
        tauri::async_runtime::spawn_blocking(move || ensure_native_ai(&runtime_app))
            .await
            .map_err(|error| format!("Native AI initialization task failed: {error}"))?;
    if !runtime_ready {
        return Err("Native ONNX Runtime is unavailable on this desktop build".into());
    }
    inference_models::download_at(
        &varve_bgremove::model::models_dir(),
        &model_id,
        &request_id,
        &job.cancellation,
        |loaded, total| {
            let _ = app.emit(
                "background-removal-model-progress",
                NativeBgModelProgress {
                    request_id: request_id.clone(),
                    model_id: model_id.clone(),
                    loaded,
                    total,
                },
            );
        },
    )
    .await?;
    Ok(model.size_bytes)
}

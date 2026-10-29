//! Native image denoise (SCUNet) command extracted from the crate root (Batch B/B-01).

#[cfg(test)]
mod tests;

use crate::clipboard::validate_bounded_image_dimensions;
use crate::inference::background::models::encoded_image_dimensions;
use crate::inference::background::models::preflight_native_model;
use crate::inference::native_ai::ensure_native_ai;
use image::load_from_memory;
use std::collections::HashSet;
use std::sync::LazyLock;
use std::sync::Mutex;

// ── Native image denoise (SCUNet) ──────────────────────────────────────
/// Cancellation is recorded separately from the child registry because a
/// renderer can cancel after invoking the command but before the helper has
/// finished spawning. Keeping the tombstone until the worker observes it
/// closes that start-up race and also prevents a just-exited child from
/// publishing a late result.
pub(crate) static GENERATIVE_CANCELLATIONS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Options for native denoise.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDenoiseOptions {
    /// Model id (e.g. "scunet"). Defaults to "scunet".
    pub model_id: Option<String>,
    /// Blend factor between original (0.0) and fully denoised (1.0).
    pub strength: Option<f32>,
}

/// Result of a native denoise operation.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDenoiseResult {
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
    pub processing_time_ms: u64,
    pub execution_provider: String,
}

/// Run native SCUNet denoising on an image. Preferred over the WASM-worker
/// path on desktop because native ONNX Runtime is faster and not bound by
/// the wasm32 4 GB address space.
#[tauri::command]
pub(crate) async fn denoise_image(
    app: tauri::AppHandle,
    image_data: Vec<u8>,
    options: NativeDenoiseOptions,
) -> Result<NativeDenoiseResult, String> {
    let model_id = options.model_id.unwrap_or_else(|| "scunet".to_string());
    if !varve_bgremove::is_image_model(&model_id) {
        return Err(format!(
            "Unknown denoise model '{model_id}'. Supported: scunet"
        ));
    }
    let (width, height) = encoded_image_dimensions(&image_data)?;
    validate_bounded_image_dimensions(width, height, "denoise image")?;
    preflight_native_model("Native denoise", &model_id, width, height)?;
    if !ensure_native_ai(&app) {
        return Err(
            "Native AI runtime is unavailable on this system; use the in-app (WASM) denoise instead"
                .into(),
        );
    }
    let strength = options.strength.unwrap_or(0.7).clamp(0.0, 1.0);

    tauri::async_runtime::spawn_blocking(move || {
        let (width, height) = encoded_image_dimensions(&image_data)?;
        validate_bounded_image_dimensions(width, height, "denoise image")?;
        preflight_native_model("Native denoise", &model_id, width, height)?;
        let img = load_from_memory(&image_data).map_err(|e| format!("Image decode error: {e}"))?;
        let result = varve_bgremove::denoise_image(&img, strength, &model_id)?;
        Ok(NativeDenoiseResult {
            png_base64: result.png_base64,
            width: result.width,
            height: result.height,
            processing_time_ms: result.processing_time_ms,
            execution_provider: result.execution_provider,
        })
    })
    .await
    .map_err(|e| format!("Denoise task failed: {e}"))?
}

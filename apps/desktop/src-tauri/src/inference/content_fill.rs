//! Native content-aware fill (LaMa inpainting) commands extracted from the crate root (Batch B/B-01).

#[cfg(test)]
mod tests;

use crate::clipboard::validate_bounded_image_dimensions;
use crate::inference::background::models::preflight_native_model;
use crate::inference::native_ai::ensure_native_ai;
use std::sync::Mutex;
use tauri::Manager;

// ── Native content-aware fill (LaMa inpainting) ────────────────────────

/// Options for native content-aware fill.
#[derive(Debug, serde::Deserialize)]
pub struct ContentAwareFillOptions {
    #[serde(default)]
    pub request_id: Option<String>,
    pub image_data: Vec<u8>,
    pub image_w: u32,
    pub image_h: u32,
    pub mask: Vec<u8>,
    pub mask_w: u32,
    pub mask_h: u32,
    pub preview_max_dimension: Option<u32>,
}

fn validate_content_aware_fill_options(options: &ContentAwareFillOptions) -> Result<(), String> {
    validate_bounded_image_dimensions(
        options.image_w,
        options.image_h,
        "content-aware fill image",
    )?;
    validate_bounded_image_dimensions(options.mask_w, options.mask_h, "content-aware fill mask")?;
    if options.preview_max_dimension == Some(0) {
        return Err("content-aware fill preview_max_dimension must be positive".into());
    }

    let image_pixels = u64::from(options.image_w)
        .checked_mul(u64::from(options.image_h))
        .ok_or_else(|| "content-aware fill image dimensions overflow".to_string())?;
    let image_bytes = image_pixels
        .checked_mul(4)
        .ok_or_else(|| "content-aware fill image buffer size overflow".to_string())?;
    if options.image_data.len() as u64 != image_bytes {
        return Err("content-aware fill image buffer does not match its dimensions".into());
    }

    let mask_pixels = u64::from(options.mask_w)
        .checked_mul(u64::from(options.mask_h))
        .ok_or_else(|| "content-aware fill mask dimensions overflow".to_string())?;
    if options.mask.len() as u64 != mask_pixels {
        return Err("content-aware fill mask buffer does not match its dimensions".into());
    }
    Ok(())
}

/// Result of a native content-aware fill operation.
#[derive(Debug, serde::Serialize)]
pub struct ContentAwareFillResult {
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
    pub model_id: String,
    pub execution_backend: String,
    pub processing_time_ms: u64,
    pub warnings: Vec<String>,
}

/// Single-job cancellation and admission state for native LaMa. The engine
/// already checks this token at model/session and processing boundaries; the
/// command owns the token so renderer AbortSignals can stop a native request
/// without waiting for the blocking task to return.
pub(crate) struct LamaCancelState {
    pub(crate) active: Mutex<Option<LamaCancelEntry>>,
    pub(crate) execution_gate: std::sync::Arc<Mutex<()>>,
}

pub(crate) struct LamaCancelEntry {
    pub(crate) request_id: String,
    pub(crate) token: varve_bgremove::InferenceCancellationToken,
}

impl LamaCancelState {
    pub(crate) fn new() -> Self {
        Self {
            active: Mutex::new(None),
            execution_gate: std::sync::Arc::new(Mutex::new(())),
        }
    }

    pub(crate) fn register(&self, request_id: &str) -> varve_bgremove::InferenceCancellationToken {
        if let Ok(mut guard) = self.active.lock() {
            if let Some(current) = guard.as_ref() {
                if current.request_id == request_id {
                    return current.token.clone();
                }
            }
            let token = varve_bgremove::InferenceCancellationToken::default();
            if let Some(previous) = guard.replace(LamaCancelEntry {
                request_id: request_id.to_owned(),
                token: token.clone(),
            }) {
                previous.token.cancel();
            }
            return token;
        }
        varve_bgremove::InferenceCancellationToken::default()
    }

    pub(crate) fn cancel(&self, request_id: &str) {
        if let Ok(guard) = self.active.lock() {
            if let Some(entry) = guard.as_ref() {
                if entry.request_id == request_id {
                    entry.token.cancel();
                }
            }
        }
    }

    pub(crate) fn finish(&self, request_id: &str) {
        if let Ok(mut guard) = self.active.lock() {
            if guard
                .as_ref()
                .is_some_and(|entry| entry.request_id == request_id)
            {
                *guard = None;
            }
        }
    }

    pub(crate) fn execution_gate(&self) -> std::sync::Arc<Mutex<()>> {
        self.execution_gate.clone()
    }
}

#[tauri::command]
pub(crate) fn cancel_content_aware_fill(app: tauri::AppHandle, request_id: String) {
    if let Some(state) = app.try_state::<LamaCancelState>() {
        state.cancel(&request_id);
    }
}

/// Run native LaMa inpainting on an image+mask pair.
///
/// Preferred over the WASM-worker path on desktop because native ONNX
/// Runtime is faster and not bound by the wasm32 4 GB address space.
#[tauri::command]
pub(crate) async fn content_aware_fill(
    app: tauri::AppHandle,
    options: ContentAwareFillOptions,
) -> Result<ContentAwareFillResult, String> {
    validate_content_aware_fill_options(&options)?;
    preflight_native_model(
        "Native content-aware fill",
        "lama-inpainting",
        options.image_w,
        options.image_h,
    )?;
    if !ensure_native_ai(&app) {
        return Err(
            "Native AI runtime is unavailable on this system; use the in-app (WASM) model instead"
                .into(),
        );
    }

    let request_id = options
        .request_id
        .clone()
        .unwrap_or_else(|| format!("lama-{}", std::process::id()));
    let (cancellation, execution_gate) = app.try_state::<LamaCancelState>().map_or_else(
        || {
            (
                varve_bgremove::InferenceCancellationToken::default(),
                std::sync::Arc::new(Mutex::new(())),
            )
        },
        |state| (state.register(&request_id), state.execution_gate()),
    );
    let cancellation_for_worker = cancellation.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let _permit = execution_gate
            .lock()
            .map_err(|_| "Native LaMa execution gate was poisoned".to_string())?;
        if cancellation_for_worker.is_cancelled() {
            return Err("Inference cancelled".to_owned());
        }
        preflight_native_model(
            "Native content-aware fill",
            "lama-inpainting",
            options.image_w,
            options.image_h,
        )?;
        let request = varve_bgremove::LamaInpaintRequest {
            image_rgba: options.image_data,
            image_w: options.image_w,
            image_h: options.image_h,
            mask: options.mask,
            mask_w: options.mask_w,
            mask_h: options.mask_h,
            preview_max_dimension: options.preview_max_dimension,
        };

        let result = varve_bgremove::lama_inpaint_cancellable(request, &cancellation_for_worker)?;

        Ok(ContentAwareFillResult {
            png_base64: result.png_base64,
            width: result.width,
            height: result.height,
            model_id: result.model_id,
            execution_backend: result.execution_backend,
            processing_time_ms: result.processing_time_ms,
            warnings: result.warnings,
        })
    })
    .await
    .map_err(|e| format!("Content-aware fill task failed: {e}"));

    if let Some(state) = app.try_state::<LamaCancelState>() {
        state.finish(&request_id);
    }
    result?
}

//! Shared upscale / live-effect command cores (Batch B/B-01).

use crate::acceleration;
use crate::filesystem;
use crate::upscale::upscale_image_impl;
use crate::upscale::UpscaleCancelState;
use crate::upscale::UpscaleImageOptions;
use crate::upscale::MAX_UPSCALE_INPUT_BYTES;
use crate::upscale::MAX_UPSCALE_OUTPUT_PIXELS;
use image::load_from_memory;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::Emitter;
use tauri::Manager;

pub(crate) async fn upscale_image_command(
    app: tauri::AppHandle,
    image_data: Vec<u8>,
    options: UpscaleImageOptions,
) -> Result<Response, String> {
    #[cfg(not(feature = "ai"))]
    let _ = &app;

    let job_id = options.job_id.unwrap_or(0);

    if image_data.len() > MAX_UPSCALE_INPUT_BYTES {
        return Err(format!(
            "Upscale input is {} bytes; the native limit is {MAX_UPSCALE_INPUT_BYTES} bytes",
            image_data.len()
        ));
    }

    // Register a cancellable job with a shared flag. The worker thread below
    // receives a clone of the same Arc, so `cancel_upscale` flipping the bool
    // interrupts inference between tiles. Guarded by a Mutex so begin/cancel
    // racing on the active slot is sound.
    let (cancel_flag, execution_gate) = app.try_state::<UpscaleCancelState>().map_or_else(
        || {
            (
                std::sync::Arc::new(AtomicBool::new(false)),
                std::sync::Arc::new(Mutex::new(())),
            )
        },
        |state| (state.register(job_id), state.execution_gate()),
    );
    let cancel_for_worker = cancel_flag.clone();

    // Progress callback: emit a `upscale:progress` event the frontend listens to.
    let app_for_progress = app.clone();
    let clamped_job_id = job_id;
    let progress_callback: Option<varve_upscale::ProgressCallback> =
        Some(Box::new(move |done: usize, total: usize| {
            let _ = app_for_progress.emit(
                "upscale:progress",
                serde_json::json!({ "jobId": clamped_job_id, "done": done, "total": total }),
            );
        }));

    let method = options.method.clone();
    let model_id = options
        .model_id
        .clone()
        .unwrap_or_else(|| "upscale-realesr-general".to_string());
    // The model id becomes a filename under the app-owned models root. It is
    // validated here (not inside varve-upscale, which is also used by
    // non-desktop callers) so a `../` component can never escape the root on
    // a read.
    filesystem::validate_storage_key(&model_id).map_err(|error| error.message)?;
    let max_pixels = options.max_pixels;
    let target_width = options.target_width;
    let target_height = options.target_height;
    let scale_opt = options.scale;

    // Non-AI methods can use the native GPU resampler when a hardware device
    // is available. Keep the state handle, not a created device, until the
    // blocking worker has admitted the request; device creation can take long
    // enough to make a Tauri/GTK event thread visibly unresponsive.
    let acceleration_state = if method != "ai" {
        app.try_state::<std::sync::Arc<acceleration::AccelerationState>>()
            .map(|state| std::sync::Arc::clone(&*state))
    } else {
        None
    };

    #[cfg(feature = "ai")]
    let app_for_worker = app.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        // Serialize native upscale allocations. Superseded jobs remain cheap
        // queued closures and observe their cancellation flag before decoding
        // or allocating an output buffer.
        let _permit = execution_gate
            .lock()
            .map_err(|_| "Native upscale execution gate was poisoned".to_string())?;
        if cancel_for_worker.load(Ordering::SeqCst) {
            return Err("Upscale cancelled".into());
        }
        #[cfg(feature = "ai")]
        if method == "ai" && !crate::ensure_native_ai(&app_for_worker) {
            return Err(
                "Native AI runtime is unavailable on this system; use the in-app (WASM) model instead"
                    .into(),
            );
        }
        let dimensions = image::ImageReader::new(std::io::Cursor::new(&image_data))
            .with_guessed_format()
            .map_err(|e| format!("Image format error: {e}"))?
            .into_dimensions()
            .map_err(|e| format!("Image dimensions error: {e}"))?;
        let source_pixels = u64::from(dimensions.0) * u64::from(dimensions.1);
        if source_pixels > MAX_UPSCALE_OUTPUT_PIXELS {
            return Err(format!(
                "Upscale source contains {source_pixels} pixels; the native limit is {MAX_UPSCALE_OUTPUT_PIXELS} pixels"
            ));
        }
        let img = load_from_memory(&image_data).map_err(|e| format!("Image decode error: {e}"))?;
        let rgba = img.to_rgba8();
        let (width, height) = rgba.dimensions();
        let pixels = rgba.into_raw();
        upscale_image_impl(
            &pixels,
            width,
            height,
            scale_opt,
            target_width,
            target_height,
            max_pixels,
            method.as_str(),
            model_id.as_str(),
            progress_callback,
            cancel_for_worker,
            acceleration_state,
        )
    })
    .await
    .map_err(|e| format!("Upscale task panicked: {e}"));

    if let Some(state) = app.try_state::<UpscaleCancelState>() {
        state.finish(job_id);
    }
    let result = result??;

    let _ = app.emit(
        "upscale:done",
        serde_json::json!({
            "jobId": job_id,
            "cancelled": false,
            "executionProvider": result.execution_provider,
        }),
    );
    // `Response` selects Tauri's application/octet-stream IPC response. A
    // Vec<u8> would be serialized as a large JSON number array.
    Ok(Response::new(result.bytes))
}

/// Native live-effect kernels — raw RGBA request body, `x-varve-effect` JSON
/// header (kind, dimensions, quality, coord space, params). Returns raw RGBA
/// bytes via the octet-stream response channel. Bounded like trace/upscale:
/// pixel-count ceiling before any allocation; runs on a blocking thread so
/// the UI thread stays free.
#[tauri::command]
pub(crate) async fn apply_live_effect_binary(
    state: tauri::State<'_, std::sync::Arc<acceleration::AccelerationState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, String> {
    const OPTIONS_HEADER: &str = "x-varve-effect";
    const BACKEND_HEADER: &str = "x-varve-effect-backend";
    const MAX_EFFECT_PIXELS: u64 = 33_554_432; // 8192x4096 — export ceiling
    let rgba = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("Binary effect requires an application/octet-stream body".into())
        }
    };
    let backend = request
        .headers()
        .get(BACKEND_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("cpu")
        .to_ascii_lowercase();
    let options_json = request
        .headers()
        .get(OPTIONS_HEADER)
        .ok_or_else(|| format!("Missing {OPTIONS_HEADER} header"))?
        .to_str()
        .map_err(|_| format!("Invalid {OPTIONS_HEADER} header"))?
        .to_owned();
    let effect_request: varve_effects::EffectRequest =
        serde_json::from_str(&options_json).map_err(|e| format!("Invalid effect options: {e}"))?;
    let pixels = u64::from(effect_request.width) * u64::from(effect_request.height);
    if pixels > MAX_EFFECT_PIXELS {
        return Err(format!(
            "Effect surface contains {pixels} pixels; the native limit is {MAX_EFFECT_PIXELS} pixels"
        ));
    }

    if backend == "gpu" {
        // Explicit GPU requests fail closed: the provider chain decides
        // whether to fall back to the CPU command, and a success here means
        // the GPU actually produced the bytes. Device creation can block on
        // adapter negotiation, so keep it off the Tauri/GTK event thread.
        let acceleration_state = std::sync::Arc::clone(&*state);
        let result = tauri::async_runtime::spawn_blocking(move || {
            let workers = acceleration_state.workers()?;
            acceleration::apply_effect_on_gpu(&workers, &effect_request, &rgba)
        })
        .await
        .map_err(|e| format!("GPU effect task panicked: {e}"))??;
        return Ok(Response::new(result));
    }

    let result = tauri::async_runtime::spawn_blocking(move || {
        varve_effects::apply_effect(&effect_request, &rgba)
    })
    .await
    .map_err(|e| format!("Effect task panicked: {e}"))??;

    Ok(Response::new(result))
}

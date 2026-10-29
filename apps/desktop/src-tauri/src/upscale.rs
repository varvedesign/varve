//! Native upscale commands, cancellation state and core implementation (Batch B/B-01).

pub(crate) mod ops;

#[cfg(test)]
mod tests;

use crate::acceleration;
use crate::upscale::ops::upscale_image_command;
use serde::Deserialize;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::Manager;

/// Shared state for cancelling an in-flight AI upscaling job. The active job's
/// cancellation flag is an `Arc<AtomicBool>` the worker thread also holds, so
/// the cancel command can flip it without re-entering the async runtime.
pub(crate) struct UpscaleCancelState {
    pub(crate) active: Mutex<Option<CancelEntry>>,
    pub(crate) execution_gate: std::sync::Arc<Mutex<()>>,
}

pub(crate) struct CancelEntry {
    pub(crate) job_id: u64,
    pub(crate) flag: std::sync::Arc<AtomicBool>,
}

impl UpscaleCancelState {
    pub(crate) fn new() -> Self {
        Self {
            active: Mutex::new(None),
            execution_gate: std::sync::Arc::new(Mutex::new(())),
        }
    }

    /// Install the latest job and request cancellation of any superseded job.
    /// Only one native upscale is admitted at a time: running multiple image
    /// models concurrently can exhaust memory on the 4 GB support tier.
    pub(crate) fn register(&self, job_id: u64) -> std::sync::Arc<AtomicBool> {
        if let Ok(mut guard) = self.active.lock() {
            if let Some(current) = guard.as_ref() {
                if current.job_id == job_id {
                    return current.flag.clone();
                }
            }
            let flag = std::sync::Arc::new(AtomicBool::new(false));
            if let Some(previous) = guard.replace(CancelEntry {
                job_id,
                flag: flag.clone(),
            }) {
                previous.flag.store(true, Ordering::SeqCst);
            }
            return flag;
        }
        // Poisoning disables cross-command cancellation, but the job remains
        // locally safe and bounded rather than panicking the command handler.
        std::sync::Arc::new(AtomicBool::new(false))
    }

    pub(crate) fn cancel(&self, job_id: u64) {
        if let Ok(guard) = self.active.lock() {
            if let Some(entry) = guard.as_ref() {
                if entry.job_id == job_id {
                    entry.flag.store(true, Ordering::SeqCst);
                }
            }
        }
    }

    /// Clear the active slot only if it still belongs to this job. A stale
    /// completion must never remove a newer job's cancellation handle.
    pub(crate) fn finish(&self, job_id: u64) {
        if let Ok(mut guard) = self.active.lock() {
            if guard.as_ref().is_some_and(|entry| entry.job_id == job_id) {
                *guard = None;
            }
        }
    }

    pub(crate) fn execution_gate(&self) -> std::sync::Arc<Mutex<()>> {
        self.execution_gate.clone()
    }
}

#[tauri::command]
pub(crate) fn begin_upscale_job(app: tauri::AppHandle, job_id: u64) {
    let Some(state) = app.try_state::<UpscaleCancelState>() else {
        return;
    };
    state.register(job_id);
}

#[tauri::command]
pub(crate) fn cancel_upscale(app: tauri::AppHandle, job_id: u64) {
    let Some(state) = app.try_state::<UpscaleCancelState>() else {
        return;
    };
    state.cancel(job_id);
}

pub(crate) const MAX_UPSCALE_INPUT_BYTES: usize = 128 * 1024 * 1024;
pub(crate) const MAX_UPSCALE_OUTPUT_PIXELS: u64 = 64 * 1024 * 1024;
// The native GPU route includes a source upload, destination storage buffer,
// and readback staging buffer. Below this measured workload size, that
// transfer/setup cost is not reliably repaid by the shader, so automatic mode
// keeps the cheaper CPU path and avoids waking a discrete GPU for tiny jobs.
const MIN_GPU_RESAMPLE_PIXELS: u64 = 1_000_000;

fn should_try_gpu_resample(
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
) -> bool {
    let source_pixels = u64::from(src_width) * u64::from(src_height);
    let output_pixels = u64::from(dst_width) * u64::from(dst_height);
    source_pixels != output_pixels && source_pixels.max(output_pixels) >= MIN_GPU_RESAMPLE_PIXELS
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpscaleImageOptions {
    pub(crate) scale: f64,
    #[serde(default = "default_upscale_method")]
    pub(crate) method: String,
    #[serde(default, rename = "modelId")]
    pub(crate) model_id: Option<String>,
    #[serde(default, rename = "maxPixels")]
    pub(crate) max_pixels: Option<u64>,
    #[serde(default, rename = "targetWidth")]
    pub(crate) target_width: Option<u32>,
    #[serde(default, rename = "targetHeight")]
    pub(crate) target_height: Option<u32>,
    #[serde(default)]
    #[serde(rename = "jobId")]
    pub(crate) job_id: Option<u64>,
}

/// The binary response remains the encoded image, while the event channel
/// carries provenance for this specific request. Keeping the metadata out of
/// the response body preserves the compact octet-stream IPC contract.
#[derive(Debug)]
pub(crate) struct UpscaleImageResult {
    pub(crate) bytes: Vec<u8>,
    pub(crate) execution_provider: String,
}

fn default_upscale_method() -> String {
    "bicubic".into()
}

#[tauri::command]
pub(crate) async fn upscale_image(
    app: tauri::AppHandle,
    image_data: Vec<u8>,
    options: UpscaleImageOptions,
) -> Result<Response, String> {
    upscale_image_command(app, image_data, options).await
}

/// Raw binary IPC variant. Options remain a small JSON header while the PNG
/// request body and PNG response both stay out of JSON serialization.
#[tauri::command]
pub(crate) async fn upscale_image_binary(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, String> {
    const OPTIONS_HEADER: &str = "x-varve-upscale-options";
    let image_data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("Binary upscale requires an application/octet-stream body".into())
        }
    };
    let options_json = request
        .headers()
        .get(OPTIONS_HEADER)
        .ok_or_else(|| format!("Missing {OPTIONS_HEADER} header"))?
        .to_str()
        .map_err(|_| format!("Invalid {OPTIONS_HEADER} header"))?
        .to_owned();
    let options: UpscaleImageOptions =
        serde_json::from_str(&options_json).map_err(|e| format!("Invalid upscale options: {e}"))?;
    upscale_image_command(app, image_data, options).await
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn upscale_image_impl(
    pixels: &[u8],
    width: u32,
    height: u32,
    scale_opt: f64,
    target_width: Option<u32>,
    target_height: Option<u32>,
    max_pixels: Option<u64>,
    method: &str,
    model_id: &str,
    progress_callback: Option<varve_upscale::ProgressCallback>,
    cancel_flag: std::sync::Arc<AtomicBool>,
    acceleration_state: Option<std::sync::Arc<acceleration::AccelerationState>>,
) -> Result<UpscaleImageResult, String> {
    if cancel_flag.load(Ordering::SeqCst) {
        return Err("Upscale cancelled".into());
    }
    if !scale_opt.is_finite() || scale_opt <= 0.0 {
        return Err("Upscale scale must be finite and greater than zero".into());
    }
    let scale = if let (Some(tw), Some(th)) = (target_width, target_height) {
        let sx = tw as f64 / width as f64;
        let sy = th as f64 / height as f64;
        sx.min(sy).max(0.001)
    } else {
        scale_opt
    };

    let (out_w, out_h) = if method == "ai" {
        (
            width.checked_mul(4).ok_or("Upscale width overflow")?,
            height.checked_mul(4).ok_or("Upscale height overflow")?,
        )
    } else {
        (
            (width as f64 * scale).round().max(1.0) as u32,
            (height as f64 * scale).round().max(1.0) as u32,
        )
    };
    let output_pixels = (out_w as u64) * (out_h as u64);
    let requested_max = max_pixels.unwrap_or(MAX_UPSCALE_OUTPUT_PIXELS);
    let effective_max = requested_max.min(MAX_UPSCALE_OUTPUT_PIXELS);
    if output_pixels > effective_max {
        return Err(format!(
            "Output contains {output_pixels} pixels; the effective limit is {effective_max} pixels"
        ));
    }

    // GPU device creation is intentionally deferred until the worker has
    // decoded the image and the output has passed admission checks. This keeps
    // a small resize from paying initialization cost or waking a discrete GPU.
    let gpu_workers = if method != "ai" && should_try_gpu_resample(width, height, out_w, out_h) {
        acceleration_state
            .as_ref()
            .and_then(|state| state.workers().ok())
    } else {
        None
    };

    let (result, execution_provider) = if method == "ai" {
        #[cfg(feature = "ai")]
        {
            let upscale_opts = varve_upscale::UpscaleOptions {
                progress: progress_callback,
                cancel: Some(cancel_flag.clone()),
            };
            let result = varve_upscale::ai_upscale_with_metadata(
                pixels,
                width,
                height,
                model_id,
                upscale_opts,
            )?;
            (result.pixels, result.execution_provider)
        }
        #[cfg(not(feature = "ai"))]
        {
            return Err(format!(
                "AI upscaling requires a desktop build with the ai feature enabled (model '{model_id}')"
            ));
        }
    } else {
        let filter = varve_upscale::UpscaleFilter::from_method(method);
        let mp = (width as u64) * (height as u64);
        // Native GPU resampling when a hardware device is available. The
        // result is within 1 LSB of the image-rs CPU filters (verified by
        // crates/varve-accel parity tests); on any failure the CPU path runs.
        let gpu_result = gpu_workers.as_ref().and_then(|workers| {
            acceleration::resample_on_gpu(workers, pixels, width, height, out_w, out_h, method)
                .map_err(|err| {
                    eprintln!("native GPU resample unavailable ({err}); using CPU filters");
                    err
                })
                .ok()
        });
        if let Some(bytes) = gpu_result {
            (bytes, "native-gpu")
        } else if mp > 4_000_000 {
            (
                varve_upscale::tiled_upscale(pixels, width, height, scale, 256, 16, filter)?,
                "native-cpu",
            )
        } else {
            (
                varve_upscale::cpu_upscale(pixels, width, height, scale, filter)?,
                "native-cpu",
            )
        }
    };

    if cancel_flag.load(Ordering::SeqCst) {
        return Err("Upscale cancelled".into());
    }

    let out_img = image::DynamicImage::ImageRgba8(
        image::ImageBuffer::from_raw(out_w, out_h, result)
            .ok_or("Failed to construct output image")?,
    );

    let mut bytes: Vec<u8> = Vec::new();
    out_img
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .map_err(|e| format!("PNG encode error: {e}"))?;

    Ok(UpscaleImageResult {
        bytes,
        execution_provider: execution_provider.to_string(),
    })
}

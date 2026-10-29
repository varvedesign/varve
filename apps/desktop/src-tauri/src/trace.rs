//! Native raster-to-vector trace commands and core (Batch B/B-01).

#[cfg(test)]
mod tests;

use crate::upscale::CancelEntry;
use image::load_from_memory;
use serde::Deserialize;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;

// ── Image trace (native raster-to-vector) ──────────────

const MAX_TRACE_INPUT_BYTES: usize = 128 * 1024 * 1024;
const MAX_TRACE_PIXELS: u64 = 64 * 1024 * 1024;
/// Hard ceiling on paths per trace, even when the client requests 0 (unlimited).
/// Prevents unbounded memory growth from adversarial high-frequency images.
const MAX_TRACE_PATHS: usize = 100_000;

/// Emits `trace:progress` events from the blocking trace thread.
pub(crate) type TraceProgressSink = Box<dyn Fn(&str, f64) + Sync>;

/// Single-job cancellation state for native tracing (mirror of
/// `UpscaleCancelState`): exactly one trace is admitted at a time so memory
/// stays bounded on the 4 GB support tier, and a new job supersedes the old.
pub(crate) struct TraceCancelState {
    pub(crate) active: Mutex<Option<CancelEntry>>,
    pub(crate) execution_gate: std::sync::Arc<Mutex<()>>,
}

impl TraceCancelState {
    pub(crate) fn new() -> Self {
        Self {
            active: Mutex::new(None),
            execution_gate: std::sync::Arc::new(Mutex::new(())),
        }
    }

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

    pub(crate) fn execution_gate(&self) -> std::sync::Arc<Mutex<()>> {
        self.execution_gate.clone()
    }
}

#[tauri::command]
pub(crate) fn begin_trace_job(app: tauri::AppHandle, job_id: u64) {
    let Some(state) = app.try_state::<TraceCancelState>() else {
        return;
    };
    state.register(job_id);
}

#[tauri::command]
pub(crate) fn cancel_trace(app: tauri::AppHandle, job_id: u64) {
    let Some(state) = app.try_state::<TraceCancelState>() else {
        return;
    };
    state.cancel(job_id);
}

#[derive(Debug, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct TraceImageOptions {
    pub(crate) threshold: Option<u8>,
    pub(crate) min_pixels: Option<u32>,
    pub(crate) max_colors: Option<u8>,
    pub(crate) foreground: Option<String>,
    pub(crate) corner_angle: Option<f64>,
    pub(crate) max_error: Option<f64>,
    pub(crate) simplify_tolerance: Option<f64>,
    pub(crate) trace_mode: Option<String>,
    pub(crate) alpha_threshold: Option<u8>,
    pub(crate) centerline_width: Option<f64>,
    pub(crate) centerline_prune: Option<f64>,
    pub(crate) max_paths: Option<u32>,
    pub(crate) compound_holes: Option<bool>,
    pub(crate) structure: Option<String>,
    #[serde(rename = "jobId")]
    pub(crate) job_id: Option<u64>,
}

fn default_corner_angle() -> f64 {
    135.0
}
fn default_max_error() -> f64 {
    1.0
}

/// Clamp untrusted client options into the engine's safe ranges.
/// All limits are documented in the trace contract (docs/architecture/image-trace-system.md).
fn sanitize_trace_options(raw: TraceImageOptions) -> varve_trace::TraceOptions {
    let trace_mode = match raw.trace_mode.as_deref() {
        Some("centerline") => varve_trace::TraceMode::Centerline,
        Some("pixel_art") | Some("pixel-art") => varve_trace::TraceMode::PixelArt,
        _ => varve_trace::TraceMode::Silhouette,
    };
    let foreground = match raw.foreground.as_deref() {
        Some("light") => varve_trace::Foreground::Light,
        _ => varve_trace::Foreground::Dark,
    };
    varve_trace::TraceOptions {
        threshold: raw.threshold.unwrap_or(128).clamp(1, 254),
        min_pixels: raw.min_pixels.unwrap_or(10).clamp(1, 1_000_000) as usize,
        max_colors: raw
            .max_colors
            .unwrap_or(if trace_mode == varve_trace::TraceMode::PixelArt {
                8
            } else {
                0
            })
            .clamp(0, 64),
        foreground,
        corner_angle: raw
            .corner_angle
            .unwrap_or_else(default_corner_angle)
            .clamp(90.0, 180.0),
        max_error: raw
            .max_error
            .unwrap_or_else(default_max_error)
            .clamp(0.01, 10.0),
        simplify_tolerance: raw.simplify_tolerance.unwrap_or(0.75).clamp(0.0, 10.0),
        trace_mode,
        alpha_threshold: raw.alpha_threshold.unwrap_or(1).clamp(0, 255),
        centerline_width: raw.centerline_width.unwrap_or(2.0).clamp(0.5, 100.0),
        centerline_prune: raw.centerline_prune.unwrap_or(4.0).clamp(0.0, 1000.0),
        // 0 means "unlimited" to clients; enforce a hard ceiling server-side.
        max_paths: match raw.max_paths {
            Some(0) => MAX_TRACE_PATHS,
            Some(v) => (v as usize).clamp(1, MAX_TRACE_PATHS),
            None => 1000,
        },
        compound_holes: raw.compound_holes.unwrap_or(true),
        structure: match raw.structure.as_deref() {
            Some("stacked") => varve_trace::Structure::Stacked,
            _ => varve_trace::Structure::Cutout,
        },
    }
}
#[tauri::command]
pub(crate) async fn trace_image(
    app: tauri::AppHandle,
    image_data: Vec<u8>,
    options: TraceImageOptions,
) -> Result<varve_trace::TraceBezierResult, String> {
    trace_image_command(Some(&app), image_data, options).await
}

/// Raw binary IPC variant: the PNG request body stays out of JSON
/// serialization; options travel as a small JSON header. Mirrors the upscale
/// binary channel.
#[tauri::command]
pub(crate) async fn trace_image_binary(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<varve_trace::TraceBezierResult, String> {
    const OPTIONS_HEADER: &str = "x-varve-trace-options";
    let image_data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("Binary trace requires an application/octet-stream body".into())
        }
    };
    let options_json = request
        .headers()
        .get(OPTIONS_HEADER)
        .ok_or_else(|| format!("Missing {OPTIONS_HEADER} header"))?
        .to_str()
        .map_err(|_| format!("Invalid {OPTIONS_HEADER} header"))?
        .to_owned();
    let options: TraceImageOptions =
        serde_json::from_str(&options_json).map_err(|e| format!("Invalid trace options: {e}"))?;
    trace_image_command(Some(&app), image_data, options).await
}

/// Shared core: decodes defensively (dimension pre-check before full decode,
/// pixel-count ceiling), runs the engine on a blocking thread so the UI
/// thread stays free, honors cancellation between and inside engine loops,
/// and reports stage progress over `trace:progress` events.
///
/// `app` is optional so unit tests can exercise the core without a live
/// AppHandle (progress events and job registration are skipped then).
async fn trace_image_command(
    app: Option<&tauri::AppHandle>,
    image_data: Vec<u8>,
    options: TraceImageOptions,
) -> Result<varve_trace::TraceBezierResult, String> {
    let job_id = options.job_id.unwrap_or(0);

    if image_data.len() > MAX_TRACE_INPUT_BYTES {
        return Err(format!(
            "Trace input is {:.1} MB; the native limit is 128 MB",
            image_data.len() as f64 / (1024.0 * 1024.0)
        ));
    }

    let (cancel_flag, execution_gate) = app
        .and_then(|a| a.try_state::<TraceCancelState>())
        .map_or_else(
            || {
                (
                    std::sync::Arc::new(AtomicBool::new(false)),
                    std::sync::Arc::new(Mutex::new(())),
                )
            },
            |state| (state.register(job_id), state.execution_gate()),
        );
    let cancel_for_worker = cancel_flag.clone();
    let cancel_after_await = cancel_flag.clone();
    let app_for_progress = app.cloned();
    let clamped_job_id = job_id;
    let opts = sanitize_trace_options(options);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let _permit = execution_gate
            .lock()
            .map_err(|_| "Native trace execution gate was poisoned".to_string())?;
        if cancel_flag.load(Ordering::SeqCst) {
            return Err("Trace cancelled".into());
        }
        // Dimension pre-check before allocating a full decode: rejects
        // decompression bombs and integer-overflow-prone sizes cheaply.
        let dimensions = image::ImageReader::new(std::io::Cursor::new(&image_data))
            .with_guessed_format()
            .map_err(|e| format!("Image format error: {e}"))?
            .into_dimensions()
            .map_err(|e| format!("Image dimensions error: {e}"))?;
        let source_pixels = u64::from(dimensions.0) * u64::from(dimensions.1);
        if source_pixels > MAX_TRACE_PIXELS {
            return Err(format!(
                "Trace source contains {source_pixels} pixels; the native limit is 64 megapixels"
            ));
        }
        if cancel_flag.load(Ordering::SeqCst) {
            return Err("Trace cancelled".into());
        }
        let img = load_from_memory(&image_data).map_err(|e| format!("Image decode error: {e}"))?;
        let rgba = img.to_rgba8();
        let (width, height) = rgba.dimensions();
        let pixels = rgba.into_raw();

        let progress: Option<TraceProgressSink> = app_for_progress.map(|app| {
            Box::new(move |stage: &str, frac: f64| {
                let _ = app.emit(
                    "trace:progress",
                    serde_json::json!({
                        "jobId": clamped_job_id,
                        "stage": stage,
                        "progress": frac,
                    }),
                );
            }) as Box<dyn Fn(&str, f64) + Sync>
        });
        let progress_ref = progress.as_deref();
        Ok(varve_trace::trace_to_beziers_cancellable(
            &pixels,
            width,
            height,
            &opts,
            Some(&cancel_for_worker),
            progress_ref,
        ))
    })
    .await
    .map_err(|e| format!("Trace task panicked: {e}"))??;

    if cancel_after_await.load(Ordering::SeqCst) {
        return Err("Trace cancelled".into());
    }
    Ok(result)
}

//! Native scene rasterization commands.
//!
//! This module is the application entry point for the native IR raster stage in
//! `varve_accel::render`. It is deliberately separate from `acceleration.rs`
//! (which owns *compute*: device discovery, self-test, effect/resample kernels)
//! because the two answer different questions. A machine can have a perfectly
//! usable compute device and still decline to rasterize a frame, and the
//! diagnostics must not conflate the two.
//!
//! What this path is: the scene nodes the editor already sends to
//! `build_render_ir` are lowered into the native draw plan on this thread, and
//! the admitted frame is rasterized on the GPU and returned as straight-alpha
//! RGBA8. What this path is **not**: native presentation. The pixels reach the
//! window through the existing Canvas2D present surface. ADR-0244 records why,
//! with the measured bridge cost that drove the decision.

use std::sync::{Arc, Mutex};

/// Wire framing for a raster response: a little-endian `u32` header length, the
/// UTF-8 JSON header, then the raw pixels.
///
/// The pixels deliberately do **not** travel as a JSON array or base64. A
/// 1600x1000 frame is 6.4 MB; as a JSON array of numbers that is roughly 25 MB
/// of text to parse, and base64 would be 8.5 MB plus a decode pass. Raw bytes
/// through `tauri::ipc::Response` are one copy and arrive as an `ArrayBuffer`.
/// The measured cost of the whole bridge is recorded in ADR-0244; the framing
/// here is what keeps it from being larger than necessary.
pub const NATIVE_RASTER_HEADER_PREFIX_BYTES: usize = 4;

use serde::{Deserialize, Serialize};
use varve_accel::render::{AdmissionReport, NativeRasterDiagnostics, RasterMetrics, RenderError};

/// Application-wide native raster state. The stage is created lazily on the
/// first request, is replaced only after a genuine device loss, and is never
/// silently downgraded: when health pauses it, `native_raster_status` says why
/// and `native_raster_retry` is the explicit recovery.
#[derive(Default)]
pub struct NativeRasterState {
    stage: Mutex<Option<varve_accel::render::NativeRenderStage>>,
    metrics: Mutex<RasterMetrics>,
    last_error: Mutex<Option<String>>,
    last_error_stage: Mutex<Option<varve_accel::render::FailureStage>>,
    /// Reported once, so the frontend can show a truthful "no device" reason
    /// instead of retrying on every frame.
    create_error: Mutex<Option<String>>,
}

impl NativeRasterState {
    pub fn new() -> Self {
        Self::default()
    }

    fn unavailable_reason(&self) -> Option<String> {
        self.create_error.lock().ok().and_then(|slot| slot.clone())
    }

    /// Drop the stage and clear the pause so the next request tries again.
    pub fn retry(&self) {
        if let Ok(mut stage) = self.stage.lock() {
            *stage = None;
        }
        if let Ok(mut error) = self.create_error.lock() {
            *error = None;
        }
        if let Ok(mut metrics) = self.metrics.lock() {
            *metrics = RasterMetrics::default();
        }
        if let Ok(mut error) = self.last_error.lock() {
            *error = None;
        }
        if let Ok(mut stage) = self.last_error_stage.lock() {
            *stage = None;
        }
    }

    fn ensure_stage(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Option<varve_accel::render::NativeRenderStage>>, String>
    {
        let mut guard = self
            .stage
            .lock()
            .map_err(|_| "native raster state lock poisoned".to_string())?;
        if guard.is_none() {
            match varve_accel::render::NativeRenderStage::create(None) {
                Ok(stage) => *guard = Some(stage),
                Err(error) => {
                    let message = error.to_string();
                    if let Ok(mut slot) = self.create_error.lock() {
                        *slot = Some(message.clone());
                    }
                    return Err(message);
                }
            }
        }
        Ok(guard)
    }

    fn record<T>(&self, result: &Result<T, RenderError>) {
        if let Ok(mut stage) = self.stage.lock() {
            if let Some(stage) = stage.as_mut() {
                stage.record_health(result);
            }
        }
        match result {
            Ok(_) => {
                if let Ok(mut slot) = self.last_error.lock() {
                    *slot = None;
                }
                if let Ok(mut slot) = self.last_error_stage.lock() {
                    *slot = None;
                }
            }
            Err(error) => {
                if let Ok(mut slot) = self.last_error.lock() {
                    *slot = Some(format!("{}: {}", error.key(), error.detail()));
                }
                if let Ok(mut slot) = self.last_error_stage.lock() {
                    *slot = Some(error.stage());
                }
            }
        }
    }
}

/// Request payload for one native frame.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRasterRequest {
    /// The same node array the editor sends to `build_render_ir`.
    pub nodes: Vec<varve_core::SceneNode>,
    /// Camera transform premultiplied by the display scale: `[a, b, c, d, e, f]`.
    pub view: [f64; 6],
    pub width: u32,
    pub height: u32,
    /// Plan only: lower and report admission without touching the device. Used
    /// by the frontend to decide whether a native frame is worth requesting.
    #[serde(default)]
    pub dry_run: bool,
}

/// Admission and cost report for one request. Serialized as the JSON header of
/// the framed response.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRasterOutcome {
    pub admission: AdmissionReport,
    /// True when the returned bytes are a complete frame for the request.
    pub rendered: bool,
    pub width: u32,
    pub height: u32,
    pub draw_calls: u32,
    pub sample_count: u32,
    pub lower_ms: f64,
    pub encode_ms: f64,
    pub transfer_ms: f64,
    pub straighten_ms: f64,
    /// Byte length of the pixel payload that follows the header. Straight-alpha
    /// RGBA8, so `width * height * 4` for a rendered frame and `0` otherwise.
    pub pixel_bytes: usize,
}

/// Frame the JSON header and the pixel payload into one raw response body.
fn frame_response(header: &NativeRasterOutcome, pixels: &[u8]) -> tauri::ipc::Response {
    let mut body = Vec::with_capacity(NATIVE_RASTER_HEADER_PREFIX_BYTES + 512 + pixels.len());
    let header_json = serde_json::to_vec(header).unwrap_or_else(|_| b"{}".to_vec());
    body.extend_from_slice(&(header_json.len() as u32).to_le_bytes());
    body.extend_from_slice(&header_json);
    body.extend_from_slice(pixels);
    tauri::ipc::Response::new(body)
}

/// Lower the scene and, when every item is admitted, rasterize it natively.
///
/// Refusals are returned as a successful response with `rendered: false` and a
/// populated `admission`, not as an error: a frame the native stage cannot draw
/// is a normal, expected outcome that the caller answers by keeping the
/// authoritative replay, and turning it into a transport error would make the
/// frontend treat content coverage as a fault.
#[tauri::command]
pub async fn native_raster_frame(
    state: tauri::State<'_, Arc<NativeRasterState>>,
    request: NativeRasterRequest,
) -> Result<tauri::ipc::Response, String> {
    if let Some(reason) = state.unavailable_reason() {
        return Err(reason);
    }
    if request.width == 0 || request.height == 0 {
        return Err("native raster refused a zero-sized frame".to_string());
    }

    // Adapter/device creation can enter a platform graphics loader and must not
    // run on the Tauri/GTK event thread.
    let state = Arc::clone(&*state);
    tauri::async_runtime::spawn_blocking(move || -> Result<tauri::ipc::Response, String> {
        let started = std::time::Instant::now();
        let items = varve_engine::build_render_ir(&request.nodes);

        if request.dry_run {
            let mut guard = state.ensure_stage()?;
            let stage = guard
                .as_mut()
                .ok_or_else(|| "native raster stage unavailable".to_string())?;
            let plan = stage.plan(&items, request.view);
            let admission = plan.report.clone();
            if let Ok(mut metrics) = state.metrics.lock() {
                metrics.record_plan(&admission);
            }
            let outcome = NativeRasterOutcome {
                admission,
                rendered: false,
                width: request.width,
                height: request.height,
                draw_calls: 0,
                sample_count: stage.sample_count(),
                lower_ms: started.elapsed().as_secs_f64() * 1000.0,
                encode_ms: 0.0,
                transfer_ms: 0.0,
                straighten_ms: 0.0,
                pixel_bytes: 0,
            };
            return Ok(frame_response(&outcome, &[]));
        }

        let mut guard = state.ensure_stage()?;
        let stage = guard
            .as_mut()
            .ok_or_else(|| "native raster stage unavailable".to_string())?;

        let plan = stage.plan(&items, request.view);
        let admission = plan.report.clone();
        if let Ok(mut metrics) = state.metrics.lock() {
            metrics.record_plan(&admission);
        }
        let lower_ms = started.elapsed().as_secs_f64() * 1000.0;

        let result = stage.render(&items, request.view, request.width, request.height);
        state.record(&result);

        match result {
            Ok(frame) => {
                if let Ok(mut metrics) = state.metrics.lock() {
                    metrics.record_frame(&frame);
                }
                let outcome = NativeRasterOutcome {
                    admission,
                    rendered: true,
                    width: frame.width,
                    height: frame.height,
                    draw_calls: frame.draw_calls,
                    sample_count: frame.sample_count,
                    lower_ms,
                    encode_ms: frame.encode_ms,
                    transfer_ms: frame.transfer_ms,
                    straighten_ms: frame.straighten_ms,
                    pixel_bytes: frame.pixels.len(),
                };
                Ok(frame_response(&outcome, &frame.pixels))
            }
            // A frame the stage cannot draw is a normal outcome, not a fault:
            // the caller answers it by keeping the authoritative replay.
            Err(RenderError::Unsupported(_)) => {
                let outcome = NativeRasterOutcome {
                    admission,
                    rendered: false,
                    width: request.width,
                    height: request.height,
                    draw_calls: 0,
                    sample_count: stage.sample_count(),
                    lower_ms,
                    encode_ms: 0.0,
                    transfer_ms: 0.0,
                    straighten_ms: 0.0,
                    pixel_bytes: 0,
                };
                Ok(frame_response(&outcome, &[]))
            }
            Err(error) => Err(format!("{}: {}", error.key(), error.detail())),
        }
    })
    .await
    .map_err(|err| format!("native raster task failed: {err}"))?
}

/// Capability and health report. Never creates a device.
#[tauri::command]
pub fn native_raster_status(
    state: tauri::State<'_, Arc<NativeRasterState>>,
) -> NativeRasterDiagnostics {
    if let Some(reason) = state.unavailable_reason() {
        return NativeRasterDiagnostics::unavailable(reason);
    }
    let Ok(mut guard) = state.stage.lock() else {
        return NativeRasterDiagnostics::unavailable("native raster state lock poisoned");
    };
    let Some(stage) = guard.as_mut() else {
        return NativeRasterDiagnostics::unavailable(
            "the native raster stage has not been created yet this session",
        );
    };
    let metrics = state.metrics.lock().ok();
    NativeRasterDiagnostics {
        available: true,
        device_name: stage.device_name().to_string(),
        backend: stage.backend(),
        driver: stage.driver(),
        sample_count: stage.sample_count(),
        stencil_format: format!("{:?}", stage.stencil_format()),
        health: stage.health().clone(),
        last_report: metrics.as_ref().and_then(|m| m.last_report.clone()),
        last_error: state.last_error.lock().ok().and_then(|slot| slot.clone()),
        last_error_stage: state.last_error_stage.lock().ok().and_then(|slot| *slot),
        last_draw_calls: metrics.as_ref().map(|m| m.last_draw_calls).unwrap_or(0),
        last_build_ms: metrics.as_ref().map(|m| m.last_build_ms).unwrap_or(0.0),
        last_encode_ms: metrics.as_ref().map(|m| m.last_encode_ms).unwrap_or(0.0),
        last_readback_ms: metrics.as_ref().map(|m| m.last_readback_ms).unwrap_or(0.0),
    }
}

/// Explicit re-detect / retry after a paused stage. Deliberately does not clear
/// a device loss: a lost device is never resurrected, only replaced.
#[tauri::command]
pub fn native_raster_retry(state: tauri::State<'_, Arc<NativeRasterState>>) -> Result<(), String> {
    if let Ok(mut stage) = state.stage.lock() {
        if let Some(existing) = stage.as_mut() {
            if existing.device_is_lost() {
                *stage = None;
            }
        }
    }
    state.retry();
    Ok(())
}

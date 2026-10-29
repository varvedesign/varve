//! Unit tests for upscale (moved verbatim from lib.rs #[cfg(test)] mod tests; Batch B/B-01).

use super::*;
use image::load_from_memory;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use tauri::ipc::Response;

#[test]
fn upscale_image_end_to_end_png_roundtrip() {
    let mut buf = image::RgbaImage::new(8, 8);
    for y in 0..8 {
        for x in 0..8 {
            let v = if (x + y) % 2 == 0 { 255 } else { 0 };
            buf.put_pixel(x, y, image::Rgba([v, v, v, 255]));
        }
    }
    let mut png: Vec<u8> = Vec::new();
    image::DynamicImage::ImageRgba8(buf)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("encode png");

    let options = UpscaleImageOptions {
        scale: 2.0,
        method: "nearest".into(),
        model_id: None,
        max_pixels: None,
        target_width: None,
        target_height: None,
        job_id: None,
    };
    let result = upscale_image_impl(
        &load_from_memory(&png).unwrap().to_rgba8().into_raw(),
        8,
        8,
        options.scale,
        options.target_width,
        options.target_height,
        options.max_pixels,
        &options.method,
        options
            .model_id
            .as_deref()
            .unwrap_or("upscale-realesr-general"),
        None,
        std::sync::Arc::new(AtomicBool::new(false)),
        None,
    )
    .expect("upscale_image should succeed");
    assert_eq!(result.execution_provider, "native-cpu");
    let decoded = image::load_from_memory(&result.bytes).expect("result must be PNG");
    assert_eq!(decoded.width(), 16);
    assert_eq!(decoded.height(), 16);
}

#[test]
fn gpu_resample_admission_avoids_small_setup_boundaries() {
    assert!(!should_try_gpu_resample(8, 8, 32, 32));
    assert!(!should_try_gpu_resample(1000, 1000, 1000, 1000));
    assert!(should_try_gpu_resample(1920, 1080, 3840, 2160));
}

#[test]
fn upscale_binary_response_preserves_every_byte_without_json() {
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    let expected = vec![0, 1, 127, 128, 254, 255];
    let body = Response::new(expected.clone())
        .body()
        .expect("response body");
    match body {
        InvokeResponseBody::Raw(actual) => assert_eq!(actual, expected),
        InvokeResponseBody::Json(_) => panic!("binary upscale response was JSON encoded"),
    }
}

#[test]
fn upscale_options_accept_frontend_camel_case_job_id() {
    let options: UpscaleImageOptions = serde_json::from_value(serde_json::json!({
        "scale": 2,
        "method": "nearest",
        "jobId": 42,
        "maxPixels": 1024,
    }))
    .expect("deserialize frontend options");
    assert_eq!(options.job_id, Some(42));
    assert_eq!(options.max_pixels, Some(1024));
}

#[test]
fn upscale_state_is_latest_only_and_stale_finish_is_ignored() {
    let state = UpscaleCancelState::new();
    let gate = state.execution_gate();
    assert!(std::sync::Arc::ptr_eq(&gate, &state.execution_gate()));
    let first = state.register(10);
    let same = state.register(10);
    assert!(std::sync::Arc::ptr_eq(&first, &same));

    let second = state.register(11);
    assert!(
        first.load(Ordering::SeqCst),
        "replacement must cancel job 10"
    );
    assert!(!second.load(Ordering::SeqCst));

    state.finish(10);
    state.cancel(11);
    assert!(
        second.load(Ordering::SeqCst),
        "stale completion must not clear job 11"
    );
}

#[test]
fn upscale_rejects_work_above_hard_pixel_budget_before_processing() {
    let error = upscale_image_impl(
        &[0, 0, 0, 0],
        4096,
        4096,
        3.0,
        None,
        None,
        None,
        "nearest",
        "unused",
        None,
        std::sync::Arc::new(AtomicBool::new(false)),
        None,
    )
    .expect_err("large output must be rejected");
    assert!(
        error.contains("effective limit"),
        "unexpected error: {error}"
    );
}

#[test]
fn upscale_honors_preexisting_cancellation_before_processing() {
    let cancelled = std::sync::Arc::new(AtomicBool::new(true));
    let error = upscale_image_impl(
        &[0, 0, 0, 255],
        1,
        1,
        2.0,
        None,
        None,
        None,
        "nearest",
        "unused",
        None,
        cancelled,
        None,
    )
    .expect_err("cancelled job must not run");
    assert_eq!(error, "Upscale cancelled");
}

#![cfg(feature = "ai")]
//! Real-runtime cancellation and pooled-session reuse. No substitute graph or
//! inference implementation: the bundled U2-NetP artifact executes in ORT.

use std::path::Path;
use varve_bgremove::inference::{InferenceRuntime, OrtInferenceRuntime};
use varve_bgremove::InferenceCancellationToken;

#[test]
#[ignore = "requires the shipped ONNX Runtime dynamic library"]
fn cancellation_reaches_ort_and_does_not_poison_the_next_request() {
    let library = std::env::var("ORT_DYLIB_PATH").expect("ORT_DYLIB_PATH is required");
    ort::init_from(library)
        .expect("load shipped runtime")
        .commit();
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let model = root.join("apps/desktop/public/models/u2netp.onnx");
    let mut session = OrtInferenceRuntime
        .create_cpu_session(&model)
        .expect("load bundled model with production policy");
    let image = image::open(root.join("tests/fixtures/bg-removal-corpus/human.jpg"))
        .expect("real image fixture")
        .resize_exact(320, 320, image::imageops::FilterType::Triangle)
        .to_rgb8();
    let mut input = Vec::with_capacity(320 * 320 * 3);
    let mean = [0.485, 0.456, 0.406];
    let std = [0.229, 0.224, 0.225];
    for channel in 0..3 {
        for pixel in image.pixels() {
            input.push((f32::from(pixel[channel]) / 255.0 - mean[channel]) / std[channel]);
        }
    }

    let cancelled = InferenceCancellationToken::default();
    session.set_cancellation(&cancelled).unwrap();
    cancelled.cancel();
    // This calls ORT rather than the surrounding early-return boundary. A
    // Rust-only cancelled flag cannot produce this native termination error.
    let error = session.run(&input, 320).unwrap_err();
    assert!(
        error.contains("terminate"),
        "actual ORT termination: {error}"
    );

    let next = InferenceCancellationToken::default();
    session.set_cancellation(&next).unwrap();
    cancelled.cancel(); // late cancellation belongs only to the previous run
    let output = session.run(&input, 320).expect("next native run succeeds");
    assert_eq!(output.len(), 320 * 320);
    assert!(output.iter().all(|value| value.is_finite()));
    let min = output.iter().copied().fold(f32::INFINITY, f32::min);
    let max = output.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    assert!(max - min > 0.5, "real image produces a non-uniform mask");
    assert!(!next.is_cancelled());
}

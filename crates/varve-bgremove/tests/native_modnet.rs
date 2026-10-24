#![cfg(feature = "ai")]
//! Real portrait graph through the production native preprocessing and decoder.
use base64::Engine;
use std::path::{Path, PathBuf};
use varve_bgremove::inference::{remove_ai_cancellable, stream_sha256, unload_all_model_sessions};
use varve_bgremove::webgpu_ep::{set_inference_provider_policy, InferenceProviderPolicy};
use varve_bgremove::{InferenceCancellationToken, RemovalMethod, RemovalOptions};

#[test]
#[ignore = "requires shipped ORT, VARVE_MODNET_MODEL and VARVE_NATIVE_MODNET_AUDIT_DIR"]
fn native_portrait_graph_preserves_soft_alpha_and_cancellation() {
    let evidence = PathBuf::from(std::env::var("VARVE_NATIVE_MODNET_AUDIT_DIR").unwrap());
    std::fs::create_dir_all(&evidence).unwrap();
    let models = evidence.join("models");
    std::fs::create_dir_all(&models).unwrap();
    let artifact = PathBuf::from(std::env::var("VARVE_MODNET_MODEL").unwrap());
    let checksum = stream_sha256(&artifact).unwrap();
    assert_eq!(
        checksum,
        "07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9"
    );
    std::fs::copy(&artifact, models.join("modnet-portrait.onnx")).unwrap();
    varve_bgremove::model::configure_models_dir(models);
    ort::init_from(std::env::var("ORT_DYLIB_PATH").unwrap())
        .unwrap()
        .commit();
    set_inference_provider_policy(InferenceProviderPolicy::Cpu);
    let source = image::open(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/bg-removal-corpus/human.jpg"),
    )
    .unwrap();
    let options = RemovalOptions {
        method: RemovalMethod::Portrait,
        tolerance: None,
        feather_radius: Some(0.0),
        decontaminate: Some(false),
        click_x: None,
        click_y: None,
        preview_max_dimension: Some(1024),
    };
    let cancelled = InferenceCancellationToken::default();
    cancelled.cancel();
    assert!(
        remove_ai_cancellable(&source, &options, "modnet-portrait", &cancelled)
            .unwrap_err()
            .contains("cancelled")
    );
    let result = remove_ai_cancellable(
        &source,
        &options,
        "modnet-portrait",
        &InferenceCancellationToken::default(),
    )
    .expect("real native MODNet execution");
    let png = base64::engine::general_purpose::STANDARD
        .decode(&result.mask_base64)
        .unwrap();
    std::fs::write(evidence.join("human-modnet-mask.png"), &png).unwrap();
    let mask = image::load_from_memory(&png).unwrap().to_luma8();
    assert_eq!(mask.dimensions(), (source.width(), source.height()));
    assert_eq!(result.execution_provider, "native-cpu");
    assert_eq!(result.method, "portrait");
    let foreground = mask.as_raw().iter().filter(|&&v| v > 230).count();
    let background = mask.as_raw().iter().filter(|&&v| v < 25).count();
    let fractional = mask.as_raw().iter().filter(|&&v| v > 25 && v < 230).count();
    let summary = serde_json::json!({ "modelSha256": checksum,
        "foreground": foreground, "background": background, "fractional": fractional,
        "pixels": mask.as_raw().len(), "processingTimeMs": result.processing_time_ms });
    std::fs::write(evidence.join("result.json"), summary.to_string()).unwrap();
    assert!(
        foreground > mask.as_raw().len() / 100,
        "no subject: {summary}"
    );
    assert!(
        background > mask.as_raw().len() / 100,
        "no background: {summary}"
    );
    assert!(fractional > 100, "no soft coverage: {summary}");
    assert_eq!(unload_all_model_sessions(), 1);
}

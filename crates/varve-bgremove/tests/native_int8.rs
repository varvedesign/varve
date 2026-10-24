#![cfg(feature = "ai")]
//! Real bundled quantized graph, production preprocessing, session and mask.
use base64::Engine;
use std::path::Path;
use varve_bgremove::inference::{remove_ai, unload_all_model_sessions};
use varve_bgremove::webgpu_ep::{set_inference_provider_policy, InferenceProviderPolicy};
use varve_bgremove::{RemovalMethod, RemovalOptions};

#[test]
#[ignore = "requires shipped ONNX Runtime and an isolated VARVE_NATIVE_INT8_AUDIT_DIR"]
fn bundled_int8_executes_its_actual_graph_and_preserves_a_subject_mask() {
    let evidence = std::path::PathBuf::from(std::env::var("VARVE_NATIVE_INT8_AUDIT_DIR").unwrap());
    std::fs::create_dir_all(&evidence).unwrap();
    let models = evidence.join("models");
    std::fs::create_dir_all(&models).unwrap();
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::copy(
        root.join("apps/desktop/public/models/quantized/u2netp-int8.onnx"),
        models.join("u2netp-int8.onnx"),
    )
    .unwrap();
    varve_bgremove::model::configure_models_dir(models);
    ort::init_from(std::env::var("ORT_DYLIB_PATH").unwrap())
        .unwrap()
        .commit();
    set_inference_provider_policy(InferenceProviderPolicy::Cpu);
    let source = image::open(root.join("tests/fixtures/bg-removal-corpus/human.jpg")).unwrap();
    let result = remove_ai(
        &source,
        &RemovalOptions {
            method: RemovalMethod::AiBalanced,
            tolerance: None,
            feather_radius: Some(0.0),
            decontaminate: Some(false),
            click_x: None,
            click_y: None,
            preview_max_dimension: Some(1024),
        },
        "u2netp-int8",
    )
    .expect("real INT8 native execution");
    let png = base64::engine::general_purpose::STANDARD
        .decode(&result.mask_base64)
        .unwrap();
    std::fs::write(evidence.join("human-int8-mask.png"), &png).unwrap();
    let mask = image::load_from_memory(&png).unwrap().to_luma8();
    assert_eq!(mask.dimensions(), (source.width(), source.height()));
    assert_eq!(result.execution_provider, "native-cpu");
    assert_eq!(result.method, "ai-balanced");
    let foreground = mask.as_raw().iter().filter(|&&value| value > 192).count();
    let background = mask.as_raw().iter().filter(|&&value| value < 64).count();
    let summary = serde_json::json!({ "foreground": foreground, "background": background, "pixels": mask.as_raw().len(), "processingTimeMs": result.processing_time_ms });
    std::fs::write(evidence.join("result.json"), summary.to_string()).unwrap();
    assert!(
        foreground > mask.as_raw().len() / 100,
        "no usable foreground: {summary}"
    );
    assert!(
        background > mask.as_raw().len() / 100,
        "no usable background: {summary}"
    );
    assert_eq!(unload_all_model_sessions(), 1);
}

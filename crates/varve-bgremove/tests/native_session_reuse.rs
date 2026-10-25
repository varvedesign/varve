#![cfg(feature = "ai")]
//! Exercise the production pool on a real CPU-only runtime. Reusing identical
//! models must not reload weights under the unavailable GPU cache identity.

use std::path::Path;
use varve_bgremove::inference::{remove_ai, session_pool_metrics, unload_all_model_sessions};
use varve_bgremove::webgpu_ep::{set_inference_provider_policy, InferenceProviderPolicy};
use varve_bgremove::{RemovalMethod, RemovalOptions};

#[test]
#[ignore = "requires the shipped ONNX Runtime dynamic library"]
fn automatic_cpu_inference_reuses_the_session_that_actually_executed() {
    let library = std::env::var("ORT_DYLIB_PATH").expect("ORT_DYLIB_PATH is required");
    ort::init_from(library)
        .expect("load shipped runtime")
        .commit();
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    varve_bgremove::model::configure_models_dir(root.join("apps/desktop/public/models"));
    assert!(!varve_bgremove::webgpu_ep::device_usable());
    set_inference_provider_policy(InferenceProviderPolicy::Auto);
    let image = image::open(root.join("tests/fixtures/bg-removal-corpus/human.jpg"))
        .expect("real image fixture");
    let options = RemovalOptions {
        method: RemovalMethod::AiBalanced,
        tolerance: None,
        feather_radius: Some(0.0),
        decontaminate: Some(false),
        click_x: None,
        click_y: None,
        preview_max_dimension: Some(1024),
    };
    let first = remove_ai(&image, &options, "u2netp").expect("cold native execution");
    let second = remove_ai(&image, &options, "u2netp").expect("warm native execution");
    let metrics = session_pool_metrics();
    eprintln!("production native pool: {metrics:?}");
    assert_eq!(first.execution_provider, "native-cpu");
    assert_eq!(first.mask_base64, second.mask_base64);
    assert_eq!(
        metrics.cold_loads, 1,
        "identical requests reuse CPU weights"
    );
    assert_eq!(metrics.warm_checkouts, 1);
    assert_eq!(metrics.cached_entries, 1);
    assert_eq!(metrics.active, 0);
    assert_eq!(unload_all_model_sessions(), 1);
}

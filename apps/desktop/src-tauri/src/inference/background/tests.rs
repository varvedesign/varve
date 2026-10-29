//! Unit tests for inference/background (moved verbatim from lib.rs #[cfg(test)] mod tests; Batch B/B-01).

use super::*;
use crate::generative_resources;
use crate::inference::background::models::encode_bg_remove_binary;
use crate::inference::background::models::encoded_image_dimensions;
use crate::inference::background::models::host_memory_status;
use crate::inference::background::models::native_background_model_id;
use crate::inference::background::models::BgRemoveOptions;
use crate::inference::background::models::BgRemoveResult;
use crate::inference::background::models::BG_REMOVE_BINARY_MAGIC;
use crate::test_support::*;
use base64::Engine as _;

#[test]
fn host_memory_status_reports_a_known_tier_and_sane_bytes() {
    let status = host_memory_status();
    assert!(
        ["constrained", "standard", "high", "unknown"].contains(&status.resource_tier.as_str()),
        "unexpected resource tier: {}",
        status.resource_tier
    );
    if let Some(bytes) = status.available_bytes {
        assert!(bytes > 0, "a reported availability must be positive");
        let expected = generative_resources::resource_tier(Some(bytes));
        assert_eq!(status.resource_tier, expected);
    } else {
        assert_eq!(status.resource_tier, "unknown");
    }
}

#[test]
fn birefnet_preflight_uses_the_measured_native_peak() {
    // bgremove_bench: 432 MiB peak RSS across a 12-image corpus with the
    // bundled ORT CPU build and the arena disabled (2026-10-22). The bound
    // allows measurement noise but catches a return to the 7 GB
    // browser/WASM working-set figure, which refused High quality on hosts
    // with gigabytes free.
    let model = varve_bgremove::model::model_info("birefnet-general-lite").expect("lite model");
    let peak = model.peak_memory_bytes.expect("measured native peak");
    assert!(
        (400 * 1024 * 1024..=500 * 1024 * 1024).contains(&peak),
        "native BiRefNet Lite peak changed to {peak} bytes; re-measure before changing this bound"
    );

    // A 480x640 source at this peak fits ordinary 1.5 GB of headroom.
    let required = generative_resources::estimated_required_memory_bytes_for_model(480, 640, peak)
        .expect("valid dimensions");
    assert!(
        required < 600 * 1024 * 1024,
        "High quality must fit a modest host: required {required} bytes"
    );
    assert!(
        generative_resources::memory_shortage_error(
            "Native background removal",
            required,
            1536 * 1024 * 1024,
            "x86_64",
        )
        .is_none(),
        "1.5 GB of headroom must admit High quality"
    );
    // A genuinely starved host still refuses, with an actionable message.
    let refusal = generative_resources::memory_shortage_error(
        "Native background removal",
        required,
        64 * 1024 * 1024,
        "aarch64",
    )
    .expect("a starved host must be refused");
    assert!(refusal.contains("Native background removal"));
    assert!(refusal.contains("aarch64"));
    assert!(refusal.contains("MiB"));
}

#[test]
fn host_memory_status_serializes_the_camel_case_contract() {
    // The renderer reads `availableBytes`; a missing rename_all would
    // silently send `available_bytes`, the probe would find nothing, and
    // every desktop session would fall back to the 400 MB floor again.
    let status = host_memory_status();
    let json = serde_json::to_value(&status).expect("serializable status");
    assert!(json.get("availableBytes").is_some());
    assert!(json.get("resourceTier").is_some());
    assert!(json.get("available_bytes").is_none());
    assert!(json.get("resource_tier").is_none());
}

#[test]
fn encoded_image_dimensions_are_read_without_decoding_pixels() {
    let png = make_test_png(20, 12);
    assert_eq!(encoded_image_dimensions(&png).expect("valid PNG"), (20, 12));
}

#[test]
fn bg_remove_options_deserializes_camel_case_wire_format() {
    // This is exactly the shape `invokeTauriRemoveBackground` (TS) sends.
    let json = serde_json::json!({
        "method": "quick",
        "featherRadius": 2.5,
        "decontaminate": true,
        "clickX": 10,
        "clickY": 20,
    });
    let opts: BgRemoveOptions = serde_json::from_value(json).expect("deserialize");
    assert_eq!(opts.method, "quick");
    assert_eq!(opts.feather_radius, Some(2.5));
    assert_eq!(opts.decontaminate, Some(true));
    assert_eq!(opts.click_x, Some(10));
    assert_eq!(opts.click_y, Some(20));
}

#[test]
fn bg_remove_native_routing_honours_explicit_model_identity() {
    for (method, requested, expected) in [
        (
            "ai-quality",
            Some("birefnet-general"),
            Some("birefnet-general"),
        ),
        ("ai-quality", None, Some("birefnet-general-lite")),
        ("ai-balanced", Some("u2netp"), Some("u2netp")),
        ("ai-balanced", Some("u2netp-int8"), Some("u2netp-int8")),
        ("portrait", None, Some("modnet-portrait")),
        ("portrait", Some("modnet-portrait"), Some("modnet-portrait")),
        ("ai-balanced", None, Some("isnet-general-use")),
        ("quick", None, None),
    ] {
        let options: BgRemoveOptions = serde_json::from_value(serde_json::json!({
            "method": method, "modelId": requested,
        }))
        .expect("wire options");
        assert_eq!(native_background_model_id(&options).unwrap(), expected);
    }
}

#[test]
fn bg_remove_rejects_incompatible_graphs_before_decoding_or_inference() {
    for (method, model) in [
        ("quick", "birefnet-general"),
        ("ai-quality", "scunet"),
        ("ai-quality", "../birefnet-general"),
        ("ai-balanced", "birefnet-general-lite"),
        ("portrait", "modnet-portrait"),
    ] {
        let options: BgRemoveOptions = serde_json::from_value(serde_json::json!({
            "method": method, "modelId": model,
        }))
        .expect("wire options");
        let error = remove_background_impl(vec![], options).unwrap_err();
        assert!(error.contains("Unsupported native background-removal method/model pair"));
    }
}

#[test]
fn bg_remove_result_serializes_camel_case_wire_format() {
    let result = BgRemoveResult {
        mask_base64: "abc123".to_string(),
        confidence: 0.75,
        method: "quick".to_string(),
        model_id: None,
        processing_time_ms: 42,
        width: 10,
        height: 20,
        execution_provider: "native-cpu".to_string(),
    };
    let json = serde_json::to_value(&result).expect("serialize");
    // The TS side (`BackgroundRemovalResult`/`invokeTauriRemoveBackground`)
    // reads these exact camelCase keys — a regression here silently breaks
    // background removal on the desktop build with no compile-time signal.
    assert_eq!(json["maskBase64"], "abc123");
    assert_eq!(json["processingTimeMs"], 42);
    assert_eq!(json["executionProvider"], "native-cpu");
    assert!(json.get("mask_base64").is_none());
    assert!(json.get("processing_time_ms").is_none());
}

#[test]
fn bg_remove_binary_response_keeps_mask_out_of_json() {
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    let mask = [137u8, 80, 78, 71];
    let result = BgRemoveResult {
        mask_base64: base64::engine::general_purpose::STANDARD.encode(mask),
        confidence: 0.75,
        method: "ai-quality".to_string(),
        model_id: Some("birefnet-general".into()),
        processing_time_ms: 42,
        width: 10,
        height: 20,
        execution_provider: "native-cpu".to_string(),
    };
    let body = encode_bg_remove_binary(result)
        .expect("encode binary response")
        .body()
        .expect("response body");
    let InvokeResponseBody::Raw(bytes) = body else {
        panic!("background-removal binary response was JSON encoded");
    };
    assert_eq!(&bytes[..4], BG_REMOVE_BINARY_MAGIC);
    let metadata_len = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let metadata: serde_json::Value =
        serde_json::from_slice(&bytes[8..8 + metadata_len]).expect("metadata JSON");
    assert_eq!(metadata["method"], "ai-quality");
    assert_eq!(metadata["modelId"], "birefnet-general");
    assert_eq!(&bytes[8 + metadata_len..], mask);
}

#[test]
fn remove_background_quick_end_to_end_via_command() {
    let png = make_test_png(20, 20);
    let options: BgRemoveOptions = serde_json::from_value(serde_json::json!({
        "method": "quick",
    }))
    .expect("deserialize options");

    let result = remove_background_impl(png, options).expect("remove_background should succeed");
    assert_eq!(result.method, "quick");
    assert_eq!(result.width, 20);
    assert_eq!(result.height, 20);
    assert!(!result.mask_base64.is_empty());
    assert!(result.confidence > 0.0);
}

#[test]
fn remove_background_rejects_undecodable_bytes() {
    let options: BgRemoveOptions = serde_json::from_value(serde_json::json!({
        "method": "quick",
    }))
    .expect("deserialize options");
    let err = remove_background_impl(vec![0, 1, 2, 3], options).unwrap_err();
    assert!(
        err.contains("decode"),
        "should report a decode error: {err}"
    );
}

#[test]
#[cfg(not(feature = "ai"))]
fn remove_background_ai_method_is_rejected_without_ai_feature() {
    // Without the `ai` Cargo feature, an AI request must fail explicitly.
    // Returning a Quick mask here would mislabel heuristic output as AI.
    // `ai` is a default feature (see Cargo.toml) — this only runs under
    // `cargo test --no-default-features` or `--features ""`.
    let png = make_test_png(10, 10);
    let options: BgRemoveOptions = serde_json::from_value(serde_json::json!({
        "method": "ai-balanced",
    }))
    .expect("deserialize options");

    assert!(remove_background_impl(png, options)
        .expect_err("AI request must not degrade to quick")
        .contains("not enabled"));
}

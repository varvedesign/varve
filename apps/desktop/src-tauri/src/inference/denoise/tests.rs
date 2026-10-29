//! Unit tests for inference/denoise (moved verbatim from lib.rs #[cfg(test)] mod tests; Batch B/B-01).

use super::*;

#[test]
fn denoise_options_accept_frontend_camel_case_wire_format() {
    let options: NativeDenoiseOptions = serde_json::from_value(serde_json::json!({
        "modelId": "scunet",
        "strength": 0.3,
    }))
    .expect("deserialize denoise options");

    assert_eq!(options.model_id.as_deref(), Some("scunet"));
    assert_eq!(options.strength, Some(0.3));
}

#[test]
fn denoise_result_serializes_camel_case_wire_format() {
    let result = NativeDenoiseResult {
        png_base64: "encoded-png".to_string(),
        width: 12,
        height: 8,
        processing_time_ms: 27,
        execution_provider: "native-cpu".to_string(),
    };
    let json = serde_json::to_value(&result).expect("serialize denoise result");

    assert_eq!(json["pngBase64"], "encoded-png");
    assert_eq!(json["processingTimeMs"], 27);
    assert!(json.get("png_base64").is_none());
    assert!(json.get("processing_time_ms").is_none());
}

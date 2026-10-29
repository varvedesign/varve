//! Unit tests for models (moved verbatim from lib.rs #[cfg(test)] mod tests; Batch B/B-01).

use super::*;
use crate::uuid;

#[test]
fn inference_model_ids_reject_traversal_and_uppercase() {
    assert!(validate_inference_model_id("ddcolor-tiny").is_ok());
    assert!(validate_inference_model_id("ddcolor").is_ok());
    assert!(validate_inference_model_id("").is_err());
    assert!(validate_inference_model_id("../secrets").is_err());
    assert!(validate_inference_model_id("DDColor").is_err());
    assert!(validate_inference_model_id("ddcolor.onnx").is_err());
    assert!(validate_inference_model_id(&"a".repeat(65)).is_err());
}

#[test]
fn inference_sha256_requires_lowercase_hex() {
    assert!(validate_inference_sha256(
        "1410b455cd230a587c38b5771a0193aa6f28bb89b0e29566fbdb791bb1310c47"
    )
    .is_ok());
    assert!(validate_inference_sha256("").is_err());
    assert!(validate_inference_sha256(&"A".repeat(64)).is_err());
    assert!(validate_inference_sha256(&"g".repeat(64)).is_err());
    assert!(validate_inference_sha256(&"a".repeat(63)).is_err());
}

#[test]
fn inference_model_readiness_rejects_an_existing_corrupt_graph() {
    let directory = std::env::temp_dir().join(format!("varve-model-readiness-{}", uuid()));
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("u2netp.onnx"), b"truncated model").unwrap();
    let result = inference_model_path_at(&directory, "u2netp");
    std::fs::remove_dir_all(directory).unwrap();
    assert_eq!(
        result.unwrap(),
        None,
        "existence is not installation integrity"
    );
}

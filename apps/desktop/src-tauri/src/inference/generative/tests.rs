//! Unit tests for inference/generative (moved verbatim from lib.rs #[cfg(test)] mod tests; Batch B/B-01).

use crate::generative_resources;
use crate::inference::generative::config::validate_generative_edit_options;
use crate::inference::generative::config::GenerativeEditOptions;
use crate::inference::generative::config::GENERATIVE_MODEL_CUSTOM_PROFILE;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOADS;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_AVAILABLE;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_CANCELLATIONS;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_SHA256;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_SIZE;
use crate::inference::generative::config::GENERATIVE_MODEL_HANDLE;
use crate::inference::generative::config::GENERATIVE_MODEL_IMPORT_AVAILABLE;
use crate::inference::generative::config::GENERATIVE_MODEL_IMPORT_UNAVAILABLE_REASON;
use crate::inference::generative::config::GENERATIVE_MODEL_METADATA_SCHEMA_VERSION;
use crate::inference::generative::config::GENERATIVE_MODEL_PROFILE;
use crate::inference::generative::config::GENERATIVE_MODEL_RUNTIME_ID;
use crate::inference::generative::config::MAX_GENERATIVE_PROMPT_CHARS;
use crate::inference::generative::download::start_generative_download_cancellation_watcher;
use crate::inference::generative::download_commands::begin_generative_model_download;
use crate::inference::generative::download_commands::cancel_generative_edit_model_download;
use crate::inference::generative::import::generation_cancel_requested;
use crate::inference::generative::import::qualification_request;
use crate::inference::generative::import::take_generation_cancellation;
use crate::inference::generative::model_status::ensure_generative_model_import_supported;
use crate::inference::generative::model_status::generative_model_artifact_is_known_incompatible;
use crate::inference::generative::model_status::generative_model_is_ready;
use crate::inference::generative::model_status::generative_model_profile_is_supported;
use crate::inference::generative::model_status::generative_model_record_is_ready;
use crate::inference::generative::model_status::generative_model_record_matches_runtime;
use crate::inference::generative::model_status::GenerativeModelMetadata;
use crate::inference::generative::run::cancel_generative_edit;
use crate::uuid;
use std::sync::atomic::Ordering;

#[test]
fn generative_cancellation_records_startup_tombstones() {
    let request_id = format!("generative-cancel-test-{}", uuid());
    cancel_generative_edit(request_id.clone()).expect("record cancellation");
    assert!(generation_cancel_requested(&request_id));
    assert!(take_generation_cancellation(&request_id));
    assert!(!generation_cancel_requested(&request_id));
}

#[test]
fn generative_options_are_validated_before_model_preflight() {
    let request_id = format!("generative-options-test-{}", uuid());
    let mut options = qualification_request(GENERATIVE_MODEL_HANDLE, request_id);
    assert!(validate_generative_edit_options(&options).is_ok());

    options.steps = 0;
    assert!(validate_generative_edit_options(&options)
        .expect_err("zero diffusion steps must be rejected")
        .contains("steps"));
    options.steps = 4;

    options.guidance_scale = f32::NAN;
    assert!(validate_generative_edit_options(&options)
        .expect_err("non-finite guidance must be rejected")
        .contains("guidance scale"));
    options.guidance_scale = 7.0;

    options.strength = 1.1;
    assert!(validate_generative_edit_options(&options)
        .expect_err("out-of-range strength must be rejected")
        .contains("strength"));
    options.strength = 0.85;

    options.prompt = "x".repeat(MAX_GENERATIVE_PROMPT_CHARS + 1);
    assert!(validate_generative_edit_options(&options)
        .expect_err("oversized prompts must be rejected")
        .contains("prompt"));
}

#[test]
fn generative_options_default_image_guidance_for_legacy_callers() {
    let options: GenerativeEditOptions = serde_json::from_value(serde_json::json!({
        "request_id": "legacy-options-test",
        "model_handle": GENERATIVE_MODEL_HANDLE,
        "image_data": [],
        "image_w": 1,
        "image_h": 1,
        "mask": [],
        "mask_w": 1,
        "mask_h": 1,
        "mode": "replace",
        "prompt": "a red apple",
        "negative_prompt": "",
        "output_w": 1,
        "output_h": 1,
        "steps": 1,
        "guidance_scale": 7.0,
        "seed": 417,
        "strength": 0.85
    }))
    .expect("older renderer payloads remain readable");

    assert_eq!(options.image_guidance_scale, 1.0);
    assert_eq!(options.mask_input, "image-and-mask");
    assert_eq!(options.mask_convention, "white-edit-black-preserve");
}

#[test]
fn generative_options_reject_unmapped_frames_and_mismatched_buffers() {
    let request_id = format!("generative-buffer-test-{}", uuid());
    let mut options = qualification_request(GENERATIVE_MODEL_HANDLE, request_id);

    options.output_w = 256;
    assert!(validate_generative_edit_options(&options)
        .expect_err("the helper must not guess a source resize")
        .contains("source dimensions"));
    options.output_w = 512;

    options.mask.pop();
    assert!(validate_generative_edit_options(&options)
        .expect_err("a truncated mask must be rejected before model access")
        .contains("mask buffer"));
}

#[test]
fn model_download_cancellation_wakes_in_flight_network_wait() {
    let request_id = format!("download-cancel-test-{}", uuid());
    let (stop_watcher, mut cancellation, watcher) =
        start_generative_download_cancellation_watcher(&request_id);

    cancel_generative_edit_model_download(request_id.clone()).expect("record cancellation");
    let observed = tauri::async_runtime::block_on(async { cancellation.recv().await });

    assert_eq!(observed, Some(()));
    stop_watcher.store(true, Ordering::Release);
    watcher.join().expect("cancellation watcher exits");
    GENERATIVE_MODEL_DOWNLOAD_CANCELLATIONS
        .lock()
        .expect("cancellation state is available")
        .remove(&request_id);
}

#[test]
fn model_download_cancellation_before_dispatch_is_honored() {
    let request_id = format!("download-cancel-before-dispatch-{}", uuid());
    cancel_generative_edit_model_download(request_id.clone()).expect("record cancellation");

    assert_eq!(
        begin_generative_model_download(&request_id),
        Err("Download cancelled".into())
    );
    assert!(!GENERATIVE_MODEL_DOWNLOADS
        .lock()
        .expect("download state is available")
        .contains(&request_id));
    assert!(!GENERATIVE_MODEL_DOWNLOAD_CANCELLATIONS
        .lock()
        .expect("cancellation state is available")
        .contains(&request_id));
}

#[test]
fn model_qualification_is_bound_to_the_current_platform_and_architecture() {
    let resource = generative_resources::NativeResourceSnapshot {
        available_memory_bytes: Some(8 * 1024 * 1024 * 1024),
        required_memory_bytes: 6 * 1024 * 1024 * 1024,
        resource_tier: "high",
        execution_backend: "native-cpu",
        platform: "linux",
        architecture: "x86_64",
    };
    let record = GenerativeModelMetadata {
        schema_version: GENERATIVE_MODEL_METADATA_SCHEMA_VERSION,
        model_handle: GENERATIVE_MODEL_HANDLE.into(),
        profile_id: GENERATIVE_MODEL_PROFILE.into(),
        size_bytes: 42,
        checksum_sha256: "hash".into(),
        runtime_id: GENERATIVE_MODEL_RUNTIME_ID.into(),
        execution_backend: "native-cpu".into(),
        platform: "linux".into(),
        architecture: "x86_64".into(),
        preflight_qualified: true,
        preflight_qualified_at: Some(1),
    };

    assert!(generative_model_record_matches_runtime(
        &record, 42, "hash", &resource
    ));
    assert!(record.preflight_qualified);
    assert!(
        !generative_model_record_is_ready(&record, 42, "hash", &resource),
        "a cheap compatibility probe must not unlock an uncertified model"
    );
    assert!(!generative_model_is_ready(&record, 42, "hash", &resource));

    let mut arm_resource = resource.clone();
    arm_resource.architecture = "aarch64";
    assert!(!generative_model_record_is_ready(
        &record,
        42,
        "hash",
        &arm_resource
    ));

    let mut constrained_resource = resource.clone();
    constrained_resource.available_memory_bytes = Some(4 * 1024 * 1024 * 1024);
    assert!(!generative_model_is_ready(
        &record,
        42,
        "hash",
        &constrained_resource
    ));

    let mut unknown_resource = resource.clone();
    unknown_resource.available_memory_bytes = None;
    unknown_resource.resource_tier = "unknown";
    assert!(!generative_model_is_ready(
        &record,
        42,
        "hash",
        &unknown_resource
    ));

    let mut windows_resource = resource.clone();
    windows_resource.platform = "windows";
    assert!(!generative_model_record_is_ready(
        &record,
        42,
        "hash",
        &windows_resource
    ));
}

#[test]
fn packaged_q4_artifact_is_rejected_as_incompatible_with_varve_runtime() {
    const { assert!(!GENERATIVE_MODEL_DOWNLOAD_AVAILABLE) };
    let resource = generative_resources::NativeResourceSnapshot {
        available_memory_bytes: Some(8 * 1024 * 1024 * 1024),
        required_memory_bytes: 6 * 1024 * 1024 * 1024,
        resource_tier: "high",
        execution_backend: "native-cpu",
        platform: "linux",
        architecture: "x86_64",
    };
    let record = GenerativeModelMetadata {
        schema_version: GENERATIVE_MODEL_METADATA_SCHEMA_VERSION,
        model_handle: GENERATIVE_MODEL_HANDLE.into(),
        profile_id: GENERATIVE_MODEL_PROFILE.into(),
        size_bytes: GENERATIVE_MODEL_DOWNLOAD_SIZE,
        checksum_sha256: GENERATIVE_MODEL_DOWNLOAD_SHA256.into(),
        runtime_id: GENERATIVE_MODEL_RUNTIME_ID.into(),
        execution_backend: "native-cpu".into(),
        platform: "linux".into(),
        architecture: "x86_64".into(),
        preflight_qualified: true,
        preflight_qualified_at: Some(1),
    };

    assert!(generative_model_artifact_is_known_incompatible(
        GENERATIVE_MODEL_DOWNLOAD_SHA256
    ));
    assert!(generative_model_record_matches_runtime(
        &record,
        GENERATIVE_MODEL_DOWNLOAD_SIZE,
        GENERATIVE_MODEL_DOWNLOAD_SHA256,
        &resource
    ));
    assert!(!generative_model_record_is_ready(
        &record,
        GENERATIVE_MODEL_DOWNLOAD_SIZE,
        GENERATIVE_MODEL_DOWNLOAD_SHA256,
        &resource
    ));
}

#[test]
fn arbitrary_model_import_is_fail_closed_until_a_model_adapter_is_qualified() {
    const { assert!(!GENERATIVE_MODEL_IMPORT_AVAILABLE) };
    assert_eq!(
        ensure_generative_model_import_supported(),
        Err(GENERATIVE_MODEL_IMPORT_UNAVAILABLE_REASON.into())
    );
    assert!(generative_model_profile_is_supported(
        GENERATIVE_MODEL_PROFILE
    ));
    assert!(!generative_model_profile_is_supported(
        GENERATIVE_MODEL_CUSTOM_PROFILE
    ));
}

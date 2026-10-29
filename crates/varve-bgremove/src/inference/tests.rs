use super::denoise::pad_rgba_edges;
use super::runtime::{InferenceRuntime, InferenceSession, OrtInferenceRuntime};
use super::segmentation::{
    model_spec, normalize_segmentation_output, reconstruct_letterbox_mask, resize_mask,
    LetterboxTransform,
};
use super::session::{
    auto_gpu_model_fallbacks, auto_gpu_model_is_quarantined, automatic_gpu_fallback_allowed,
    clear_auto_gpu_model_quarantine, execution_provider_fallback, quarantine_auto_gpu_model,
};
use crate::session_pool::{InferenceCancellationToken, SessionPool, SessionPoolLimits};

#[test]
fn webgpu_quarantine_seam_blocks_other_paths_and_clears() {
    let path = Path::new("/tmp/varve-quarantine-seam-test.onnx");
    clear_auto_gpu_model_quarantine();
    assert!(!auto_gpu_model_is_quarantined(path));
    assert!(auto_gpu_model_fallbacks().is_empty());

    quarantine_auto_gpu_model(path, "storage-buffer limit");
    assert!(auto_gpu_model_is_quarantined(path));
    assert!(!auto_gpu_model_is_quarantined(Path::new(
        "/tmp/other-model.onnx"
    )));
    let entries = auto_gpu_model_fallbacks();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].1.contains("storage-buffer"));

    clear_auto_gpu_model_quarantine();
    assert!(!auto_gpu_model_is_quarantined(path));
    assert!(auto_gpu_model_fallbacks().is_empty());
}

#[test]
fn automatic_fallback_is_gated_to_auto_policy() {
    use crate::webgpu_ep::{set_inference_provider_policy, InferenceProviderPolicy};
    let original = crate::webgpu_ep::inference_provider_policy();
    set_inference_provider_policy(InferenceProviderPolicy::Auto);
    assert!(automatic_gpu_fallback_allowed());
    set_inference_provider_policy(InferenceProviderPolicy::Gpu);
    assert!(!automatic_gpu_fallback_allowed());
    set_inference_provider_policy(InferenceProviderPolicy::Cpu);
    assert!(!automatic_gpu_fallback_allowed());
    set_inference_provider_policy(original);
}
use image::{Rgba, RgbaImage};
use std::path::Path;

fn decode_gray_png(png: &[u8]) -> Vec<u8> {
    let image = image::load_from_memory(png).expect("png should decode");
    let gray = image.to_luma8();
    gray.into_raw()
}

#[test]
fn normalizes_u2net_probabilities_to_reference_scale() {
    // rembg-faithful: probability * 255 with clamp — no min-max stretch.
    assert_eq!(
        normalize_segmentation_output(&[0.2, 0.4, 0.6], false),
        vec![51, 102, 153]
    );
}

#[test]
fn applies_birefnet_sigmoid() {
    assert_eq!(
        normalize_segmentation_output(&[-2.0, 0.0, 2.0], true),
        vec![30, 128, 225]
    );
}

#[test]
fn clamps_out_of_range_logits_to_valid_soft_mask() {
    // Sigmoid output is bounded, but a malformed graph output must not
    // escape the 0-255 range; negative probabilities clamp to 0.
    assert_eq!(
        normalize_segmentation_output(&[-100.0, 0.0, 100.0], false),
        vec![0, 0, 255]
    );
    let sigmoided = normalize_segmentation_output(&[-50.0, 0.0, 50.0], true);
    assert_eq!(sigmoided[0], 0);
    assert_eq!(sigmoided[2], 255);
    assert_eq!(sigmoided[1], 128);
}

#[test]
fn flat_output_stays_at_its_true_probability_not_stretched() {
    // The old min-max path stretched a near-flat map to full contrast,
    // turning soft probability bands into hard edges.
    assert_eq!(
        normalize_segmentation_output(&[0.5, 0.51, 0.52], false),
        vec![128, 130, 133]
    );
}

#[test]
fn resizes_soft_mask_bilinearly() {
    assert_eq!(resize_mask(&[0, 255], 2, 1, 4, 1), vec![0, 64, 191, 255]);
}

#[test]
fn pads_image_model_inputs_by_repeating_edges() {
    let mut image = RgbaImage::new(2, 2);
    image.put_pixel(0, 0, Rgba([1, 2, 3, 4]));
    image.put_pixel(1, 0, Rgba([5, 6, 7, 8]));
    image.put_pixel(0, 1, Rgba([9, 10, 11, 12]));
    image.put_pixel(1, 1, Rgba([13, 14, 15, 16]));

    let padded = pad_rgba_edges(&image, 3, 4);
    assert_eq!(padded.get_pixel(2, 3), &Rgba([13, 14, 15, 16]));
    assert_eq!(padded.get_pixel(0, 3), &Rgba([9, 10, 11, 12]));
    assert_eq!(padded.get_pixel(2, 0), &Rgba([5, 6, 7, 8]));
}

#[test]
fn isnet_uses_official_normalization_without_sigmoid() {
    let (size, mean, std, _, sigmoid) = model_spec("isnet-general-use");
    assert_eq!(size, 1024);
    assert_eq!(mean, [0.5; 3]);
    assert_eq!(std, [1.0; 3]);
    assert!(!sigmoid);
}

#[test]
fn int8_uses_u2net_geometry_and_probability_output() {
    assert_eq!(model_spec("u2netp-int8"), model_spec("u2netp"));
}

#[test]
fn reconstructs_wide_letterbox_without_stretching() {
    let mut mask = vec![0; 16];
    mask[4..12].fill(255);
    assert_eq!(
        reconstruct_letterbox_mask(
            &mask,
            4,
            4,
            4,
            2,
            LetterboxTransform {
                offset_x: 0.0,
                offset_y: 1.0,
                scale: 1.0,
            },
        ),
        vec![255; 8]
    );
}

#[test]
fn ort_runtime_can_be_overridden() {
    // The default runtime is OrtInferenceRuntime
    let runtime = OrtInferenceRuntime;
    // This just tests the trait is object-safe and constructable
    let _: &dyn InferenceRuntime = &runtime;
}

#[test]
fn ort_session_trait_is_object_safe() {
    // Test that Box<dyn InferenceSession> works (object safety)
    // We can't create a real session without a model file, but we
    // can verify the trait is properly object-safe for future impls.
    struct StubSession;
    impl InferenceSession for StubSession {
        fn run(&mut self, _input: &[f32], _input_size: u32) -> Result<Vec<f32>, String> {
            Ok(vec![])
        }
        fn output_names(&self) -> Vec<String> {
            vec!["output".to_string()]
        }
    }
    let mut session: Box<dyn InferenceSession> = Box::new(StubSession);
    let result = session.run(&[], 0).unwrap();
    assert!(result.is_empty());
}

#[test]
fn automatic_gpu_execution_failure_retries_once_on_cpu_and_discards_gpu_session() {
    struct FakeSession {
        provider: &'static str,
        fail: bool,
    }

    impl InferenceSession for FakeSession {
        fn run(&mut self, _input: &[f32], _input_size: u32) -> Result<Vec<f32>, String> {
            if self.fail {
                self.fail = false;
                Err("synthetic WebGPU kernel failure".to_owned())
            } else {
                Ok(vec![42.0])
            }
        }

        fn output_names(&self) -> Vec<String> {
            vec!["output".to_owned()]
        }

        fn execution_provider(&self) -> &'static str {
            self.provider
        }
    }

    crate::webgpu_ep::set_inference_provider_policy(
        crate::webgpu_ep::InferenceProviderPolicy::Auto,
    );
    clear_auto_gpu_model_quarantine();

    let pool = SessionPool::new(SessionPoolLimits {
        max_cached_entries: 2,
        max_cached_bytes: 100,
        max_concurrent: 1,
    });
    let cpu_pool = pool.clone();
    let token = InferenceCancellationToken::default();
    let gpu_session = pool
        .checkout("gpu", 10, &token, || {
            Ok(Box::new(FakeSession {
                provider: "native-webgpu",
                fail: true,
            }) as Box<dyn InferenceSession>)
        })
        .expect("GPU session checkout");
    let model_path = Path::new("/tmp/varve-provider-fallback-test.onnx");

    let (output, provider) = execution_provider_fallback(
        model_path,
        &token,
        gpu_session,
        |session| session.run(&[], 1),
        move |_, cancellation| {
            cpu_pool.checkout("cpu", 10, cancellation, || {
                Ok(Box::new(FakeSession {
                    provider: "native-cpu",
                    fail: false,
                }) as Box<dyn InferenceSession>)
            })
        },
    )
    .expect("CPU retry should succeed");

    assert_eq!(output, vec![42.0]);
    assert_eq!(provider, "native-cpu");
    assert!(auto_gpu_model_is_quarantined(model_path));
    let metrics = pool.metrics();
    assert_eq!(metrics.active, 0);
    assert_eq!(metrics.cached_entries, 1);
    clear_auto_gpu_model_quarantine();
}

/// Native-parity golden test against the checked-in rembg reference mask
/// for the bundled u2netp model and one deterministic synthetic fixture.
///
/// Gated on `ORT_DYLIB_PATH`: running it requires the bundled onnxruntime
/// dylib, which ordinary CI does not have. The threshold is deliberately
/// loose (IoU ≥ 0.98): the reference was generated with a different ORT
/// patch version and resize kernel, and the test exists to catch pipeline
/// regressions (wrong normalization, broken letterbox, double sigmoid),
/// not to pin pixel-exact output.
#[test]
#[ignore = "requires ORT_DYLIB_PATH pointing at a bundled onnxruntime dylib"]
fn native_u2netp_matches_reference_mask_within_tolerance() {
    let Ok(dylib) = std::env::var("ORT_DYLIB_PATH") else {
        return;
    };
    let root = env!("CARGO_MANIFEST_DIR");
    let fixture = format!("{root}/../../tests/fixtures/bg-removal-corpus/synthetic/synth-hair.png");
    let reference = format!(
        "{root}/../../tests/fixtures/bg-removal-corpus/reference/synth-hair-u2netp-rembg.png"
    );
    if !std::path::Path::new(&reference).is_file() {
        return; // reference artifact not checked out; nothing to compare
    }
    crate::runtime::init_native_runtime(std::path::Path::new(&dylib))
        .expect("onnxruntime dylib should load");
    let model = crate::model::model_path("u2netp");
    std::fs::create_dir_all(model.parent().expect("model parent")).expect("model dir");
    std::fs::copy(
        format!("{root}/../../apps/desktop/public/models/u2netp.onnx"),
        &model,
    )
    .expect("stage bundled model");
    let image = image::open(&fixture).expect("fixture should decode");
    let result = crate::inference::remove_ai(
        &image,
        &crate::RemovalOptions {
            method: crate::RemovalMethod::AiBalanced,
            tolerance: None,
            feather_radius: Some(0.0),
            decontaminate: Some(false),
            click_x: None,
            click_y: None,
            preview_max_dimension: Some(4096),
        },
        "u2netp",
    )
    .expect("inference should succeed");
    let png = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &result.mask_base64,
    )
    .expect("mask base64");
    let predicted = decode_gray_png(&png);
    let expected = decode_gray_png(&std::fs::read(&reference).expect("reference"));

    let metrics = crate::metrics::compute_mask_metrics(
        &predicted,
        &expected,
        result.width,
        result.height,
        crate::metrics::MaskMetricsOptions::default(),
    );
    assert!(
        metrics.iou >= 0.98,
        "native u2netp diverged from the rembg reference on synth-hair: {metrics:?}"
    );
    assert!(metrics.mae <= 0.02, "mask MAE too high: {metrics:?}");
}

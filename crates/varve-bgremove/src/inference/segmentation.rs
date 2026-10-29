//! Segmentation removal pipeline: model geometry spec, letterbox preprocessing,
//! and mask post-processing.

use super::prelude::*;
use super::runtime::InferenceSession;
use super::session::{checkout_cpu_session, checkout_session, execution_provider_fallback};

// ── Model spec ────────────────────────────────────────────────────────

pub(super) type ModelSpec = (u32, [f32; 3], [f32; 3], [u8; 3], bool);

#[derive(Clone, Copy)]
pub(super) struct LetterboxTransform {
    pub(super) offset_x: f32,
    pub(super) offset_y: f32,
    pub(super) scale: f32,
}

pub(super) fn model_spec(model_id: &str) -> ModelSpec {
    let u2net = matches!(model_id, "u2netp" | "u2netp-int8");
    if model_id == "isnet-general-use" {
        (1024, [0.5; 3], [1.0; 3], [128; 3], false)
    } else {
        (
            if u2net { 320 } else { 1024 },
            [0.485, 0.456, 0.406],
            [0.229, 0.224, 0.225],
            [124, 116, 104],
            !u2net,
        )
    }
}

// ── Public API ────────────────────────────────────────────────────────

/// Run AI background removal on an image using the specified model.
pub fn remove_ai(
    img: &DynamicImage,
    opts: &RemovalOptions,
    model_id: &str,
) -> Result<RemovalResult, String> {
    remove_ai_cancellable(img, opts, model_id, &InferenceCancellationToken::default())
}

/// Cancellable variant of [`remove_ai`]. A cancellation that arrives during
/// ONNX execution suppresses the result; the checked-out session is still
/// returned safely to the pool.
pub fn remove_ai_cancellable(
    img: &DynamicImage,
    opts: &RemovalOptions,
    model_id: &str,
    cancellation: &InferenceCancellationToken,
) -> Result<RemovalResult, String> {
    let start = std::time::Instant::now();
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    let model_path = model::model_path(model_id);
    if !model::is_model_downloaded(model_id) {
        return Err(format!(
            "Model '{}' is not installed completely at {}. Download via Settings or export from webview.",
            model_id,
            model_path.display()
        ));
    }

    let session = checkout_session(&model_path, cancellation)?;

    let (orig_w, orig_h) = img.dimensions();
    let preview_max = opts
        .preview_max_dimension
        .unwrap_or(DEFAULT_PREVIEW_MAX_DIMENSION);

    let source = if orig_w > preview_max || orig_h > preview_max {
        let scale = preview_max as f32 / orig_w.max(orig_h) as f32;
        let tw = ((orig_w as f32 * scale).round() as u32).max(1);
        let th = ((orig_h as f32 * scale).round() as u32).max(1);
        img.resize_exact(tw, th, image::imageops::FilterType::Triangle)
    } else {
        img.clone()
    };

    let (source_w, source_h) = source.dimensions();
    let (source_mask, confidence, execution_provider) = if model_id == "modnet-portrait" {
        let input = crate::modnet::preprocess(&source)?;
        if cancellation.is_cancelled() {
            return Err("Inference cancelled".to_owned());
        }
        let (output, provider) = execution_provider_fallback(
            &model_path,
            cancellation,
            session,
            |session| session.run_nd(&input.data, &input.shape.0),
            checkout_cpu_session,
        )?;
        let mask = crate::modnet::decode(output, source_w, source_h)?;
        let confidence = mask_confidence(&mask);
        (mask, confidence, provider)
    } else {
        infer_segmentation_mask(&source, model_id, &model_path, cancellation, session)?
    };
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }
    let mut resized_mask = resize_mask(&source_mask, source_w, source_h, orig_w, orig_h);

    if opts.decontaminate.unwrap_or(false) {
        resized_mask = heuristic::apply_decontaminate(&resized_mask, orig_w, orig_h);
    }

    let final_mask = if opts.feather_radius.unwrap_or(0.0) > 0.0 {
        heuristic::apply_feather(
            &resized_mask,
            orig_w,
            orig_h,
            opts.feather_radius.unwrap_or(0.0),
        )
    } else {
        resized_mask
    };

    let method = match model_id {
        "birefnet-general" | "birefnet-general-lite" => "ai-quality",
        "u2netp" | "u2netp-int8" | "isnet-general-use" => "ai-balanced",
        "modnet-portrait" => "portrait",
        _ => model_id,
    };
    let mask_base64 = mask_to_base64(&final_mask, orig_w, orig_h)?;
    Ok(RemovalResult {
        mask_base64,
        confidence,
        method: method.to_string(),
        processing_time_ms: start.elapsed().as_millis() as u64,
        width: orig_w,
        height: orig_h,
        execution_provider,
    })
}

fn infer_segmentation_mask(
    source: &DynamicImage,
    model_id: &str,
    model_path: &Path,
    cancellation: &InferenceCancellationToken,
    session: SessionLease<Box<dyn InferenceSession>>,
) -> Result<(Vec<u8>, f32, String), String> {
    let (source_w, source_h) = source.dimensions();
    let (input_size, mean, std, padding, apply_sigmoid) = model_spec(model_id);
    let scale = (input_size as f32 / source_w as f32).min(input_size as f32 / source_h as f32);
    let content_w = ((source_w as f32 * scale).round() as u32).max(1);
    let content_h = ((source_h as f32 * scale).round() as u32).max(1);
    let offset_x = (input_size - content_w) / 2;
    let offset_y = (input_size - content_h) / 2;
    let content = source.resize_exact(content_w, content_h, image::imageops::FilterType::Triangle);
    let mut letterboxed = ImageBuffer::from_pixel(
        input_size,
        input_size,
        Rgba([padding[0], padding[1], padding[2], 255]),
    );
    image::imageops::overlay(
        &mut letterboxed,
        &content.to_rgba8(),
        i64::from(offset_x),
        i64::from(offset_y),
    );
    let rgba = letterboxed;
    let pixels = rgba.into_raw();

    let n = (input_size * input_size) as usize;
    let mut tensor_data = Vec::with_capacity(n * 3);
    for c in 0..3 {
        for y in 0..input_size {
            for x in 0..input_size {
                let i = ((y * input_size + x) * 4 + c) as usize;
                let normalized = pixels[i] as f32 / 255.0;
                tensor_data.push((normalized - mean[c as usize]) / std[c as usize]);
            }
        }
    }

    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }
    let (output_data, execution_provider) = execution_provider_fallback(
        model_path,
        cancellation,
        session,
        |session| session.run(&tensor_data, input_size),
        checkout_cpu_session,
    )?;
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    let mask_size = output_data.len();
    let mask_dim = (mask_size as f64).sqrt() as u32;
    let mask = normalize_segmentation_output(&output_data, apply_sigmoid);
    let confidence = mask_confidence(&mask);

    let source_mask = reconstruct_letterbox_mask(
        &mask,
        mask_dim,
        mask_dim,
        source_w,
        source_h,
        LetterboxTransform {
            offset_x: offset_x as f32 * mask_dim as f32 / input_size as f32,
            offset_y: offset_y as f32 * mask_dim as f32 / input_size as f32,
            scale: scale * mask_dim as f32 / input_size as f32,
        },
    );
    Ok((source_mask, confidence, execution_provider))
}

fn mask_confidence(mask: &[u8]) -> f32 {
    if mask.is_empty() {
        return 0.0;
    }
    let total: f32 = mask
        .iter()
        .map(|v| (f32::from(*v) / 255.0 - 0.5).abs())
        .sum();
    (total * 2.0 / mask.len() as f32).min(1.0)
}

/// Default preview downscale cap (matches TS `DEFAULT_PREVIEW_MAX_DIMENSION`).
pub(super) const DEFAULT_PREVIEW_MAX_DIMENSION: u32 = 2048;

pub(super) fn reconstruct_letterbox_mask(
    mask: &[u8],
    model_w: u32,
    model_h: u32,
    source_w: u32,
    source_h: u32,
    transform: LetterboxTransform,
) -> Vec<u8> {
    let mut result = vec![0; (source_w * source_h) as usize];
    for y in 0..source_h {
        for x in 0..source_w {
            let mx = transform.offset_x + (x as f32 + 0.5) * transform.scale - 0.5;
            let my = transform.offset_y + (y as f32 + 0.5) * transform.scale - 0.5;
            let x0 = mx.floor().clamp(0.0, (model_w - 1) as f32) as u32;
            let y0 = my.floor().clamp(0.0, (model_h - 1) as f32) as u32;
            let x1 = (x0 + 1).min(model_w - 1);
            let y1 = (y0 + 1).min(model_h - 1);
            let wx = (mx - x0 as f32).clamp(0.0, 1.0);
            let wy = (my - y0 as f32).clamp(0.0, 1.0);
            let top = mask[(y0 * model_w + x0) as usize] as f32 * (1.0 - wx)
                + mask[(y0 * model_w + x1) as usize] as f32 * wx;
            let bottom = mask[(y1 * model_w + x0) as usize] as f32 * (1.0 - wx)
                + mask[(y1 * model_w + x1) as usize] as f32 * wx;
            result[(y * source_w + x) as usize] = (top * (1.0 - wy) + bottom * wy).round() as u8;
        }
    }
    result
}

/// Convert raw model output to a soft mask byte per pixel, following the
/// rembg reference semantics for the pinned checkpoints:
///
/// 1. apply sigmoid where the graph does not bake it (BiRefNet exports);
/// 2. clamp the result to [0, 1] — the rembg `post_process` does
///    `np.clip(mat, 0, 1)`, it does not min-max stretch the map.
///
/// A min-max stretch is input-dependent: it inflates semi-transparent edge
/// values and amplifies noise in near-flat regions, diverging from the
/// reference soft alpha (measured up to ~0.065 MAE on the benchmark corpus).
/// It is monotone, so thresholded binary metrics are unaffected by the
/// change, but soft edge alpha now matches the reference.
pub(super) fn normalize_segmentation_output(data: &[f32], apply_sigmoid: bool) -> Vec<u8> {
    data.iter()
        .map(|value| {
            let probability = if apply_sigmoid {
                1.0 / (1.0 + (-value).exp())
            } else {
                *value
            };
            ((probability.clamp(0.0, 1.0)) * 255.0).round() as u8
        })
        .collect()
}

pub(super) fn resize_mask(mask: &[u8], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<u8> {
    if src_w == dst_w && src_h == dst_h {
        return mask.to_vec();
    }

    let mut result = vec![0u8; (dst_w * dst_h) as usize];
    for dy in 0..dst_h {
        let sy = (((dy as f32 + 0.5) * src_h as f32 / dst_h as f32) - 0.5)
            .clamp(0.0, (src_h - 1) as f32);
        let y0 = sy.floor() as u32;
        let y1 = (y0 + 1).min(src_h - 1);
        let wy = sy - y0 as f32;
        for dx in 0..dst_w {
            let sx = (((dx as f32 + 0.5) * src_w as f32 / dst_w as f32) - 0.5)
                .clamp(0.0, (src_w - 1) as f32);
            let x0 = sx.floor() as u32;
            let x1 = (x0 + 1).min(src_w - 1);
            let wx = sx - x0 as f32;
            let top = mask[(y0 * src_w + x0) as usize] as f32 * (1.0 - wx)
                + mask[(y0 * src_w + x1) as usize] as f32 * wx;
            let bottom = mask[(y1 * src_w + x0) as usize] as f32 * (1.0 - wx)
                + mask[(y1 * src_w + x1) as usize] as f32 * wx;
            result[(dy * dst_w + dx) as usize] = (top * (1.0 - wy) + bottom * wy).round() as u8;
        }
    }
    result
}

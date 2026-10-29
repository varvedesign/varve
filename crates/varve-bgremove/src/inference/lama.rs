//! LaMa inpainting pipeline (mask-guided content fill).

use super::prelude::*;
use super::segmentation::DEFAULT_PREVIEW_MAX_DIMENSION;
use super::session::{checkout_cpu_session, checkout_session, execution_provider_fallback};

// ── LaMa Inpainting ───────────────────────────────────────────────────
// LaMa (Large Mask Inpainting) is a mask-guided inpainting model from
// Samsung AI / saic-mdal. ONNX export: Carve/LaMa-ONNX (lama_fp32.onnx).
//
// Inputs:
//   "image" — [1,3,512,512] float32, pixel values in [0,1] (no mean/std)
//   "mask"  — [1,1,512,512] float32, 1.0 = inpaint, 0.0 = keep
// Output: [1,3,512,512] float32, values already scaled to [0,255]
//   (the ONNX export bakes post-processing into the graph)

/// Request to run LaMa inpainting natively.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LamaInpaintRequest {
    /// RGBA pixel data of the source image.
    pub image_rgba: Vec<u8>,
    pub image_w: u32,
    pub image_h: u32,
    /// Mask: 0 = keep, 255 = fill (inpaint).
    pub mask: Vec<u8>,
    pub mask_w: u32,
    pub mask_h: u32,
    /// Downscale the larger dimension before running inference; the output
    /// is always returned at the original resolution.
    pub preview_max_dimension: Option<u32>,
}

/// Result of a LaMa inpainting operation.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LamaInpaintResult {
    /// Base64-encoded PNG of the inpainted image.
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
    pub model_id: String,
    pub execution_backend: String,
    pub processing_time_ms: u64,
    pub warnings: Vec<String>,
}

const LAMA_INPUT_SIZE: u32 = 512;

/// Run LaMa inpainting with default (non-cancellable) token.
pub fn lama_inpaint(request: LamaInpaintRequest) -> Result<LamaInpaintResult, String> {
    lama_inpaint_cancellable(request, &InferenceCancellationToken::default())
}

/// Cancellable LaMa inpainting.
pub fn lama_inpaint_cancellable(
    request: LamaInpaintRequest,
    cancellation: &InferenceCancellationToken,
) -> Result<LamaInpaintResult, String> {
    let start = std::time::Instant::now();
    let model_id = "lama-inpainting";
    let mut warnings = Vec::new();

    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    // ── Model path ─────────────────────────────────────────────────────
    let model_path = model::model_path(model_id);
    if !model::is_model_downloaded(model_id) {
        return Err(format!(
            "LaMa model is not installed completely at {}. Download in Settings and try again.",
            model_path.display()
        ));
    }

    // ── Session ────────────────────────────────────────────────────────
    let session = checkout_session(&model_path, cancellation)?;

    // ── Input validation ───────────────────────────────────────────────
    let input_names = session.input_names();
    let has_image = input_names.iter().any(|n| n == "image");
    let has_mask = input_names.iter().any(|n| n == "mask");
    if !has_image || !has_mask || input_names.len() != 2 {
        return Err(format!(
            "LaMa model: expected inputs ['image', 'mask'], got {input_names:?}"
        ));
    }

    // ── Determine working dimensions ───────────────────────────────────
    let orig_w = request.image_w;
    let orig_h = request.image_h;
    if orig_w == 0 || orig_h == 0 {
        return Err("LaMa: source image has zero dimensions".to_owned());
    }

    let max_dim = request
        .preview_max_dimension
        .unwrap_or(DEFAULT_PREVIEW_MAX_DIMENSION);

    // Downscale if over preview limit
    let mut work_w = orig_w;
    let mut work_h = orig_h;
    if orig_w > max_dim || orig_h > max_dim {
        let scale = max_dim as f32 / orig_w.max(orig_h) as f32;
        work_w = (orig_w as f32 * scale).round() as u32;
        work_h = (orig_h as f32 * scale).round() as u32;
    }
    work_w = work_w.max(1);
    work_h = work_h.max(1);

    if work_w != orig_w || work_h != orig_h {
        warnings.push(format!(
            "Source downscaled from {}×{} to {}×{} for inference",
            orig_w, orig_h, work_w, work_h
        ));
    }

    // ── Build letterboxed image (RGBA → RGB, resize, pad to 512²) ──────
    let source_rgba =
        ImageBuffer::<Rgba<u8>, _>::from_raw(orig_w, orig_h, request.image_rgba.clone())
            .ok_or("LaMa: failed to create source image buffer")?;

    // Resize to work dimensions
    let work_img = if work_w != orig_w || work_h != orig_h {
        image::imageops::resize(
            &source_rgba,
            work_w,
            work_h,
            image::imageops::FilterType::Triangle,
        )
    } else {
        source_rgba
    };

    // Letterbox to 512×512 (pad with zeros since mean=[0,0,0])
    let scale =
        (LAMA_INPUT_SIZE as f32 / work_w as f32).min(LAMA_INPUT_SIZE as f32 / work_h as f32);
    let content_w = ((work_w as f32 * scale).round() as u32).max(1);
    let content_h = ((work_h as f32 * scale).round() as u32).max(1);
    let offset_x = (LAMA_INPUT_SIZE - content_w) / 2;
    let offset_y = (LAMA_INPUT_SIZE - content_h) / 2;

    let content = image::imageops::resize(
        &work_img,
        content_w,
        content_h,
        image::imageops::FilterType::Triangle,
    )
    .into_raw();

    let mut letterboxed_pixels = vec![0u8; (LAMA_INPUT_SIZE * LAMA_INPUT_SIZE * 4) as usize];
    for y in 0..content_h {
        for x in 0..content_w {
            let dst_idx = ((offset_y + y) * LAMA_INPUT_SIZE + (offset_x + x)) as usize * 4;
            let src_idx = (y * content_w + x) as usize * 4;
            letterboxed_pixels[dst_idx..dst_idx + 4]
                .copy_from_slice(&content[src_idx..src_idx + 4]);
        }
    }

    // ── Pack image as CHW float32 [1,3,512,512], pixel/255, no mean/std ──
    let n = (LAMA_INPUT_SIZE * LAMA_INPUT_SIZE) as usize;
    let mut image_tensor = Vec::with_capacity(n * 3);
    for c in 0..3 {
        for pixel in letterboxed_pixels.chunks_exact(4) {
            image_tensor.push(pixel[c as usize] as f32 / 255.0);
        }
    }

    // ── Build letterboxed mask (single channel) ────────────────────────
    // Resize mask to work dimensions if needed
    let mask_work = if request.mask_w != work_w || request.mask_h != work_h {
        let mask_img = image::GrayImage::from_raw(request.mask_w, request.mask_h, request.mask)
            .ok_or("LaMa: invalid mask dimensions")?;
        image::imageops::resize(
            &mask_img,
            work_w,
            work_h,
            image::imageops::FilterType::Nearest,
        )
        .into_raw()
    } else {
        request.mask
    };

    // Letterbox mask
    let mask_content = image::GrayImage::from_raw(work_w, work_h, mask_work)
        .ok_or("LaMa: failed to rebuild mask")?;
    let mask_resized = image::imageops::resize(
        &mask_content,
        content_w,
        content_h,
        image::imageops::FilterType::Nearest,
    )
    .into_raw();

    let mut letterboxed_mask = vec![0u8; (LAMA_INPUT_SIZE * LAMA_INPUT_SIZE) as usize];
    for y in 0..content_h {
        for x in 0..content_w {
            let dst_idx = ((offset_y + y) * LAMA_INPUT_SIZE + (offset_x + x)) as usize;
            let src_idx = (y * content_w + x) as usize;
            letterboxed_mask[dst_idx] = mask_resized[src_idx];
        }
    }

    // Pack mask as CHW float32 [1,1,512,512], 0.0=keep / 1.0=fill
    let mut mask_tensor = Vec::with_capacity((LAMA_INPUT_SIZE * LAMA_INPUT_SIZE) as usize);
    for &m in &letterboxed_mask {
        mask_tensor.push(m as f32 / 255.0);
    }

    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    // ── Run inference ─────────────────────────────────────────────────
    let dims = [
        1usize,
        3,
        LAMA_INPUT_SIZE as usize,
        LAMA_INPUT_SIZE as usize,
    ];
    let mask_dims = [
        1usize,
        1,
        LAMA_INPUT_SIZE as usize,
        LAMA_INPUT_SIZE as usize,
    ];
    let (output, execution_provider) = execution_provider_fallback(
        &model_path,
        cancellation,
        session,
        |session| {
            session.run_multi(&[
                ("image", &image_tensor, &dims[..]),
                ("mask", &mask_tensor, &mask_dims[..]),
            ])
        },
        checkout_cpu_session,
    )?;

    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    // ── Validate output ────────────────────────────────────────────────
    let out_shape = &output.shape.0;
    if out_shape.len() != 4 || out_shape[0] != 1 || out_shape[1] != 3 {
        return Err(format!(
            "LaMa: unexpected output shape {out_shape:?}, expected [1,3,512,512]"
        ));
    }
    let out_h = out_shape[2] as u32;
    let out_w = out_shape[3] as u32;
    let out_data = output.data;
    let out_pixel_count = (out_w * out_h) as usize;
    if out_h != LAMA_INPUT_SIZE || out_w != LAMA_INPUT_SIZE {
        return Err(format!(
            "LaMa: output dimensions {out_w}×{out_h}, expected {LAMA_INPUT_SIZE}×{LAMA_INPUT_SIZE}"
        ));
    }
    if out_data.len() != out_pixel_count * 3 {
        return Err(format!(
            "LaMa: output data length {} != expected {}",
            out_data.len(),
            out_pixel_count * 3
        ));
    }

    // ── Crop letterbox to content region ───────────────────────────────
    // The model outputs values already scaled to [0,255].
    let mut crop_rgba = Vec::with_capacity((content_w * content_h * 4) as usize);
    for y in 0..content_h {
        for x in 0..content_w {
            let sx = (offset_x + x).min(LAMA_INPUT_SIZE - 1);
            let sy = (offset_y + y).min(LAMA_INPUT_SIZE - 1);
            let src_idx = (sy * LAMA_INPUT_SIZE + sx) as usize;
            for c in 0..3 {
                let v = out_data[c * out_pixel_count + src_idx].clamp(0.0, 255.0);
                crop_rgba.push(v.round() as u8);
            }
            crop_rgba.push(255u8); // opaque alpha
        }
    }

    // ── Scale back to original dimensions ──────────────────────────────
    let crop_img = ImageBuffer::<Rgba<u8>, _>::from_raw(content_w, content_h, crop_rgba)
        .ok_or("LaMa: failed to build crop buffer")?;
    let final_rgba = if content_w != orig_w || content_h != orig_h {
        image::imageops::resize(
            &crop_img,
            orig_w,
            orig_h,
            image::imageops::FilterType::Triangle,
        )
        .into_raw()
    } else {
        crop_img.into_raw()
    };

    // ── Encode as PNG base64 ───────────────────────────────────────────
    let png_base64 = {
        use base64::Engine;
        use image::codecs::png::PngEncoder;
        use image::ExtendedColorType;
        use image::ImageEncoder;
        let mut png_bytes: Vec<u8> = Vec::new();
        let encoder = PngEncoder::new(&mut png_bytes);
        encoder
            .write_image(&final_rgba, orig_w, orig_h, ExtendedColorType::Rgba8)
            .map_err(|e| format!("LaMa PNG encode error: {e}"))?;
        base64::engine::general_purpose::STANDARD.encode(&png_bytes)
    };

    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    let elapsed = start.elapsed();
    Ok(LamaInpaintResult {
        png_base64,
        width: orig_w,
        height: orig_h,
        model_id: model_id.to_owned(),
        execution_backend: execution_provider,
        processing_time_ms: elapsed.as_millis() as u64,
        warnings,
    })
}

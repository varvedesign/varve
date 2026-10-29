//! SCUNet denoise pipeline and the dynamic-shape image-model specs it uses.

use super::prelude::*;
use super::session::{checkout_cpu_session, checkout_session, execution_provider_fallback};

// ── Denoise (SCUNet) ─────────────────────────────────────────────────
// SCUNet is fully convolutional: dynamic H×W, identity normalization
// (pixel / 255), no letterboxing. Input/output both [1,3,H,W].
// Padding must be a multiple of 64: the Heliosoph ONNX conversion bakes a
// window-8 channel-attention reshape with floor-grid semantics, so any
// padded dimension not divisible by 64 crashes the graph (verified on a
// dimension sweep 2026-08-13; the manifest previously claimed 8).

const DENOISE_INPUT_DIVISIBLE: u32 = 64;

fn align_to(n: u32, to: u32) -> u32 {
    if n.is_multiple_of(to) {
        n
    } else {
        n + (to - n % to)
    }
}

/// Normalization spec for a dynamic-shape image model.
struct ImageModelSpec {
    pub mean: [f32; 3],
    pub std: [f32; 3],
    /// Input height must be a multiple of this (0 = no constraint).
    pub input_divisible: u32,
    /// Channel order of the RGBA source when packed into the tensor.
    /// `rgb` feeds (R, G, B) — SCUNet. `bgr` feeds (B, G, R) — NAFNet,
    /// which was trained on OpenCV BGR tensors; the output planes are
    /// then mapped back so the returned PNG is RGBA again.
    pub channel_order: ChannelOrder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChannelOrder {
    Rgb,
    Bgr,
}

impl ChannelOrder {
    /// Index of the source channel for tensor plane `c` (0..3).
    fn source_channel(self, c: usize) -> usize {
        match self {
            ChannelOrder::Rgb => c,
            ChannelOrder::Bgr => [2, 1, 0][c],
        }
    }

    /// Index of the tensor plane for output RGBA channel `c` (0..3).
    fn output_plane(self, c: usize) -> usize {
        match self {
            ChannelOrder::Rgb => c,
            ChannelOrder::Bgr => [2, 1, 0][c],
        }
    }
}

/// Per-model preprocessing/normalization for fully-convolutional models
/// (SCUNet, PaddleOCR detection). Segmentation uses the fixed-size
/// [`model_spec`] instead.
fn image_model_spec(model_id: &str) -> Option<ImageModelSpec> {
    match model_id {
        "scunet" => Some(ImageModelSpec {
            mean: [0.0, 0.0, 0.0],
            std: [1.0, 1.0, 1.0],
            input_divisible: DENOISE_INPUT_DIVISIBLE,
            channel_order: ChannelOrder::Rgb,
        }),
        // NAFNet checkpoints (task-validated, see tools/nafnet-export):
        // GoPro deblur width64 (int8 OpenCV export) and the SIDD denoise
        // checkpoint both expect BGR tensors divisible by 16 (the width64
        // encoder's padder_size).
        "nafnet-deblur-gopro" | "nafnet-denoise-sidd" => Some(ImageModelSpec {
            mean: [0.0, 0.0, 0.0],
            std: [1.0, 1.0, 1.0],
            input_divisible: 16,
            channel_order: ChannelOrder::Bgr,
        }),
        "paddleocr-det-v4" => Some(ImageModelSpec {
            mean: [0.485, 0.456, 0.406],
            std: [0.229, 0.224, 0.225],
            input_divisible: 32,
            channel_order: ChannelOrder::Rgb,
        }),
        "paddleocr-rec-v4" => Some(ImageModelSpec {
            mean: [0.5, 0.5, 0.5],
            std: [0.5, 0.5, 0.5],
            input_divisible: 0,
            channel_order: ChannelOrder::Rgb,
        }),
        _ => None,
    }
}

/// Output of a denoise operation: base64 PNG of the denoised image.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DenoiseResult {
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
    pub processing_time_ms: u64,
    /// Provider that successfully produced the returned image. This is the
    /// observed session provider, not a device capability or a permission.
    pub execution_provider: String,
}

/// Run SCUNet denoising on an image natively via ONNX Runtime.
///
/// The model expects [1,3,H,W] float32 in [0,1] range (pixel / 255, no
/// mean subtraction) and H/W divisible by 64. Output is [1,3,H,W] in [0,1].
/// `strength` blends between original and denoised (0 = original, 1 = full).
pub fn denoise_image(
    img: &DynamicImage,
    strength: f32,
    model_id: &str,
) -> Result<DenoiseResult, String> {
    denoise_image_cancellable(
        img,
        strength,
        model_id,
        &InferenceCancellationToken::default(),
    )
}

/// Cancellable variant of [`denoise_image`]. Cancellation is checked before
/// session loading, before inference, and before publishing the result.
pub fn denoise_image_cancellable(
    img: &DynamicImage,
    strength: f32,
    model_id: &str,
    cancellation: &InferenceCancellationToken,
) -> Result<DenoiseResult, String> {
    let start = std::time::Instant::now();
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }
    let spec = image_model_spec(model_id)
        .ok_or_else(|| format!("Denoise: no image model spec for '{model_id}'"))?;

    let model_path = model::model_path(model_id);
    if !model::is_model_downloaded(model_id) {
        return Err(format!(
            "Denoise model '{}' is not installed completely at {}.",
            model_id,
            model_path.display()
        ));
    }

    let (orig_w, orig_h) = img.dimensions();
    let proc_w = if spec.input_divisible > 0 {
        align_to(orig_w, spec.input_divisible)
    } else {
        orig_w
    };
    let proc_h = if spec.input_divisible > 0 {
        align_to(orig_h, spec.input_divisible)
    } else {
        orig_h
    };

    let source_rgba = img.to_rgba8();
    let source = if proc_w != orig_w || proc_h != orig_h {
        DynamicImage::ImageRgba8(pad_rgba_edges(&source_rgba, proc_w, proc_h))
    } else {
        DynamicImage::ImageRgba8(source_rgba)
    };
    let rgba = source.to_rgba8();
    let pixels = rgba.into_raw();
    let pixel_count = (proc_w * proc_h) as usize;

    let mut tensor_data = Vec::with_capacity(pixel_count * 3);
    for c in 0..3 {
        for p in 0..pixel_count {
            let normalized = pixels[p * 4 + spec.channel_order.source_channel(c)] as f32 / 255.0;
            tensor_data.push((normalized - spec.mean[c]) / spec.std[c]);
        }
    }

    let session = checkout_session(&model_path, cancellation)?;
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }
    let (output, execution_provider) = execution_provider_fallback(
        &model_path,
        cancellation,
        session,
        |session| session.run_nd(&tensor_data, &[1, 3, proc_h as usize, proc_w as usize]),
        checkout_cpu_session,
    )?;
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".to_owned());
    }

    let shape = &output.shape.0;
    if shape.len() != 4 || shape[0] != 1 || shape[1] != 3 {
        return Err(format!(
            "Denoise: unexpected output shape {:?}, expected [1,3,H,W]",
            shape
        ));
    }
    let out_h = shape[2] as u32;
    let out_w = shape[3] as u32;
    let out_data = output.data;
    let out_pixel_count = (out_w * out_h) as usize;
    if out_data.len() != out_pixel_count * 3 {
        return Err(format!(
            "Denoise: output data length {} != expected {}",
            out_data.len(),
            out_pixel_count * 3
        ));
    }

    let mut out_rgba: Vec<u8> = Vec::with_capacity((out_w * out_h * 4) as usize);
    let s = strength.clamp(0.0, 1.0);
    for p in 0..out_pixel_count {
        for c in 0..3 {
            let plane = spec.channel_order.output_plane(c);
            let model_val = out_data[plane * out_pixel_count + p].clamp(0.0, 1.0);
            let orig_val = pixels[p * 4 + c] as f32 / 255.0;
            let blended = orig_val * (1.0 - s) + model_val * s;
            out_rgba.push((blended * 255.0).round().clamp(0.0, 255.0) as u8);
        }
        out_rgba.push(pixels[p * 4 + 3]); // preserve alpha
    }

    let final_rgba = if out_w != orig_w || out_h != orig_h {
        if out_w < orig_w || out_h < orig_h {
            return Err(format!(
                "Denoise: output dimensions {out_w}×{out_h} are smaller than source {orig_w}×{orig_h}"
            ));
        }
        let tmp = ImageBuffer::<image::Rgba<u8>, _>::from_raw(out_w, out_h, out_rgba)
            .ok_or("Failed to build output image buffer")?;
        image::imageops::crop_imm(&tmp, 0, 0, orig_w, orig_h)
            .to_image()
            .into_raw()
    } else {
        out_rgba
    };

    let png_base64 = {
        use base64::Engine;
        use image::codecs::png::PngEncoder;
        use image::ExtendedColorType;
        use image::ImageEncoder;
        let mut png_bytes: Vec<u8> = Vec::new();
        let encoder = PngEncoder::new(&mut png_bytes);
        encoder
            .write_image(&final_rgba, orig_w, orig_h, ExtendedColorType::Rgba8)
            .map_err(|e| format!("Denoise PNG encode error: {e}"))?;
        base64::engine::general_purpose::STANDARD.encode(&png_bytes)
    };

    let elapsed = start.elapsed();
    Ok(DenoiseResult {
        png_base64,
        width: orig_w,
        height: orig_h,
        processing_time_ms: elapsed.as_millis() as u64,
        execution_provider,
    })
}

/// Match the browser worker's graph-safe preprocessing: repeat the nearest
/// edge pixel into the padded region instead of resampling the source. This
/// keeps fine lines and alpha edges stable when the model requires dimensions
/// divisible by 64.
pub(super) fn pad_rgba_edges(
    image: &RgbaImage,
    target_width: u32,
    target_height: u32,
) -> RgbaImage {
    let mut padded = RgbaImage::new(target_width, target_height);
    for y in 0..target_height {
        let source_y = y.min(image.height().saturating_sub(1));
        for x in 0..target_width {
            let source_x = x.min(image.width().saturating_sub(1));
            padded.put_pixel(x, y, *image.get_pixel(source_x, source_y));
        }
    }
    padded
}

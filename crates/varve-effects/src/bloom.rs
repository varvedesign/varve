//! Optical bloom / high-key diffusion kernel — faithful port of
//! `packages/engine/src/liveEffects/bloom.ts`.
//!
//! Pipeline: threshold+soft-knee on linearized luma → bright-pass extraction →
//! box-downsample pyramid → linear-light Gaussian blur per level → bilinear
//! upsample + additive combine → tint → optional anamorphic streak pass.
//! Blur and brightness math run in linear light; final compositing in gamma
//! space, matching the TS kernel exactly.

use crate::blur::gaussian_blur_linear_light_with;
use crate::parallel::{for_each_row_band, Execution};
use crate::prng::srgb_to_linear01;
use crate::quality::{downsample_box_with, quality_resolution_factor, upsample_bilinear_with};
use crate::{clamp01, clamp_byte, js_round, CoordSpace, EffectQuality, Params};

fn srgb_back(linear: f64) -> f64 {
    let v = linear.clamp(0.0, 1.0);
    let srgb = if v <= 0.0031308 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    };
    srgb * 255.0
}

/// Directional smear (streak) in linear light along an angle — port of
/// `streakSmear` in bloom.ts. Mutates `data` in place.
#[allow(clippy::too_many_arguments)]
fn streak_smear(
    data: &mut [u8],
    w: u32,
    h: u32,
    angle_deg: f64,
    length_px: f64,
    intensity: f64,
    aspect: f64,
    lin_lut: &[f64; 256],
    exec: Execution,
) {
    if length_px < 1.0 {
        return;
    }
    let angle = (angle_deg * std::f64::consts::PI) / 180.0;
    let dx = angle.cos();
    let dy = angle.sin();
    let n = (w * h) as usize;
    let mut linear = vec![0.0f64; n * 3];
    for i in 0..n {
        let o = i * 4;
        linear[i * 3] = lin_lut[data[o] as usize];
        linear[i * 3 + 1] = lin_lut[data[o + 1] as usize];
        linear[i * 3 + 2] = lin_lut[data[o + 2] as usize];
    }
    let mut out = vec![0.0f64; n * 3];
    let steps = js_round(length_px / 3.0).clamp(3.0, 32.0) as i64;
    let step_px = length_px / steps as f64;
    let rgb_row = (w * 3) as usize;
    for_each_row_band(&mut out, rgb_row, exec, |first_row, band| {
        for (ry, row) in band.chunks_mut(rgb_row).enumerate() {
            let y = (first_row + ry) as u32;
            for x in 0..w {
                let mut ar = 0.0;
                let mut ag = 0.0;
                let mut ab = 0.0;
                let mut cnt = 0i64;
                for s in -steps..=steps {
                    let sx = x as f64 + dx * s as f64 * step_px;
                    let sy = y as f64 + dy * s as f64 * step_px;
                    let xi = js_round(sx) as i64;
                    let yi = js_round(sy) as i64;
                    if xi < 0 || xi >= w as i64 || yi < 0 || yi >= h as i64 {
                        continue;
                    }
                    let o = ((yi as u32 * w + xi as u32) * 3) as usize;
                    ar += linear[o];
                    ag += linear[o + 1];
                    ab += linear[o + 2];
                    cnt += 1;
                }
                if cnt == 0 {
                    continue;
                }
                let o = (x * 3) as usize;
                row[o] = ar / cnt as f64;
                row[o + 1] = ag / cnt as f64;
                row[o + 2] = ab / cnt as f64;
            }
        }
    });
    let aspect_scale = aspect.max(1.0);
    let rgba_row = (w * 4) as usize;
    for_each_row_band(data, rgba_row, exec, |first_row, band| {
        for (ry, row) in band.chunks_mut(rgba_row).enumerate() {
            let y = (first_row + ry) as u32;
            for x in 0..w {
                let o = (x * 4) as usize;
                let s = intensity * 0.5;
                let oi = (y * w + x) as usize * 3;
                let lr = out[oi];
                let lg = out[oi + 1];
                let lb = out[oi + 2];
                let mix = s / (aspect_scale * 0.5).max(1.0);
                let nr = (row[o] as f64 / 255.0) * (1.0 - mix) + lr * mix;
                row[o] = clamp_byte(srgb_back(nr));
                let ng = (row[o + 1] as f64 / 255.0) * (1.0 - mix) + lg * mix;
                row[o + 1] = clamp_byte(srgb_back(ng));
                let nb = (row[o + 2] as f64 / 255.0) * (1.0 - mix) + lb * mix;
                row[o + 2] = clamp_byte(srgb_back(nb));
            }
        }
    });
}

/// Apply bloom in place — port of `applyBloom` + `applyBloomResolved`.
pub fn apply(
    out: &mut [u8],
    w: u32,
    h: u32,
    p: &Params,
    quality: EffectQuality,
    coord: CoordSpace,
) -> Result<(), String> {
    apply_with(out, w, h, p, quality, coord, Execution::scalar())
}

/// [`apply`] with every per-pixel stage spread over `exec`'s row bands.
pub fn apply_with(
    out: &mut [u8],
    w: u32,
    h: u32,
    p: &Params,
    quality: EffectQuality,
    coord: CoordSpace,
    exec: Execution,
) -> Result<(), String> {
    let threshold = clamp01(p.f("threshold", 0.7));
    let soft_knee = clamp01(p.f("softKnee", 0.2));
    let intensity = p.f("intensity", 1.0).max(0.0);
    let diffusion = clamp01(p.f("diffusion", 0.5));
    let tint = p.rgb("tint");
    let tint_amount = clamp01(p.f("tintAmount", 0.0));
    let composite = p.s("composite", "screen");
    let streak_enabled = p.b("streakEnabled", false);
    let streak_angle = p.f("streakAngle", 0.0);
    let streak_length = p.f("streakLength", 64.0).max(0.0);
    let streak_intensity = clamp01(p.f("streakIntensity", 0.5));
    let streak_aspect = p.f("streakAspect", 2.0).max(1.0);
    let tier = match p.s("quality", "auto") {
        "interactive" => EffectQuality::Interactive,
        "export" => EffectQuality::Export,
        _ => quality,
    };
    if intensity <= 0.0 {
        return Ok(());
    }
    let scale = if coord.scale > 0.0 { coord.scale } else { 1.0 };
    if w == 0 || h == 0 {
        return Ok(());
    }

    let res_factor = quality_resolution_factor(tier);
    let radius = (p.f("radius", 24.0).max(0.0) * scale).max(0.5);
    let streak_length = streak_length * scale;

    let mut src = out.to_vec();
    let mut sw = w;
    let mut sh = h;
    let mut work: Option<Vec<u8>> = None;
    if res_factor < 1.0 {
        let (data, dw, dh) = downsample_box_with(out, w, h, 2, exec);
        work = Some(data.clone());
        sw = dw;
        sh = dh;
        src = data;
    }

    // Linearized-luma LUT (256 entries) for the threshold test.
    let mut lin_lut = [0.0f64; 256];
    for (v, slot) in lin_lut.iter_mut().enumerate() {
        *slot = srgb_to_linear01(v as f64);
    }

    // Bright pass.
    let n = (sw * sh) as usize;
    let mut bright = vec![0u8; n * 4];
    let knee = soft_knee;
    let thresh = threshold;
    let bright_row = (sw * 4) as usize;
    for_each_row_band(&mut bright, bright_row, exec, |first_row, band| {
        let base = first_row * bright_row;
        for (px, chunk) in band.chunks_mut(4).enumerate() {
            let o = base + px * 4;
            let r = src[o] as f64;
            let g = src[o + 1] as f64;
            let b = src[o + 2] as f64;
            let a = src[o + 3];
            let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            let lin = lin_lut[js_round(lum) as usize];
            let m: f64 = if knee <= 0.0 {
                if lin >= thresh {
                    1.0
                } else {
                    0.0
                }
            } else {
                let d = (lin - thresh) / knee;
                if d <= -1.0 {
                    0.0
                } else if d >= 1.0 {
                    1.0
                } else {
                    d * 0.5 + 0.5
                }
            };
            let f = m * m;
            chunk[0] = js_round(r * f) as u8;
            chunk[1] = js_round(g * f) as u8;
            chunk[2] = js_round(b * f) as u8;
            chunk[3] = a;
        }
    });

    // Pyramid: levels at 1/2^k, blurred in linear light.
    struct Level {
        data: Vec<u8>,
        width: u32,
        height: u32,
        weight: f64,
    }
    let mut levels: Vec<Level> = Vec::new();
    let level_count = if tier == EffectQuality::Export { 4 } else { 3 };
    let mut lw = sw;
    let mut lh = sh;
    let mut lsrc = bright;
    for k in 0..level_count {
        let (data, dw, dh) = downsample_box_with(&lsrc, lw, lh, 2, exec);
        lsrc = data.clone();
        lw = dw;
        lh = dh;
        let blur_radius = js_round(radius / 2f64.powi(k)).max(1.0);
        let blurred =
            gaussian_blur_linear_light_with(&data, lw, lh, blur_radius.min(32.0) as i64, exec);
        let weight = 1.0 + (level_count - k) as f64 * diffusion * 0.35;
        levels.push(Level {
            data: blurred,
            width: lw,
            height: lh,
            weight,
        });
        if lw <= 1 || lh <= 1 {
            break;
        }
    }

    // Streak pass: directional smear on the widest level.
    if streak_enabled && streak_intensity > 0.0 && !levels.is_empty() {
        let top = levels.last_mut().unwrap();
        streak_smear(
            &mut top.data,
            top.width,
            top.height,
            streak_angle,
            streak_length / 2f64.powi(level_count - 1),
            streak_intensity,
            streak_aspect,
            &lin_lut,
            exec,
        );
    }

    // Combine: upsample each level to full res and add. Every pixel's weight
    // total is the same sequence of additions (one per level, in order), so it
    // is computed once rather than stored per pixel.
    let mut glow = vec![0.0f64; n * 4];
    let mut total_weight = 0.0f64;
    let mut half = vec![0u8; n * 4];
    let glow_row = (sw * 4) as usize;
    for level in &levels {
        upsample_bilinear_with(
            &level.data,
            level.width,
            level.height,
            &mut half,
            sw,
            sh,
            exec,
        );
        let lwgt = level.weight;
        for_each_row_band(&mut glow, glow_row, exec, |first_row, band| {
            let base = first_row * glow_row;
            for (px, chunk) in band.chunks_mut(4).enumerate() {
                let o = base + px * 4;
                chunk[0] += half[o] as f64 * lwgt;
                chunk[1] += half[o + 1] as f64 * lwgt;
                chunk[2] += half[o + 2] as f64 * lwgt;
            }
        });
        total_weight += lwgt;
    }
    let weight_divisor = if total_weight == 0.0 {
        1.0
    } else {
        total_weight
    };

    // Composite glow over the source (with optional tint).
    let tr = tint.map_or(255.0, |t| t[0]);
    let tg = tint.map_or(255.0, |t| t[1]);
    let tb = tint.map_or(255.0, |t| t[2]);
    let tint_mix = if tint.is_some() && tint_amount > 0.0 {
        tint_amount
    } else {
        0.0
    };
    for_each_row_band(&mut src, glow_row, exec, |first_row, band| {
        let base = first_row * glow_row;
        for (px, chunk) in band.chunks_mut(4).enumerate() {
            let o = base + px * 4;
            let mut gr = glow[o] / weight_divisor;
            let mut gg = glow[o + 1] / weight_divisor;
            let mut gb = glow[o + 2] / weight_divisor;
            if tint_mix > 0.0 {
                gr = gr + (gr * (tr / 255.0) - gr) * tint_mix;
                gg = gg + (gg * (tg / 255.0) - gg) * tint_mix;
                gb = gb + (gb * (tb / 255.0) - gb) * tint_mix;
            }
            if composite == "add" {
                chunk[0] = clamp_byte(chunk[0] as f64 + gr * intensity);
                chunk[1] = clamp_byte(chunk[1] as f64 + gg * intensity);
                chunk[2] = clamp_byte(chunk[2] as f64 + gb * intensity);
            } else {
                let inv_r = 255.0 - chunk[0] as f64;
                chunk[0] = clamp_byte(255.0 - (inv_r * (255.0 - gr * intensity)) / 255.0);
                chunk[1] = clamp_byte(
                    255.0 - ((255.0 - chunk[1] as f64) * (255.0 - gg * intensity)) / 255.0,
                );
                chunk[2] = clamp_byte(
                    255.0 - ((255.0 - chunk[2] as f64) * (255.0 - gb * intensity)) / 255.0,
                );
            }
        }
    });

    // Upscale interactive-tier result back to full resolution, or write the
    // composed result back to the source buffer at full resolution.
    if work.is_some() && (sw != w || sh != h) {
        let mut restored = vec![0u8; (w * h * 4) as usize];
        upsample_bilinear_with(&src, sw, sh, &mut restored, w, h, exec);
        out.copy_from_slice(&restored);
    } else {
        out.copy_from_slice(&src);
    }
    Ok(())
}

//! CPU cost probe for the live-effects kernels.
//!
//! Usage: `cargo run --release -p varve-effects --example effect_cost [size]`
//!
//! Reports wall-clock time per effect on a deterministic synthetic raster, once
//! on the single-threaded scalar path and once under the bounded row-band
//! policy `apply_effect` uses, and checks the two outputs are byte-identical.
//! The native GPU backend has this as its measured baseline to beat. Set
//! `VARVE_EFFECT_THREADS=1` to see what a one-thread policy reports.

use std::time::Instant;

use varve_effects::parallel::Execution;
use varve_effects::{apply_effect_with, EffectKind, EffectQuality, EffectRequest};

fn synthetic_rgba(width: u32, height: u32) -> Vec<u8> {
    let mut out = vec![0u8; (width as usize) * (height as usize) * 4];
    for y in 0..height {
        for x in 0..width {
            let i = ((y as usize) * (width as usize) + x as usize) * 4;
            let fx = x as f32 / width as f32;
            let fy = y as f32 / height as f32;
            let ring = ((fx * 12.0).sin() * (fy * 9.0).cos() * 0.5 + 0.5) * 255.0;
            out[i] = (fx * 255.0) as u8;
            out[i + 1] = (fy * 255.0) as u8;
            out[i + 2] = ring as u8;
            out[i + 3] = 255;
        }
    }
    out
}

fn main() {
    let size: u32 = std::env::args()
        .nth(1)
        .and_then(|v| v.parse().ok())
        .unwrap_or(2048);
    let (width, height) = (size, size);
    let input = synthetic_rgba(width, height);

    let kinds = [
        EffectKind::Dither,
        EffectKind::PaletteSnap,
        EffectKind::Bloom,
        EffectKind::RgbSplit,
        EffectKind::Crt,
        EffectKind::Vhs,
        EffectKind::LightShafts,
        EffectKind::LensFlare,
        EffectKind::LightLeak,
        EffectKind::Caustics,
    ];

    let bounded = Execution::bounded();
    for quality in [EffectQuality::Interactive, EffectQuality::Export] {
        println!(
            "varve-effects CPU cost — {width}x{height} RGBA, quality={quality:?}, bounded policy = {} thread(s)",
            bounded.threads()
        );
        for kind in kinds {
            let request = EffectRequest {
                effect: kind,
                width,
                height,
                quality,
                coord_space: None,
                params: serde_json::json!({}),
            };
            let start = Instant::now();
            let scalar = apply_effect_with(&request, &input, Execution::scalar());
            let scalar_ms = start.elapsed().as_secs_f64() * 1000.0;
            let start = Instant::now();
            let parallel = apply_effect_with(&request, &input, bounded);
            let parallel_ms = start.elapsed().as_secs_f64() * 1000.0;
            match (scalar, parallel) {
                (Ok(a), Ok(b)) => println!(
                    "{kind:?}: scalar {scalar_ms:.1} ms, bounded {parallel_ms:.1} ms ({:.2}x), identical: {}",
                    scalar_ms / parallel_ms,
                    a == b
                ),
                (Err(err), _) | (_, Err(err)) => println!("{kind:?}: error: {err}"),
            }
        }
    }
}

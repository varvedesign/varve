//! End-to-end CPU vs native-GPU benchmark for resampling (non-AI upscale).
//!
//! Usage: `cargo run --release -p varve-accel --example gpu_resample_bench`
//!
//! The GPU number includes upload, dispatch, synchronization, and readback.

use std::time::Instant;

use varve_accel::effects::{GpuEffectEngine, GpuResampleFilter};
use varve_upscale::{cpu_upscale, tiled_upscale, UpscaleFilter};

fn synthetic(width: u32, height: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; (width as usize) * (height as usize) * 4];
    for y in 0..height {
        for x in 0..width {
            let i = ((y as usize) * (width as usize) + x as usize) * 4;
            rgba[i] = ((x * 7 + y * 3) % 256) as u8;
            rgba[i + 1] = ((x * 2 + y * 5) % 256) as u8;
            rgba[i + 2] = (((x ^ y) * 3) % 256) as u8;
            rgba[i + 3] = 255;
        }
    }
    rgba
}

fn main() {
    let engine = match GpuEffectEngine::create() {
        Ok(engine) => engine,
        Err(err) => {
            eprintln!("native GPU unavailable: {err}");
            return;
        }
    };
    println!(
        "native GPU: {} ({}, {})",
        engine.info().name,
        engine.info().backend,
        engine.info().device_type
    );
    println!(
        "{:>22}  {:>10}  {:>12}  {:>12}  {:>8}",
        "case", "filter", "cpu (ms)", "gpu (ms)", "speedup"
    );

    let cases: &[(u32, u32, u32)] = &[(1920, 1080, 2), (3000, 2000, 2)];
    for &(width, height, factor) in cases {
        let input = synthetic(width, height);
        let out_w = width * factor;
        let out_h = height * factor;
        let scale = f64::from(factor);
        for (name, cpu_filter, gpu_filter) in [
            (
                "bicubic",
                UpscaleFilter::CatmullRom,
                GpuResampleFilter::Bicubic,
            ),
            (
                "lanczos3",
                UpscaleFilter::Lanczos3,
                GpuResampleFilter::Lanczos3,
            ),
        ] {
            // Warm the pipeline.
            let _ = engine
                .resample(&input, width, height, out_w, out_h, gpu_filter)
                .expect("gpu warmup");

            let cpu_started = Instant::now();
            let cpu = if u64::from(width) * u64::from(height) > 4_000_000 {
                tiled_upscale(&input, width, height, scale, 256, 16, cpu_filter)
            } else {
                cpu_upscale(&input, width, height, scale, cpu_filter)
            }
            .expect("cpu resample");
            let cpu_ms = cpu_started.elapsed().as_secs_f64() * 1000.0;

            let mut samples = Vec::new();
            for _ in 0..3 {
                let started = Instant::now();
                let (gpu, _) = engine
                    .resample(&input, width, height, out_w, out_h, gpu_filter)
                    .expect("gpu resample");
                samples.push(started.elapsed().as_secs_f64() * 1000.0);
                if gpu.len() != cpu.len() {
                    eprintln!("size mismatch for {width}x{height} {name}");
                }
            }
            samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let gpu_ms = samples[samples.len() / 2];
            println!(
                "{:>22}  {:>10}  {:>12.2}  {:>12.2}  {:>7.1}x",
                format!("{width}x{height} -> {out_w}x{out_h}"),
                name,
                cpu_ms,
                gpu_ms,
                cpu_ms / gpu_ms.max(0.001)
            );
        }
    }
}

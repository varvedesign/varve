//! Native raster cost benchmark.
//!
//! Answers the question the architecture decision turns on: what does one
//! natively rasterized frame actually cost at realistic canvas resolution, and
//! how much of that is the readback bridge rather than the rasterization?
//!
//! Run with:
//!   cargo run --release -p varve-accel --example native_render_bench
//!
//! Optional environment:
//!   VARVE_BENCH_FRAMES (default 60)  measured frames per case
//!   VARVE_BENCH_DEVICE           preferred adapter id
//!   VARVE_BENCH_SAMPLES          comma list of forced MSAA counts
//!                                (e.g. "4,2,1"); default probes the device
//!   --emit-corpus <dir>          write the deterministic corpora as JSON so
//!                                the Canvas2D baseline replays the same IR

use std::time::Instant;

use varve_accel::render::{NativeRenderStage, lower_frame};
use varve_core::{BlendMode, EngineColor, PathPoint};
use varve_engine::{Primitive, RenderItem};

fn rgb(r: f64, g: f64, b: f64, a: f64) -> EngineColor {
    EngineColor::Rgb {
        r,
        g,
        b,
        a,
        bit_depth: None,
        profile: None,
    }
}

fn solid(primitive: Primitive) -> RenderItem {
    RenderItem {
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        fill: rgb(40.0, 120.0, 200.0, 255.0),
        primitive,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        strokes: Vec::new(),
        effects: Vec::new(),
        fills: None,
        filters: None,
    }
}

/// A deterministic, Varve-shaped document: a deterministic mix of the shape
/// families the native stage admits, laid out over the visible viewport.
///
/// The mix is deliberately not "10k rectangles": the point of the benchmark is
/// to price the real lowering and draw-call shape, including the stencil path.
fn corpus(count: usize, width: f64, height: f64, seed: u64) -> Vec<RenderItem> {
    let mut state = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        (state >> 11) as f64 / (1u64 << 53) as f64
    };

    (0..count)
        .map(|index| {
            let x = next() * width;
            let y = next() * height;
            let w = 4.0 + next() * 60.0;
            let h = 4.0 + next() * 60.0;
            let transform = [
                1.0 + next() * 0.5,
                (next() - 0.5) * 0.4,
                (next() - 0.5) * 0.4,
                1.0 + next() * 0.5,
                x,
                y,
            ];
            let primitive = match index % 6 {
                0 | 1 => Primitive::Rect {
                    x: 0.0,
                    y: 0.0,
                    w,
                    h,
                    corner_radius: Some(serde_json::json!(6)),
                },
                2 => Primitive::Ellipse {
                    cx: 0.0,
                    cy: 0.0,
                    rx: w * 0.5,
                    ry: h * 0.5,
                },
                3 => Primitive::Polygon {
                    cx: 0.0,
                    cy: 0.0,
                    radius: w * 0.5,
                    sides: 6,
                    rotation: 0.3,
                },
                4 => Primitive::Star {
                    cx: 0.0,
                    cy: 0.0,
                    inner_radius: w * 0.22,
                    outer_radius: w * 0.5,
                    points: 5,
                    rotation: 0.0,
                },
                _ => Primitive::Path {
                    points: vec![
                        PathPoint {
                            x: 0.0,
                            y: 0.0,
                            handle_in: None,
                            handle_out: Some([w * 0.3, h * 0.4]),
                            mode: None,
                        },
                        PathPoint {
                            x: w,
                            y: h * 0.2,
                            handle_in: Some([-w * 0.3, -h * 0.3]),
                            handle_out: Some([w * 0.2, h * 0.3]),
                            mode: None,
                        },
                        PathPoint {
                            x: w * 0.4,
                            y: h,
                            handle_in: Some([w * 0.2, -h * 0.4]),
                            handle_out: None,
                            mode: None,
                        },
                    ],
                    closed: true,
                    tolerance: 0.25,
                    contours: Vec::new(),
                    holes: Vec::new(),
                    fill_rule: Some("nonzero".to_string()),
                },
            };
            let mut item = solid(primitive);
            item.transform = transform;
            item
        })
        .collect()
}

struct Samples {
    values: Vec<f64>,
}

impl Samples {
    fn new() -> Self {
        Self { values: Vec::new() }
    }
    fn push(&mut self, value: f64) {
        self.values.push(value);
    }
    fn percentile(&self, p: f64) -> f64 {
        if self.values.is_empty() {
            return 0.0;
        }
        let mut sorted = self.values.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let index = ((sorted.len() as f64 - 1.0) * p).round() as usize;
        sorted[index]
    }
}

fn emit_corpus(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    for (width, height, count) in [
        (1600u32, 1000u32, 600usize),
        (1600, 1000, 10_000),
        (2560, 1600, 600),
        (2560, 1600, 10_000),
        (3200, 2000, 600),
        (3200, 2000, 10_000),
    ] {
        let items = corpus(count, width as f64 * 0.9, height as f64 * 0.9, 0x5eed);
        let name = format!("corpus-{width}x{height}-{count}.json");
        let document = serde_json::json!({
            "width": width,
            "height": height,
            "view": [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            "items": items,
        });
        let path = dir.join(name);
        std::fs::write(&path, serde_json::to_vec(&document).expect("corpus json"))?;
        println!("emitted {}", path.display());
    }
    Ok(())
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut emit_corpus_dir: Option<std::path::PathBuf> = None;
    while let Some(arg) = args.next() {
        if arg == "--emit-corpus" {
            emit_corpus_dir = args.next().map(std::path::PathBuf::from);
        }
    }
    if let Some(dir) = emit_corpus_dir {
        if let Err(error) = emit_corpus(&dir) {
            eprintln!("corpus emission failed: {error}");
            std::process::exit(2);
        }
        return;
    }

    let frames: usize = std::env::var("VARVE_BENCH_FRAMES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(60);
    let preferred = std::env::var("VARVE_BENCH_DEVICE").ok();
    let forced_samples: Vec<Option<u32>> =
        match std::env::var("VARVE_BENCH_SAMPLES").ok().as_deref() {
            Some(list) if !list.is_empty() => list
                .split(',')
                .map(|value| value.trim().parse::<u32>().ok())
                .collect(),
            _ => vec![None],
        };

    println!("Varve native raster benchmark");
    println!("  frames/case : {frames}");
    println!(
        "  host        : {} / {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    println!();

    for forced in forced_samples {
        let mut stage = match NativeRenderStage::create_with_sample_count(
            preferred.as_deref(),
            forced,
        ) {
            Ok(stage) => stage,
            Err(error) => {
                match forced {
                    Some(count) => println!(
                        "msaa {count}x: unavailable ({error}); no numbers claimed for this count"
                    ),
                    None => {
                        eprintln!("native raster stage unavailable: {error}");
                        std::process::exit(2);
                    }
                }
                continue;
            }
        };

        println!(
            "device {} backend {} msaa {}x",
            stage.device_name(),
            stage.backend(),
            stage.sample_count()
        );

        let cases: [(u32, u32, usize); 6] = [
            (1600, 1000, 600),
            (1600, 1000, 10_000),
            (2560, 1600, 600),
            (2560, 1600, 10_000),
            (3200, 2000, 600),
            (3200, 2000, 10_000),
        ];

        println!(
            "{:>10} {:>8} {:>8} {:>7} {:>9} {:>10} {:>9} {:>9} {:>9} {:>7}",
            "size",
            "items",
            "lower",
            "encode",
            "transfer",
            "straighten",
            "tot p50",
            "tot p95",
            "tot max",
            "px MB"
        );

        for (width, height, count) in cases {
            let items = corpus(count, width as f64 * 0.9, height as f64 * 0.9, 0x5eed);
            let view = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

            // Admission first: an unlowerable corpus would make the timing a
            // measurement of the refusal path.
            let plan = lower_frame(&items, view);
            if !plan.is_presentable() {
                println!(
                    "{width:>10}x{height:<6} {count:>8}  not presentable: {}",
                    plan.report.summary()
                );
                continue;
            }

            // Warm-up: first frame pays pipeline and target creation.
            let _ = stage
                .render(&items, view, width, height)
                .expect("warm-up frame");

            let mut lower = Samples::new();
            let mut encode = Samples::new();
            let mut transfer = Samples::new();
            let mut straighten = Samples::new();
            let mut total = Samples::new();

            for _ in 0..frames {
                let lower_started = Instant::now();
                let _plan = lower_frame(&items, view);
                lower.push(lower_started.elapsed().as_secs_f64() * 1000.0);

                // `render` performs the lowering used by the production call;
                // keep the standalone lowering sample outside this interval.
                let started = Instant::now();
                let frame = stage
                    .render(&items, view, width, height)
                    .expect("benchmark frame");
                encode.push(frame.encode_ms);
                transfer.push(frame.transfer_ms);
                straighten.push(frame.straighten_ms);
                total.push(started.elapsed().as_secs_f64() * 1000.0);
                debug_assert_eq!(frame.pixels.len(), (width * height * 4) as usize);
            }

            println!(
                "{:>10} {:>8} {:>8.2} {:>7.2} {:>9.2} {:>10.2} {:>9.2} {:>9.2} {:>9.2} {:>7.1}",
                format!("{width}x{height}"),
                count,
                lower.percentile(0.5),
                encode.percentile(0.5),
                transfer.percentile(0.5),
                straighten.percentile(0.5),
                total.percentile(0.5),
                total.percentile(0.95),
                total.percentile(1.0),
                (width * height * 4) as f64 / 1_048_576.0,
            );
        }

        println!();
        println!(
            "health: paused={} consecutive_failures={}",
            stage.health().paused,
            stage.health().consecutive_failures
        );
    }

    println!(
        "note: 'lower' is IR -> draw plan; 'encode' is command recording + submit; \
         'transfer' is GPU sync + padded row copy; 'straighten' is the \
         premultiplied -> straight-alpha conversion the browser canvas APIs require."
    );
}

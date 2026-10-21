//! WASM bindings for `@varve/engine` web backend.

use serde::Serialize;
use varve_bridge::parse_engine_nodes_json;
use varve_core::Point;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn build_ir_json(nodes_json: &str) -> Result<String, JsValue> {
    let scene = parse_engine_nodes_json(nodes_json).map_err(|e| JsValue::from_str(&e))?;
    let ir = varve_engine::build_render_ir(&scene);
    serde_json::to_string(&ir).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn hit_test_json(nodes_json: &str, x: f64, y: f64) -> Result<i32, JsValue> {
    let scene = parse_engine_nodes_json(nodes_json).map_err(|e| JsValue::from_str(&e))?;
    Ok(varve_core::hit_test(&scene, Point::new(x, y))
        .map(|i| i as i32)
        .unwrap_or(-1))
}

#[wasm_bindgen]
pub fn wasm_engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ── WASM live-effect kernels ────────────────────────────────────────────

/// Small, versioned capability contract consumed by the effect preview
/// worker before it sends pixels across the WASM boundary.
#[wasm_bindgen]
pub fn wasm_effects_abi_json() -> String {
    let effects: Vec<&str> = varve_effects::IMPLEMENTED_EFFECTS
        .iter()
        .map(|kind| kind.wire_name())
        .collect();
    serde_json::json!({
        "engineVersion": env!("CARGO_PKG_VERSION"),
        "kernelAbi": varve_effects::EFFECT_KERNEL_ABI_VERSION,
        "pixelFormat": "rgba8-straight-srgb",
        "maxDimension": 16_384,
        "maxPixels": 4_194_304,
        "effects": effects,
    })
    .to_string()
}

/// Apply one live effect to an owned, exact-size RGBA working buffer.
///
/// The caller's document pixels must not be passed here: wasm-bindgen takes
/// ownership of the JS bytes for the call, and the returned vector is a new
/// result buffer. The binary boundary accepts 8-bit straight-alpha sRGB only;
/// callers must convert elsewhere before claiming other precision or profiles.
#[wasm_bindgen]
pub fn wasm_apply_effect_json(request_json: &str, mut rgba: Vec<u8>) -> Result<Vec<u8>, JsValue> {
    const MAX_REQUEST_BYTES: usize = 64 * 1024;
    const MAX_DIMENSION: u32 = 16_384;
    const MAX_PIXELS: u64 = 4_194_304;

    if request_json.len() > MAX_REQUEST_BYTES {
        return Err(JsValue::from_str(
            "Effect request JSON exceeds the 64 KiB limit",
        ));
    }
    let request: varve_effects::EffectRequest = serde_json::from_str(request_json)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    if request.width > MAX_DIMENSION || request.height > MAX_DIMENSION {
        return Err(JsValue::from_str(
            "Effect dimensions exceed the 16,384-pixel axis limit",
        ));
    }
    let pixels = u64::from(request.width)
        .checked_mul(u64::from(request.height))
        .ok_or_else(|| JsValue::from_str("Effect dimensions overflow"))?;
    if pixels > MAX_PIXELS {
        return Err(JsValue::from_str(
            "Effect surface exceeds the 4,194,304-pixel limit",
        ));
    }
    varve_effects::validate_surface(request.width, request.height, rgba.len())
        .map_err(|error| JsValue::from_str(&error))?;
    varve_effects::apply_effect_in_place(&request, &mut rgba)
        .map_err(|error| JsValue::from_str(&error))?;
    Ok(rgba)
}

// ── WASM trace bindings ─────────────────────────────────────────────────

/// JSON-serializable path point for the wasm trace result.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TracePointJson {
    x: f64,
    y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    handle_in: Option<(f64, f64)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    handle_out: Option<(f64, f64)>,
}

/// JSON-serializable bounding box for the wasm trace result.
#[derive(Serialize)]
struct TraceBoundsJson {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// JSON-serializable traced path matching the TS `RasterTracePath` shape.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TracePathJson {
    points: Vec<TracePointJson>,
    holes: Option<Vec<Vec<TracePointJson>>>,
    closed: bool,
    area: f64,
    bounds: TraceBoundsJson,
    curve_fitted: bool,
}

/// JSON-serializable trace result matching the TS `RasterTraceResult` shape.
#[derive(Serialize)]
#[allow(non_snake_case)]
struct TraceResultJson {
    width: u32,
    height: u32,
    paths: Vec<TracePathJson>,
    omittedHoles: u32,
}

/// Trace raster image data to vector contours.
///
/// `pixels`: flat RGBA byte array (width × height × 4)
/// `width`, `height`: image dimensions
/// `threshold`: binarization threshold (0–255)
/// `min_pixels`: minimum contour pixel count
/// `foreground`: "dark" or "light" (default "dark")
///
/// Returns a JSON string matching the TS `RasterTraceResult` shape.
/// Parse optional JSON options and merge with explicit params.
fn parse_trace_opts(
    threshold: u8,
    min_pixels: u32,
    foreground: Option<String>,
    opts_json: Option<String>,
) -> varve_trace::TraceOptions {
    let fg = foreground
        .as_deref()
        .map_or(varve_trace::Foreground::Dark, |v| {
            if v.eq_ignore_ascii_case("light") {
                varve_trace::Foreground::Light
            } else {
                varve_trace::Foreground::Dark
            }
        });

    // Start with defaults, then overlay explicit params
    let mut opts = varve_trace::TraceOptions {
        threshold,
        min_pixels: min_pixels as usize,
        max_colors: 0,
        foreground: fg,
        ..Default::default()
    };

    // If JSON options provided, parse and overlay
    if let Some(json) = opts_json {
        if let Ok(json_opts) = serde_json::from_str::<serde_json::Value>(&json) {
            if let Some(ca) = json_opts.get("cornerAngle").and_then(|v| v.as_f64()) {
                opts.corner_angle = ca;
            }
            if let Some(me) = json_opts.get("maxError").and_then(|v| v.as_f64()) {
                opts.max_error = me.clamp(0.01, 10.0);
            }
            if let Some(st) = json_opts.get("simplifyTolerance").and_then(|v| v.as_f64()) {
                opts.simplify_tolerance = st.clamp(0.0, 10.0);
            }
        }
    }

    opts
}

#[wasm_bindgen]
pub fn trace_contours_json(
    pixels: &[u8],
    width: u32,
    height: u32,
    threshold: u8,
    min_pixels: u32,
    foreground: Option<String>,
) -> Result<String, JsValue> {
    trace_contours_json_opts(
        pixels, width, height, threshold, min_pixels, foreground, None,
    )
}

/// Extended version that accepts additional options as JSON string.
#[wasm_bindgen(js_name = trace_contours_json_opts)]
pub fn trace_contours_json_opts(
    pixels: &[u8],
    width: u32,
    height: u32,
    threshold: u8,
    min_pixels: u32,
    foreground: Option<String>,
    opts_json: Option<String>,
) -> Result<String, JsValue> {
    let expected_len = (width * height * 4) as usize;
    if pixels.len() != expected_len {
        return Err(JsValue::from_str(&format!(
            "pixels length {} does not match width*height*4 = {}",
            pixels.len(),
            expected_len
        )));
    }
    if width == 0 || height == 0 {
        return Err(JsValue::from_str("width and height must be > 0"));
    }

    let opts = parse_trace_opts(threshold, min_pixels, foreground, opts_json);

    // Use the same RGBA contour, simplification, hole pairing, and cubic-fit
    // path as desktop. The web facade remains monochrome-only, but supported
    // settings must not silently change their semantics by provider.
    let paths = varve_trace::trace_to_beziers(pixels, width, height, &opts);
    let json_paths: Vec<TracePathJson> = paths
        .into_iter()
        .map(|p| {
            let points: Vec<TracePointJson> = p
                .points
                .iter()
                .map(|point| TracePointJson {
                    x: point.x,
                    y: point.y,
                    handle_in: point.handle_in,
                    handle_out: point.handle_out,
                })
                .collect();
            let holes = (!p.holes.is_empty()).then(|| {
                p.holes
                    .iter()
                    .map(|ring| {
                        ring.iter()
                            .map(|point| TracePointJson {
                                x: point.x,
                                y: point.y,
                                handle_in: point.handle_in,
                                handle_out: point.handle_out,
                            })
                            .collect()
                    })
                    .collect()
            });
            let area = bezier_polygon_area(&p.points);
            let (min_x, min_y, max_x, max_y) = bezier_bounds(&p.points);
            TracePathJson {
                points,
                holes,
                closed: p.closed,
                area,
                bounds: TraceBoundsJson {
                    x: min_x,
                    y: min_y,
                    w: (max_x - min_x).max(0.0),
                    h: (max_y - min_y).max(0.0),
                },
                curve_fitted: true,
            }
        })
        .collect();

    let result = TraceResultJson {
        width,
        height,
        paths: json_paths,
        omittedHoles: 0,
    };

    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// WASM trace version identifier.
#[wasm_bindgen]
pub fn wasm_trace_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ── Threaded-pool bindings (threads feature only) ────────────────────────
//
// These exist only in the `varve_wasm_threads` artifact built by
// `just wasm-build-threads` with nightly + shared memory. The simd/baseline
// artifacts are single-threaded by construction; nothing here may leak into
// their ABI. The pool is initialized from a dedicated worker (never the main
// thread): `initThreadPool` blocks on atomics while workers bootstrap, which
// browsers forbid on the main thread and a design app must not pay there.

#[cfg(feature = "threads")]
#[wasm_bindgen]
pub fn init_thread_pool(num_threads: usize) -> js_sys::Promise {
    wasm_bindgen_rayon::init_thread_pool(num_threads)
}

/// Direct evidence that the pool executes Varve work on multiple workers.
/// Each Rayon task runs the real contour tracer against a deterministic
/// bitmap fixture; no-op scheduling probes can report a pool as working even
/// when useful tracing never reaches it. Returns worker IDs and result counts.
#[cfg(feature = "threads")]
#[wasm_bindgen]
pub fn threaded_worker_probe(chunks: u32) -> String {
    use rayon::prelude::*;
    use std::collections::BTreeSet;
    use varve_trace::TraceOptions;

    let chunks = chunks.max(1) as usize;
    const WIDTH: u32 = 192;
    const HEIGHT: u32 = 192;
    let mut pixels = vec![255_u8; (WIDTH * HEIGHT) as usize];
    // Thirty-six separate, jagged foreground regions create enough contour
    // work to exercise the same tracer used by the production WASM export.
    for row in 0..6_u32 {
        for col in 0..6_u32 {
            let left = 8 + col * 29;
            let top = 8 + row * 29;
            for y in top..top + 18 {
                for x in left..left + 18 {
                    if (x + y + col * row) % 7 != 0 {
                        pixels[(y * WIDTH + x) as usize] = 0;
                    }
                }
            }
        }
    }
    let options = TraceOptions {
        min_pixels: 4,
        ..TraceOptions::default()
    };
    let completed: Vec<(usize, usize)> = (0..chunks)
        .into_par_iter()
        .map(|_| {
            let paths = varve_trace::trace_contours(&pixels, WIDTH, HEIGHT, &options);
            (rayon::current_thread_index().unwrap_or(usize::MAX), paths.len())
        })
        .collect();
    let seen: BTreeSet<usize> = completed.iter().map(|(worker, _)| *worker).collect();
    serde_json::json!({
        "workersUsed": seen.into_iter().collect::<Vec<_>>(),
        "requestedChunks": chunks,
        "tracesCompleted": completed.len(),
        "pathsProduced": completed.iter().map(|(_, paths)| paths).sum::<usize>(),
    })
    .to_string()
}

/// ABI/version stamp the loader checks before scheduling work, so glue, wasm,
/// and worker scripts cannot drift apart silently.
#[cfg(feature = "threads")]
#[wasm_bindgen]
pub fn wasm_threads_abi() -> String {
    // `wasm-bindgen` exposes no runtime version accessor; the glue itself
    // carries the paired version and the loader checks the whole set.
    serde_json::json!({
        "engineVersion": env!("CARGO_PKG_VERSION"),
        "abi": 1,
    })
    .to_string()
}

fn bezier_polygon_area(points: &[varve_trace::BezierPoint]) -> f64 {
    if points.len() < 3 {
        return 0.0;
    }
    let mut sum = 0.0;
    for i in 0..points.len() {
        let j = (i + 1) % points.len();
        sum += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    sum.abs() / 2.0
}

fn bezier_bounds(points: &[varve_trace::BezierPoint]) -> (f64, f64, f64, f64) {
    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;
    for p in points {
        if p.x < min_x {
            min_x = p.x;
        }
        if p.y < min_y {
            min_y = p.y;
        }
        if p.x > max_x {
            max_x = p.x;
        }
        if p.y > max_y {
            max_y = p.y;
        }
    }
    (min_x, min_y, max_x, max_y)
}

// ── WASM media bindings ──────────────────────────────────────────────────

/// Probe animated media bytes (GIF/APNG/WebP) without decoding pixels.
/// Returns a JSON string matching the Rust `MediaProbe` shape.
#[wasm_bindgen]
pub fn media_probe(bytes: &[u8]) -> Result<String, JsValue> {
    let probe = varve_media::probe(bytes, &varve_media::DEFAULT_LIMITS)
        .map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&probe).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Decode raw source frames `[start, end]` (inclusive).
///
/// Returns a JS object: `{ frames: [{ index, x, y, width, height,
/// durationMs, blend, disposal, preComposited, rgba: Uint8Array }] }`.
#[wasm_bindgen]
pub fn media_decode_frames(bytes: &[u8], start: u32, end: u32) -> Result<JsValue, JsValue> {
    let frames = varve_media::decode_frames(bytes, start, end, &varve_media::DEFAULT_LIMITS)
        .map_err(|e| JsValue::from_str(&e))?;
    let obj = js_sys::Object::new();
    let frame_arr = js_sys::Array::new();
    for frame in frames {
        let f = js_sys::Object::new();
        js_sys::Reflect::set(
            &f,
            &JsValue::from_str("index"),
            &JsValue::from_f64(f64::from(frame.index)),
        )
        .map_err(|e| JsValue::from_str(&format!("media frame serialize failed: {e:?}")))?;
        js_sys::Reflect::set(
            &f,
            &JsValue::from_str("x"),
            &JsValue::from_f64(f64::from(frame.x)),
        )?;
        js_sys::Reflect::set(
            &f,
            &JsValue::from_str("y"),
            &JsValue::from_f64(f64::from(frame.y)),
        )?;
        js_sys::Reflect::set(
            &f,
            &JsValue::from_str("width"),
            &JsValue::from_f64(f64::from(frame.width)),
        )?;
        js_sys::Reflect::set(
            &f,
            &JsValue::from_str("height"),
            &JsValue::from_f64(f64::from(frame.height)),
        )?;
        js_sys::Reflect::set(
            &f,
            &JsValue::from_str("durationMs"),
            &JsValue::from_f64(f64::from(frame.duration_ms)),
        )?;
        js_sys::Reflect::set(
            &f,
            &JsValue::from_str("blend"),
            &JsValue::from_str(frame.blend),
        )?;
        js_sys::Reflect::set(
            &f,
            &JsValue::from_str("disposal"),
            &JsValue::from_str(frame.disposal),
        )?;
        js_sys::Reflect::set(
            &f,
            &JsValue::from_str("preComposited"),
            &JsValue::from_bool(frame.pre_composited),
        )?;
        let rgba = js_sys::Uint8Array::from(&frame.rgba[..]);
        js_sys::Reflect::set(&f, &JsValue::from_str("rgba"), &rgba)?;
        frame_arr.push(&f);
    }
    js_sys::Reflect::set(&obj, &JsValue::from_str("frames"), &frame_arr)?;
    Ok(obj.into())
}

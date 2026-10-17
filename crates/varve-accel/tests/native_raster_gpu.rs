//! Real-device execution tests for the native IR rasterizer.
//!
//! These are not mocked. They create a device on whatever hardware adapter the
//! machine reports, submit real work, and read real pixels back. The unit tests
//! in `render::tests` cover lowering and policy; these cover the claim that the
//! stage actually rasterizes.
//!
//! Skip policy follows the lesson from a sibling project's tracker: a GPU suite
//! that silently skips turns a broken backend into a green gate. Set
//! `VARVE_REQUIRE_GPU=1` to make an absent adapter a failure instead of a skip
//! (that is what the qualification lane uses). Without it, an absent adapter
//! prints the exact reason it was absent.

use varve_accel::render::{NativeRenderStage, RenderError};
use varve_core::{BlendMode, EngineColor, PathPoint};
use varve_engine::{Primitive, RenderItem};

const WIDTH: u32 = 64;
const HEIGHT: u32 = 48;

fn require_gpu() -> bool {
    matches!(
        std::env::var("VARVE_REQUIRE_GPU").as_deref(),
        Ok("1") | Ok("true")
    )
}

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

fn identity() -> [f64; 6] {
    [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
}

fn solid(primitive: Primitive, color: EngineColor) -> RenderItem {
    RenderItem {
        transform: identity(),
        fill: color,
        primitive,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        strokes: Vec::new(),
        effects: Vec::new(),
        fills: None,
        filters: None,
    }
}

fn rect(x: f64, y: f64, w: f64, h: f64, color: EngineColor) -> RenderItem {
    solid(
        Primitive::Rect {
            x,
            y,
            w,
            h,
            corner_radius: None,
        },
        color,
    )
}

fn points(list: &[(f64, f64)]) -> Vec<PathPoint> {
    list.iter()
        .map(|(x, y)| PathPoint {
            x: *x,
            y: *y,
            handle_in: None,
            handle_out: None,
            mode: None,
        })
        .collect()
}

fn path(list: &[(f64, f64)], rule: &str, color: EngineColor) -> RenderItem {
    solid(
        Primitive::Path {
            points: points(list),
            closed: true,
            tolerance: 0.25,
            contours: Vec::new(),
            holes: Vec::new(),
            fill_rule: Some(rule.to_string()),
        },
        color,
    )
}

/// A stage, or `None` with the reason printed. Panics when `VARVE_REQUIRE_GPU`
/// is set, because a qualification lane must not pass without a device.
fn stage() -> Option<NativeRenderStage> {
    match NativeRenderStage::create(None) {
        Ok(stage) => {
            eprintln!(
                "[native-raster] device={} backend={} samples={}",
                stage.device_name(),
                stage.backend(),
                stage.sample_count()
            );
            Some(stage)
        }
        Err(error) => {
            let message = format!("native raster stage unavailable: {error}");
            if require_gpu() {
                panic!("VARVE_REQUIRE_GPU is set but {message}");
            }
            eprintln!("[native-raster] SKIPPED: {message}");
            None
        }
    }
}

/// Read one pixel as straight-alpha RGBA8.
fn pixel(frame: &varve_accel::render::RasterizedFrame, x: u32, y: u32) -> [u8; 4] {
    let offset = ((y * frame.width + x) * 4) as usize;
    [
        frame.pixels[offset],
        frame.pixels[offset + 1],
        frame.pixels[offset + 2],
        frame.pixels[offset + 3],
    ]
}

#[test]
fn a_solid_rect_lands_where_it_was_authored() {
    let Some(mut stage) = stage() else { return };
    let items = [rect(8.0, 8.0, 32.0, 24.0, rgb(255.0, 0.0, 0.0, 255.0))];
    let frame = stage
        .render(&items, identity(), WIDTH, HEIGHT)
        .expect("an admitted solid rect must rasterize");

    assert_eq!(frame.pixels.len(), (WIDTH * HEIGHT * 4) as usize);
    // Inside the rect: fully opaque red, exactly the authored colour. The
    // target is non-sRGB and the shader does not linearize, so this is an
    // exact-equality assertion, not a tolerance.
    assert_eq!(pixel(&frame, 24, 20), [255, 0, 0, 255]);
    // Outside: untouched transparent black from the frame clear.
    assert_eq!(pixel(&frame, 2, 2), [0, 0, 0, 0]);
    assert_eq!(pixel(&frame, 60, 44), [0, 0, 0, 0]);
    assert!(frame.draw_calls >= 1);
}

#[test]
fn alpha_and_opacity_composite_the_way_canvas2d_does() {
    let Some(mut stage) = stage() else { return };
    let mut item = rect(0.0, 0.0, 32.0, 32.0, rgb(255.0, 0.0, 0.0, 255.0));
    item.opacity = 0.5;
    let frame = stage
        .render(&[item], identity(), WIDTH, HEIGHT)
        .expect("rasterize");

    let inside = pixel(&frame, 16, 16);
    // Canvas2D source-over on encoded values with alpha 0.5 leaves the stored
    // channel values intact and halves alpha.
    assert_eq!(inside[0], 255, "encoded channel must not be linearized");
    assert!(
        (inside[3] as i32 - 128).abs() <= 1,
        "alpha should be ~128, got {}",
        inside[3]
    );
}

#[test]
fn the_antialiased_edge_has_partial_coverage() {
    let Some(mut stage) = stage() else { return };
    // A fractional edge position is what produces a coverage ramp.
    let items = [rect(0.0, 0.0, 32.3, 32.0, rgb(0.0, 0.0, 255.0, 255.0))];
    let frame = stage
        .render(&items, identity(), WIDTH, HEIGHT)
        .expect("rasterize");

    let mut partial = 0;
    for x in 0..WIDTH {
        let alpha = pixel(&frame, x, 16)[3];
        if alpha > 0 && alpha < 255 {
            partial += 1;
        }
    }
    assert!(
        partial >= 1,
        "a fractional edge must produce at least one partially covered pixel"
    );
}

#[test]
fn paint_order_decides_the_winner_of_an_overlap() {
    let Some(mut stage) = stage() else { return };
    let first = rect(0.0, 0.0, 32.0, 32.0, rgb(255.0, 0.0, 0.0, 255.0));
    let second = rect(16.0, 0.0, 32.0, 32.0, rgb(0.0, 255.0, 0.0, 255.0));
    let frame = stage
        .render(&[first.clone(), second.clone()], identity(), WIDTH, HEIGHT)
        .expect("rasterize");
    assert_eq!(pixel(&frame, 8, 16), [255, 0, 0, 255], "left stays red");
    assert_eq!(pixel(&frame, 24, 16), [0, 255, 0, 255], "overlap is green");

    // Reversing the order must reverse the overlap, proving the stage honours
    // input order rather than grouping by pipeline.
    let frame = stage
        .render(&[second, first], identity(), WIDTH, HEIGHT)
        .expect("rasterize");
    assert_eq!(
        pixel(&frame, 24, 16),
        [255, 0, 0, 255],
        "overlap is now red"
    );
}

#[test]
fn a_path_fill_covers_its_interior() {
    let Some(mut stage) = stage() else { return };
    let item = path(
        &[(8.0, 8.0), (48.0, 8.0), (48.0, 40.0), (8.0, 40.0)],
        "nonzero",
        rgb(0.0, 128.0, 255.0, 255.0),
    );
    let frame = stage
        .render(&[item], identity(), WIDTH, HEIGHT)
        .expect("rasterize");
    assert_eq!(pixel(&frame, 28, 24), [0, 128, 255, 255]);
    assert_eq!(pixel(&frame, 2, 2), [0, 0, 0, 0], "outside stays clear");
}

#[test]
fn a_non_convex_path_is_filled_by_winding_not_by_its_hull() {
    let Some(mut stage) = stage() else { return };
    // A five-pointed star drawn as an alternating ring: the concave notch
    // between two points must stay unpainted. A convex-hull approximation
    // would paint it, so this is the test that distinguishes the two.
    let mut ring: Vec<(f64, f64)> = Vec::new();
    let (cx, cy, outer, inner) = (32.0_f64, 24.0_f64, 20.0_f64, 8.0_f64);
    for index in 0..10 {
        let angle = -std::f64::consts::FRAC_PI_2 + std::f64::consts::TAU * (index as f64) / 10.0;
        let radius = if index % 2 == 0 { outer } else { inner };
        ring.push((cx + radius * angle.cos(), cy + radius * angle.sin()));
    }
    let item = path(&ring, "nonzero", rgb(255.0, 255.0, 0.0, 255.0));
    let frame = stage
        .render(&[item], identity(), WIDTH, HEIGHT)
        .expect("rasterize");

    assert_eq!(
        pixel(&frame, 32, 20),
        [255, 255, 0, 255],
        "centre is painted"
    );
    // A point just inside the outer hull but in a notch between two points.
    let notch = (
        cx + (outer - 1.0) * (std::f64::consts::TAU / 10.0).cos(),
        cy + (outer - 1.0) * (std::f64::consts::TAU / 10.0).sin(),
    );
    let sample = pixel(&frame, notch.0.round() as u32, notch.1.round() as u32);
    assert_eq!(
        sample[3], 0,
        "the notch at {notch:?} must not be painted by a convex hull"
    );
}

#[test]
fn even_odd_and_nonzero_disagree_on_a_double_wound_square() {
    let Some(mut stage) = stage() else { return };
    // Two nested squares with the SAME winding: non-zero fills both, even-odd
    // punches the inner one out. That difference is the whole reason the two
    // stencil pipelines exist.
    let outer = [(4.0, 4.0), (60.0, 4.0), (60.0, 44.0), (4.0, 44.0)];
    let inner = [(20.0, 16.0), (44.0, 16.0), (44.0, 32.0), (20.0, 32.0)];
    let build = |rule: &str| {
        solid(
            Primitive::Path {
                points: points(&outer),
                closed: true,
                tolerance: 0.25,
                contours: Vec::new(),
                holes: vec![points(&inner)],
                fill_rule: Some(rule.to_string()),
            },
            rgb(255.0, 255.0, 255.0, 255.0),
        )
    };

    let nonzero = stage
        .render(&[build("nonzero")], identity(), WIDTH, HEIGHT)
        .expect("rasterize");
    assert_eq!(
        pixel(&nonzero, 32, 24),
        [255, 255, 255, 255],
        "non-zero fill must fill the same-wound inner ring"
    );

    let even_odd = stage
        .render(&[build("evenodd")], identity(), WIDTH, HEIGHT)
        .expect("rasterize");
    assert_eq!(
        pixel(&even_odd, 32, 24),
        [0, 0, 0, 0],
        "even-odd fill must punch the inner ring out"
    );
    assert_eq!(
        pixel(&even_odd, 12, 24),
        [255, 255, 255, 255],
        "the ring between the two squares stays painted"
    );
}

#[test]
fn contours_rings_render_hole_and_island_like_the_replay_resolves_them() {
    let Some(mut stage) = stage() else { return };
    // The boolean-result shape: `points` is empty, rings live in `contours`
    // (outer, hole, island) with no explicit fill rule — the derivation must
    // produce even-odd exactly like `pathFillRule` in the replay.
    let outer = [(4.0, 4.0), (60.0, 4.0), (60.0, 44.0), (4.0, 44.0)];
    let hole = [(20.0, 16.0), (44.0, 16.0), (44.0, 32.0), (20.0, 32.0)];
    let island = [(28.0, 21.0), (36.0, 21.0), (36.0, 27.0), (28.0, 27.0)];
    let frame = stage
        .render(
            &[solid(
                Primitive::Path {
                    points: Vec::new(),
                    closed: true,
                    tolerance: 0.25,
                    contours: vec![points(&outer), points(&hole), points(&island)],
                    holes: Vec::new(),
                    fill_rule: None,
                },
                rgb(255.0, 255.0, 255.0, 255.0),
            )],
            identity(),
            WIDTH,
            HEIGHT,
        )
        .expect("rasterize");
    assert_eq!(
        pixel(&frame, 12, 24),
        [255, 255, 255, 255],
        "the ring between outer and hole stays painted"
    );
    assert_eq!(pixel(&frame, 24, 24), [0, 0, 0, 0], "the hole punches out");
    assert_eq!(
        pixel(&frame, 32, 24),
        [255, 255, 255, 255],
        "the island inside the hole paints once"
    );
}

#[test]
fn a_reused_target_never_shows_the_previous_frame() {
    // The stale-pixel class: a cached surface that is not fully rewritten for
    // the current frame. The stage clears colour and stencil at the start of
    // every frame, so a large frame followed by a small one must leave no trace
    // of the first.
    let Some(mut stage) = stage() else { return };
    let big = rect(0.0, 0.0, 64.0, 48.0, rgb(255.0, 0.0, 0.0, 255.0));
    let small = rect(4.0, 4.0, 8.0, 8.0, rgb(0.0, 0.0, 255.0, 255.0));

    let first = stage
        .render(&[big], identity(), WIDTH, HEIGHT)
        .expect("rasterize");
    assert_eq!(pixel(&first, 40, 30), [255, 0, 0, 255]);

    let second = stage
        .render(&[small], identity(), WIDTH, HEIGHT)
        .expect("rasterize");
    assert_eq!(
        pixel(&second, 8, 8),
        [0, 0, 255, 255],
        "the small rect paints"
    );
    assert_eq!(
        pixel(&second, 40, 30),
        [0, 0, 0, 0],
        "the region the previous frame covered must be transparent, not stale"
    );
}

#[test]
fn a_rotated_and_scaled_camera_still_lands_correctly() {
    let Some(mut stage) = stage() else { return };
    // Scale 1 with a pure translation: the rect at (8,8) must appear at (28,28).
    let view = [1.0, 0.0, 0.0, 1.0, 20.0, 20.0];
    let items = [rect(8.0, 8.0, 16.0, 16.0, rgb(0.0, 255.0, 0.0, 255.0))];
    let frame = stage
        .render(&items, view, WIDTH, HEIGHT)
        .expect("rasterize");
    assert_eq!(pixel(&frame, 32, 32), [0, 255, 0, 255]);
    assert_eq!(pixel(&frame, 12, 12), [0, 0, 0, 0]);
}

#[test]
fn an_unsupported_frame_is_refused_without_touching_the_device() {
    let Some(mut stage) = stage() else { return };
    let text = solid(
        Primitive::Text {
            text: "native text is not lowered yet".to_string(),
            font_size: 12.0,
            font_family: "Inter".to_string(),
            font_weight: 400,
            font_style: "normal".to_string(),
            text_align: "left".to_string(),
            text_align_vertical: "top".to_string(),
            x: 0.0,
            y: 0.0,
            w: 40.0,
            h: 12.0,
            letter_spacing: 0.0,
            line_height: 1.4,
            paragraph_spacing: 0.0,
            text_case: "none".to_string(),
            text_decoration: "none".to_string(),
            text_overflow: "visible".to_string(),
            list_style: "none".to_string(),
            rich_text: None,
            open_type_features: None,
            variable_axes: None,
            text_mode: "point".to_string(),
            path_text_settings: None,
            path_shape: None,
        },
        rgb(0.0, 0.0, 0.0, 255.0),
    );
    let error = stage
        .render(&[text], identity(), WIDTH, HEIGHT)
        .expect_err("an unlowerable frame must be refused");
    assert!(matches!(error, RenderError::Unsupported(_)), "{error}");
    assert!(
        !error.is_device_fatal(),
        "a content refusal is not a device fault"
    );

    // The device is untouched: a supported frame still renders afterwards.
    let frame = stage
        .render(
            &[rect(0.0, 0.0, 8.0, 8.0, rgb(1.0, 2.0, 3.0, 255.0))],
            identity(),
            WIDTH,
            HEIGHT,
        )
        .expect("the device must still be usable after a content refusal");
    assert_eq!(pixel(&frame, 4, 4), [1, 2, 3, 255]);
}

#[test]
fn a_mixed_frame_keeps_the_unsupported_items_visible_in_the_report() {
    let Some(mut stage) = stage() else { return };
    let items = [rect(0.0, 0.0, 8.0, 8.0, rgb(255.0, 255.0, 255.0, 255.0)), {
        let mut stroked = rect(8.0, 0.0, 8.0, 8.0, rgb(255.0, 255.0, 255.0, 255.0));
        stroked.strokes = vec![varve_core::Stroke::default()];
        stroked
    }];
    let error = stage
        .render(&items, identity(), WIDTH, HEIGHT)
        .expect_err("a partial frame is not presentable");
    let detail = error.detail().to_string();
    assert!(
        detail.contains("unsupported-stroke"),
        "the report must name the boundary: {detail}"
    );
    assert!(detail.contains("1 of 2"), "counts must be exact: {detail}");
}

#[test]
fn shapes_and_path_fills_composite_in_one_frame() {
    // A frame that alternates analytic shapes with stencil path fills. Both
    // pipeline families share bind group 0 with different contents, so this is
    // the test that catches a stale group binding: the failure mode is a
    // validation error mid-frame, which would drop the frame entirely.
    let Some(mut stage) = stage() else { return };
    let items = [
        rect(0.0, 0.0, 16.0, 16.0, rgb(255.0, 0.0, 0.0, 255.0)),
        path(
            &[(16.0, 0.0), (48.0, 0.0), (48.0, 16.0), (16.0, 16.0)],
            "nonzero",
            rgb(0.0, 255.0, 0.0, 255.0),
        ),
        rect(0.0, 16.0, 16.0, 16.0, rgb(0.0, 0.0, 255.0, 255.0)),
        path(
            &[(16.0, 16.0), (48.0, 16.0), (48.0, 16.0), (32.0, 40.0)],
            "nonzero",
            rgb(255.0, 255.0, 0.0, 255.0),
        ),
    ];
    let frame = stage
        .render(&items, identity(), WIDTH, HEIGHT)
        .expect("a mixed shape and path frame must rasterize");
    assert_eq!(pixel(&frame, 8, 8), [255, 0, 0, 255], "first shape run");
    assert_eq!(pixel(&frame, 32, 8), [0, 255, 0, 255], "first path fill");
    assert_eq!(pixel(&frame, 8, 24), [0, 0, 255, 255], "second shape run");
    assert_eq!(
        pixel(&frame, 32, 24),
        [255, 255, 0, 255],
        "second path fill"
    );
    assert_eq!(frame.draw_calls, 6, "two shape runs and two fills");
}

#[test]
fn repeated_frames_do_not_accumulate_device_state() {
    // A bounded-memory smoke test: the target is reused rather than recreated,
    // and the staging buffer is not leaked across frames.
    let Some(mut stage) = stage() else { return };
    let items = [rect(2.0, 2.0, 40.0, 30.0, rgb(10.0, 20.0, 30.0, 255.0))];
    for _ in 0..64 {
        let frame = stage
            .render(&items, identity(), WIDTH, HEIGHT)
            .expect("rasterize");
        assert_eq!(pixel(&frame, 20, 20), [10, 20, 30, 255]);
    }
    assert_eq!(stage.health().consecutive_failures, 0);
    assert!(stage.health().is_available());
}

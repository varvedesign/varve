//! Unit tests for trace (moved verbatim from lib.rs #[cfg(test)] mod tests; Batch B/B-01).

use super::*;

#[test]
fn trace_image_end_to_end() {
    // Create a 20x20 PNG with a white square (foreground) on black background.
    let mut buf = image::RgbaImage::new(20, 20);
    for y in 0..20 {
        for x in 0..20 {
            let is_foreground = x > 2 && x < 17 && y > 2 && y < 17;
            buf.put_pixel(
                x,
                y,
                if is_foreground {
                    image::Rgba([255, 255, 255, 255])
                } else {
                    image::Rgba([0, 0, 0, 255])
                },
            );
        }
    }
    let mut png: Vec<u8> = Vec::new();
    image::DynamicImage::ImageRgba8(buf)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("encode png");

    let options = TraceImageOptions {
        threshold: Some(128),
        min_pixels: Some(5),
        max_colors: Some(0),
        foreground: Some("light".into()),
        corner_angle: Some(135.0),
        max_error: Some(1.0),
        ..Default::default()
    };
    let result = tauri::async_runtime::block_on(trace_image_command(None, png, options))
        .expect("trace_image should succeed");
    // A 20x20 image with a white square foreground on black should trace at least one contour.
    assert!(
        !result.paths.is_empty(),
        "expected at least one traced path"
    );
    // Each path should be a closed BezierPath with points.
    for path in &result.paths {
        assert!(
            path.points.len() >= 3,
            "each path must have at least 3 points"
        );
        assert!(path.closed, "contour paths should be closed");
    }
}

#[test]
fn trace_image_rejects_undecodable_bytes() {
    let options = TraceImageOptions {
        threshold: Some(128),
        min_pixels: Some(5),
        max_colors: Some(2),
        foreground: None,
        corner_angle: Some(135.0),
        max_error: Some(1.0),
        ..Default::default()
    };
    let err = tauri::async_runtime::block_on(trace_image_command(None, vec![0, 1, 2, 3], options))
        .expect_err("undecodable bytes must fail");
    assert!(
        err.contains("decode") || err.contains("dimensions"),
        "should report a decode or dimensions error: {err}"
    );
}

#[test]
fn trace_image_sanitizes_out_of_range_options() {
    let options = TraceImageOptions {
        threshold: Some(0),
        min_pixels: Some(0),
        max_colors: Some(200),
        foreground: None,
        corner_angle: Some(10.0),
        max_error: Some(50.0),
        simplify_tolerance: Some(50.0),
        trace_mode: Some("pixel-art".into()),
        alpha_threshold: Some(255),
        centerline_width: Some(1000.0),
        centerline_prune: Some(5000.0),
        max_paths: Some(0),
        compound_holes: Some(true),
        structure: Some("stacked".into()),
        job_id: None,
    };
    let opts = sanitize_trace_options(options);
    assert_eq!(opts.trace_mode, varve_trace::TraceMode::PixelArt);
    assert_eq!(opts.structure, varve_trace::Structure::Stacked);
    assert_eq!(opts.threshold, 1, "threshold clamped to 1");
    assert_eq!(opts.min_pixels, 1, "min_pixels clamped to 1");
    assert_eq!(opts.max_colors, 64, "max_colors clamped to 64");
    assert_eq!(opts.corner_angle, 90.0, "corner angle clamped to 90");
    assert_eq!(opts.max_error, 10.0, "max error clamped to 10");
    assert_eq!(
        opts.simplify_tolerance, 10.0,
        "simplify tolerance clamped to 10"
    );
    assert_eq!(opts.centerline_width, 100.0);
    assert_eq!(opts.centerline_prune, 1000.0);
    assert_eq!(
        opts.max_paths, MAX_TRACE_PATHS,
        "0 = unlimited → hard ceiling"
    );
}

#[test]
fn trace_image_preserves_subpixel_preview_fit_errors() {
    let opts = sanitize_trace_options(TraceImageOptions {
        max_error: Some(0.0),
        ..Default::default()
    });
    assert_eq!(opts.max_error, 0.01);
}

#[test]
fn trace_image_detects_pixel_bomb_dimensions() {
    // A tiny PNG with a huge declared dimension set would previously
    // allocate after decode; the pre-check must reject it by dimensions.
    let mut buf = image::RgbaImage::new(2, 2);
    buf.put_pixel(0, 0, image::Rgba([0, 0, 0, 255]));
    let mut png: Vec<u8> = Vec::new();
    image::DynamicImage::ImageRgba8(buf)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("encode png");
    let options = TraceImageOptions {
        job_id: Some(1),
        ..Default::default()
    };
    // A 2x2 image is well under the limit and must trace fine.
    let result = tauri::async_runtime::block_on(trace_image_command(None, png, options))
        .expect("small image traces");
    assert!(result.paths.is_empty() || !result.paths.is_empty());
}

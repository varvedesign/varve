//! Pattern-fill rendering for the PDF writer.

use super::colour::fill_blend_mode;
use super::paint::effective_fill_alpha;
use super::paths::{path_clip_operator, shape_pdf_bounds};
use super::prelude::*;
use super::resources::ImageRenderState;
use super::resources::{embed_image_with_colorspace, rgba_extract_alpha, rgba_to_rgb};

pub(crate) fn render_pattern_fill(
    node: &SceneNode,
    page_height: f64,
    use_cmyk: bool,
    mut image_state: Option<&mut ImageRenderState>,
    manifest: Option<&resources::ExportManifest>,
    profile: Option<PrintProfile>,
    fill: &FillIR,
    source_path_ops: &[u8],
    buf: &mut Vec<u8>,
) {
    let path_ops = source_path_ops.to_vec();
    let FillIR::Pattern {
        tile_src,
        spacing,
        rotation,
        image_width,
        image_height,
        gap_x,
        gap_y,
        arrangement,
        row_shift,
        column_shift,
        mirror_x,
        mirror_y,
        offset_x,
        offset_y,
        alignment,
        opacity,
        ..
    } = fill
    else {
        return;
    };

    buf.extend_from_slice(b"q\n");

    // Non-rectangular shapes: clip to the shape path first
    if !matches!(node.shape, Shape::Rect(_)) {
        buf.extend(&path_ops);
        buf.extend_from_slice(path_clip_operator(node));
    }

    // Try to resolve tile from manifest
    let tile_image = manifest.as_ref().and_then(|m| {
        m.resolve_image_by_src(tile_src).ok().or_else(|| {
            m.patterns
                .iter()
                .find(|p| p.id == *tile_src || p.tile_image_id == *tile_src)
                .and_then(|pat| m.resolve_image(&pat.tile_image_id).ok())
        })
    });

    match tile_image {
        Some(img) if img.is_valid() => {
            let tile_w = image_width.unwrap_or(img.width as f64);
            let tile_h = image_height.unwrap_or(img.height as f64);
            let gap_x = gap_x.unwrap_or(*spacing);
            let gap_y = gap_y.unwrap_or(*spacing);
            let unsupported_layout = arrangement
                .as_deref()
                .is_some_and(|layout| layout != "grid")
                || row_shift.unwrap_or(0.0) != 0.0
                || column_shift.unwrap_or(0.0) != 0.0
                || mirror_x.unwrap_or(false)
                || mirror_y.unwrap_or(false)
                || offset_x.unwrap_or(0.0) != 0.0
                || offset_y.unwrap_or(0.0) != 0.0
                || alignment.as_deref().is_some_and(|value| value != "object")
                || gap_x < 0.0
                || gap_y < 0.0
                || *rotation != 0.0;
            let step_x = tile_w + gap_x;
            let step_y = tile_h + gap_y;
            if unsupported_layout
                || !tile_w.is_finite()
                || !tile_h.is_finite()
                || tile_w <= 0.0
                || tile_h <= 0.0
                || !step_x.is_finite()
                || !step_y.is_finite()
                || step_x <= 0.0
                || step_y <= 0.0
            {
                buf.extend_from_slice(
                    b"% WARNING: pattern layout is unsupported in PDF; fill omitted instead of approximated\n",
                );
                buf.extend_from_slice(b"Q\n");
                return;
            }

            let source_has_alpha = matches!(&img.color_space, resources::ColorSpace::Rgb)
                && img.data.chunks_exact(4).any(|rgba| rgba[3] < 255);
            if use_cmyk && (*opacity < 1.0 || source_has_alpha) {
                buf.extend_from_slice(
                    b"% WARNING: transparent pattern cannot be represented in PDF/X-1a; fill omitted\n",
                );
                buf.extend_from_slice(b"Q\n");
                return;
            }

            let image_state = image_state.as_mut().unwrap();
            let embedded = match (&img.color_space, use_cmyk) {
                (resources::ColorSpace::Rgb, true) => {
                    let cmyk_data: Vec<u8> = img
                        .data
                        .chunks_exact(4)
                        .flat_map(|rgba| {
                            let (c, m, y, k) = match profile {
                                Some(print_profile) => crate::cmyk::rgb_to_cmyk_icc(
                                    print_profile,
                                    rgba[0],
                                    rgba[1],
                                    rgba[2],
                                    crate::profiles::RenderingIntent::Relative,
                                    true,
                                ),
                                None => crate::cmyk::rgb_to_cmyk(rgba[0], rgba[1], rgba[2]),
                            };
                            [c, m, y, k]
                        })
                        .collect();
                    embed_image_with_colorspace(
                        image_state.doc,
                        &cmyk_data,
                        img.width,
                        img.height,
                        4,
                        "DeviceCMYK",
                        None,
                    )
                }
                (resources::ColorSpace::Rgb, false) => {
                    let rgb_data = rgba_to_rgb(&img.data);
                    let alpha = rgba_extract_alpha(&img.data);
                    let alpha_data = alpha.iter().any(|value| *value < 255);
                    embed_image_with_colorspace(
                        image_state.doc,
                        &rgb_data,
                        img.width,
                        img.height,
                        3,
                        "DeviceRGB",
                        alpha_data.then_some(alpha.as_slice()),
                    )
                }
                (resources::ColorSpace::Cmyk, _) => embed_image_with_colorspace(
                    image_state.doc,
                    &img.data,
                    img.width,
                    img.height,
                    4,
                    "DeviceCMYK",
                    None,
                ),
                (resources::ColorSpace::Gray, false) => embed_image_with_colorspace(
                    image_state.doc,
                    &img.data,
                    img.width,
                    img.height,
                    1,
                    "DeviceGray",
                    None,
                ),
                (resources::ColorSpace::Gray, true) => {
                    let cmyk_data: Vec<u8> = img
                        .data
                        .iter()
                        .flat_map(|gray| {
                            let (c, m, y, k) = match profile {
                                Some(print_profile) => crate::cmyk::rgb_to_cmyk_icc(
                                    print_profile,
                                    *gray,
                                    *gray,
                                    *gray,
                                    crate::profiles::RenderingIntent::Relative,
                                    true,
                                ),
                                None => crate::cmyk::rgb_to_cmyk(*gray, *gray, *gray),
                            };
                            [c, m, y, k]
                        })
                        .collect();
                    embed_image_with_colorspace(
                        image_state.doc,
                        &cmyk_data,
                        img.width,
                        img.height,
                        4,
                        "DeviceCMYK",
                        None,
                    )
                }
            };

            match embedded {
                Ok(obj_ref) => {
                    let name = format!("Pat{}", image_state.counter);
                    image_state.counter += 1;
                    image_state.refs.push((name.clone(), obj_ref));

                    // Clip to shape bounds
                    let (shape_x, shape_y, shape_w, shape_h) = shape_pdf_bounds(node, page_height);
                    buf.extend_from_slice(b"q\n");
                    // Fill-scoped graphics state, exactly as
                    // the canvas applies per-fill alpha and
                    // blend for a pattern paint.
                    if let Some(name) = image_state.get_or_create_blend_gs(fill_blend_mode(fill)) {
                        buf.extend(format!("/{name} gs\n").as_bytes());
                    }
                    let pattern_alpha = effective_fill_alpha(node, fill);
                    if pattern_alpha < 1.0 {
                        let gs_name = image_state.get_or_create_opacity_gs(pattern_alpha);
                        buf.extend(format!("/{gs_name} gs\n").as_bytes());
                    }
                    buf.extend(&path_ops);
                    buf.extend_from_slice(path_clip_operator(node));

                    // Tile the image across shape bounds
                    let x_step = step_x;
                    let y_step = step_y;
                    let estimated_tiles =
                        ((shape_w + tile_w) / x_step).ceil() * ((shape_h + tile_h) / y_step).ceil();
                    if !estimated_tiles.is_finite() || estimated_tiles > 100_000.0 {
                        buf.extend_from_slice(
                            b"% WARNING: pattern tile estimate exceeds 100000; fill omitted instead of truncated\n",
                        );
                        buf.extend_from_slice(b"Q\n");
                        buf.extend_from_slice(b"Q\n");
                        return;
                    } else if estimated_tiles > 1000.0 {
                        buf.extend(format!(
                            "% WARNING: pattern tile estimate {:.0} exceeds 1000; consider a larger tile size\n",
                            estimated_tiles
                        ).as_bytes());
                    }

                    let mut y = shape_y;
                    while y < shape_y + shape_h + tile_h {
                        let mut x = shape_x;
                        while x < shape_x + shape_w + tile_w {
                            // Isolate each tile's matrix. Without the local
                            // graphics state, every `cm` compounds on the
                            // previous tile and later copies drift off page.
                            buf.extend_from_slice(b"q\n");
                            // Position and scale tile
                            buf.extend(
                                format!("{tile_w:.4} 0 0 {tile_h:.4} {x:.4} {y:.4} cm\n")
                                    .as_bytes(),
                            );
                            buf.extend(format!("/{name} Do\n").as_bytes());
                            buf.extend_from_slice(b"Q\n");

                            x += x_step;
                        }
                        y += y_step;
                    }

                    // Apply opacity if needed
                    buf.extend_from_slice(b"Q\n"); // restore clip
                }
                Err(e) => {
                    buf.extend(
                        format!("% pattern tile embed error; fill omitted: {e}\n").as_bytes(),
                    );
                }
            }
        }
        _ => {
            // Missing source — omit it with a warning rather than
            // substituting a gray rectangle as if that were artwork.
            buf.extend_from_slice(
                b"% WARNING: pattern tile not found in export manifest; fill omitted\n",
            );
        }
    }

    buf.extend_from_slice(b"Q\n");
}

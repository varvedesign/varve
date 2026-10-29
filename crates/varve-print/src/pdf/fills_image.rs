//! Image-fill rendering for the PDF writer.

use super::colour::fill_blend_mode;
use super::geometry::{
    image_content_affine, pdf_image_matrix, render_perspective_triangles, transformed_rect_clip,
};
use super::paint::effective_fill_alpha;
use super::paths::{node_affine, path_clip_operator, shape_local_bounds, shape_pdf_bounds};
use super::prelude::*;
use super::resources::ImageRenderState;
use super::resources::{
    compute_pdf_image_placement, embed_image, embed_image_with_colorspace, generate_checkerboard,
    rgba_extract_alpha, rgba_to_rgb,
};

pub(crate) fn render_image_fill(
    node: &SceneNode,
    page_height: f64,
    use_cmyk: bool,
    mut image_state: Option<&mut ImageRenderState>,
    manifest: Option<&resources::ExportManifest>,
    _profile: Option<PrintProfile>,
    fill: &FillIR,
    source_path_ops: &[u8],
    buf: &mut Vec<u8>,
) {
    let path_ops = source_path_ops.to_vec();
    let FillIR::Image {
        src,
        x: fill_x,
        y: fill_y,
        scale: fill_scale,
        fit: fill_fit,
        alpha_mask,
        crop,
        rotation: fill_rotation,
        flip_h,
        flip_v,
        perspective,
        ..
    } = fill
    else {
        return;
    };

    match &mut image_state {
        Some(state) => {
            buf.extend_from_slice(b"q\n");

            // Image fills have their own canvas blend mode,
            // independent of the node's blend state. Apply
            // it before painting either a regular image or
            // the perspective triangle mesh.
            if let Some(name) = state.get_or_create_blend_gs(fill_blend_mode(fill)) {
                buf.extend(format!("/{name} gs\n").as_bytes());
            }

            // Every image fill is clipped to its object.
            // Rectangles use the complete object affine;
            // complex shapes retain their existing path
            // representation until the shared path writer
            // is migrated to local-space geometry.
            if matches!(node.shape, Shape::Rect(_)) {
                let (x, y, w, h) = shape_local_bounds(node);
                buf.extend_from_slice(
                    transformed_rect_clip(node_affine(node), page_height, x, y, w, h).as_bytes(),
                );
            } else {
                buf.extend(&path_ops);
                buf.extend_from_slice(path_clip_operator(node));
            }

            // Try to resolve image from manifest by source URL
            let manifest_image = manifest
                .as_ref()
                .and_then(|m| m.resolve_image_by_src(src).ok());

            match manifest_image {
                Some(img) if img.is_valid() => {
                    // Detect if source data is RGBA (width * height * 4 == data.len())
                    let is_rgba = img.data.len() >= (img.width * img.height * 4) as usize;
                    let alpha_data = if is_rgba {
                        Some(rgba_extract_alpha(&img.data))
                    } else {
                        None
                    };

                    // Real pixel data from the TS-side ICC pipeline
                    let (data, cs, bpc) = match img.color_space {
                        resources::ColorSpace::Cmyk => {
                            // CMYK data: embed directly as DeviceCMYK
                            (img.data.clone(), "DeviceCMYK", 4u32)
                        }
                        _ => {
                            // RGBA data: strip alpha to RGB for PDF
                            let rgb = if is_rgba {
                                rgba_to_rgb(&img.data)
                            } else {
                                img.data.clone()
                            };
                            (rgb, "DeviceRGB", 3u32)
                        }
                    };

                    let img_w = img.width as f64;
                    let img_h = img.height as f64;
                    let normalized_crop = crop.as_ref().and_then(|c| {
                        if !c.x.is_finite()
                            || !c.y.is_finite()
                            || !c.w.is_finite()
                            || !c.h.is_finite()
                            || c.w <= 0.0
                            || c.h <= 0.0
                        {
                            return None;
                        }
                        let x = c.x.clamp(0.0, img_w);
                        let y = c.y.clamp(0.0, img_h);
                        let right = (c.x + c.w).clamp(x, img_w);
                        let bottom = (c.y + c.h).clamp(y, img_h);
                        (right > x && bottom > y).then_some((x, y, right - x, bottom - y))
                    });

                    match embed_image_with_colorspace(
                        state.doc,
                        &data,
                        img.width,
                        img.height,
                        bpc,
                        cs,
                        alpha_data.as_deref(),
                    ) {
                        Ok(obj_ref) => {
                            let name = format!("Im{}", state.counter);
                            state.counter += 1;
                            state.refs.push((name.clone(), obj_ref));

                            if let Some(perspective) = perspective.as_ref() {
                                let normalized_crop = crop.as_ref().and_then(|c| {
                                    if !c.x.is_finite()
                                        || !c.y.is_finite()
                                        || !c.w.is_finite()
                                        || !c.h.is_finite()
                                        || c.w <= 0.0
                                        || c.h <= 0.0
                                    {
                                        return None;
                                    }
                                    let x = c.x.clamp(0.0, img_w);
                                    let y = c.y.clamp(0.0, img_h);
                                    let right = (c.x + c.w).clamp(x, img_w);
                                    let bottom = (c.y + c.h).clamp(y, img_h);
                                    (right > x && bottom > y).then_some((
                                        x,
                                        y,
                                        right - x,
                                        bottom - y,
                                    ))
                                });
                                let perspective_ops = render_perspective_triangles(
                                    node,
                                    page_height,
                                    &name,
                                    img_w,
                                    img_h,
                                    fill_fit,
                                    *fill_x,
                                    *fill_y,
                                    *fill_scale,
                                    normalized_crop,
                                    fill_rotation.unwrap_or(0.0),
                                    *flip_h == Some(true),
                                    *flip_v == Some(true),
                                    effective_fill_alpha(node, fill),
                                    &perspective.quad,
                                    state,
                                );
                                buf.extend_from_slice(perspective_ops.as_bytes());
                            } else {
                                let (bounds_x, bounds_y, bw, bh) = shape_local_bounds(node);

                                // Compute the full-source placement. A crop
                                // remains a sample within this destination; it
                                // never changes fit aspect or stretches itself
                                // back over the object bounds.
                                let (draw_w, draw_h, draw_ox, draw_oy) =
                                    compute_pdf_image_placement(
                                        fill_fit,
                                        img_w,
                                        img_h,
                                        bw,
                                        bh,
                                        *fill_scale,
                                    );
                                let draw_x = bounds_x + fill_x + draw_ox;
                                let draw_y = bounds_y + fill_y + draw_oy;

                                let flip_h_val = *flip_h == Some(true);
                                let flip_v_val = *flip_v == Some(true);
                                let rot = fill_rotation.unwrap_or(0.0);
                                let content_matrix = image_content_affine(
                                    node, draw_x, draw_y, draw_w, draw_h, rot, flip_h_val,
                                    flip_v_val,
                                );

                                // Crop clipping uses the same transformed
                                // proportional destination as the full image
                                // and its embedded SMask.
                                if let Some((src_x, src_y, src_w, src_h)) = normalized_crop {
                                    let sample_x = draw_x + src_x / img_w * draw_w;
                                    let sample_y = draw_y + src_y / img_h * draw_h;
                                    let sample_w = src_w / img_w * draw_w;
                                    let sample_h = src_h / img_h * draw_h;
                                    buf.extend_from_slice(
                                        transformed_rect_clip(
                                            content_matrix,
                                            page_height,
                                            sample_x,
                                            sample_y,
                                            sample_w,
                                            sample_h,
                                        )
                                        .as_bytes(),
                                    );
                                }

                                // Apply per-fill opacity via ExtGState
                                let fill_alpha = effective_fill_alpha(node, fill);
                                if fill_alpha < 1.0 {
                                    let gs_name = state.get_or_create_opacity_gs(fill_alpha);
                                    buf.extend(format!("/{gs_name} gs\n").as_bytes());
                                }
                                let image_matrix = pdf_image_matrix(
                                    content_matrix,
                                    page_height,
                                    draw_x,
                                    draw_y,
                                    draw_w,
                                    draw_h,
                                );
                                buf.extend(
                                    format!(
                                        "{:.4} {:.4} {:.4} {:.4} {:.4} {:.4} cm\n",
                                        image_matrix[0],
                                        image_matrix[1],
                                        image_matrix[2],
                                        image_matrix[3],
                                        image_matrix[4],
                                        image_matrix[5],
                                    )
                                    .as_bytes(),
                                );
                                buf.extend(format!("/{name} Do\n").as_bytes());
                            }
                        }
                        Err(e) => {
                            buf.extend(format!("% image fill embed error: {e}\n").as_bytes());
                        }
                    }
                }
                _ => {
                    // Fallback: checkerboard placeholder (no manifest or no match)
                    const PH: u32 = 16;
                    let checkerboard = generate_checkerboard();
                    match embed_image(state.doc, &checkerboard, PH, PH) {
                        Ok(obj_ref) => {
                            let name = format!("Im{}", state.counter);
                            state.counter += 1;
                            state.refs.push((name.clone(), obj_ref));

                            let (bx, by, bw, bh) = shape_pdf_bounds(node, page_height);
                            let tx = bx + fill_x;
                            let ty = by + fill_y;
                            let sx = bw / PH as f64;
                            let sy = bh / PH as f64;

                            // Apply per-fill opacity via ExtGState
                            let fill_alpha = effective_fill_alpha(node, fill);
                            if fill_alpha < 1.0 {
                                let gs_name = state.get_or_create_opacity_gs(fill_alpha);
                                buf.extend(format!("/{gs_name} gs\n").as_bytes());
                            }

                            buf.extend(
                                format!("{sx:.4} 0 0 {sy:.4} {tx:.4} {ty:.4} cm\n").as_bytes(),
                            );
                            buf.extend(format!("/{name} Do\n").as_bytes());

                            if use_cmyk {
                                let note = "% image fill CMYK conversion not yet implemented; checkerboard placeholder rendered as RGB\n";
                                buf.extend_from_slice(note.as_bytes());
                            }

                            if let Some(mask_type) = alpha_mask {
                                let note = format!(
                                    "% alpha mask type '{:?}' not yet implemented for image fill in PDF export; use SMask via RGBA data\n",
                                    mask_type
                                );
                                buf.extend_from_slice(note.as_bytes());
                            }
                        }
                        Err(e) => {
                            buf.extend(format!("% image fill embed error: {e}\n").as_bytes());
                        }
                    }
                }
            }
            buf.extend_from_slice(b"Q\n");
        }
        None => {
            // No document — keep legacy behaviour
            buf.extend_from_slice(b"% image/pattern fill (not rendered in basic PDF)\n");
        }
    }
}

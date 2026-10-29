//! Fill rendering dispatcher for PDF output.

use super::colour::{
    color_to_cmyk_string, color_to_rgb_string, fill_to_color_string, fill_visible,
};
use super::fills_image::render_image_fill;
use super::fills_pattern::render_pattern_fill;
use super::paint::write_fill_graphics_state;
use super::paths::{path_clip_operator, path_fill_operator, shape_path_operators};
use super::prelude::*;
use super::resources::ImageRenderState;
use super::shading::{gradient_page_affine, ShadingRegistry};

/// `use_cmyk` controls whether RGB or CMYK color operators are emitted.
///
/// When `image_state` is `Some`, image fills are rendered as checkerboard
/// placeholders via XObject `Do` operators (clipped to the shape path for
/// non-rectangular geometry). When `None`, image/pattern fills emit an
/// explicit "not rendered" comment (backward-compatible).
pub(crate) fn render_fills(
    node: &SceneNode,
    page_height: f64,
    use_cmyk: bool,
    mut image_state: Option<&mut ImageRenderState>,
    manifest: Option<&resources::ExportManifest>,
    profile: Option<PrintProfile>,
    mut shading_registry: Option<&mut ShadingRegistry>,
    lossy: bool,
) -> Vec<u8> {
    let path_ops = shape_path_operators(node, page_height);
    if path_ops.is_empty() {
        return Vec::new();
    }

    let mut buf = Vec::new();

    if let Some(fills) = &node.fills {
        if !fills.is_empty() {
            // Iterate bottom-to-top (Vec order is paint order)
            for fill in fills.iter() {
                if !fill_visible(fill) {
                    continue;
                }
                match fill {
                    FillIR::Image { .. } => {
                        render_image_fill(
                            node,
                            page_height,
                            use_cmyk,
                            image_state.as_mut().map(|state| &mut **state),
                            manifest,
                            profile,
                            fill,
                            &path_ops,
                            &mut buf,
                        );
                    }
                    FillIR::Pattern { .. } => {
                        render_pattern_fill(
                            node,
                            page_height,
                            use_cmyk,
                            image_state.as_mut().map(|state| &mut **state),
                            manifest,
                            profile,
                            fill,
                            &path_ops,
                            &mut buf,
                        );
                    }
                    FillIR::Solid { .. } => {
                        buf.extend_from_slice(b"q\n");
                        // The canvas multiplies the fill's opacity by the
                        // item's and applies the fill's blend mode in place of
                        // the item's, so both belong to this fill's own state.
                        // A graphics state only affects the operators that
                        // follow it, so it must precede the paint.
                        write_fill_graphics_state(&mut buf, &mut image_state, node, fill);
                        let color_str = fill_to_color_string(fill, use_cmyk, profile, lossy);
                        buf.extend(color_str.as_bytes());
                        buf.extend(b"\n");
                        buf.extend(&path_ops);
                        buf.extend_from_slice(path_fill_operator(node));
                        buf.extend_from_slice(b"Q\n");
                    }
                    FillIR::Gradient {
                        gradient_type,
                        stops,
                        rotation,
                        transform,
                        ..
                    } => {
                        buf.extend_from_slice(b"q\n");
                        write_fill_graphics_state(&mut buf, &mut image_state, node, fill);
                        let use_shading = stops.len() >= 2;
                        if use_shading {
                            if let Some(registry) = shading_registry.as_mut() {
                                let matrix =
                                    gradient_page_affine(node, page_height, *transform, *rotation);
                                let shading_name = match gradient_type.as_str() {
                                    "radial" => registry
                                        .add_radial_gradient(stops, use_cmyk, profile, matrix),
                                    _ => registry
                                        .add_linear_gradient(stops, use_cmyk, profile, matrix),
                                };
                                buf.extend(&path_ops);
                                buf.extend_from_slice(path_clip_operator(node));
                                buf.extend(format!("/{shading_name} sh\n").as_bytes());
                            } else {
                                let color_str =
                                    fill_to_color_string(fill, use_cmyk, profile, lossy);
                                buf.extend(color_str.as_bytes());
                                buf.extend(b"\n");
                                buf.extend(&path_ops);
                                buf.extend_from_slice(path_fill_operator(node));
                            }
                        } else {
                            let color_str = fill_to_color_string(fill, use_cmyk, profile, lossy);
                            buf.extend(color_str.as_bytes());
                            buf.extend(b"\n");
                            buf.extend(&path_ops);
                            buf.extend_from_slice(path_fill_operator(node));
                        }
                        // The canvas multiplies the fill's opacity by the
                        // item's and applies the fill's blend mode in place of
                        // the item's, so both belong to this fill's own state.
                        write_fill_graphics_state(&mut buf, &mut image_state, node, fill);
                        buf.extend_from_slice(b"Q\n");
                    }
                }
            }
            return buf;
        }
    }

    // Fallback to node.fill
    buf.extend_from_slice(b"q\n");
    if use_cmyk {
        buf.extend(color_to_cmyk_string(&node.fill, profile).as_bytes());
    } else {
        buf.extend(color_to_rgb_string(&node.fill).as_bytes());
    }
    buf.extend(b"\n");
    buf.extend(&path_ops);
    buf.extend_from_slice(path_fill_operator(node));
    // Node opacity and blend mode are applied once by `shape_to_pdf_content`
    // for the whole node, which is the scope the canvas uses too.
    buf.extend_from_slice(b"Q\n");
    buf
}

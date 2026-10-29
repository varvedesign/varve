//! Stroke, effect, and graphics-state painting for PDF output.

use super::colour::{
    color_to_cmyk_string, color_to_rgb_string, color_to_stroke_cmyk_string,
    color_to_stroke_rgb_string, fill_blend_mode, fill_opacity,
};
use super::fills::render_fills;
use super::paths::{path_fill_operator, shape_path_operators};
use super::prelude::*;
use super::resources::ImageRenderState;

/// Render strokes from `node.strokes`.
pub(crate) fn render_strokes(
    node: &SceneNode,
    page_height: f64,
    use_cmyk: bool,
    profile: Option<PrintProfile>,
    mut image_state: Option<&mut ImageRenderState<'_>>,
) -> Vec<u8> {
    let path_ops = shape_path_operators(node, page_height);
    if path_ops.is_empty() || node.strokes.is_empty() {
        return Vec::new();
    }

    let mut buf = Vec::new();
    for stroke in &node.strokes {
        if !stroke.visible {
            continue;
        }
        buf.extend_from_slice(b"q\n");

        // PDF alpha is a graphics-state value rather than a component of the
        // stroke colour. Match the canvas by multiplying the node opacity by
        // the color alpha before setting the stroking alpha.
        let stroke_alpha = (node.opacity.clamp(0.0, 1.0)
            * (f64::from(engine_color_rgba(&stroke.color).3) / 255.0).clamp(0.0, 1.0))
        .clamp(0.0, 1.0);
        if stroke_alpha < 1.0 {
            if let Some(state) = image_state.as_deref_mut() {
                let name = state.get_or_create_opacity_gs(stroke_alpha);
                buf.extend_from_slice(format!("/{name} gs\n").as_bytes());
            }
        }

        // Line width
        buf.extend(format!("{:.2} w\n", stroke.weight).as_bytes());

        // Line cap: 0=butt, 1=round, 2=square
        let cap_val: u8 = match stroke.cap.as_str() {
            "round" => 1,
            "square" => 2,
            _ => 0,
        };
        buf.extend(format!("{cap_val} J\n").as_bytes());

        // Line join: 0=miter, 1=round, 2=bevel
        let join_val: u8 = match stroke.join.as_str() {
            "round" => 1,
            "bevel" => 2,
            _ => 0,
        };
        buf.extend(format!("{join_val} j\n").as_bytes());

        // Miter limit
        buf.extend(format!("{:.2} M\n", stroke.miter_limit).as_bytes());

        // Dash pattern
        if !stroke.dash_pattern.is_empty() {
            let dash_str: Vec<String> = stroke
                .dash_pattern
                .iter()
                .map(|v| format!("{v:.2}"))
                .collect();
            buf.extend(
                format!("[{}] {:.2} d\n", dash_str.join(" "), stroke.dash_offset).as_bytes(),
            );
        }

        // Color
        if use_cmyk {
            buf.extend(color_to_stroke_cmyk_string(&stroke.color, profile).as_bytes());
        } else {
            buf.extend(color_to_stroke_rgb_string(&stroke.color).as_bytes());
        }
        buf.extend(b"\n");

        buf.extend(&path_ops);
        buf.extend_from_slice(b"S\n");
        buf.extend_from_slice(b"Q\n");
    }
    buf
}

/// Render effects. dropShadow is rendered as an offset, semi-transparent
/// black copy of the path. Other effects are emitted as comments.
pub(crate) fn render_effects(
    node: &SceneNode,
    page_height: f64,
    use_cmyk: bool,
    profile: Option<PrintProfile>,
    mut image_state: Option<&mut ImageRenderState>,
) -> Vec<u8> {
    let path_ops = shape_path_operators(node, page_height);
    let has_filters = node
        .filters
        .as_ref()
        .map(|f| !f.is_empty())
        .unwrap_or(false);
    if path_ops.is_empty() || (node.effects.is_empty() && !has_filters) {
        return Vec::new();
    }

    let mut buf = Vec::new();
    for effect in &node.effects {
        match effect {
            Effect::DropShadow {
                x,
                y,
                blur,
                spread: _,
                color,
                opacity,
                blend_mode,
                visible,
                ..
            } => {
                if !visible || *opacity <= 0.0 {
                    continue;
                }
                buf.extend_from_slice(b"q\n");

                if let Some(state) = image_state.as_deref_mut() {
                    if let Some(name) = state.get_or_create_effect_blend_gs(blend_mode) {
                        buf.extend(format!("/{name} gs\n").as_bytes());
                    }
                    let color_alpha = f64::from(engine_color_rgba(color).3) / 255.0;
                    let effect_alpha =
                        (node.opacity.clamp(0.0, 1.0) * opacity.clamp(0.0, 1.0) * color_alpha)
                            .clamp(0.0, 1.0);
                    if effect_alpha < 1.0 {
                        let name = state.get_or_create_opacity_gs(effect_alpha);
                        buf.extend(format!("/{name} gs\n").as_bytes());
                    }
                }

                // Apply shadow offset translation
                let blur_approx = blur.max(0.0);
                let spread_approx = blur_approx * 0.5;
                let tx = x + spread_approx;
                let ty = y + spread_approx;
                buf.extend(format!("1 0 0 1 {tx:.2} {ty:.2} cm\n").as_bytes());

                // Shadow fill color
                if use_cmyk {
                    buf.extend(color_to_cmyk_string(color, profile).as_bytes());
                } else {
                    buf.extend(color_to_rgb_string(color).as_bytes());
                }
                buf.extend(b"\n");

                buf.extend(&path_ops);
                buf.extend_from_slice(path_fill_operator(node));

                if *blur > 0.0 {
                    buf.extend(format!("% blur={:.2}\n", blur).as_bytes());
                }
                buf.extend_from_slice(b"Q\n");
            }
            Effect::InnerShadow { visible, .. } => {
                if *visible {
                    buf.extend(b"% innerShadow (not rendered in basic PDF)\n");
                }
            }
            Effect::LayerBlur {
                radius, visible, ..
            } => {
                if *visible {
                    buf.extend(format!("% layerBlur radius={radius:.2}\n").as_bytes());
                }
            }
            Effect::BackgroundBlur {
                radius, visible, ..
            } => {
                if *visible {
                    buf.extend(format!("% backgroundBlur radius={radius:.2}\n").as_bytes());
                }
            }
            Effect::GaussianBlur { visible, .. }
            | Effect::FieldBlur { visible, .. }
            | Effect::IrisBlur { visible, .. }
            | Effect::TiltShiftBlur { visible, .. }
            | Effect::PathBlur { visible, .. }
            | Effect::SpinBlur { visible, .. } => {
                if *visible {
                    buf.extend_from_slice(
                        b"% spatial blur rasterization required by basic PDF export\n",
                    );
                }
            }
            Effect::DepthBlur {
                depth_map_id,
                blur_strength,
                visible,
                ..
            } => {
                // Depth-aware blur depends on an image-space depth resource and
                // is currently replayed by the Canvas2D/WASM renderer only.
                // Keep print output honest instead of dropping it silently.
                if *visible {
                    buf.extend(
                        format!(
                            "% depthBlur depthMapId={depth_map_id} blurStrength={blur_strength:.2} (not rendered in basic PDF)\n"
                        )
                        .as_bytes(),
                    );
                }
            }
            Effect::OuterGlow { visible, .. } => {
                if *visible {
                    buf.extend(b"% outerGlow (not rendered in basic PDF)\n");
                }
            }
            Effect::InnerGlow { visible, .. } => {
                if *visible {
                    buf.extend(b"% innerGlow (not rendered in basic PDF)\n");
                }
            }
            Effect::GlassMaterial {
                blur,
                edge_highlight: _,
                edge_highlight_width: _,
                visible,
                ..
            } => {
                if *visible {
                    buf.extend(
                        format!("% glassMaterial blur={blur:.2} (not rendered in basic PDF)\n")
                            .as_bytes(),
                    );
                }
            }
            Effect::ChromaticAberration { visible, .. } => {
                if *visible {
                    buf.extend(b"% chromaticAberration (not rendered in basic PDF)\n");
                }
            }
            Effect::Glitch { visible, .. } => {
                if *visible {
                    buf.extend(b"% glitch (not rendered in basic PDF)\n");
                }
            }
        }
    }

    if has_filters {
        // The nondestructive adjustment stack (curves, levels, halftone, etc.)
        // is CPU-rasterized by the live canvas renderer only; there is no
        // Rust-side implementation of it (see packages/engine/src/filters.ts
        // and halftone.ts). Surface that honestly instead of silently
        // dropping the effect from print output.
        buf.extend_from_slice(
            b"% nondestructive adjustment stack (e.g. halftone, curves, levels) not rendered in basic PDF export\n",
        );
    }

    buf
}

/// Legacy shape_to_pdf_content — maintained for backward compatibility
/// with `build_pdfx_content` in cmyk.rs.
/// Shape → PDF content stream. `use_cmyk`/`profile` control whether fills and
/// strokes are emitted as ICC-aware CMYK operators (PDF/X-1a) or plain RGB.
pub(crate) fn shape_to_pdf_content(
    node: &SceneNode,
    page_height: f64,
    mut image_state: Option<&mut ImageRenderState>,
    manifest: Option<&resources::ExportManifest>,
    use_cmyk: bool,
    profile: Option<PrintProfile>,
) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(b"q\n");
    if let Some(state) = image_state.as_mut() {
        write_node_graphics_state(&mut buf, state, node);
    }
    let effects = render_effects(
        node,
        page_height,
        use_cmyk,
        profile,
        image_state.as_deref_mut(),
    );
    buf.extend(&effects);
    let fills = render_fills(
        node,
        page_height,
        use_cmyk,
        image_state.as_deref_mut(),
        manifest,
        profile,
        None,
        false,
    );
    buf.extend(&fills);
    let strokes = render_strokes(node, page_height, use_cmyk, profile, image_state);
    buf.extend(&strokes);
    buf.extend_from_slice(b"Q\n");
    buf
}

/// Effective alpha of one fill, matching the canvas: the node's opacity
/// multiplies the fill's own opacity (`packages/engine/src/replay.ts` sets
/// `globalAlpha = itemAlpha * fill.opacity`). PDF `/ca` is a single value, so
/// the product is what must be written — emitting both graphics states
/// separately would leave only the inner one in effect and paint the fill
/// twice as opaque as the canvas did.
pub(crate) fn effective_fill_alpha(node: &SceneNode, fill: &FillIR) -> f64 {
    (node.opacity.clamp(0.0, 1.0) * fill_opacity(fill).clamp(0.0, 1.0)).clamp(0.0, 1.0)
}

/// Write one fill's own graphics state (blend mode, then alpha) into `buf`.
///
/// Called inside the fill's own `q`/`Q`, so the state applies to that fill
/// alone. The node-level state written by [`write_node_graphics_state`] stays
/// in effect for the fills that do not override it, which is the same fallback
/// the canvas uses (`fill.blendMode` wins, otherwise the item's mode).
pub(crate) fn write_fill_graphics_state(
    buf: &mut Vec<u8>,
    image_state: &mut Option<&mut ImageRenderState>,
    node: &SceneNode,
    fill: &FillIR,
) {
    let Some(state) = image_state.as_mut() else {
        return;
    };
    if let Some(name) = state.get_or_create_blend_gs(fill_blend_mode(fill)) {
        buf.extend_from_slice(format!("/{name} gs\n").as_bytes());
    }
    let alpha = effective_fill_alpha(node, fill);
    if alpha < 1.0 {
        let name = state.get_or_create_opacity_gs(alpha);
        buf.extend_from_slice(format!("/{name} gs\n").as_bytes());
    }
}

/// Write the node-scoped graphics state (blend mode, then opacity) into `buf`.
///
/// The canvas applies a node's `opacity` and `blendMode` to everything the node
/// paints — `globalAlpha` and `globalCompositeOperation` wrap the fills,
/// strokes and effects of one render item (`packages/engine/src/replay.ts`) —
/// so both entries are set once, inside the node's own `q`/`Q`. A mode with no
/// PDF name writes nothing and is reported by [`unrepresented_blend_modes`]
/// rather than being passed off as `Normal`.
///
/// Either writer that renders a node must call this: the vector-export loop in
/// [`export_pdf`] and [`shape_to_pdf_content`] are separate code paths, and a
/// node painted without its graphics state is exactly the defect this exists
/// to prevent.
pub(crate) fn write_node_graphics_state(
    buf: &mut Vec<u8>,
    state: &mut ImageRenderState,
    node: &SceneNode,
) {
    if let Some(name) = state.get_or_create_blend_gs(&node.blend_mode) {
        buf.extend_from_slice(format!("/{name} gs\n").as_bytes());
    }
    if node.opacity < 1.0 {
        let name = state.get_or_create_opacity_gs(node.opacity);
        buf.extend_from_slice(format!("/{name} gs\n").as_bytes());
    }
}

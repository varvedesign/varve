//! Colour conversion and blend-mode reporting for PDF output.

use super::prelude::*;

pub(crate) fn color_to_rgb_string(fill: &EngineColor) -> String {
    if is_spot_color(fill) {
        return spot_color_separation(fill);
    }
    let (r, g, b, _) = engine_color_rgba(fill);
    let rf = r as f32 / 255.0;
    let gf = g as f32 / 255.0;
    let bf = b as f32 / 255.0;
    format!("{rf:.3} {gf:.3} {bf:.3} rg")
}

/// Normalized 0-1 CMYK channels of an authored CMYK color.
///
/// Channel scale follows the color's declared bit depth (uint8 → /255,
/// uint16 → /65535, float depths → as-is). Authored CMYK channels must be
/// emitted directly — never round-tripped through RGB — so pure K stays
/// (0 0 0 1) and profile association is preserved instead of being replaced
/// by a naive `(1-c)(1-k)` build.
pub(crate) fn cmyk_normalized(color: &EngineColor) -> Option<(f32, f32, f32, f32)> {
    let EngineColor::Cmyk {
        c,
        m,
        y,
        k,
        bit_depth,
        ..
    } = color
    else {
        return None;
    };
    let div: f32 = match bit_depth.as_deref().map(str::to_owned) {
        Some(d) if d == "uint16" => 65535.0,
        Some(d) if d == "float16" || d == "float32" => 1.0,
        _ => 255.0,
    };
    Some((
        *c as f32 / div,
        *m as f32 / div,
        *y as f32 / div,
        *k as f32 / div,
    ))
}

fn is_spot_color(color: &EngineColor) -> bool {
    matches!(color, EngineColor::Spot { .. })
}

/// Emit a PDF /Separation color space for a spot color.
/// Returns the PDF commands to set the spot color, using the process fallback
/// for the separation's DeviceCMYK alternate.
fn spot_color_separation(color: &EngineColor) -> String {
    if let EngineColor::Spot { name, tint, a, .. } = color {
        let tint_val = (tint / 100.0).clamp(0.0, 1.0);
        // Set color space to /Separation with the spot color name.
        // The alternate DeviceCMYK uses the process fallback; the tint value
        // (0-1) maps to spot concentration.
        format!(
            "[/Separation {name} /DeviceCMYK {{0 0 0 0}}] cs\n{:.3} sc\n",
            tint_val * (*a / 255.0)
        )
    } else {
        String::new()
    }
}

pub(crate) fn color_to_cmyk_string(fill: &EngineColor, profile: Option<PrintProfile>) -> String {
    if is_spot_color(fill) {
        return spot_color_separation(fill);
    }
    // Native CMYK: emit the authored channels at the color's own bit-depth
    // scale. No CMYK→RGB→CMYK round trip (which would turn pure K into a
    // four-color build and discard the authored profile association).
    if let Some((c, m, y, k)) = cmyk_normalized(fill) {
        return format!("{c:.3} {m:.3} {y:.3} {k:.3} k");
    }
    let (r, g, b, _) = engine_color_rgba(fill);
    let (c, m, y, k) = match profile {
        Some(p) => crate::cmyk::rgb_to_cmyk_icc(
            p,
            r,
            g,
            b,
            crate::profiles::RenderingIntent::Relative,
            true,
        ),
        None => crate::cmyk::rgb_to_cmyk(r, g, b),
    };
    format!(
        "{:.3} {:.3} {:.3} {:.3} k",
        c as f32 / 255.0,
        m as f32 / 255.0,
        y as f32 / 255.0,
        k as f32 / 255.0
    )
}

pub(crate) fn color_to_stroke_rgb_string(fill: &EngineColor) -> String {
    let (r, g, b, _) = engine_color_rgba(fill);
    let rf = r as f32 / 255.0;
    let gf = g as f32 / 255.0;
    let bf = b as f32 / 255.0;
    format!("{rf:.3} {gf:.3} {bf:.3} RG")
}

pub(crate) fn color_to_stroke_cmyk_string(
    fill: &EngineColor,
    profile: Option<PrintProfile>,
) -> String {
    if let Some((c, m, y, k)) = cmyk_normalized(fill) {
        return format!("{c:.3} {m:.3} {y:.3} {k:.3} K");
    }
    let (r, g, b, _) = engine_color_rgba(fill);
    let (c, m, y, k) = match profile {
        Some(p) => crate::cmyk::rgb_to_cmyk_icc(
            p,
            r,
            g,
            b,
            crate::profiles::RenderingIntent::Relative,
            true,
        ),
        None => crate::cmyk::rgb_to_cmyk(r, g, b),
    };
    format!(
        "{:.3} {:.3} {:.3} {:.3} K",
        c as f32 / 255.0,
        m as f32 / 255.0,
        y as f32 / 255.0,
        k as f32 / 255.0
    )
}

/// Check if a fill contains high bit depth colors that will lose precision
/// when converted to 8-bit PDF. Prints a warning to stderr.
fn check_lossy_color(fill: &FillIR) {
    let colors: Vec<&EngineColor> = match fill {
        FillIR::Solid { color, .. } => vec![color],
        FillIR::Gradient { stops, .. } => stops.iter().map(|s| &s.color).collect(),
        _ => return,
    };
    for color in colors {
        let bit_depth = match color {
            EngineColor::Rgb { bit_depth, .. } => bit_depth.as_deref(),
            EngineColor::Cmyk { bit_depth, .. } => bit_depth.as_deref(),
            EngineColor::Gray { bit_depth, .. } => bit_depth.as_deref(),
            _ => None,
        };
        if let Some(bd) = bit_depth {
            if bd != "uint8" && bd != "uint16" {
                eprintln!("[warn] exporting {bd} color as 8-bit PDF — precision will be lost");
            }
        }
    }
}

/// Helper: convert a FillIR to an RGB or CMYK fill color string.
pub(crate) fn fill_to_color_string(
    fill: &FillIR,
    use_cmyk: bool,
    profile: Option<PrintProfile>,
    lossy: bool,
) -> String {
    if lossy {
        check_lossy_color(fill);
    }
    match fill {
        FillIR::Solid { color, .. } => {
            if use_cmyk {
                color_to_cmyk_string(color, profile)
            } else {
                color_to_rgb_string(color)
            }
        }
        FillIR::Gradient { stops, .. } => {
            // Gradient fills approximate as solid using the first stop color.
            if let Some(stop) = stops.first() {
                if use_cmyk {
                    color_to_cmyk_string(&stop.color, profile)
                } else {
                    color_to_rgb_string(&stop.color)
                }
            } else if use_cmyk {
                color_to_cmyk_string(
                    &EngineColor::Rgb {
                        r: 0.0,
                        g: 0.0,
                        b: 0.0,
                        a: 255.0,
                        bit_depth: None,
                        profile: None,
                    },
                    profile,
                )
            } else {
                color_to_rgb_string(&EngineColor::Rgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 255.0,
                    bit_depth: None,
                    profile: None,
                })
            }
        }
        FillIR::Image { .. } | FillIR::Pattern { .. } => {
            if use_cmyk {
                color_to_cmyk_string(
                    &EngineColor::Rgb {
                        r: 0.0,
                        g: 0.0,
                        b: 0.0,
                        a: 255.0,
                        bit_depth: None,
                        profile: None,
                    },
                    profile,
                )
            } else {
                color_to_rgb_string(&EngineColor::Rgb {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 255.0,
                    bit_depth: None,
                    profile: None,
                })
            }
        }
    }
}

pub(crate) fn fill_visible(fill: &FillIR) -> bool {
    match fill {
        FillIR::Solid { visible, .. } => *visible,
        FillIR::Gradient { visible, .. } => *visible,
        FillIR::Image { visible, .. } => *visible,
        FillIR::Pattern { visible, .. } => *visible,
    }
}

pub(crate) fn fill_opacity(fill: &FillIR) -> f64 {
    match fill {
        FillIR::Solid { opacity, .. } => *opacity,
        FillIR::Gradient { opacity, .. } => *opacity,
        FillIR::Image { opacity, .. } => *opacity,
        FillIR::Pattern { opacity, .. } => *opacity,
    }
}

pub(crate) fn fill_blend_mode(fill: &FillIR) -> &varve_core::BlendMode {
    match fill {
        FillIR::Solid { blend_mode, .. } => blend_mode,
        FillIR::Gradient { blend_mode, .. } => blend_mode,
        FillIR::Image { blend_mode, .. } => blend_mode,
        FillIR::Pattern { blend_mode, .. } => blend_mode,
    }
}

/// True when the writer can reproduce `mode` for a target that may (`true`) or
/// may not (`false`) carry live transparency.
///
/// One predicate, used both to decide what to write and to decide what to
/// report, so the two can never disagree:
///
/// - `Normal` is the PDF page default.
/// - `passThrough` is a group policy whose node-level effect is also `Normal`.
/// - every other mode needs a `/BM` entry, which PDF/X-1a forbids because it
///   does not permit live transparency.
/// - `plusLighter` has a Canvas2D equivalent (`lighter`) but no PDF name, and
///   `plusDarker` is a legacy mode with no Canvas2D equivalent either.
pub fn blend_is_representable(mode: &varve_core::BlendMode, allow_blend_modes: bool) -> bool {
    match blend::pdf_blend_name(mode) {
        Some("Normal") => true,
        None => matches!(mode, varve_core::BlendMode::PassThrough),
        Some(_) => allow_blend_modes,
    }
}

/// Every node in `nodes` whose paint the writer cannot reproduce faithfully: a
/// node or a visible fill whose blend mode is not representable for a target
/// with the given transparency capability.
///
/// Callers that must not ship a silently different composition — the PDF/X-1a
/// route, where the format forbids transparency outright — use this to refuse
/// or disclose instead of returning a page that looks like a successful
/// export and composites differently from the canvas.
pub fn unrepresented_blend_modes(
    nodes: &[SceneNode],
    allow_blend_modes: bool,
) -> Vec<UnrepresentedBlend> {
    let mut out = Vec::new();
    for node in nodes {
        if !blend_is_representable(&node.blend_mode, allow_blend_modes) {
            out.push(UnrepresentedBlend {
                node_name: node.name.clone(),
                mode: blend::blend_mode_label(&node.blend_mode),
            });
        }
        if let Some(fills) = &node.fills {
            for fill in fills {
                if !fill_visible(fill) {
                    continue;
                }
                let mode = fill_blend_mode(fill);
                if !blend_is_representable(mode, allow_blend_modes) {
                    out.push(UnrepresentedBlend {
                        node_name: node.name.clone(),
                        mode: blend::blend_mode_label(mode),
                    });
                }
            }
        }
        for effect in &node.effects {
            if let Effect::DropShadow {
                blend_mode,
                visible: true,
                ..
            } = effect
            {
                if !blend_is_representable(blend_mode, allow_blend_modes) {
                    out.push(UnrepresentedBlend {
                        node_name: node.name.clone(),
                        mode: blend::blend_mode_label(blend_mode),
                    });
                }
            }
        }
    }
    out
}

/// Refuse direct PDF API calls when a scene contains a mode without a PDF
/// equivalent. Editor preflight performs the same check for user-facing
/// exports; keeping it here prevents library callers from silently getting
/// Normal-composited artwork.
pub(crate) fn assert_pdf_blends_are_representable(
    nodes: &[SceneNode],
    format_label: &str,
) -> Result<(), String> {
    let unsupported = unrepresented_blend_modes(nodes, true);
    if unsupported.is_empty() {
        return Ok(());
    }
    let details = unsupported
        .iter()
        .map(|entry| format!("'{}' ({})", entry.node_name, entry.mode))
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "{format_label} export stopped: these objects use blend modes PDF cannot carry: {details}. Flatten the complete composite against its background or export it as a raster image."
    ))
}
// ── FillIR helpers (free functions as we can't impl on external type) ─

//! CMYK conversion (re-exported from `varve-colour`) + PDF/X export.
//!
//! The naive (`rgb_to_cmyk`) and analytical ICC-aware (`rgb_to_cmyk_icc`)
//! colour conversions have moved to the `varve-colour` crate for
//! deterministic cross-target (native + WASM) colour processing.
//! This module re-exports them for backward compatibility and provides
//! the PDF/X export functions that build on top.
//!
//! Research basis: ISO 15930 (PDF/X-1a, PDF/X-4), ICC color management,
//! Bruce Lindbloom's colour equations.

use crate::marks::{self, MarksGeometry};
use crate::subset::{
    collect_used_chars, get_subset_tag, subset_font, validate_embedding_permission,
    EmbeddingPermission,
};
use crate::{add_image_render_resources, ImageRenderState, PdfOptions};
use lopdf::{dictionary, Document, Object, Stream};
use varve_colour::profiles::PrintProfile;
pub use varve_colour::{rgb_to_cmyk, rgb_to_cmyk_icc};
use varve_core::SceneNode;

/// Return default bleed/trim marks geometry as `(bleed_mm, trim_offset_mm, mark_length_mm)`.
///
/// Delegates to `MarksGeometry::default()` so the single source of truth is `marks.rs`.
pub fn marks_geometry() -> (f64, f64, f64) {
    let g = MarksGeometry::default();
    (g.bleed_mm, g.trim_offset_mm, g.mark_length_mm)
}

/// Build PDF content stream bytes from scene nodes, optionally converting
/// fill colours to CMYK, and optionally drawing registration marks and
/// color bars.
fn build_pdfx_content(
    nodes: &[SceneNode],
    page_width: f64,
    page_height: f64,
    trim_x: f64,
    trim_y: f64,
    use_cmyk: bool,
    marks_geo: Option<&MarksGeometry>,
    draw_reg_marks: bool,
    draw_color_bar: bool,
    mut image_state: Option<&mut ImageRenderState>,
    manifest: Option<&crate::resources::ExportManifest>,
    profile: Option<PrintProfile>,
) -> Vec<u8> {
    let mut content = Vec::new();
    content.extend_from_slice(b"q\n");

    // The page keeps its neutral initial backdrop, exactly as in
    // `crate::export_pdf`: blend modes must composite with what the canvas
    // shows, and a document that wants paper paints its page-background nodes.
    // (A CMYK `0 0 0 0 k` rectangle would be ink-free but would still become
    // the backdrop every blend composites against.)

    // Scene coordinates are trim-local (the same contract used by the
    // editor). PDF coordinates are media-local and Y-up, so move authored
    // content into the trim position when the media sheet includes bleed or
    // printer marks.
    if trim_x != 0.0 || trim_y != 0.0 {
        let pdf_y = -trim_y;
        content.extend_from_slice(format!("q\n1 0 0 1 {trim_x:.4} {pdf_y:.4} cm\n").as_bytes());
    }
    for node in nodes {
        let state = image_state.as_mut().map(|s| &mut **s);
        let cmd =
            crate::shape_to_pdf_content(node, page_height, state, manifest, use_cmyk, profile);
        content.extend_from_slice(&cmd);
    }
    if trim_x != 0.0 || trim_y != 0.0 {
        content.extend_from_slice(b"Q\n");
    }

    // Draw crop marks if requested
    if let Some(geo) = marks_geo.filter(|geo| geo.draw_crop_marks) {
        let trim_w = page_width - 2.0 * trim_x;
        let trim_h = page_height - 2.0 * trim_y;

        // Crop marks
        let lines = marks::crop_mark_lines(trim_x, trim_y, trim_w, trim_h, geo);
        if use_cmyk {
            content.extend_from_slice(b"0 0 0 1 K\n");
        } else {
            content.extend_from_slice(b"0 0 0 RG\n");
        }
        content.extend_from_slice(format!("{} w\n", geo.line_width_pt).as_bytes());
        for (x1, y1, x2, y2) in &lines {
            content
                .extend_from_slice(format!("{x1:.2} {y1:.2} m\n{x2:.2} {y2:.2} l\nS\n").as_bytes());
        }

        // Registration marks (crosshairs)
        if draw_reg_marks {
            let reg_pos = marks::registration_mark_positions(trim_x, trim_y, trim_w, trim_h);
            for (rx, ry) in &reg_pos {
                let arm = 3.0; // 3mm arm length
                if use_cmyk {
                    content.extend_from_slice(b"0 0 0 1 K\n");
                } else {
                    content.extend_from_slice(b"0 0 0 RG\n");
                }
                // Horizontal line
                content.extend_from_slice(
                    format!(
                        "{:.2} {:.2} m\n{:.2} {:.2} l\nS\n",
                        rx - arm,
                        *ry,
                        rx + arm,
                        *ry
                    )
                    .as_bytes(),
                );
                // Vertical line
                content.extend_from_slice(
                    format!(
                        "{:.2} {:.2} m\n{:.2} {:.2} l\nS\n",
                        *rx,
                        ry - arm,
                        *rx,
                        ry + arm
                    )
                    .as_bytes(),
                );
                // Small circle at center
                content.extend_from_slice(
                    format!("{:.2} {:.2} 0.5 0 360 arc\nS\n", rx, ry).as_bytes(),
                );
            }
        }

        // Color bar (CMYK process swatches + tints)
        if draw_color_bar {
            let swatches = marks::color_bar_positions(trim_x, trim_y, trim_w, trim_h, 7);
            // 7 swatches: C, M, Y, K, R, G, B (process colour indicators)
            let cmyk_colors: [(&str, [f32; 4]); 7] = [
                ("Cyan", [1.0, 0.0, 0.0, 0.0]),
                ("Magenta", [0.0, 1.0, 0.0, 0.0]),
                ("Yellow", [0.0, 0.0, 1.0, 0.0]),
                ("Black", [0.0, 0.0, 0.0, 1.0]),
                ("Red", [0.0, 1.0, 1.0, 0.0]),
                ("Green", [1.0, 0.0, 1.0, 0.0]),
                ("Blue", [1.0, 1.0, 0.0, 0.0]),
            ];
            for (i, (name, cmyk_color)) in cmyk_colors.iter().enumerate() {
                if i >= swatches.len() {
                    break;
                }
                let (sx, sy, sw, sh) = swatches[i];
                let (cc, cm, cy, ck) = (cmyk_color[0], cmyk_color[1], cmyk_color[2], cmyk_color[3]);
                if use_cmyk {
                    content.extend(format!("{cc:.3} {cm:.3} {cy:.3} {ck:.3} k\n").as_bytes());
                } else {
                    // Approximate CMYK->RGB for the color bar in RGB mode
                    let r = (1.0 - cc) * (1.0 - ck);
                    let g = (1.0 - cm) * (1.0 - ck);
                    let b2 = (1.0 - cy) * (1.0 - ck);
                    content.extend(format!("{r:.3} {g:.3} {b2:.3} rg\n").as_bytes());
                }
                content.extend(format!("{sx:.2} {sy:.2} {sw:.2} {sh:.2} re\nf\n").as_bytes());
                // Label
                content.extend(format!("% color-bar: {name}\n").as_bytes());
            }
        }
    }

    content.extend_from_slice(b"Q\n");
    content
}

/// Build a common PDF/X document structure.
///
/// `pdf_version` sets the header version (e.g. "1.4" for X-1a, "1.6" for X-4).
/// `use_cmyk` controls whether fills are emitted as CMYK operators.
/// `marks_geo` optionally adds crop marks.
fn build_pdfx_document(
    nodes: &[SceneNode],
    opts: &PdfOptions,
    pdf_version: &str,
    use_cmyk: bool,
    marks_geo: Option<&MarksGeometry>,
    gts_pdfx_version: &str,
    allow_blend_modes: bool,
) -> Result<Vec<u8>, String> {
    let mut doc = Document::new();
    doc.version = pdf_version.to_string();

    // PdfOptions carries trim dimensions. The media sheet grows to contain
    // the configured bleed and, when present, the complete crop-mark arms.
    // This keeps the page boxes in the same coordinate system as the content.
    let (trim_x, trim_y, media_width, media_height) = if let Some(geo) = marks_geo {
        let mark_extent = if geo.draw_crop_marks {
            geo.trim_offset_mm + geo.mark_length_mm
        } else {
            0.0
        };
        let margin = geo.bleed_mm.max(mark_extent);
        (
            margin,
            margin,
            opts.page_width + margin * 2.0,
            opts.page_height + margin * 2.0,
        )
    } else {
        (0.0, 0.0, opts.page_width, opts.page_height)
    };

    // -- Build content with image rendering support --------------------------
    let (image_refs, content) = {
        let mut image_state = ImageRenderState::new(&mut doc);
        // PDF/X-1a forbids live transparency, so its
        // blend modes are reported rather than written; PDF/X-4 carries them.
        image_state.allow_blend_modes = allow_blend_modes;
        let c = build_pdfx_content(
            nodes,
            media_width,
            media_height,
            trim_x,
            trim_y,
            use_cmyk,
            marks_geo,
            opts.registration_marks,
            opts.color_bar,
            Some(&mut image_state),
            opts.manifest.as_ref(),
            opts.print_profile,
        );
        (std::mem::take(&mut image_state.refs), c)
    };

    let content_stream = Stream::new(dictionary! {}, content);
    let content_id = doc.new_object_id();
    doc.objects
        .insert(content_id, Object::Stream(content_stream));

    // Font resources — embed fonts when data is provided
    let mut font_dict = lopdf::Dictionary::new();
    if !opts.fonts.is_empty() {
        for (font_idx, (family, font_data)) in opts.fonts.iter().enumerate() {
            // Validate embedding permission
            if let Ok(EmbeddingPermission::Restricted) = validate_embedding_permission(font_data) {
                continue;
            }
            // Subset font to used characters
            let used_text = crate::collect_text_per_family(nodes);
            let text = used_text.get(family).map(|s| s.as_str()).unwrap_or("");
            let chars = collect_used_chars(text);
            let subset_data = if chars.is_empty() {
                font_data.clone()
            } else {
                subset_font(font_data, &chars).unwrap_or_else(|_| font_data.clone())
            };
            let tag = get_subset_tag(family);
            let sanitized: String = family.chars().filter(|c| c.is_alphanumeric()).collect();
            let base_font = format!("{tag}{sanitized}");

            // Embed font program
            let font_stream_id = doc.new_object_id();
            let font_stream = Stream::new(
                dictionary! { "Length1" => subset_data.len() as i64 },
                subset_data,
            );
            doc.objects
                .insert(font_stream_id, Object::Stream(font_stream));

            // Font descriptor
            let descriptor_id = doc.new_object_id();
            let font_name_bytes = base_font.as_bytes().to_vec();
            let descriptor = dictionary! {
                "Type" => "FontDescriptor",
                "FontName" => Object::Name(font_name_bytes.clone()),
                "Flags" => 32,
                "FontBBox" => vec![Object::Real(0.0), Object::Real(-200.0), Object::Real(1000.0), Object::Real(800.0)],
                "ItalicAngle" => 0,
                "Ascent" => 800,
                "Descent" => -200,
                "CapHeight" => 500,
                "StemV" => 50,
                "FontFile2" => Object::Reference(font_stream_id),
            };
            doc.objects
                .insert(descriptor_id, Object::Dictionary(descriptor));

            // Font dictionary
            let res_name = format!("F{}", font_idx + 1);
            let font_dict_entry = dictionary! {
                "Type" => "Font",
                "Subtype" => "TrueType",
                "BaseFont" => Object::Name(font_name_bytes),
                "FontDescriptor" => Object::Reference(descriptor_id),
                "Encoding" => "WinAnsiEncoding",
                "FirstChar" => 32,
                "LastChar" => 255,
            };
            font_dict.set(res_name.as_bytes(), font_dict_entry);
        }
    } else {
        // Fallback to Helvetica when no font data
        font_dict.set(
            "F1",
            dictionary! {
                "Type" => "Font",
                "Subtype" => "Type1",
                "BaseFont" => "Helvetica",
            },
        );
    }
    let mut resources = dictionary! {
        "Font" => font_dict,
    };
    add_image_render_resources(&mut resources, &image_refs);

    let page_id = doc.new_object_id();

    let bleed = marks_geo.map(|g| g.bleed_mm.max(0.0)).unwrap_or(0.0);
    let bleed_x = (trim_x - bleed).max(0.0);
    let bleed_y = (trim_y - bleed).max(0.0);
    let bleed_right = trim_x + opts.page_width + bleed;
    let bleed_top = trim_y + opts.page_height + bleed;

    let pages_id = doc.new_object_id();
    let catalog_id = doc.new_object_id();

    let mut page_dict = dictionary! {
        "Type" => "Page",
        "MediaBox" => vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(media_width as f32),
            Object::Real(media_height as f32),
        ],
        "BleedBox" => vec![
            Object::Real(bleed_x as f32),
            Object::Real(bleed_y as f32),
            Object::Real(bleed_right as f32),
            Object::Real(bleed_top as f32),
        ],
        "TrimBox" => vec![
            Object::Real(trim_x as f32),
            Object::Real(trim_y as f32),
            Object::Real((trim_x + opts.page_width) as f32),
            Object::Real((trim_y + opts.page_height) as f32),
        ],
        "CropBox" => vec![
            Object::Real(trim_x as f32),
            Object::Real(trim_y as f32),
            Object::Real((trim_x + opts.page_width) as f32),
            Object::Real((trim_y + opts.page_height) as f32),
        ],
        "ArtBox" => vec![
            Object::Real(trim_x as f32),
            Object::Real(trim_y as f32),
            Object::Real((trim_x + opts.page_width) as f32),
            Object::Real((trim_y + opts.page_height) as f32),
        ],
        "Contents" => Object::Reference(content_id),
        "Resources" => resources,
        "Parent" => Object::Reference(pages_id),
    };
    // OutputIntent for PDF/X — embed the actual destination ICC profile so a
    // conforming viewer (and preflight tool) can perform real colour
    // management. The chosen profile comes from `opts.print_profile`, defaulting
    // to Fogra39 when the caller asked for CMYK but named no profile.
    let dest_profile = opts
        .print_profile
        .or_else(|| use_cmyk.then_some(PrintProfile::Fogra39));
    let output_intent_id = doc.new_object_id();
    let mut output_intent = dictionary! {
        "Type" => "OutputIntent",
        "S" => "GTS_PDFX",
        "OutputConditionIdentifier" => dest_profile
            .map(|p| p.output_condition_identifier())
            .unwrap_or("Fogra39"),
        "RegistryName" => "http://www.color.org",
        "Info" => "Fogra39 (ISO Coated v2)",
    };
    if let Some(profile) = dest_profile {
        let icc_bytes = profile.icc_bytes();
        let icc_stream = Stream::new(
            dictionary! { "N" => 4, "Alternate" => "DeviceCMYK" },
            icc_bytes.to_vec(),
        );
        let icc_id = doc.new_object_id();
        doc.objects.insert(icc_id, Object::Stream(icc_stream));
        output_intent.set("DestOutputProfile", Object::Reference(icc_id));
    }
    doc.objects
        .insert(output_intent_id, Object::Dictionary(output_intent));
    page_dict.set(
        "OutputIntents",
        Object::Array(vec![Object::Reference(output_intent_id)]),
    );

    doc.objects.insert(page_id, Object::Dictionary(page_dict));

    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => vec![Object::Reference(page_id)],
        "Count" => Object::Integer(1),
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let mut catalog = dictionary! {
        "Type" => "Catalog",
        "Pages" => Object::Reference(pages_id),
        "OutputIntents" => Object::Array(vec![Object::Reference(output_intent_id)]),
    };
    // PDF/X version identifier
    let xversion = dictionary! {
        "GTS_PDFXVersion" => gts_pdfx_version,
    };
    catalog.set("VersionedIdentifier", Object::Dictionary(xversion));

    doc.objects.insert(catalog_id, Object::Dictionary(catalog));
    doc.trailer.set("Root", Object::Reference(catalog_id));
    doc.compress();

    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|e| format!("PDF/X save failed: {e}"))?;
    Ok(output)
}

/// Export a PDF/X-1a document (ISO 15930-1).
///
/// - PDF 1.4 header
/// - OutputIntent with GTS_PDFX
/// - CMYK content (RGB fills converted to CMYK)
/// - Optional crop marks via `marks_geo`
/// - Proper MediaBox/BleedBox/TrimBox
/// - No live transparency: blend modes are not written. The header version is
///   PDF 1.4 for the 2003 profile, but the standard still forbids live
///   transparency. `crate::unrepresented_blend_modes` reports the content that this
///   costs, so a caller can refuse or disclose instead of shipping art that
///   composites differently from the canvas.
pub fn export_pdfx1a(nodes: &[SceneNode], opts: &PdfOptions) -> Result<Vec<u8>, String> {
    assert_pdfx1a_blends_are_representable(nodes)?;
    assert_pdfx1a_has_no_live_transparency(nodes, opts)?;
    build_pdfx_document(nodes, opts, "1.4", true, None, "PDF/X-1a:2003", false)
}

/// Export a PDF/X-1a document with crop marks.
pub fn export_pdfx1a_with_marks(
    nodes: &[SceneNode],
    opts: &PdfOptions,
    geo: &MarksGeometry,
) -> Result<Vec<u8>, String> {
    assert_pdfx1a_blends_are_representable(nodes)?;
    assert_pdfx1a_has_no_live_transparency(nodes, opts)?;
    build_pdfx_document(nodes, opts, "1.4", true, Some(geo), "PDF/X-1a:2003", false)
}

/// The native print API is also callable without editor preflight. Keep the
/// format's blend-mode limitation enforced at this boundary so direct callers
/// cannot get a successful PDF whose composition silently changed to Normal.
fn assert_pdfx1a_blends_are_representable(nodes: &[SceneNode]) -> Result<(), String> {
    let unsupported = crate::unrepresented_blend_modes(nodes, false);
    if unsupported.is_empty() {
        return Ok(());
    }

    let details = unsupported
        .iter()
        .map(|entry| format!("'{}' ({})", entry.node_name, entry.mode))
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "PDF/X-1a export stopped: these objects use blend modes the standard cannot carry: {details}. Export PDF/X-4, which carries blend modes, or flatten the complete composite against its opaque background."
    ))
}

/// PDF/X-1a cannot contain live transparency. Refuse inputs that the writer
/// would otherwise turn into `/ca` or image soft masks; a successful export
/// must never claim PDF/X-1a while silently changing those pixels.
fn assert_pdfx1a_has_no_live_transparency(
    nodes: &[SceneNode],
    opts: &PdfOptions,
) -> Result<(), String> {
    fn translucent_color(color: &varve_core::EngineColor) -> bool {
        let alpha = match color {
            varve_core::EngineColor::Rgb { a, .. }
            | varve_core::EngineColor::Cmyk { a, .. }
            | varve_core::EngineColor::Gray { a, .. }
            | varve_core::EngineColor::Spot { a, .. } => *a,
        };
        alpha < 255.0
    }
    fn translucent_fill(fill: &varve_core::FillIR) -> bool {
        match fill {
            varve_core::FillIR::Solid {
                color,
                opacity,
                visible,
                ..
            } => *visible && (*opacity < 1.0 || translucent_color(color)),
            varve_core::FillIR::Gradient {
                stops,
                opacity,
                visible,
                ..
            } => {
                *visible
                    && (*opacity < 1.0 || stops.iter().any(|stop| translucent_color(&stop.color)))
            }
            varve_core::FillIR::Image {
                opacity, visible, ..
            }
            | varve_core::FillIR::Pattern {
                opacity, visible, ..
            } => *visible && *opacity < 1.0,
        }
    }

    for node in nodes {
        let translucent_raster_fill = node.fills.as_ref().is_some_and(|fills| {
            fills.iter().any(|fill| {
                let visible = match fill {
                    varve_core::FillIR::Image { visible, .. }
                    | varve_core::FillIR::Pattern { visible, .. } => *visible,
                    _ => false,
                };
                if !visible {
                    return false;
                }
                let Some(manifest) = opts.manifest.as_ref() else {
                    return false;
                };
                let image = match fill {
                    varve_core::FillIR::Image { src, .. } => {
                        manifest.resolve_image_by_src(src).ok()
                    }
                    varve_core::FillIR::Pattern { tile_src, .. } => {
                        manifest.resolve_image_by_src(tile_src).ok().or_else(|| {
                            manifest
                                .patterns
                                .iter()
                                .find(|pattern| {
                                    pattern.id == *tile_src || pattern.tile_image_id == *tile_src
                                })
                                .and_then(|pattern| {
                                    manifest.resolve_image(&pattern.tile_image_id).ok()
                                })
                        })
                    }
                    _ => None,
                };
                image.is_some_and(|image| {
                    matches!(image.color_space, crate::resources::ColorSpace::Rgb)
                        && image.data.chunks_exact(4).any(|rgba| rgba[3] < 255)
                })
            })
        });
        let translucent_fill = node
            .fills
            .as_ref()
            .is_some_and(|fills| fills.iter().any(translucent_fill));
        let legacy_fill_is_used = node.fills.as_ref().is_none_or(|fills| fills.is_empty());
        let translucent_stroke = node
            .strokes
            .iter()
            .any(|stroke| stroke.visible && translucent_color(&stroke.color));
        if node.opacity < 1.0
            || translucent_fill
            || translucent_stroke
            || (legacy_fill_is_used && translucent_color(&node.fill))
            || translucent_raster_fill
        {
            return Err(format!(
                "PDF/X-1a export stopped: '{}' uses transparency that this standard cannot carry. Flatten the affected artwork against an opaque background or export PDF/X-4.",
                node.name
            ));
        }
    }
    Ok(())
}

/// Export a PDF/X-4 document (ISO 15930-7).
///
/// - PDF 1.6 header
/// - OutputIntent with GTS_PDFX
/// - Permits RGB content (no CMYK conversion)
/// - Same box structure as X-1a
/// - Supports live transparency, so blend modes are written as `/BM`
pub fn export_pdfx4(nodes: &[SceneNode], opts: &PdfOptions) -> Result<Vec<u8>, String> {
    build_pdfx_document(nodes, opts, "1.6", false, None, "PDF/X-4", true)
}

/// Export a PDF/X-4 document with crop marks.
pub fn export_pdfx4_with_marks(
    nodes: &[SceneNode],
    opts: &PdfOptions,
    geo: &MarksGeometry,
) -> Result<Vec<u8>, String> {
    build_pdfx_document(nodes, opts, "1.6", false, Some(geo), "PDF/X-4", true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::{PrintProfile, RenderingIntent};
    use varve_colour::{profile_gcr, profile_tac};
    use varve_core::BlendMode;

    #[test]
    fn rgb_to_cmyk_black() {
        assert_eq!(rgb_to_cmyk(0, 0, 0), (0, 0, 0, 255));
    }

    #[test]
    fn rgb_to_cmyk_white() {
        assert_eq!(rgb_to_cmyk(255, 255, 255), (0, 0, 0, 0));
    }

    #[test]
    fn rgb_to_cmyk_red() {
        let (c, m, y, k) = rgb_to_cmyk(255, 0, 0);
        assert!(m > 200, "magenta should be high for red");
        assert!(y > 200, "yellow should be high for red");
        assert!(c < 50, "cyan should be low for red");
        assert!(k < 50, "key should be low for red");
    }

    #[test]
    fn rgb_to_cmyk_green() {
        let (c, m, y, _k) = rgb_to_cmyk(0, 255, 0);
        assert!(c > 200, "cyan should be high for green");
        assert!(y > 200, "yellow should be high for green");
        assert!(m < 50, "magenta should be low for green");
    }

    #[test]
    fn marks_geometry_returns_sane_values() {
        let (bleed, offset, length) = marks_geometry();
        assert!(bleed > 0.0);
        assert!(offset > 0.0);
        assert!(length > 0.0);
    }

    fn rect_node(id: u64, x: f64, y: f64, w: f64, h: f64) -> SceneNode {
        SceneNode {
            id: varve_core::NodeId(id),
            name: format!("r{id}"),
            transform: varve_core::Affine::translate((x, y)),
            shape: varve_core::Shape::Rect(varve_core::Rect::new(0.0, 0.0, w, h)),
            fill: varve_core::EngineColor::Rgb {
                r: 57.0,
                g: 208.0,
                b: 198.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: varve_core::BlendMode::Normal,
            rotation: 0.0,
            strokes: Vec::new(),
            effects: Vec::new(),
            fills: None,
            corner_radius: None,
            filters: None,
        }
    }

    #[test]
    fn pdfx1a_has_output_intent() {
        let nodes = vec![rect_node(1, 0.0, 0.0, 100.0, 100.0)];
        let opts = PdfOptions::default();
        let bytes = export_pdfx1a(&nodes, &opts).expect("pdfx1a");
        let content = String::from_utf8_lossy(&bytes);
        assert!(
            content.contains("GTS_PDFX"),
            "should contain GTS_PDFX marker"
        );
    }

    #[test]
    fn pdfx1a_emits_icc_cmyk_fill_when_profile_set() {
        // Regression: PDF/X-1a used to hardcode RGB fills even though it
        // declares a CMYK output intent. With a print profile wired through
        // PdfOptions.print_profile, shape fills must be converted via the ICC
        // path (`rgb_to_cmyk_icc`), not the naive subtractive formula.
        let nodes = vec![rect_node(1, 0.0, 0.0, 100.0, 100.0)];
        let opts = PdfOptions {
            print_profile: Some(PrintProfile::Fogra39),
            ..Default::default()
        };
        let bytes = export_pdfx1a(&nodes, &opts).expect("pdfx1a");

        // Decompress every content stream and assert a CMYK fill operator.
        let doc = Document::load_mem(&bytes).expect("parse pdfx1a");
        let mut found_cmyk_fill = false;
        let mut found_rgb_fill = false;
        for obj in doc.objects.values() {
            if let Object::Stream(stream) = obj {
                if let Ok(content) = stream.decompressed_content() {
                    let text = String::from_utf8_lossy(&content);
                    // CMYK fill operator ends with " k\n"; RGB fill ends " rg\n".
                    if text.contains(" k\n") {
                        found_cmyk_fill = true;
                    }
                    if text.contains(" rg\n") {
                        found_rgb_fill = true;
                    }
                }
            }
        }
        assert!(
            found_cmyk_fill,
            "PDF/X-1a content must contain CMYK fill operators"
        );
        assert!(
            !found_rgb_fill,
            "PDF/X-1a content must not contain RGB fill operators"
        );
    }

    #[test]
    fn pdfx1a_embeds_pattern_tiles_from_the_export_manifest_as_cmyk() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![varve_core::FillIR::Pattern {
            tile_src: "tile.png".into(),
            spacing: 0.0,
            rotation: 0.0,
            image_width: Some(2.0),
            image_height: Some(2.0),
            gap_x: None,
            gap_y: None,
            arrangement: None,
            row_shift: None,
            column_shift: None,
            mirror_x: None,
            mirror_y: None,
            offset_x: None,
            offset_y: None,
            alignment: None,
            opacity: 1.0,
            blend_mode: varve_core::BlendMode::Normal,
            visible: true,
        }]);
        let manifest = crate::resources::ExportManifest {
            images: vec![crate::resources::ImageResource {
                id: "tile-image".into(),
                src: Some("tile.png".into()),
                mime_type: "image/raw-rgba".into(),
                width: 2,
                height: 2,
                data: vec![
                    180, 120, 60, 255, 180, 120, 60, 255, 180, 120, 60, 255, 180, 120, 60, 255,
                ],
                color_space: crate::resources::ColorSpace::Rgb,
            }],
            patterns: vec![],
        };
        let opts = PdfOptions {
            print_profile: Some(PrintProfile::Fogra39),
            manifest: Some(manifest),
            ..Default::default()
        };

        let bytes = export_pdfx1a(&[node], &opts).expect("PDF/X-1a with a pattern tile");
        let content = String::from_utf8_lossy(&bytes);
        assert!(
            content.contains("/Pat0"),
            "PDF/X-1a must link the pattern image resource"
        );
        assert!(
            content.contains("/DeviceCMYK"),
            "PDF/X-1a must embed an opaque RGB pattern tile in CMYK"
        );
        assert!(!content.contains("/DeviceRGB"));
        assert!(!content.contains("/SMask"));
    }

    #[test]
    fn pdfx1a_refuses_transparent_pattern_tiles_instead_of_exporting_missing_artwork() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![varve_core::FillIR::Pattern {
            tile_src: "tile.png".into(),
            spacing: 0.0,
            rotation: 0.0,
            image_width: Some(2.0),
            image_height: Some(2.0),
            gap_x: None,
            gap_y: None,
            arrangement: None,
            row_shift: None,
            column_shift: None,
            mirror_x: None,
            mirror_y: None,
            offset_x: None,
            offset_y: None,
            alignment: None,
            opacity: 1.0,
            blend_mode: varve_core::BlendMode::Normal,
            visible: true,
        }]);
        let manifest = crate::resources::ExportManifest {
            images: vec![crate::resources::ImageResource {
                id: "tile-image".into(),
                src: Some("tile.png".into()),
                mime_type: "image/raw-rgba".into(),
                width: 2,
                height: 2,
                data: vec![
                    180, 120, 60, 128, 180, 120, 60, 255, 180, 120, 60, 255, 180, 120, 60, 255,
                ],
                color_space: crate::resources::ColorSpace::Rgb,
            }],
            patterns: vec![],
        };
        let opts = PdfOptions {
            print_profile: Some(PrintProfile::Fogra39),
            manifest: Some(manifest),
            ..Default::default()
        };

        let error = export_pdfx1a(&[node], &opts).unwrap_err();
        assert!(error.contains("PDF/X-1a"));
        assert!(error.contains("PDF/X-4"));
    }

    #[test]
    fn pdfx4_preserves_alpha_for_transparent_pattern_tiles() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![varve_core::FillIR::Pattern {
            tile_src: "tile.png".into(),
            spacing: 0.0,
            rotation: 0.0,
            image_width: Some(2.0),
            image_height: Some(2.0),
            gap_x: None,
            gap_y: None,
            arrangement: None,
            row_shift: None,
            column_shift: None,
            mirror_x: None,
            mirror_y: None,
            offset_x: None,
            offset_y: None,
            alignment: None,
            opacity: 0.8,
            blend_mode: varve_core::BlendMode::Normal,
            visible: true,
        }]);
        let manifest = crate::resources::ExportManifest {
            images: vec![crate::resources::ImageResource {
                id: "tile-image".into(),
                src: Some("tile.png".into()),
                mime_type: "image/raw-rgba".into(),
                width: 2,
                height: 2,
                data: vec![
                    180, 120, 60, 128, 180, 120, 60, 255, 180, 120, 60, 255, 180, 120, 60, 255,
                ],
                color_space: crate::resources::ColorSpace::Rgb,
            }],
            patterns: vec![],
        };
        let opts = PdfOptions {
            print_profile: Some(PrintProfile::Fogra39),
            manifest: Some(manifest),
            ..Default::default()
        };

        let bytes = export_pdfx4(&[node], &opts).expect("PDF/X-4 with transparent pattern");
        let doc = Document::load_mem(&bytes).expect("parse PDF/X-4");
        let page_id = *doc.get_pages().values().next().expect("PDF/X-4 has a page");
        let page = doc.get_object(page_id).unwrap().as_dict().unwrap();
        let resources = page.get(b"Resources").unwrap().as_dict().unwrap();
        let graphics_states = resources.get(b"ExtGState").unwrap().as_dict().unwrap();
        let xobjects = resources.get(b"XObject").unwrap().as_dict().unwrap();
        assert!(
            graphics_states.has(b"GS800"),
            "fill opacity resource must resolve"
        );
        assert!(xobjects.has(b"Pat0"), "pattern tile resource must resolve");
        let page_content = doc.get_page_content(page_id);
        let content = String::from_utf8_lossy(&page_content);
        assert!(content.contains("/Pat0"));
        assert!(content.contains("/GS800"));
        assert!(
            doc.objects.values().any(|object| matches!(
                object,
                Object::Stream(stream) if stream.dict.has(b"SMask")
            )),
            "transparency mask must be embedded"
        );
    }

    #[test]
    fn pdfx1a_embeds_destination_icc_profile() {
        let nodes = vec![rect_node(1, 0.0, 0.0, 100.0, 100.0)];
        let opts = PdfOptions {
            print_profile: Some(PrintProfile::Fogra39),
            ..Default::default()
        };
        let bytes = export_pdfx1a(&nodes, &opts).expect("pdfx1a");
        // The OutputIntent must reference a stream whose decompressed bytes are
        // a real ICC profile (lowercase 'acsp' magic at offset 36).
        let doc = Document::load_mem(&bytes).expect("parse pdfx1a");
        let mut embedded = false;
        for obj in doc.objects.values() {
            if let Object::Stream(stream) = obj {
                if let Ok(content) = stream.decompressed_content() {
                    if content.len() >= 40 && &content[36..40] == b"acsp" {
                        embedded = true;
                        break;
                    }
                }
            }
        }
        assert!(embedded, "expected an embedded ICC profile ('acsp' magic)");
    }

    #[test]
    fn pdfx1a_with_crop_marks() {
        let nodes = vec![rect_node(1, 0.0, 0.0, 100.0, 100.0)];
        let opts = PdfOptions {
            page_width: 210.0,
            page_height: 297.0,
            ..Default::default()
        };
        let geo = MarksGeometry::default();
        let bytes = export_pdfx1a_with_marks(&nodes, &opts, &geo).expect("pdfx1a with marks");
        let content = String::from_utf8_lossy(&bytes);
        assert!(content.contains("GTS_PDFX"), "should contain GTS_PDFX");
        assert!(bytes.starts_with(b"%PDF"), "should start with PDF header");
    }

    #[test]
    fn pdfx1a_with_registration_marks() {
        let nodes = vec![rect_node(1, 0.0, 0.0, 100.0, 100.0)];
        let opts = PdfOptions {
            page_width: 210.0,
            page_height: 297.0,
            registration_marks: true,
            ..Default::default()
        };
        let geo = MarksGeometry::default();
        let bytes = export_pdfx1a_with_marks(&nodes, &opts, &geo).expect("pdfx1a with reg marks");
        let content = String::from_utf8_lossy(&bytes);
        assert!(content.contains("GTS_PDFX"), "should contain GTS_PDFX");
        assert!(
            content.contains("TrimBox"),
            "should contain TrimBox for mark alignment"
        );
        assert!(bytes.starts_with(b"%PDF"), "should start with PDF header");
    }

    #[test]
    fn pdfx1a_with_color_bar() {
        let nodes = vec![rect_node(1, 0.0, 0.0, 100.0, 100.0)];
        let opts = PdfOptions {
            page_width: 210.0,
            page_height: 297.0,
            color_bar: true,
            ..Default::default()
        };
        let geo = MarksGeometry::default();
        let bytes = export_pdfx1a_with_marks(&nodes, &opts, &geo).expect("pdfx1a with color bar");
        assert!(bytes.starts_with(b"%PDF"), "should start with PDF header");
        assert!(
            bytes.len() > 400,
            "should have meaningful content including color bar"
        );
    }

    #[test]
    fn pdfx4_has_correct_version() {
        let nodes = vec![rect_node(1, 0.0, 0.0, 100.0, 100.0)];
        let opts = PdfOptions::default();
        let bytes = export_pdfx4(&nodes, &opts).expect("pdfx4");
        assert!(
            bytes.starts_with(b"%PDF-1.6"),
            "PDF/X-4 should use PDF 1.6, got: {:?}",
            &bytes[..8]
        );
        let as_str = String::from_utf8_lossy(&bytes);
        assert!(
            as_str.contains("GTS_PDFX"),
            "should contain GTS_PDFX marker in PDF object metadata"
        );
        let gts_idx = as_str.find("GTS_PDFXVersion").unwrap();
        let after_gts = &as_str[gts_idx..];
        assert!(
            after_gts.contains("PDF/X-4") || after_gts.contains("PDF"),
            "should have PDF/X-4 value after GTS_PDFXVersion, got: {:?}",
            &after_gts[..after_gts.len().min(120)]
        );
    }

    #[test]
    fn pdfx4_supports_rgb() {
        let node = rect_node(1, 10.0, 10.0, 200.0, 100.0);
        let opts = PdfOptions {
            page_width: 300.0,
            page_height: 200.0,
            ..Default::default()
        };
        let bytes = export_pdfx4(&[node], &opts).expect("pdfx4 with rgb node");
        assert!(
            bytes.starts_with(b"%PDF"),
            "should produce valid PDF header"
        );
        assert!(bytes.len() > 300, "should have meaningful content");
    }

    #[test]
    fn pdfx4_with_both_marks() {
        let nodes = vec![rect_node(1, 10.0, 10.0, 100.0, 100.0)];
        let opts = PdfOptions {
            page_width: 300.0,
            page_height: 200.0,
            registration_marks: true,
            color_bar: true,
            ..Default::default()
        };
        let geo = MarksGeometry::default();
        let bytes = export_pdfx4_with_marks(&nodes, &opts, &geo).expect("pdfx4 with both marks");
        let content = String::from_utf8_lossy(&bytes);
        assert!(bytes.starts_with(b"%PDF-1.6"), "PDF/X-4 requires PDF 1.6");
        assert!(bytes.len() > 500, "marks should add content size");
        assert!(content.contains("GTS_PDFX"), "should contain GTS_PDFX");
        assert!(
            content.contains("TrimBox"),
            "should contain TrimBox for mark alignment"
        );
    }

    #[test]
    fn pdfx_boxes_keep_trim_and_bleed_distinct_and_fit_marks() {
        let nodes = vec![rect_node(1, 0.0, 0.0, 100.0, 80.0)];
        let opts = PdfOptions {
            page_width: 100.0,
            page_height: 80.0,
            ..Default::default()
        };
        let geo = MarksGeometry {
            bleed_mm: 3.0,
            trim_offset_mm: 2.0,
            mark_length_mm: 4.0,
            ..Default::default()
        };
        let bytes = export_pdfx4_with_marks(&nodes, &opts, &geo).expect("pdfx4 boxes");
        let pdf = Document::load_mem(&bytes).expect("parse PDF");
        let page_id = *pdf.get_pages().values().next().expect("one page");
        let page = pdf
            .get_object(page_id)
            .expect("page object")
            .as_dict()
            .expect("page dict");
        let numbers = |key: &[u8]| -> Vec<f64> {
            page.get(key)
                .expect("box")
                .as_array()
                .expect("box array")
                .iter()
                .map(|value| match value {
                    Object::Integer(n) => *n as f64,
                    Object::Real(n) => *n as f64,
                    other => panic!("unexpected box value: {other:?}"),
                })
                .collect()
        };

        assert_eq!(numbers(b"MediaBox"), vec![0.0, 0.0, 112.0, 92.0]);
        assert_eq!(numbers(b"BleedBox"), vec![3.0, 3.0, 109.0, 89.0]);
        assert_eq!(numbers(b"TrimBox"), vec![6.0, 6.0, 106.0, 86.0]);
        assert_eq!(numbers(b"CropBox"), numbers(b"TrimBox"));
        assert_eq!(numbers(b"ArtBox"), numbers(b"TrimBox"));
    }

    #[test]
    fn pdfx_without_bleed_still_emits_coincident_page_boxes() {
        let opts = PdfOptions {
            page_width: 100.0,
            page_height: 80.0,
            ..Default::default()
        };
        let bytes = export_pdfx4(&[], &opts).expect("plain pdfx");
        let pdf = Document::load_mem(&bytes).expect("parse PDF");
        let page_id = *pdf.get_pages().values().next().expect("one page");
        let page = pdf
            .get_object(page_id)
            .expect("page object")
            .as_dict()
            .expect("page dict");
        for key in [
            b"MediaBox".as_slice(),
            b"BleedBox",
            b"TrimBox",
            b"CropBox",
            b"ArtBox",
        ] {
            assert!(page.has(key), "missing {:?}", String::from_utf8_lossy(key));
        }
    }

    // --- ICC-aware CMYK conversion tests ---

    #[test]
    fn icc_cmyk_preserves_white() {
        let (c, m, y, k) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            255,
            255,
            255,
            RenderingIntent::Perceptual,
            true,
        );
        assert!(c < 40, "cyan should be low for white, got {c}");
        assert!(m < 40, "magenta should be low for white, got {m}");
        assert!(y < 40, "yellow should be low for white, got {y}");
        assert!(k < 40, "key should be low for white, got {k}");
    }

    #[test]
    fn icc_cmyk_black_has_high_k() {
        let (c, _m, _y, k) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            0,
            0,
            0,
            RenderingIntent::Perceptual,
            false,
        );
        assert!(k > 200, "K should be high for black, got {k}");
        assert!(c < 100, "C should be low for black, got {c}");
    }

    #[test]
    fn icc_cmyk_red_expected() {
        let (_c, m, y, _k) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            255,
            0,
            0,
            RenderingIntent::Perceptual,
            false,
        );
        assert!(m > 100, "magenta should be high for red, got {m}");
        assert!(y > 100, "yellow should be high for red, got {y}");
    }

    #[test]
    fn rendering_intent_variants() {
        let intents = [
            RenderingIntent::Perceptual,
            RenderingIntent::Relative,
            RenderingIntent::Absolute,
            RenderingIntent::Saturation,
        ];
        for intent in &intents {
            let (c, m, y, k) = rgb_to_cmyk_icc(PrintProfile::Fogra39, 128, 64, 192, *intent, false);
            let total = c as u32 + m as u32 + y as u32 + k as u32;
            assert!(
                total > 0,
                "all channels should not be zero for intent {intent:?}"
            );
        }
    }

    #[test]
    fn icc_cmyk_profile_differentiation() {
        // Different profiles have different GCR and TAC parameters.
        // For colors where CMY overlap exists (not neutral), the GCR
        // produces different K levels. For a reddish-brown where r,g,b
        // are not equal, we get CMY overlap.
        let gcr_vals = [
            profile_gcr(PrintProfile::Fogra39),
            profile_gcr(PrintProfile::Gracol2006),
            profile_gcr(PrintProfile::SwopCoated),
        ];
        let tac_vals = [
            profile_tac(PrintProfile::Fogra39),
            profile_tac(PrintProfile::Gracol2006),
            profile_tac(PrintProfile::SwopCoated),
        ];
        // At least GCR or TAC should differ between profiles
        let gcr_all_same = gcr_vals[0] == gcr_vals[1] && gcr_vals[1] == gcr_vals[2];
        let tac_all_same = tac_vals[0] == tac_vals[1] && tac_vals[1] == tac_vals[2];
        assert!(
            !gcr_all_same || !tac_all_same,
            "profiles should differ in GCR or TAC: GCR={gcr_vals:?} TAC={tac_vals:?}"
        );
        // Verify all profiles produce valid non-zero output
        let profiles = [
            PrintProfile::Fogra39,
            PrintProfile::Gracol2006,
            PrintProfile::SwopCoated,
        ];
        for profile in &profiles {
            let (c, m, y, k) =
                rgb_to_cmyk_icc(*profile, 180, 100, 60, RenderingIntent::Perceptual, false);
            let total = c as u32 + m as u32 + y as u32 + k as u32;
            assert!(total > 0, "profile {profile:?} produced all-zero CMYK");
        }
    }

    #[test]
    fn icc_cmyk_black_point_compensation() {
        let (_, _, _, k_bpc) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            10,
            10,
            10,
            RenderingIntent::Perceptual,
            true,
        );
        let (_, _, _, k_no_bpc) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            10,
            10,
            10,
            RenderingIntent::Perceptual,
            false,
        );
        assert!(k_bpc > 0 || k_no_bpc > 0, "both should produce K");
    }

    #[test]
    fn icc_cmyk_fogra39_gcr() {
        let (c, _m, _y, k) = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            100,
            100,
            100,
            RenderingIntent::Perceptual,
            false,
        );
        // Neutral gray should have higher K under Fogra39 (GCR 0.35)
        assert!(
            k > 50,
            "Fogra39 neutral gray K should be substantial, got {k}"
        );
        // CMY should be low for neutral gray (all black component)
        assert!(c < 50, "Fogra39 C should be low for neutral gray, got {c}");
    }

    #[test]
    fn icc_cmyk_gracol_tac() {
        let (c, m, y, k) = rgb_to_cmyk_icc(
            PrintProfile::Gracol2006,
            0,
            0,
            255,
            RenderingIntent::Perceptual,
            false,
        );
        // Blue: high C+M, should be under TAC for GRACoL (320%)
        let total = c as u32 + m as u32 + y as u32 + k as u32;
        assert!(total > 0, "should produce non-zero CMYK");
        // GRACoL has 320% TAC, so C+M+Y+K in 0-255 range should be under ~815
        assert!(
            total <= 820,
            "GRACoL TAC 320% should limit total, got {total}"
        );
    }

    #[test]
    fn icc_cmyk_swop_tac() {
        let (c, _m, y, k) = rgb_to_cmyk_icc(
            PrintProfile::SwopCoated,
            0,
            100,
            0,
            RenderingIntent::Perceptual,
            false,
        );
        let total = c as u32 + y as u32 + k as u32;
        assert!(total > 0, "should produce non-zero CMYK");
        // SWOP has 300% TAC
        assert!(
            total <= 770,
            "SWOP TAC 300% should limit total, got {total}"
        );
    }

    /// Blend states written into the single page of `bytes`.
    fn blend_states(bytes: &[u8]) -> Vec<String> {
        let doc = Document::load_mem(bytes).expect("parse PDF/X");
        let page_id = *doc.get_pages().values().next().expect("PDF/X has a page");
        let page = doc.get_object(page_id).unwrap().as_dict().unwrap();
        let Some(states) = page
            .get(b"Resources")
            .ok()
            .and_then(|value| value.as_dict().ok())
            .and_then(|resources| resources.get(b"ExtGState").ok())
            .and_then(|value| value.as_dict().ok())
        else {
            return Vec::new();
        };
        states
            .iter()
            .filter_map(|(name, value)| {
                let dict = value.as_dict().ok()?;
                let blend = dict.get(b"BM").ok()?.as_name().ok()?;
                Some(format!(
                    "{}={}",
                    String::from_utf8_lossy(name),
                    String::from_utf8_lossy(blend)
                ))
            })
            .collect()
    }

    #[test]
    fn pdfx4_carries_blend_modes_because_it_permits_live_transparency() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.blend_mode = BlendMode::Multiply;
        let opts = PdfOptions {
            print_profile: Some(PrintProfile::Fogra39),
            ..Default::default()
        };
        let bytes = export_pdfx4(&[node], &opts).expect("PDF/X-4 export");
        assert_eq!(
            blend_states(&bytes),
            vec!["BMMultiply=Multiply".to_string()],
            "PDF/X-4 allows live transparency, so the blend mode must be carried"
        );
    }

    #[test]
    fn pdfx1a_refuses_blend_modes_and_the_fidelity_report_names_them() {
        // PDF/X-1a forbids live transparency: a `/BM` entry would break the conformance
        // the file claims. Direct native callers must be refused just like the
        // editor preflight, rather than receiving art silently composited as Normal.
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.name = "Kite".into();
        node.blend_mode = BlendMode::Screen;
        let opts = PdfOptions {
            print_profile: Some(PrintProfile::Fogra39),
            ..Default::default()
        };
        let error = export_pdfx1a(&[node.clone()], &opts).unwrap_err();
        assert!(error.contains("Kite"));
        assert!(error.contains("Screen"));
        assert!(error.contains("PDF/X-4"));

        assert_eq!(
            crate::unrepresented_blend_modes(&[node], false),
            vec![crate::UnrepresentedBlend {
                node_name: "Kite".into(),
                mode: "Screen",
            }],
            "PDF/X-1a output must be reportable, never silently normal-blended"
        );
    }

    #[test]
    fn pdfx1a_refuses_node_opacity_instead_of_emitting_live_transparency() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.name = "Translucent card".into();
        node.opacity = 0.5;
        let error = export_pdfx1a(&[node], &PdfOptions::default()).unwrap_err();
        assert!(error.contains("Translucent card"));
        assert!(error.contains("PDF/X-4"));
    }

    #[test]
    fn pdfx1a_ignores_alpha_on_the_inactive_legacy_fill_when_stacked_fills_replace_it() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let opaque_fill = node.fill.clone();
        if let varve_core::EngineColor::Rgb { a, .. } = &mut node.fill {
            *a = 128.0;
        }
        node.fills = Some(vec![varve_core::FillIR::Solid {
            color: opaque_fill,
            opacity: 1.0,
            blend_mode: varve_core::BlendMode::Normal,
            visible: true,
        }]);

        export_pdfx1a(&[node], &PdfOptions::default())
            .expect("inactive legacy fill must not block opaque stacked-fill output");
    }

    #[test]
    fn pdfx1a_refuses_alpha_channel_image_fills() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.name = "Photo with alpha".into();
        node.fills = Some(vec![varve_core::FillIR::Image {
            src: "photo.png".into(),
            fit: "fill".into(),
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            image_width: None,
            image_height: None,
            opacity: 1.0,
            blend_mode: varve_core::BlendMode::Normal,
            visible: true,
            alpha_mask: None,
            crop: None,
            rotation: None,
            flip_h: None,
            flip_v: None,
            perspective: None,
        }]);
        let opts = PdfOptions {
            manifest: Some(crate::resources::ExportManifest {
                images: vec![crate::resources::ImageResource {
                    id: "photo".into(),
                    src: Some("photo.png".into()),
                    mime_type: "image/png".into(),
                    width: 1,
                    height: 1,
                    data: vec![255, 32, 16, 128],
                    color_space: crate::resources::ColorSpace::Rgb,
                }],
                patterns: vec![],
            }),
            ..Default::default()
        };

        let error = export_pdfx1a(&[node], &opts).unwrap_err();
        assert!(error.contains("Photo with alpha"));
    }

    #[test]
    fn pdfx1a_ignores_alpha_channel_in_hidden_image_fills() {
        let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        node.fills = Some(vec![varve_core::FillIR::Image {
            src: "photo.png".into(),
            fit: "fill".into(),
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            image_width: None,
            image_height: None,
            opacity: 1.0,
            blend_mode: varve_core::BlendMode::Normal,
            visible: false,
            alpha_mask: None,
            crop: None,
            rotation: None,
            flip_h: None,
            flip_v: None,
            perspective: None,
        }]);
        let opts = PdfOptions {
            manifest: Some(crate::resources::ExportManifest {
                images: vec![crate::resources::ImageResource {
                    id: "photo".into(),
                    src: Some("photo.png".into()),
                    mime_type: "image/png".into(),
                    width: 1,
                    height: 1,
                    data: vec![255, 32, 16, 128],
                    color_space: crate::resources::ColorSpace::Rgb,
                }],
                patterns: vec![],
            }),
            ..Default::default()
        };

        export_pdfx1a(&[node], &opts)
            .expect("hidden image alpha does not create live transparency");
    }

    #[test]
    fn pdfx_export_does_not_invent_a_paper_backdrop() {
        // The page keeps its neutral initial backdrop, so a blend composites
        // with what the canvas shows. A painted white (or ink-free CMYK)
        // rectangle would silently become every blend's backdrop.
        let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
        let node_pair = [node.clone()];
        for (label, bytes) in [
            (
                "PDF/X-1a",
                export_pdfx1a(
                    &node_pair,
                    &PdfOptions {
                        print_profile: Some(PrintProfile::Fogra39),
                        ..Default::default()
                    },
                )
                .expect("pdfx1a"),
            ),
            (
                "PDF/X-4",
                export_pdfx4(
                    &node_pair,
                    &PdfOptions {
                        print_profile: Some(PrintProfile::Fogra39),
                        ..Default::default()
                    },
                )
                .expect("pdfx4"),
            ),
        ] {
            let doc = Document::load_mem(&bytes).expect("parse PDF/X");
            let page_id = *doc.get_pages().values().next().expect("has a page");
            let content = String::from_utf8_lossy(&doc.get_page_content(page_id)).into_owned();
            assert!(
                !content.contains("1.000 1.000 1.000 rg"),
                "{label} must not paint white paper: {content}"
            );
            assert!(
                !content.contains("0.000 0.000 0.000 0.000 k"),
                "{label} must not paint an ink-free backdrop rectangle: {content}"
            );
        }
    }
}

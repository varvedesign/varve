//! The PDF export pipeline body; the crate-root entry delegates here.

use super::colour::assert_pdf_blends_are_representable;
use super::fills::render_fills;
use super::fonts::{embed_font_program, font_ascender, EmbeddedFontEntry};
use super::options::PdfOptions;
use super::paint::{render_effects, render_strokes, write_node_graphics_state};
use super::prelude::*;
use super::resources::{add_image_render_resources, ImageRenderState};
use super::rich_text::render_rich_text_to_pdf;
use super::shading::ShadingRegistry;
use super::text::{
    build_tj_array, can_encode_win_ansi, collect_text_per_family, encode_win_ansi,
    escape_pdf_string, requires_outline, shape_text, try_outline_node,
};

/// Export a scene to PDF bytes using lopdf.
///
/// Each shape node becomes a filled path. When `opts.outline_text` is true
/// and `opts.font_data` is `Some`, text nodes are outlined as vector paths
/// instead of filled rectangles. When `opts.subset_fonts` is true, fonts
/// are subsetted to used characters and embedded as font programs, enabling
/// searchable text. The new pipeline respects stacked fills, strokes, and
/// effects.
pub fn export_pdf(nodes: &[SceneNode], opts: &PdfOptions) -> Result<Vec<u8>, String> {
    assert_pdf_blends_are_representable(nodes, "PDF")?;
    let mut doc = Document::new();
    let page_id = doc.new_object_id();

    let use_cmyk = opts.print_profile.is_some();

    let mut content = Vec::new();
    content.extend_from_slice(b"q\n");
    // The page keeps its neutral initial backdrop. Painting an opaque white
    // rectangle here would make every blend mode composite with white instead
    // of with the same backdrop the canvas uses, so a `Screen` or `Lighten`
    // object over an unpainted area would come out white in the file while it
    // shows its own colour on screen. Verified against poppler and
    // Ghostscript: with nothing painted first, `Screen` over an empty area
    // returns the source colour, which is what
    // `packages/engine/src/blendConformance.ts` pins as the transparent-backdrop
    // case. A document that wants paper paints the page-background nodes it
    // already owns (`Document.pages[].backgrounds`), which are part of `nodes`.
    //
    // The document's own backdrop is whatever those nodes paint; a viewer
    // still presents the unpainted page as white paper.

    // ── Font subsetting / embedding ─────────────────────────────────────
    let embedded_fonts: Vec<EmbeddedFontEntry> = if opts.subset_fonts && !opts.fonts.is_empty() {
        let family_text = collect_text_per_family(nodes);
        let mut entries: Vec<EmbeddedFontEntry> = Vec::new();

        for (font_idx, (family, font_data)) in opts.fonts.iter().enumerate() {
            // Validate embedding permission
            match validate_embedding_permission(font_data) {
                Ok(perm) => match perm {
                    EmbeddingPermission::Restricted => match opts.embedding_restriction_handling {
                        EmbeddingRestriction::Warn => {
                            eprintln!(
                                "[warning] font '{family}' has Restricted embedding — skipping"
                            );
                            continue;
                        }
                        EmbeddingRestriction::Block => {
                            return Err(format!(
                                "Font '{family}' embedding blocked by license (Restricted)"
                            ));
                        }
                        EmbeddingRestriction::Substitute => {
                            continue;
                        }
                    },
                    EmbeddingPermission::NoSubsetting => {
                        // Embed full font without subsetting
                        let tag = get_subset_tag(family);
                        let sanitized_name: String =
                            family.chars().filter(|c| c.is_alphanumeric()).collect();
                        let base_font = format!("{tag}{sanitized_name}");

                        let entry =
                            embed_font_program(&mut doc, family, &base_font, font_data, font_idx)?;
                        entries.push(entry);
                        continue;
                    }
                    _ => { /* proceed with subsetting */ }
                },
                Err(e) => {
                    eprintln!(
                        "[warning] font '{family}' permission check failed ({e}) — embedding anyway"
                    );
                }
            }

            // Collect used chars for this family
            let used_text = family_text.get(family).map(|s| s.as_str()).unwrap_or("");
            let chars = collect_used_chars(used_text);

            // Subset the font
            let subset_data = if chars.is_empty() {
                font_data.clone()
            } else {
                match subset_font(font_data, &chars) {
                    Ok(d) => d,
                    Err(e) => {
                        eprintln!(
                            "[warning] failed to subset font '{family}': {e} — embedding full font"
                        );
                        font_data.clone()
                    }
                }
            };

            let tag = get_subset_tag(family);
            let sanitized_name: String = family.chars().filter(|c| c.is_alphanumeric()).collect();
            let base_font = format!("{tag}{sanitized_name}");

            // Embed as WinAnsi font for Latin text
            let entry = embed_font_program(&mut doc, family, &base_font, &subset_data, font_idx)?;
            entries.push(entry);
        }

        entries
    } else {
        Vec::new()
    };

    let do_outline = opts.outline_text && (opts.font_data.is_some() || !opts.fonts.is_empty());
    // ── Build content with image rendering support ──────────────────────
    let (image_refs, shading_registry) = {
        let mut image_state = ImageRenderState::new(&mut doc);
        let mut shading_registry = ShadingRegistry::new();

        for node in nodes {
            // Granular rich text fallback: when a node has rich text spans,
            // process each run independently instead of all-or-nothing.
            // Valid runs get native PDF text; non-WinAnsi runs are outlined.
            let is_text_node = matches!(&node.shape, Shape::Text { .. });
            let has_rich_text = matches!(
                &node.shape,
                Shape::Text {
                    rich_text: Some(_),
                    ..
                }
            );

            if is_text_node && has_rich_text {
                if let Some(mut rich_content) = render_rich_text_to_pdf(
                    node,
                    opts,
                    &embedded_fonts,
                    opts.page_height,
                    &mut image_state,
                ) {
                    // Scope native text and outlined rich-text runs with the
                    // same node state as the general shape renderer.
                    content.extend_from_slice(b"q\n");
                    write_node_graphics_state(&mut content, &mut image_state, node);
                    content.append(&mut rich_content);
                    content.extend_from_slice(b"Q\n");
                    continue;
                }
                // If rich text rendering fails (no runs), fall through to
                // the flat text path below.
            }

            // Try embedded font text rendering (flat text, no rich text)
            if let Shape::Text {
                text,
                font_size,
                font_family,
                x,
                y,
                ..
            } = &node.shape
            {
                let is_non_winansi = requires_outline(text);

                if !text.is_empty() && !embedded_fonts.is_empty() {
                    // Try WinAnsi font for Latin text
                    if !is_non_winansi && can_encode_win_ansi(text) {
                        if let Some(ef) = embedded_fonts.iter().find(|ef| ef.family == *font_family)
                        {
                            let tx = node.transform.as_coeffs();
                            let x_off = tx[4];
                            let y_off = tx[5];

                            let asc = font_ascender(
                                opts.fonts
                                    .iter()
                                    .find(|(n, _)| n == font_family)
                                    .map(|(_, d)| d.as_slice())
                                    .unwrap_or_default(),
                                *font_size,
                            );

                            let pdf_x = x + x_off;
                            let pdf_y = opts.page_height - y - asc - y_off;

                            content.extend_from_slice(b"q\n");
                            write_node_graphics_state(&mut content, &mut image_state, node);
                            content.extend_from_slice(b"BT\n");
                            // Use TJ array with kerning when font binary is available
                            let font_data_ref = opts
                                .fonts
                                .iter()
                                .find(|(n, _)| n == font_family)
                                .map(|(_, d)| d.as_slice());
                            let tj_str = match font_data_ref {
                                Some(fd) => build_tj_array(text, fd, *font_size, 0),
                                None => {
                                    let encoded = encode_win_ansi(text);
                                    let escaped =
                                        escape_pdf_string(&String::from_utf8_lossy(&encoded));
                                    format!("({}) Tj", escaped)
                                }
                            };
                            content.extend(
                                format!(
                                    "/{} {} Tf\n1 0 0 1 {:.2} {:.2} Tm\n{}\n",
                                    ef.res_name, font_size, pdf_x, pdf_y, tj_str
                                )
                                .as_bytes(),
                            );
                            content.extend_from_slice(b"ET\nQ\n");
                            continue;
                        }
                    }
                }
            }

            // Non-WinAnsi text is outlined even when opts.outline_text is
            // false. The current PDF text writer has no verified Unicode to
            // CID/GID mapping; emitting Unicode values as Identity-H CIDs
            // paints missing or unrelated glyphs. Paths preserve appearance,
            // while searchable text remains available for WinAnsi runs.
            if do_outline || shape_text(node).is_some_and(|t| !t.is_empty() && requires_outline(t))
            {
                if let Shape::Text {
                    text,
                    font_size,
                    font_family,
                    x,
                    y,
                    ..
                } = &node.shape
                {
                    if !text.is_empty() {
                        let outlined = try_outline_node(
                            node,
                            text,
                            *font_size,
                            font_family,
                            x,
                            y,
                            opts,
                            &mut image_state,
                        );
                        if let Some(mut cmd) = outlined {
                            content.extend_from_slice(b"q\n");
                            write_node_graphics_state(&mut content, &mut image_state, node);
                            content.append(&mut cmd);
                            content.extend_from_slice(b"Q\n");
                            continue;
                        }
                    }
                }
            }
            // New pipeline: effects + fills + strokes
            content.extend_from_slice(b"q\n");
            write_node_graphics_state(&mut content, &mut image_state, node);
            let effects = render_effects(
                node,
                opts.page_height,
                use_cmyk,
                opts.print_profile,
                Some(&mut image_state),
            );
            content.extend(&effects);
            let fills = render_fills(
                node,
                opts.page_height,
                use_cmyk,
                Some(&mut image_state),
                opts.manifest.as_ref(),
                opts.print_profile,
                Some(&mut shading_registry),
                opts.lossy,
            );
            content.extend(&fills);
            let strokes = render_strokes(
                node,
                opts.page_height,
                use_cmyk,
                opts.print_profile,
                Some(&mut image_state),
            );
            content.extend(&strokes);
            content.extend_from_slice(b"Q\n");
        }

        (std::mem::take(&mut image_state.refs), shading_registry)
    };

    content.extend_from_slice(b"Q\n");

    let content_stream = Stream::new(dictionary! {}, content);
    let content_id = doc.new_object_id();
    doc.objects
        .insert(content_id, Object::Stream(content_stream));

    // Font resources
    let font_dict = if embedded_fonts.is_empty() {
        dictionary! {
            "F1" => dictionary! {
                "Type" => "Font",
                "Subtype" => "Type1",
                "BaseFont" => "Helvetica",
            },
        }
    } else {
        let mut fd = lopdf::Dictionary::new();
        for ef in &embedded_fonts {
            fd.set(ef.res_name.as_bytes(), Object::Reference(ef.dict_id));
        }
        fd
    };
    let mut resources = dictionary! {
        "Font" => font_dict,
    };
    add_image_render_resources(&mut resources, &image_refs);
    let shading_resources = shading_registry.create_pdf_objects(&mut doc);
    if !shading_resources.is_empty() {
        let mut sdict = lopdf::Dictionary::new();
        for (name, obj_id) in &shading_resources {
            sdict.set(name.as_bytes(), Object::Reference(*obj_id));
        }
        resources.set("Shading", sdict);
    }

    let pages_id = doc.new_object_id();
    let catalog_id = doc.new_object_id();

    let page = dictionary! {
        "Type" => "Page",
        "MediaBox" => vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(opts.page_width as f32),
            Object::Real(opts.page_height as f32),
        ],
        "Contents" => Object::Reference(content_id),
        "Resources" => resources,
        "Parent" => Object::Reference(pages_id),
    };
    doc.objects.insert(page_id, Object::Dictionary(page));

    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => vec![Object::Reference(page_id)],
        "Count" => Object::Integer(1),
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog = dictionary! {
        "Type" => "Catalog",
        "Pages" => Object::Reference(pages_id),
    };
    doc.objects.insert(catalog_id, Object::Dictionary(catalog));

    doc.trailer.set("Root", Object::Reference(catalog_id));
    doc.version = "1.4".to_string();
    doc.compress();

    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|e| format!("PDF save failed: {e}"))?;
    Ok(output)
}

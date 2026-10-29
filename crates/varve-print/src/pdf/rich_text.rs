//! Rich-text run parsing and PDF rendering.

use super::colour::{color_to_cmyk_string, color_to_rgb_string};
use super::fonts::EmbeddedFontEntry;
use super::options::PdfOptions;
use super::prelude::*;
use super::resources::ImageRenderState;
use super::text::{
    can_encode_win_ansi, encode_win_ansi, escape_pdf_string, get_ascender, requires_outline,
    try_outline_node,
};

/// A single text run extracted from the rich text model.
#[allow(dead_code)]
struct RichTextRun {
    text: String,
    font_family: Option<String>,
    font_size: Option<f64>,
    font_weight: Option<i64>,
    font_style: Option<String>,
}

/// Parse rich text runs from a `serde_json::Value` matching the TS `RichText`
/// interface: `{ paragraphs: [{ runs: [{ text, format? }] }] }`.
fn parse_rich_text_runs(value: &serde_json::Value) -> Vec<RichTextRun> {
    let mut runs = Vec::new();
    let paragraphs = match value.get("paragraphs").and_then(|v| v.as_array()) {
        Some(p) => p,
        None => return runs,
    };
    for para in paragraphs {
        let run_list = match para.get("runs").and_then(|v| v.as_array()) {
            Some(r) => r,
            None => continue,
        };
        for run_val in run_list {
            let text = run_val
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let format = run_val.get("format");
            let font_family = format
                .and_then(|f| f.get("fontFamily"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let font_size = format
                .and_then(|f| f.get("fontSize"))
                .and_then(|v| v.as_f64());
            let font_weight = format
                .and_then(|f| f.get("fontWeight"))
                .and_then(|v| v.as_i64());
            let font_style = format
                .and_then(|f| f.get("fontStyle"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if !text.is_empty() {
                runs.push(RichTextRun {
                    text,
                    font_family,
                    font_size,
                    font_weight,
                    font_style,
                });
            }
        }
        // Add paragraph break as a newline between paragraphs
        runs.push(RichTextRun {
            text: "\n".to_string(),
            font_family: None,
            font_size: None,
            font_weight: None,
            font_style: None,
        });
    }
    runs
}

/// Render a rich text node to PDF content using per-run fallback.
/// WinAnsi-encodable runs get native PDF text (searchable/selectable),
/// others are outlined as vector paths. This is more granular than the
/// all-or-nothing approach that rasterizes the entire node when one
/// span contains non-WinAnsi characters.
pub(crate) fn render_rich_text_to_pdf(
    node: &SceneNode,
    opts: &PdfOptions,
    embedded_fonts: &[EmbeddedFontEntry],
    page_height: f64,
    image_state: &mut ImageRenderState,
) -> Option<Vec<u8>> {
    let Shape::Text {
        text: _,
        font_size: node_font_size,
        font_family: node_font_family,
        x: text_x,
        y: text_y,
        w: _text_w,
        h: _text_h,
        ..
    } = &node.shape
    else {
        return None;
    };

    let rich_text = match &node.shape {
        Shape::Text { rich_text, .. } => rich_text.as_ref()?,
        _ => return None,
    };

    let runs = parse_rich_text_runs(rich_text);
    if runs.is_empty() {
        return None;
    }

    let tx = node.transform.as_coeffs();
    let x_off = tx[4];
    let y_off = tx[5];
    let use_cmyk = opts.print_profile.is_some();
    let _color_str = if use_cmyk {
        color_to_cmyk_string(&node.fill, opts.print_profile)
    } else {
        color_to_rgb_string(&node.fill)
    };
    let do_outline = opts.outline_text && (opts.font_data.is_some() || !opts.fonts.is_empty());

    let mut content = Vec::new();
    let mut current_x = *text_x;
    let line_height = node_font_size * 1.2;
    let mut current_y = *text_y;

    for run in &runs {
        if run.text == "\n" {
            current_x = *text_x;
            current_y += line_height;
            continue;
        }

        let run_font_size = run.font_size.unwrap_or(*node_font_size);
        let run_font_family = run.font_family.as_deref().unwrap_or(node_font_family);
        let run_text = &run.text;

        // Per-run approximation: text advances by character count × 0.5 × font_size
        let run_width = run_text.len() as f64 * run_font_size * 0.5;

        // Try native PDF text (WinAnsi-encodable + embedded font available)
        let can_winansi = can_encode_win_ansi(run_text);
        let has_matching_font = embedded_fonts.iter().any(|ef| ef.family == run_font_family);

        if !run_text.is_empty() && can_winansi && has_matching_font {
            if let Some(ef) = embedded_fonts
                .iter()
                .find(|ef| ef.family == run_font_family)
            {
                let asc = get_ascender(opts, run_font_size);
                let pdf_x = current_x + x_off;
                let pdf_y = page_height - current_y - asc - y_off;
                let encoded = encode_win_ansi(run_text);
                let escaped = escape_pdf_string(&String::from_utf8_lossy(&encoded));

                content.extend_from_slice(b"BT\n");
                content.extend(
                    format!(
                        "/{} {} Tf\n1 0 0 1 {:.2} {:.2} Tm\n({}) Tj\nET\n",
                        ef.res_name, run_font_size, pdf_x, pdf_y, escaped
                    )
                    .as_bytes(),
                );
                current_x += run_width;
                continue;
            }
        }

        // Try outlining this run
        if do_outline || !run_text.is_empty() && requires_outline(run_text) {
            if let Some(mut cmd) = try_outline_node(
                node,
                run_text,
                run_font_size,
                run_font_family,
                &current_x,
                &current_y,
                opts,
                image_state,
            ) {
                content.append(&mut cmd);
                current_x += run_width;
                continue;
            }
        }

        // Fallback: rasterize as filled rect (same as existing shape fallback)
        // at the run's position and estimated width
        let fill_color = if use_cmyk {
            color_to_cmyk_string(&node.fill, opts.print_profile)
        } else {
            color_to_rgb_string(&node.fill)
        };
        let asc = get_ascender(opts, run_font_size);
        let pdf_y = page_height - current_y - asc - y_off;
        let pdf_x = current_x + x_off;
        content.extend_from_slice(b"q\n");
        content.extend(fill_color.as_bytes());
        content.extend(b"\n");
        content.extend(
            format!(
                "{:.2} {:.2} {:.2} {:.2} re\nf\n",
                pdf_x, pdf_y, run_width, run_font_size
            )
            .as_bytes(),
        );
        // Comment noting this run was rasterized
        content.extend(
            format!(
                "% raster fallback for non-encodable/non-outlineable run: '{}'\n",
                run_text
            )
            .as_bytes(),
        );
        content.extend_from_slice(b"Q\n");
        current_x += run_width;
    }

    Some(content)
}

//! Text encoding, outlining, and font-program embedding.

use super::colour::{color_to_cmyk_string, color_to_rgb_string};
use super::options::PdfOptions;
use super::paint::render_effects;
use super::prelude::*;
use super::resources::ImageRenderState;

/// Convert a glyph outline to PDF path content bytes.
///
/// Each `PathCommand` is mapped to the equivalent PDF path operator
/// (m, l, c, h). The result is filled with `fill_color` and closed with `Q`.
/// Coordinates are flipped so that Y increases upward (PDF convention).
fn glyph_outline_to_pdf(
    outline: &GlyphOutline,
    color: &str,
    x_base: f64,
    y_base: f64,
    page_height: f64,
) -> Vec<u8> {
    let mut buf = format!("q\n{color}\n").into_bytes();
    for cmd in &outline.commands {
        match cmd {
            PathCommand::MoveTo(x, y) => {
                let px = x_base + x;
                let py = page_height - (y_base - y);
                buf.extend(format!("{px:.2} {py:.2} m\n").as_bytes());
            }
            PathCommand::LineTo(x, y) => {
                let px = x_base + x;
                let py = page_height - (y_base - y);
                buf.extend(format!("{px:.2} {py:.2} l\n").as_bytes());
            }
            PathCommand::CurveTo(x1, y1, x2, y2, x3, y3) => {
                let p1x = x_base + x1;
                let p1y = page_height - (y_base - y1);
                let p2x = x_base + x2;
                let p2y = page_height - (y_base - y2);
                let p3x = x_base + x3;
                let p3y = page_height - (y_base - y3);
                buf.extend(
                    format!("{p1x:.2} {p1y:.2} {p2x:.2} {p2y:.2} {p3x:.2} {p3y:.2} c\n").as_bytes(),
                );
            }
            PathCommand::ClosePath => {
                buf.extend_from_slice(b"h\n");
            }
        }
    }
    buf.extend_from_slice(b"f\nQ\n");
    buf
}

/// Build a PDF TJ array string with per-glyph character hex codes.
/// Format: [(glyph1) (glyph2) ...] TJ
/// This preserves individual glyph identity for selectable text.
/// Full kerning support requires reading the GPOS/kern table directly;
/// for now we emit each glyph as a hex string with zero kerning.
pub(crate) fn build_tj_array(
    text: &str,
    _font_data: &[u8],
    _font_size: f64,
    _face_index: u32,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    for c in text.chars() {
        let cp = c as u32;
        if cp <= 0xFF {
            // Single-byte hex for WinAnsi
            parts.push(format!("<{:02X}>", cp as u8));
        } else {
            // Two-byte hex for non-WinAnsi (CID)
            parts.push(format!("<{:04X}>", cp));
        }
    }
    format!("[{}] TJ", parts.join(" "))
}

/// Escape a string for use in a PDF literal string `(...)`.
pub(crate) fn escape_pdf_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '(' => out.push_str("\\("),
            ')' => out.push_str("\\)"),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_ascii() && (c as u8) < 32 => {
                out.push_str(&format!("\\{:03o}", c as u8));
            }
            c => out.push(c),
        }
    }
    out
}

/// Detect text that cannot be represented in WinAnsiEncoding and therefore
/// MUST be outlined into vector paths. Arabic, Hebrew, Devanagari, CJK, and
/// any codepoint above U+00FF fall here.
pub fn requires_outline(text: &str) -> bool {
    text.chars().any(|c| (c as u32) > 0xFF)
}

/// Check whether text contains any character outside the PDF writer's
/// WinAnsi text path (i.e., it needs the Unicode outline fallback).
pub fn has_non_winansi(text: &str) -> bool {
    requires_outline(text)
}

/// Extract the text content of a node if it is a text shape, else None.
pub(crate) fn shape_text(node: &SceneNode) -> Option<&str> {
    match &node.shape {
        Shape::Text { text, .. } => Some(text),
        _ => None,
    }
}

/// Check whether every character in `text` fits in WinAnsiEncoding
/// (roughly Latin-1 printable characters plus common whitespace).
pub(crate) fn can_encode_win_ansi(text: &str) -> bool {
    text.chars().all(|c| {
        let cp = c as u32;
        cp == 0x09
            || cp == 0x0A
            || cp == 0x0D
            || (0x20..=0x7E).contains(&cp)
            || (0xA0..=0xFF).contains(&cp)
    })
}

/// Encode text using WinAnsiEncoding byte values.
pub(crate) fn encode_win_ansi(text: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    for ch in text.chars() {
        let cp = ch as u32;
        match cp {
            // Pass through ASCII and Latin-1 Supplement
            0x09 | 0x0A | 0x0D | 0x20..=0x7E | 0xA0..=0xFF => out.push(cp as u8),
            // Approximate common characters not in WinAnsi:
            0x2013 | 0x2014 => out.push(0x2D), // en/em dash → hyphen
            0x2018 | 0x2019 => out.push(0x27), // curly quotes → '
            0x201C | 0x201D => out.push(0x22), // curly double quotes → "
            0x2022 => out.push(0xB7),          // bullet → middle dot
            0x20AC => out.push(0x80),          // € in WinAnsi is 0x80
            _ => out.push(0x20),               // space as safest fallback
        }
    }
    out
}

/// Collect all text from scene nodes, grouped by font family.
pub(crate) fn collect_text_per_family(nodes: &[SceneNode]) -> HashMap<String, String> {
    let mut map: HashMap<String, String> = HashMap::new();
    for node in nodes {
        if let Shape::Text {
            text, font_family, ..
        } = &node.shape
        {
            if !text.is_empty() {
                map.entry(font_family.clone()).or_default().push_str(text);
            }
        }
    }
    map
}

/// Try to outline a text node. Returns Some(bytes) on success, None on fallback.
pub(crate) fn try_outline_node(
    node: &SceneNode,
    text: &str,
    font_size: f64,
    font_family: &str,
    x: &f64,
    y: &f64,
    opts: &PdfOptions,
    image_state: &mut ImageRenderState,
) -> Option<Vec<u8>> {
    let tx = node.transform.as_coeffs();
    let x_off = tx[4];
    let y_off = tx[5];
    let use_cmyk = opts.print_profile.is_some();
    let color_str = if use_cmyk {
        color_to_cmyk_string(&node.fill, opts.print_profile)
    } else {
        color_to_rgb_string(&node.fill)
    };

    // Try multi-font lookup first
    let glyphs = if !opts.fonts.is_empty() {
        outline_text_multi(&opts.fonts, font_family, text, font_size).ok()
    } else {
        None
    };

    // Fall back to single font
    let glyphs = glyphs.or_else(|| {
        opts.font_data.as_ref().and_then(|fd| {
            outline_text(fd, text, font_size)
                .ok()
                .filter(|g| !g.is_empty())
        })
    })?;

    if glyphs.is_empty() {
        return None;
    }

    let ascender = get_ascender(opts, font_size);
    let y_base = y + ascender;
    let mut content = Vec::new();
    content.extend_from_slice(b"q\n");

    // Drop shadow for text
    let shadow = render_effects(
        node,
        opts.page_height,
        use_cmyk,
        opts.print_profile,
        Some(image_state),
    );
    content.extend(&shadow);

    for glyph in &glyphs {
        let cmd = glyph_outline_to_pdf(
            glyph,
            &color_str,
            x + x_off,
            y_base + y_off,
            opts.page_height,
        );
        content.extend_from_slice(&cmd);
    }
    content.extend_from_slice(b"Q\n");
    Some(content)
}

/// Get ascender for font data.
pub(crate) fn get_ascender(opts: &PdfOptions, font_size: f64) -> f64 {
    // Try multi-font first
    if let Some(fd) = opts.fonts.first().map(|(_, d)| d.clone()) {
        if let Ok(font) = ab_glyph::FontArc::try_from_vec(fd) {
            let scale = font_size / font.units_per_em().unwrap_or(1000.0) as f64;
            return font.ascent_unscaled() as f64 * scale;
        }
    }
    // Fall back to single font
    if let Some(ref fd) = opts.font_data {
        if let Ok(font) = ab_glyph::FontArc::try_from_vec(fd.clone()) {
            let scale = font_size / font.units_per_em().unwrap_or(1000.0) as f64;
            return font.ascent_unscaled() as f64 * scale;
        }
    }
    font_size * 0.8
}

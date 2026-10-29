//! Font metric parsing and embedded font programs.

use super::prelude::*;

/// Internal record for an embedded subset font.
#[allow(dead_code)]
pub(crate) struct EmbeddedFontEntry {
    /// Resource name in the page's font dict (e.g. "F1").
    pub(crate) res_name: String,
    /// BaseFont name with subset tag prefix (e.g. "ABCDEF+DejaVuSans").
    /// Font family from the scene model.
    pub(crate) family: String,
    /// Object ID of the font dictionary in the PDF document.
    pub(crate) dict_id: ObjectId,
}

/// Compute ascender for a font from its raw bytes.
pub(crate) fn font_ascender(font_data: &[u8], font_size: f64) -> f64 {
    if let Ok(font) = ab_glyph::FontArc::try_from_vec(font_data.to_vec()) {
        let scale = font_size / font.units_per_em().unwrap_or(1000.0) as f64;
        return font.ascent_unscaled() as f64 * scale;
    }
    font_size * 0.8
}

/// Read font metrics from font binary data using ttf_parser.
fn read_font_metrics(font_data: &[u8], face_index: u32) -> FontMetrics {
    if let Ok(face) = ttf_parser::Face::parse(font_data, face_index) {
        let upem = f64::from(face.units_per_em());
        let scale = 1000.0 / upem;

        let ascent = f64::from(face.ascender()) * scale;
        let descent = f64::from(face.descender()) * scale;
        let cap_height = face
            .capital_height()
            .map(|c| f64::from(c) * scale)
            .unwrap_or(500.0);
        let _x_height: f64 = face
            .x_height()
            .map(|x| f64::from(x) * scale)
            .unwrap_or(250.0);

        // FontBBox from head table
        let head = face.tables().head;
        let bbox = [
            f64::from(head.global_bbox.x_min) * scale,
            f64::from(head.global_bbox.y_min) * scale,
            f64::from(head.global_bbox.x_max) * scale,
            f64::from(head.global_bbox.y_max) * scale,
        ];

        // Determine flags from OS/2 table
        let flags = if face.tables().os2.is_some() {
            let mut f = 32i32;
            if face.is_italic() {
                f |= 1 << 3;
            }
            f
        } else {
            32
        };

        FontMetrics {
            ascent: ascent.max(0.0),
            descent: descent.min(0.0),
            cap_height: cap_height.max(100.0),
            stem_v: 50.0,
            italic_angle: 0.0,
            flags,
            bbox,
            units_per_em: upem,
        }
    } else {
        FontMetrics {
            ascent: 800.0,
            descent: -200.0,
            cap_height: 500.0,
            stem_v: 50.0,
            italic_angle: 0.0,
            flags: 32,
            bbox: [0.0, -200.0, 1000.0, 800.0],
            units_per_em: 1000.0,
        }
    }
}

struct FontMetrics {
    ascent: f64,
    descent: f64,
    cap_height: f64,
    stem_v: f64,
    italic_angle: f64,
    flags: i32,
    bbox: [f64; 4],
    #[allow(dead_code)]
    units_per_em: f64,
}

/// Embed a font program into the PDF document as a TrueType font with
/// FontDescriptor and font dictionary, returning the entry record.
pub(crate) fn embed_font_program(
    doc: &mut Document,
    family: &str,
    base_font: &str,
    font_data: &[u8],
    font_idx: usize,
) -> Result<EmbeddedFontEntry, String> {
    // Read metrics from actual font binary
    let metrics = read_font_metrics(font_data, 0);

    // 1. Font program stream (FontFile2)
    let font_stream_id = doc.new_object_id();
    let font_stream = Stream::new(
        dictionary! {
            "Length1" => font_data.len() as i64,
        },
        font_data.to_vec(),
    );
    doc.objects
        .insert(font_stream_id, Object::Stream(font_stream));

    // 2. Font descriptor with metrics read from actual font data
    let descriptor_id = doc.new_object_id();
    let font_name_bytes = base_font.as_bytes().to_vec();
    let descriptor = dictionary! {
        "Type" => "FontDescriptor",
        "FontName" => Object::Name(font_name_bytes.clone()),
        "Flags" => metrics.flags,
        "FontBBox" => vec![
            Object::Real(metrics.bbox[0] as f32),
            Object::Real(metrics.bbox[1] as f32),
            Object::Real(metrics.bbox[2] as f32),
            Object::Real(metrics.bbox[3] as f32),
        ],
        "ItalicAngle" => metrics.italic_angle as i32,
        "Ascent" => metrics.ascent as i32,
        "Descent" => metrics.descent as i32,
        "CapHeight" => metrics.cap_height as i32,
        "StemV" => metrics.stem_v as i64,
        "FontFile2" => Object::Reference(font_stream_id),
    };
    doc.objects
        .insert(descriptor_id, Object::Dictionary(descriptor));

    // 3. Font dictionary
    let res_name = format!("F{}", font_idx + 1);
    let font_dict_id = doc.new_object_id();
    let font_dict = dictionary! {
        "Type" => "Font",
        "Subtype" => "TrueType",
        "BaseFont" => Object::Name(font_name_bytes),
        "FontDescriptor" => Object::Reference(descriptor_id),
        "Encoding" => "WinAnsiEncoding",
        "FirstChar" => 32,
        "LastChar" => 255,
    };
    doc.objects
        .insert(font_dict_id, Object::Dictionary(font_dict));

    // 4. ToUnicode CMap for text extraction
    let to_unicode_id = doc.new_object_id();
    let to_unicode_stream = build_to_unicode_cmap(font_data, 0);
    doc.objects.insert(
        to_unicode_id,
        Object::Stream(Stream::new(dictionary! {}, to_unicode_stream)),
    );

    // Add ToUnicode reference to font dict
    if let Object::Dictionary(dict) = doc.objects.get_mut(&font_dict_id).unwrap() {
        dict.set("ToUnicode", Object::Reference(to_unicode_id));
    }

    Ok(EmbeddedFontEntry {
        res_name,
        family: family.to_string(),
        dict_id: font_dict_id,
    })
}

/// Build a ToUnicode CMap stream for the simple WinAnsi font path.
/// Maps one-byte WinAnsi character codes to Unicode values using the
/// embedded font's cmap table.
fn build_to_unicode_cmap(font_data: &[u8], face_index: u32) -> Vec<u8> {
    // Build bfrange entries: character code → Unicode
    let mut ranges: Vec<(u8, u8, u32)> = Vec::new();

    if let Ok(face) = ttf_parser::Face::parse(font_data, face_index) {
        let mut range_start: Option<u8> = None;
        let mut range_unicode: Option<u32> = None;

        for code in 0x20u8..=0xFF {
            let glyph = face.glyph_index(char::from(code));
            if glyph.is_some() {
                match (range_start, range_unicode) {
                    (Some(rs), Some(ru))
                        if u32::from(rs) + u32::from(code) - u32::from(rs) == ru => {}
                    (Some(rs), Some(ru)) => {
                        ranges.push((rs, code - 1, ru));
                        range_start = Some(code);
                        range_unicode = Some(u32::from(code));
                    }
                    _ => {
                        range_start = Some(code);
                        range_unicode = Some(u32::from(code));
                    }
                }
            }
        }

        if let (Some(rs), Some(ru)) = (range_start, range_unicode) {
            ranges.push((rs, 0xFF, ru));
        }
    }

    if ranges.is_empty() {
        ranges.push((0x20, 0xFF, 0x20));
    }

    let mut cmap = Vec::new();
    cmap.extend_from_slice(b"/CIDInit /ProcSet findresource begin\n");
    cmap.extend_from_slice(b"12 dict begin\n");
    cmap.extend_from_slice(b"begincmap\n");
    cmap.extend_from_slice(
        b"/CIDSystemInfo << /Registry (Strata) /Ordering (Identity) /Supplement 0 >> def\n",
    );
    cmap.extend_from_slice(b"/CMapName /Strata-Identity def\n");
    cmap.extend_from_slice(b"/CMapType 2 def\n");
    cmap.extend_from_slice(b"1 begincodespacerange\n");
    cmap.extend_from_slice(b"<00> <FF>\n");
    cmap.extend_from_slice(b"endcodespacerange\n");

    cmap.extend_from_slice(format!("{} beginbfrange\n", ranges.len()).as_bytes());
    for (start, end, unicode_start) in &ranges {
        cmap.extend_from_slice(
            format!("<{start:02X}> <{end:02X}> <{unicode_start:04X}>\n").as_bytes(),
        );
    }
    cmap.extend_from_slice(b"endbfrange\n");
    cmap.extend_from_slice(b"endcmap\n");
    cmap.extend_from_slice(b"end\n");

    cmap
}

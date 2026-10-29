//! PDF pipeline tests relocated from the crate-root test module.

#![allow(unused_imports)]
use crate::pdf::colour::*;
use crate::pdf::export::*;
use crate::pdf::fills::*;
use crate::pdf::fills_image::*;
use crate::pdf::fills_pattern::*;
use crate::pdf::fonts::*;
use crate::pdf::geometry::*;
use crate::pdf::options::*;
use crate::pdf::paint::*;
use crate::pdf::paths::*;
use crate::pdf::prelude::*;
use crate::pdf::resources::*;
use crate::pdf::rich_text::*;
use crate::pdf::shading::*;
use crate::pdf::tests::support::image::*;
use crate::pdf::tests::support::inspect::*;
use crate::pdf::tests::support::nodes::*;
use crate::pdf::text::*;

// ── Text outlining integration tests ─────────────────────────────────

#[test]
fn export_pdf_outlines_text() {
    let font_data = test_font_data();
    let nodes = vec![text_node(1, 10.0, 10.0, "A", 24.0)];
    let opts = PdfOptions {
        outline_text: true,
        font_data: Some(font_data),
        ..Default::default()
    };
    let bytes = export_pdf(&nodes, &opts).expect("outlined text pdf");
    assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
    assert!(
        bytes.len() > 500,
        "outlined text should be larger than minimal PDF"
    );
}

#[test]
fn export_pdf_outlines_text_multiple_glyphs() {
    let font_data = test_font_data();
    let nodes = vec![text_node(1, 10.0, 10.0, "AB", 24.0)];
    let opts = PdfOptions {
        outline_text: true,
        font_data: Some(font_data),
        ..Default::default()
    };
    let bytes = export_pdf(&nodes, &opts).expect("outlined AB pdf");
    assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
    assert!(
        bytes.len() > 600,
        "two-glyph text should be larger than one glyph"
    );
}

#[test]
fn export_pdf_outlines_text_disabled_by_default() {
    let nodes = vec![text_node(1, 10.0, 10.0, "Hello", 16.0)];
    let opts = PdfOptions::default();
    let bytes = export_pdf(&nodes, &opts).expect("non-outlined pdf");
    assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
}

#[test]
fn export_pdf_outlines_text_empty_string() {
    let font_data = test_font_data();
    let nodes = vec![text_node(1, 10.0, 10.0, "", 16.0)];
    let opts = PdfOptions {
        outline_text: true,
        font_data: Some(font_data),
        ..Default::default()
    };
    let bytes = export_pdf(&nodes, &opts).expect("empty text pdf");
    assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
}

#[test]
fn export_pdf_outlines_text_font_data_none_falls_back() {
    let nodes = vec![text_node(1, 10.0, 10.0, "Test", 16.0)];
    let opts = PdfOptions {
        outline_text: true,
        font_data: None,
        ..Default::default()
    };
    let bytes = export_pdf(&nodes, &opts).expect("fallback pdf");
    assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
}

#[test]
fn export_pdf_outlines_text_larger_than_rectangle() {
    let font_data = test_font_data();
    let nodes = vec![text_node(1, 10.0, 10.0, "ABX", 24.0)];
    let opts_outline = PdfOptions {
        outline_text: true,
        font_data: Some(font_data.clone()),
        ..Default::default()
    };
    let opts_rect = PdfOptions {
        outline_text: false,
        font_data: Some(font_data),
        ..Default::default()
    };
    let outlined = export_pdf(&nodes, &opts_outline).expect("outlined");
    let rect = export_pdf(&nodes, &opts_rect).expect("rect");
    assert!(
        outlined.len() > rect.len(),
        "outlined PDF ({}) should be larger than rect PDF ({})",
        outlined.len(),
        rect.len()
    );
}

#[test]
fn export_pdf_outlines_text_respects_fill_color() {
    let font_data = test_font_data();
    let node = SceneNode {
        id: varve_core::NodeId(1),
        name: "red-text".into(),
        transform: Affine::translate((10.0, 10.0)),
        shape: Shape::Text {
            text: "A".into(),
            font_size: 24.0,
            font_family: "DejaVu Sans".into(),
            font_weight: 400,
            font_style: "normal".into(),
            text_align: "left".into(),
            text_align_vertical: None,
            x: 0.0,
            y: 0.0,
            w: 15.0,
            h: 28.0,
            letter_spacing: None,
            line_height: None,
            paragraph_spacing: None,
            text_case: None,
            text_decoration: None,
            text_overflow: None,
            list_style: None,
            rich_text: None,
            open_type_features: None,
            variable_axes: None,
            text_mode: None,
            path_text_settings: None,
            path_shape: None,
        },
        fill: EngineColor::Rgb {
            r: 255.0,
            g: 0.0,
            b: 0.0,
            a: 255.0,
            bit_depth: None,
            profile: None,
        },
        children: Vec::new(),
        component_id: None,
        slots: None,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        rotation: 0.0,
        strokes: Vec::new(),
        effects: Vec::new(),
        fills: None,
        corner_radius: None,
        filters: None,
    };
    let opts = PdfOptions {
        outline_text: true,
        font_data: Some(font_data),
        ..Default::default()
    };
    let bytes = export_pdf(&[node], &opts).expect("red outlined text");
    assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
}

#[test]
fn export_pdf_outlines_text_multi_font() {
    let font_data = test_font_data();
    let nodes = vec![text_node(1, 10.0, 10.0, "Hello", 24.0)];
    let opts = PdfOptions {
        outline_text: true,
        fonts: vec![("DejaVu Sans".into(), font_data)],
        ..Default::default()
    };
    let bytes = export_pdf(&nodes, &opts).expect("multi-font outlined pdf");
    assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
    assert!(bytes.len() > 500, "should have outlined content");
}
// ── Unicode / non-WinAnsi fallback tests ────────────────────────────

#[test]
fn requires_outline_detects_non_winansi() {
    assert!(requires_outline("مرحبا"), "Arabic requires outline");
    assert!(requires_outline("שלום"), "Hebrew requires outline");
    assert!(requires_outline("नमस्ते"), "Devanagari requires outline");
    assert!(
        !requires_outline("Hello World"),
        "ASCII does not require outline"
    );
    assert!(
        !requires_outline("Café résumé"),
        "Latin-1 Supplement is WinAnsi"
    );
}

#[test]
fn export_pdf_outlines_non_winansi_text() {
    // Arabic text cannot be encoded in WinAnsiEncoding. It MUST be
    // outlined into vector paths even when outline_text is false.
    let font_data = test_font_data();
    let nodes = vec![text_node(1, 10.0, 10.0, "مرحبا", 24.0)];
    let opts = PdfOptions {
        outline_text: false, // disabled — but non-WinAnsi forces outline
        font_data: Some(font_data),
        ..Default::default()
    };
    let bytes = export_pdf(&nodes, &opts).expect("non-winansi pdf");
    let s = String::from_utf8_lossy(&bytes);
    assert!(
        !s.contains("/Tj"),
        "non-WinAnsi text must not emit WinAnsi Tj operator"
    );
    // Outlined text produces PDF path operators
    assert!(
        s.contains('m') && s.contains('c'),
        "non-WinAnsi text should be outlined to path operators (m, c)"
    );
}

#[test]
fn export_pdf_subsets_extended_latin_as_glyph_paths() {
    // Unicode code points are not TrueType glyph IDs. Until the PDF writer
    // has an explicit Unicode-to-CID-to-GID map, this text must retain its
    // actual outlines rather than being emitted as Identity-H character
    // codes that happen to equal Unicode values.
    let font_data = test_font_data();
    let nodes = vec![text_node(1, 10.0, 10.0, "Łódź: zażółć gęślą jaźń", 24.0)];
    let opts = PdfOptions {
        subset_fonts: true,
        fonts: vec![("DejaVu Sans".into(), font_data)],
        ..Default::default()
    };

    let bytes = export_pdf(&nodes, &opts).expect("extended Latin PDF");
    let pdf = String::from_utf8_lossy(&bytes);
    let (_, content) = page_resources_and_content(&bytes);
    assert!(
        !pdf.contains("/CIDFontType2") && !pdf.contains("/Identity-H"),
        "extended Latin text must not use the unverified identity CID path"
    );
    assert!(
        content
            .lines()
            .any(|line| matches!(line.trim(), "f" | "f*")),
        "extended Latin text should retain filled glyph paths: {content}"
    );
    assert!(
        !content.contains(" Tj\n") && !content.contains(" TJ\n"),
        "the unsearchable fallback must be explicit outlines, not text operators"
    );
}

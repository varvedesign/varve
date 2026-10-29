//! Unit tests for printing (moved verbatim from lib.rs #[cfg(test)] mod tests; Batch B/B-01).

use super::*;
use crate::stubs::convert_scene;
use crate::test_support::*;
use varve_bridge::IpcSceneNode;

// ── New command integration tests ─────────────────────────────────────

fn test_font_data() -> Vec<u8> {
    varve_print::test_fonts::test_font_bytes().to_vec()
}

#[test]
fn export_pdfx1a_from_json_string() {
    // Simulate what the TS bridge sends: nodes as JSON string + options as JSON string
    let nodes_json = serde_json::to_string(&ts_wire_json()).expect("serialize nodes");
    let options_json = serde_json::json!({
        "pageWidth": 300.0,
        "pageHeight": 200.0,
        "title": "Test X-1a",
        "author": "Varve",
        "bleedMm": 3.0,
        "includeCropMarks": false,
    })
    .to_string();

    let nodes: Vec<IpcSceneNode> =
        serde_json::from_str(&nodes_json).expect("deserialize from json string");
    let scene = convert_scene(nodes);
    let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
    let print_opts = opts.to_pdf_options(200.0);
    let bytes = varve_print::cmyk::export_pdfx1a(&scene, &print_opts).expect("pdfx1a");
    assert!(bytes.starts_with(b"%PDF"), "should be a valid PDF");
    assert!(
        String::from_utf8_lossy(&bytes).contains("GTS_PDFX"),
        "should contain PDF/X marker"
    );
}

#[test]
fn export_pdfx4_from_json_string() {
    let nodes_json = serde_json::to_string(&ts_wire_json()).expect("serialize nodes");
    let options_json = serde_json::json!({
        "pageWidth": 300.0,
        "pageHeight": 200.0,
        "title": "Test X-4",
        "author": "Varve",
    })
    .to_string();

    let nodes: Vec<IpcSceneNode> = serde_json::from_str(&nodes_json).expect("deserialize");
    let scene = convert_scene(nodes);
    let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
    let print_opts = opts.to_pdf_options(200.0);
    let bytes = varve_print::cmyk::export_pdfx4(&scene, &print_opts).expect("pdfx4");
    assert!(bytes.starts_with(b"%PDF-1.6"), "PDF/X-4 should use PDF 1.6");
}

#[test]
fn pdfx_marks_geometry_honors_bleed_and_crop_marks() {
    // No bleed, no crop marks → no geometry → plain PDF/X page (no TrimBox bleed).
    let plain: PdfXOptions = serde_json::from_value(serde_json::json!({
        "pageWidth": 300.0, "pageHeight": 200.0, "bleedMm": 0.0, "includeCropMarks": false,
    }))
    .expect("parse plain");
    assert!(
        plain.marks_geometry().is_none(),
        "no marks or bleed → no geometry"
    );

    // Bleed alone (no crop marks) must still produce geometry so the bleed
    // box is applied — otherwise bleed is silently dropped.
    let bleed_only: PdfXOptions = serde_json::from_value(serde_json::json!({
        "pageWidth": 300.0, "pageHeight": 200.0, "bleedMm": 5.0, "includeCropMarks": false,
    }))
    .expect("parse bleed-only");
    let geo = bleed_only
        .marks_geometry()
        .expect("bleed-only should produce geometry");
    assert!((geo.bleed_mm - 5.0).abs() < 1e-6);

    // Crop marks without explicit bleed uses the default bleed.
    let marks_only: PdfXOptions = serde_json::from_value(serde_json::json!({
        "pageWidth": 300.0, "pageHeight": 200.0, "includeCropMarks": true,
    }))
    .expect("parse marks-only");
    let geo = marks_only
        .marks_geometry()
        .expect("crop marks should produce geometry");
    assert!(geo.bleed_mm > 0.0, "crop marks imply a default bleed");
}

#[test]
fn pdfx_registration_marks_maps_to_include_registration_marks() {
    let with_reg: PdfXOptions = serde_json::from_value(serde_json::json!({
        "pageWidth": 300.0, "pageHeight": 200.0,
        "includeCropMarks": true,
        "includeRegistrationMarks": true,
    }))
    .expect("parse with reg marks");
    let print_opts = with_reg.to_pdf_options(200.0);
    assert!(
        print_opts.registration_marks,
        "registration_marks must follow includeRegistrationMarks (not crop marks)"
    );

    let crop_only: PdfXOptions = serde_json::from_value(serde_json::json!({
        "pageWidth": 300.0, "pageHeight": 200.0,
        "includeCropMarks": true,
        "includeRegistrationMarks": false,
    }))
    .expect("parse crop-only");
    let print_opts = crop_only.to_pdf_options(200.0);
    assert!(
        !print_opts.registration_marks,
        "crop marks alone must not enable registration marks"
    );
}

#[test]
fn outline_text_command_returns_svg_path() {
    let font_data = test_font_data();
    let result = varve_print::outline_text(&font_data, "A", 16.0).expect("outline");
    assert!(!result.is_empty(), "should produce glyph outlines");
    let path = result
        .iter()
        .map(|g| varve_print::commands_to_svg_path(&g.commands, 2))
        .filter(|d| !d.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    assert!(!path.is_empty(), "SVG path should not be empty");
    assert!(path.starts_with('M'), "should start with MoveTo");
}

#[test]
fn outline_text_command_empty_string() {
    let font_data = test_font_data();
    let result = varve_print::outline_text(&font_data, "", 16.0).expect("outline empty");
    assert!(result.is_empty(), "empty text should produce no outlines");
}

#[test]
fn outline_text_command_returns_path_for_multiple_glyphs() {
    let font_data = test_font_data();
    let result = varve_print::outline_text(&font_data, "AB", 16.0).expect("outline AB");
    assert_eq!(result.len(), 2, "should produce two glyph outlines");
    let path = result
        .iter()
        .map(|g| varve_print::commands_to_svg_path(&g.commands, 2))
        .filter(|d| !d.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    assert!(path.contains("M"), "SVG path should contain MoveTo");
}

#[test]
fn export_pdf_with_options_dispatches_screen_by_default() {
    let nodes_json = serde_json::to_string(&ts_wire_json()).expect("serialize");
    let options_json = serde_json::json!({
        "pageWidth": 192.0,
        "pageHeight": 108.0,
        "format": "screen",
    })
    .to_string();

    let nodes: Vec<IpcSceneNode> = serde_json::from_str(&nodes_json).expect("deserialize");
    let scene = convert_scene(nodes);
    let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
    let print_opts = opts.to_pdf_options(108.0);
    let bytes = varve_print::export_pdf(&scene, &print_opts).expect("screen pdf");
    assert!(bytes.starts_with(b"%PDF"), "should be a valid PDF");
    assert!(
        !String::from_utf8_lossy(&bytes).contains("GTS_PDFX"),
        "screen PDF should not contain PDF/X marker"
    );
}

#[test]
fn export_pdf_with_options_dispatches_x1a_when_use_cmyk() {
    let nodes_json = serde_json::to_string(&ts_wire_json()).expect("serialize");
    let options_json = serde_json::json!({
        "pageWidth": 300.0,
        "pageHeight": 200.0,
    })
    .to_string();

    let nodes: Vec<IpcSceneNode> = serde_json::from_str(&nodes_json).expect("deserialize");
    let scene = convert_scene(nodes);
    let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
    let print_opts = opts.to_pdf_options(200.0);
    // use_cmyk = true should dispatch to export_pdfx1a
    let bytes = varve_print::cmyk::export_pdfx1a(&scene, &print_opts).expect("pdfx1a");
    assert!(bytes.starts_with(b"%PDF"), "should be a valid PDF");
    assert!(
        String::from_utf8_lossy(&bytes).contains("GTS_PDFX"),
        "CMYK dispatch should produce PDF/X"
    );
}

#[test]
fn export_pdf_with_options_dispatches_x4_by_format() {
    let nodes_json = serde_json::to_string(&ts_wire_json()).expect("serialize");
    let options_json = serde_json::json!({
        "pageWidth": 300.0,
        "pageHeight": 200.0,
        "format": "x4",
    })
    .to_string();

    let nodes: Vec<IpcSceneNode> = serde_json::from_str(&nodes_json).expect("deserialize");
    let scene = convert_scene(nodes);
    let opts: PdfXOptions = serde_json::from_str(&options_json).expect("parse options");
    let print_opts = opts.to_pdf_options(200.0);
    let bytes = varve_print::cmyk::export_pdfx4(&scene, &print_opts).expect("pdfx4");
    assert!(
        bytes.starts_with(b"%PDF-1.6"),
        "format x4 should produce PDF/X-4"
    );
}

#[test]
fn parse_nodes_from_json_handles_empty_array() {
    let scene = parse_nodes_from_json("[]").expect("empty array");
    assert!(scene.is_empty(), "empty scene should have no nodes");
}

#[test]
fn parse_nodes_from_json_errors_on_invalid_input() {
    let err = parse_nodes_from_json("not json").unwrap_err();
    assert!(err.contains("parse"), "should report parse error");
}

#[test]
fn pdf_xoptions_defaults_are_sane() {
    let opts = PdfXOptions::default();
    assert!((opts.page_width - 1920.0).abs() < 1e-6);
    assert!((opts.page_height - 1080.0).abs() < 1e-6);
    assert!((opts.bleed_mm - 3.0).abs() < 1e-6);
    assert!(!opts.include_crop_marks);
    assert!(!opts.outline_text);
}

#[test]
fn export_node_pdf_rejects_oversized_scene() {
    let err = export_node_pdf(oversized_node_list(), None, None).unwrap_err();
    assert!(err.contains("limit"), "expected a limit error, got: {err}");
}

#[test]
fn parse_nodes_from_json_rejects_oversized_scene() {
    let nodes_json = serde_json::to_string(&oversized_node_list_json()).expect("serialize");
    let err = parse_nodes_from_json(&nodes_json).unwrap_err();
    assert!(err.contains("limit"), "expected a limit error, got: {err}");
}

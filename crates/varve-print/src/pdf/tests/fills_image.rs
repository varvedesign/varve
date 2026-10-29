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

// ── render_fills image fill tests ──────────────────────────────────

#[test]
fn export_pdf_embeds_pattern_tile_alpha_and_fill_opacity() {
    let mut node = rect_node(1, 20.0, 20.0, 96.0, 72.0);
    node.fills = Some(vec![FillIR::Pattern {
        tile_src: "pattern-source".into(),
        spacing: 0.0,
        rotation: 0.0,
        image_width: Some(16.0),
        image_height: Some(16.0),
        gap_x: Some(0.0),
        gap_y: Some(0.0),
        arrangement: Some("grid".into()),
        row_shift: None,
        column_shift: None,
        mirror_x: None,
        mirror_y: None,
        offset_x: None,
        offset_y: None,
        alignment: None,
        opacity: 0.8,
        blend_mode: BlendMode::Normal,
        visible: true,
    }]);
    let mut manifest = image_manifest("pattern-source", 2, 2);
    manifest.images[0].data = vec![
        30, 150, 200, 255, 220, 80, 40, 128, 30, 150, 200, 255, 220, 80, 40, 255,
    ];
    let opts = PdfOptions {
        manifest: Some(manifest),
        ..Default::default()
    };

    let bytes = export_pdf(&[node], &opts).expect("standard PDF with a raster pattern");
    assert!(bytes.starts_with(b"%PDF"));
    let doc = Document::load_mem(&bytes).expect("parse standard PDF");
    let page_id = *doc.get_pages().values().next().expect("PDF has a page");
    let page_content = doc.get_page_content(page_id);
    let content = String::from_utf8_lossy(&page_content);
    assert!(
        content.contains("/Pat0 Do"),
        "pattern image must be painted"
    );
    assert_eq!(
        content.matches("/Pat0 Do").count(),
        42,
        "the exporter must place the bounded repeat, not one transformed copy"
    );
    assert!(
        content.contains("/GS800 gs"),
        "fill opacity must be retained"
    );
    assert!(
        doc.objects.values().any(|object| matches!(
            object,
            Object::Stream(stream) if stream.dict.has(b"SMask")
        )),
        "pattern tile alpha must be retained"
    );
    assert!(
        !content.contains("pattern tile not found"),
        "resolved pattern source must not take the missing-resource path"
    );
}

#[test]
fn render_fills_image_perspective_subdivides_into_pdf_triangles() {
    let mut node = image_fill_node(1, 0.0, 0.0, 100.0, 80.0);
    node.opacity = 0.5;
    node.fills = Some(vec![FillIR::Image {
        src: "perspective-src".into(),
        fit: "stretch".into(),
        x: 0.0,
        y: 0.0,
        scale: 1.0,
        image_width: Some(32.0),
        image_height: Some(32.0),
        opacity: 0.5,
        blend_mode: BlendMode::Multiply,
        visible: true,
        alpha_mask: None,
        crop: None,
        rotation: None,
        flip_h: None,
        flip_v: None,
        perspective: Some(FillPerspective {
            quad: [[0.0, 0.0], [100.0, 8.0], [92.0, 80.0], [0.0, 72.0]],
        }),
    }]);
    let manifest = image_manifest("perspective-src", 32, 32);
    let mut doc = Document::new();
    let mut state = ImageRenderState::new(&mut doc);
    let result = render_fills(
        &node,
        200.0,
        false,
        Some(&mut state),
        Some(&manifest),
        None,
        None,
        false,
    );
    let content = String::from_utf8_lossy(&result);
    assert_eq!(
        state
            .refs
            .iter()
            .filter(|(name, _)| name.starts_with("Im"))
            .count(),
        1,
        "perspective reuses one image XObject"
    );
    assert_eq!(
        content.matches("/Im0 Do").count(),
        PERSPECTIVE_GRID * PERSPECTIVE_GRID * 2
    );
    assert!(content.matches("cm").count() >= PERSPECTIVE_GRID * PERSPECTIVE_GRID * 2);
    assert!(
        content.contains("/GS250 gs"),
        "node and fill opacity should multiply for perspective image fills: {content}"
    );
    assert!(
        content.contains("/BMMultiply gs"),
        "image fill blend mode should be applied to the perspective mesh: {content}"
    );
    assert!(!content.contains("image fill not rendered"));
}

#[test]
fn render_fills_image_with_document_renders_xobject() {
    let node = image_fill_node(1, 0.0, 0.0, 100.0, 100.0);
    let mut doc = Document::new();
    let mut state = ImageRenderState::new(&mut doc);
    let result = render_fills(
        &node,
        100.0,
        false,
        Some(&mut state),
        None,
        None,
        None,
        false,
    );
    let s = String::from_utf8_lossy(&result);
    assert!(
        s.contains("/Im0 Do"),
        "image fill should emit Do operator for embedded XObject: {s}"
    );
    assert!(
        s.contains("cm"),
        "image fill should emit transformation matrix: {s}"
    );
    // Check that the image XObject was embedded
    assert_eq!(state.refs.len(), 1, "should have 1 image reference");
    assert_eq!(state.counter, 1, "counter should be 1");
}

/// Evidence for the checkerboard fallback: with no manifest the image
/// fill embeds the 16x16 placeholder, NOT source pixels. This is why the
/// TS side must always send `manifest_json` (`printImageManifest.ts`) —
/// an export without it silently ships placeholders.
#[test]
fn render_fills_image_without_manifest_embeds_checkerboard_placeholder() {
    let node = image_fill_node(1, 0.0, 0.0, 100.0, 100.0);
    let mut doc = Document::new();
    let mut state = ImageRenderState::new(&mut doc);
    let _content = render_fills(
        &node,
        100.0,
        false,
        Some(&mut state),
        None,
        None,
        None,
        false,
    );
    assert_eq!(
        embedded_image_widths(state.doc),
        vec![16],
        "no manifest must fall back to the 16x16 checkerboard placeholder"
    );
}

/// With a manifest the source dimensions are embedded — no placeholder.
#[test]
fn render_fills_image_with_manifest_embeds_source_dimensions() {
    let node = image_fill_node(1, 0.0, 0.0, 100.0, 100.0);
    let manifest = image_manifest("data:image/png;base64,AAAA", 32, 32);
    let mut doc = Document::new();
    let mut state = ImageRenderState::new(&mut doc);
    let _content = render_fills(
        &node,
        100.0,
        false,
        Some(&mut state),
        Some(&manifest),
        None,
        None,
        false,
    );
    let widths = embedded_image_widths(state.doc);
    assert!(
        !widths.is_empty(),
        "manifest-backed image fill must embed an image XObject"
    );
    assert!(
        widths.iter().all(|&w| w == 32),
        "every embedded XObject must use the real 32px source (color + alpha SMask), got {widths:?}"
    );
    assert_eq!(state.refs.len(), 1, "should have 1 image reference");
}

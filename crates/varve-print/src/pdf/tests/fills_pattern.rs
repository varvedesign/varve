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

#[test]
fn render_fills_pattern_omits_missing_source_instead_of_rendering_gray() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![FillIR::Pattern {
        tile_src: "data:image/png;base64,AAAA".into(),
        spacing: 0.0,
        rotation: 0.0,
        image_width: None,
        image_height: None,
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
        blend_mode: BlendMode::Normal,
        visible: true,
    }]);
    let result = render_fills(&node, 100.0, false, None, None, None, None, false);
    let s = String::from_utf8_lossy(&result);
    assert!(
        !s.contains("0.75 0.75 0.75 rg"),
        "pattern without manifest must not become gray artwork: {s}"
    );
    assert!(
        s.contains("WARNING"),
        "should include a warning comment: {s}"
    );
}

#[test]
fn render_fills_pattern_honours_dimension_overrides_fallback() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![FillIR::Pattern {
        tile_src: "tile.png".into(),
        spacing: 4.0,
        rotation: 45.0,
        image_width: Some(64.0),
        image_height: Some(48.0),
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
        opacity: 0.75,
        blend_mode: BlendMode::Normal,
        visible: true,
    }]);
    let result = render_fills(&node, 100.0, false, None, None, None, None, false);
    let s = String::from_utf8_lossy(&result);
    assert!(
        !s.contains("0.75 0.75 0.75 rg"),
        "unsupported pattern must not become gray: {s}"
    );
    assert!(s.contains("WARNING"), "should include warning: {s}");
}

#[test]
fn render_fills_pattern_embeds_raster_tile() {
    use crate::resources::{ExportManifest, ImageResource};

    let manifest = ExportManifest {
        images: vec![ImageResource {
            id: "tile_0".into(),
            src: Some("tile.png".into()),
            mime_type: "image/png".into(),
            width: 32,
            height: 32,
            data: vec![200u8; 32 * 32 * 4],
            color_space: resources::ColorSpace::Rgb,
        }],
        patterns: vec![],
    };

    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![FillIR::Pattern {
        tile_src: "tile.png".into(),
        spacing: 5.0,
        rotation: 0.0,
        image_width: Some(32.0),
        image_height: Some(32.0),
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
        blend_mode: BlendMode::Normal,
        visible: true,
    }]);

    let mut doc = Document::new();
    let mut state = ImageRenderState::new(&mut doc);
    let content = render_fills(
        &node,
        800.0,
        false,
        Some(&mut state),
        Some(&manifest),
        None,
        None,
        false,
    );
    let s = String::from_utf8_lossy(&content);
    assert!(
        s.contains("/Pat"),
        "should contain pattern XObject reference: {s}"
    );
    assert!(s.contains("Do"), "should contain Do operator: {s}");
    assert!(
        !s.contains("0.8 0.85 0.9"),
        "should NOT contain placeholder light blue: {s}"
    );
    assert!(
        !s.contains("0.75 0.75 0.75 rg"),
        "should NOT contain fallback gray: {s}"
    );
    assert!(
        s.contains("/GS800 gs"),
        "pattern opacity should be applied: {s}"
    );
    let image = state
        .refs
        .iter()
        .find(|(name, _)| name.starts_with("Pat"))
        .map(|(_, object)| object)
        .expect("pattern image XObject reference");
    let Object::Reference(image_id) = image else {
        panic!("pattern image reference must be indirect");
    };
    let image_stream = state
        .doc
        .get_object(*image_id)
        .expect("embedded pattern image")
        .as_stream()
        .expect("pattern image stream");
    assert!(
        image_stream.dict.get(b"SMask").is_ok(),
        "transparent source tile must keep its alpha channel"
    );
}

#[test]
fn render_fills_pattern_without_manifest_omits_instead_of_faking_artwork() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![FillIR::Pattern {
        tile_src: "pat_0".into(),
        spacing: 5.0,
        rotation: 0.0,
        image_width: Some(32.0),
        image_height: Some(32.0),
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
        blend_mode: BlendMode::Normal,
        visible: true,
    }]);

    let content = render_fills(&node, 800.0, false, None, None, None, None, false);
    let s = String::from_utf8_lossy(&content);
    assert!(
        !s.contains("0.75 0.75 0.75 rg"),
        "missing pattern must not become gray artwork: {s}"
    );
    assert!(s.contains("WARNING"), "should include warning comment: {s}");
}

#[test]
fn render_fills_pattern_missing_tile_in_manifest_omits_instead_of_faking_artwork() {
    use crate::resources::{ExportManifest, ImageResource, PatternResource};

    let manifest = ExportManifest {
        images: vec![ImageResource {
            id: "other_tile".into(),
            src: None,
            mime_type: "image/png".into(),
            width: 16,
            height: 16,
            data: vec![128u8; 16 * 16 * 4],
            color_space: resources::ColorSpace::Rgb,
        }],
        patterns: vec![PatternResource {
            id: "pat_missing".into(),
            tile_image_id: "other_tile".into(),
            spacing: 0.0,
            rotation: 0.0,
            tile_width: 16.0,
            tile_height: 16.0,
        }],
    };

    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![FillIR::Pattern {
        tile_src: "nonexistent_pat".into(),
        spacing: 0.0,
        rotation: 0.0,
        image_width: Some(32.0),
        image_height: Some(32.0),
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
        blend_mode: BlendMode::Normal,
        visible: true,
    }]);

    let content = render_fills(
        &node,
        800.0,
        false,
        None,
        Some(&manifest),
        None,
        None,
        false,
    );
    let s = String::from_utf8_lossy(&content);
    assert!(
        !s.contains("0.75 0.75 0.75 rg"),
        "missing pattern must not become gray artwork: {s}"
    );
    assert!(s.contains("WARNING"), "should warn about missing tile: {s}");
}

#[test]
fn render_fills_pattern_with_rotation_and_document_alignment_reports_unsupported_layout() {
    use crate::resources::{ExportManifest, ImageResource, PatternResource};

    let manifest = ExportManifest {
        images: vec![ImageResource {
            id: "tile_r".into(),
            src: None,
            mime_type: "image/png".into(),
            width: 16,
            height: 16,
            data: vec![255u8; 16 * 16 * 4],
            color_space: resources::ColorSpace::Rgb,
        }],
        patterns: vec![PatternResource {
            id: "pat_r".into(),
            tile_image_id: "tile_r".into(),
            spacing: 2.0,
            rotation: 45.0,
            tile_width: 16.0,
            tile_height: 16.0,
        }],
    };

    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![FillIR::Pattern {
        tile_src: "pat_r".into(),
        spacing: 2.0,
        rotation: 45.0,
        image_width: Some(16.0),
        image_height: Some(16.0),
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
        blend_mode: BlendMode::Normal,
        visible: true,
    }]);

    let mut doc = Document::new();
    let mut state = ImageRenderState::new(&mut doc);
    let content = render_fills(
        &node,
        800.0,
        false,
        Some(&mut state),
        Some(&manifest),
        None,
        None,
        false,
    );
    let s = String::from_utf8_lossy(&content);
    assert!(
        !s.contains("/Pat"),
        "unsupported transformed layout must not be approximated: {s}"
    );
    assert!(s.contains("WARNING: pattern layout is unsupported"), "{s}");

    // PDF keeps the old object-aligned grid subset. Document alignment
    // must fail closed until PDF can preserve the page-space phase.
    let Some(FillIR::Pattern {
        rotation,
        alignment,
        ..
    }) = node.fills.as_mut().and_then(|fills| fills.first_mut())
    else {
        panic!("expected pattern fill");
    };
    *rotation = 0.0;
    *alignment = Some("document".into());
    let content = render_fills(
        &node,
        800.0,
        false,
        Some(&mut state),
        Some(&manifest),
        None,
        None,
        false,
    );
    let s = String::from_utf8_lossy(&content);
    assert!(
        !s.contains("/Pat"),
        "document alignment must not be exported with an object-relative phase: {s}"
    );
    assert!(s.contains("WARNING: pattern layout is unsupported"), "{s}");
}

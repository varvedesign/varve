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
fn render_fills_image_crop_transform_uses_full_source_geometry() {
    let mut node = image_fill_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![FillIR::Image {
        src: "image-src".into(),
        fit: "fill".into(),
        x: 10.0,
        y: -5.0,
        scale: 1.25,
        image_width: Some(200.0),
        image_height: Some(100.0),
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        visible: true,
        alpha_mask: None,
        crop: Some(varve_core::scene::CropRect {
            x: 50.0,
            y: 25.0,
            w: 100.0,
            h: 50.0,
        }),
        rotation: Some(90.0),
        flip_h: Some(true),
        flip_v: None,
        perspective: None,
    }]);
    let manifest = image_manifest("image-src", 200, 100);
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

    assert!(
        content.contains("0.0000 250.0000 125.0000 0.0000 -2.5000 30.0000 cm"),
        "image matrix must include fill offset, post-policy scale, rotation, and flip around the full draw rect: {content}"
    );
    assert_eq!(
        content.matches("h W n").count(),
        2,
        "object clip and proportional transformed source-crop clip must both be present: {content}"
    );
    assert!(
        !content.contains("250.0000 0 0 125.0000"),
        "crop must not be stretched/refit as a standalone image: {content}"
    );

    let image_ref = match &state.refs[0].1 {
        Object::Reference(object_id) => *object_id,
        other => panic!("expected image reference, got {other:?}"),
    };
    let image = state.doc.get_object(image_ref).expect("embedded image");
    let Object::Stream(stream) = image else {
        panic!("image XObject should be a stream");
    };
    assert!(
        stream.dict.get(b"SMask").is_ok(),
        "RGBA alpha must remain attached to the same transformed full-source XObject"
    );
}

#[test]
fn render_fills_image_uses_complete_object_affine() {
    let mut node = image_fill_node(1, 0.0, 0.0, 100.0, 80.0);
    node.transform = Affine::new([2.0, 0.5, 0.25, 1.5, 30.0, 40.0]);
    node.fills = Some(vec![FillIR::Image {
        src: "affine-src".into(),
        fit: "stretch".into(),
        x: 0.0,
        y: 0.0,
        scale: 1.0,
        image_width: Some(100.0),
        image_height: Some(80.0),
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        visible: true,
        alpha_mask: None,
        crop: None,
        rotation: None,
        flip_h: None,
        flip_v: None,
        perspective: None,
    }]);
    let manifest = image_manifest("affine-src", 100, 80);
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

    assert!(
        content.contains("200.0000 -50.0000 -20.0000 120.0000 50.0000 40.0000 cm"),
        "image XObject matrix must retain object scale and skew: {content}"
    );
    assert!(
        content.contains("30.0000 160.0000 m")
            && content.contains("230.0000 110.0000 l")
            && content.contains("250.0000 -10.0000 l")
            && content.contains("50.0000 40.0000 l"),
        "object clip must use all four transformed bounds corners: {content}"
    );
    assert_eq!(
        shape_pdf_bounds(&node, 200.0),
        (30.0, -10.0, 220.0, 170.0),
        "transformed export bounds must include the full affine"
    );
}

#[test]
fn render_fills_image_without_document_compat() {
    // Without a document, image fills should still emit the "not rendered" comment
    let node = image_fill_node(1, 0.0, 0.0, 100.0, 100.0);
    let result = render_fills(&node, 100.0, false, None, None, None, None, false);
    let s = String::from_utf8_lossy(&result);
    assert!(
        s.contains("not rendered"),
        "image fill without doc should note not rendered: {s}"
    );
    assert!(
        !s.contains("Do"),
        "image fill without doc should not emit Do: {s}"
    );
}

#[test]
fn render_fills_image_nonrect_clips() {
    // A circle node with an image fill should emit a clip path (W n)
    let node = SceneNode {
        id: varve_core::NodeId(1),
        name: "circle-img".into(),
        transform: varve_core::Affine::translate((50.0, 50.0)),
        shape: Shape::Circle(Circle::new(Point::new(0.0, 0.0), 40.0)),
        fill: EngineColor::Rgb {
            r: 0.0,
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
        fills: Some(vec![FillIR::Image {
            src: "data:image/png;base64,AAAA".into(),
            fit: "fill".into(),
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            image_width: Some(32.0),
            image_height: Some(32.0),
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible: true,
            alpha_mask: None,
            crop: None,
            rotation: None,
            flip_h: None,
            flip_v: None,
            perspective: None,
        }]),
        corner_radius: None,
        filters: None,
    };
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
        s.contains("W n"),
        "non-rect image fill should emit clip path (W n): {s}"
    );
    assert!(
        s.contains("/Im0 Do"),
        "non-rect image fill should still emit Do: {s}"
    );
}

#[test]
fn render_fills_image_with_opacity() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![FillIR::Image {
        src: "data:image/png;base64,AAAA".into(),
        fit: "fill".into(),
        x: 0.0,
        y: 0.0,
        scale: 1.0,
        image_width: Some(32.0),
        image_height: Some(32.0),
        opacity: 0.5,
        blend_mode: BlendMode::Normal,
        visible: true,
        alpha_mask: None,
        crop: None,
        rotation: None,
        flip_h: None,
        flip_v: None,
        perspective: None,
    }]);
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
        s.contains("GS500 gs"),
        "image fill with opacity 0.5 should emit GS500 gs (ExtGState): {s}"
    );
    assert!(
        s.contains("/Im0 Do"),
        "image fill with opacity should still emit Do: {s}"
    );
}

#[test]
fn export_pdf_with_image_fill() {
    let node = image_fill_node(1, 10.0, 10.0, 100.0, 100.0);
    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("pdf with image fill");
    assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
    assert!(
        bytes.len() > 300,
        "PDF with image fill should have meaningful content"
    );
}

#[test]
fn render_fills_image_multiple_fills_mixed() {
    // Stacked fill: solid + image + solid — all should render
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![
        FillIR::Solid {
            color: EngineColor::Rgb {
                r: 255.0,
                g: 0.0,
                b: 0.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible: true,
        },
        FillIR::Image {
            src: "data:image/png;base64,AAAA".into(),
            fit: "fill".into(),
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            image_width: Some(32.0),
            image_height: Some(32.0),
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            visible: true,
            alpha_mask: None,
            crop: None,
            rotation: None,
            flip_h: None,
            flip_v: None,
            perspective: None,
        },
    ]);
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
    assert!(s.contains("rg"), "should have solid fill color");
    assert!(s.contains("/Im0 Do"), "should have image Do operator");
    assert_eq!(state.refs.len(), 1, "one image reference");
}

#[test]
fn render_fills_image_uses_cmyk_comment() {
    let node = image_fill_node(1, 0.0, 0.0, 100.0, 100.0);
    let mut doc = Document::new();
    let mut state = ImageRenderState::new(&mut doc);
    let result = render_fills(
        &node,
        100.0,
        true,
        Some(&mut state),
        None,
        None,
        None,
        false,
    );
    let s = String::from_utf8_lossy(&result);
    assert!(
        s.contains("CMYK conversion not yet implemented"),
        "CMYK mode should emit conversion comment: {s}"
    );
    assert!(s.contains("/Im0 Do"), "CMYK mode should still emit Do: {s}");
}

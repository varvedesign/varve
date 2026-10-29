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

// ── embed_image tests ──────────────────────────────────────────────

#[test]
fn embed_image_creates_xobject() {
    let mut doc = Document::new();
    let w = 2u32;
    let h = 2u32;
    let data = vec![255u8, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]; // 4 RGB pixels
    let result = embed_image(&mut doc, &data, w, h);
    assert!(result.is_ok(), "should embed successfully");
    let obj = result.unwrap();
    // Should be a reference to an object
    match obj {
        Object::Reference(_) => {} // correct
        _ => panic!("should return a Reference"),
    }
}

#[test]
fn embed_image_short_data() {
    let mut doc = Document::new();
    let result = embed_image(&mut doc, &[0u8; 2], 10, 10);
    assert!(result.is_err(), "should fail on short data");
}

#[test]
fn embed_image_document_has_stream() {
    let mut doc = Document::new();
    let data = vec![128u8; 3 * 4 * 4]; // 4x4 RGB
    let obj = embed_image(&mut doc, &data, 4, 4).unwrap();
    if let Object::Reference(id) = obj {
        let stored = doc.objects.get(&id).expect("object should exist");
        match stored {
            Object::Stream(s) => {
                assert_eq!(
                    s.dict
                        .get(b"Subtype")
                        .ok()
                        .and_then(|o| o.as_name().ok())
                        .map(|b| String::from_utf8_lossy(b).into_owned()),
                    Some("Image".to_string())
                );
                assert_eq!(
                    s.dict.get(b"Width").ok().and_then(|o| o.as_i64().ok()),
                    Some(4)
                );
                assert_eq!(
                    s.dict.get(b"Height").ok().and_then(|o| o.as_i64().ok()),
                    Some(4)
                );
            }
            _ => panic!("should be a Stream"),
        }
    }
}
// ── PDF export integration tests ───────────────────────────────────

#[test]
fn smoke() {
    assert_eq!(2 + 2, 4);
}

#[test]
fn export_pdf_returns_valid_bytes() {
    let nodes = vec![
        rect_node(1, 0.0, 0.0, 100.0, 100.0),
        rect_node(2, 50.0, 50.0, 50.0, 50.0),
    ];
    let opts = PdfOptions::default();
    let bytes = export_pdf(&nodes, &opts).expect("pdf export");
    assert!(
        bytes.starts_with(b"%PDF"),
        "bytes should start with PDF header"
    );
    assert!(bytes.len() > 200, "PDF should have meaningful content");
}

#[test]
fn export_empty_scene() {
    let bytes = export_pdf(&[], &PdfOptions::default()).expect("empty pdf");
    assert!(bytes.starts_with(b"%PDF"));
}

#[test]
fn export_pdf_with_circle() {
    let nodes = vec![SceneNode {
        id: varve_core::NodeId(1),
        name: "circle".into(),
        transform: Affine::translate((100.0, 100.0)),
        shape: Shape::Circle(Circle::new(Point::new(0.0, 0.0), 50.0)),
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
    }];
    let bytes = export_pdf(&nodes, &PdfOptions::default()).expect("pdf with circle");
    assert!(bytes.starts_with(b"%PDF"));
}

#[test]
fn export_pdf_with_stacked_fills() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![
        solid_fill(255, 0, 0, 255, true),
        solid_fill(0, 0, 255, 128, true),
    ]);
    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("stacked fills pdf");
    assert!(bytes.starts_with(b"%PDF"));
    assert!(bytes.len() > 200, "should have content");
}

#[test]
fn export_pdf_with_strokes() {
    let stroke = Stroke {
        weight: 3.0,
        visible: true,
        ..Default::default()
    };
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.strokes = vec![stroke];
    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("stroked pdf");
    assert!(bytes.starts_with(b"%PDF"));
}

#[test]
fn export_pdf_with_effects() {
    let mut node = rect_node(1, 10.0, 10.0, 100.0, 100.0);
    node.effects = vec![Effect::DropShadow {
        id: None,
        x: 5.0,
        y: 5.0,
        blur: 2.0,
        spread: 0.0,
        color: EngineColor::Rgb {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 255.0,
            bit_depth: None,
            profile: None,
        },
        opacity: 0.5,
        blend_mode: BlendMode::Normal,
        visible: true,
    }];
    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("effects pdf");
    assert!(bytes.starts_with(b"%PDF"));
}

#[test]
fn export_pdf_no_text_operators() {
    let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("pdf");
    let content = String::from_utf8_lossy(&bytes);
    assert!(
        !content.contains("/Tj") && !content.contains("/TJ"),
        "should not contain text operators"
    );
}

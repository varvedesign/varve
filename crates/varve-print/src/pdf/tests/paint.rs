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

// ── render_strokes tests ───────────────────────────────────────────

#[test]
fn render_strokes_width() {
    let stroke = Stroke {
        weight: 5.0,
        visible: true,
        ..Default::default()
    };
    let node = node_with_stroke(stroke);
    let result = render_strokes(&node, 100.0, false, None, None);
    let s = String::from_utf8_lossy(&result);
    assert!(s.contains("5.00 w"), "should set line width to 5");
    assert!(s.contains("S\n"), "should stroke");
}

#[test]
fn render_strokes_preserves_stroke_color_alpha() {
    let stroke = Stroke {
        color: EngineColor::Rgb {
            r: 0.0,
            g: 0.0,
            b: 255.0,
            a: 127.5,
            bit_depth: None,
            profile: None,
        },
        visible: true,
        ..Default::default()
    };
    let mut node = node_with_stroke(stroke);
    node.opacity = 0.5;
    let mut doc = Document::new();
    let mut state = ImageRenderState::new(&mut doc);
    let result = render_strokes(&node, 100.0, false, None, Some(&mut state));
    let content = String::from_utf8_lossy(&result);
    assert!(
        content.contains("/GS249 gs"),
        "node opacity and near-50% stroke color alpha must multiply: {content}"
    );
    assert!(state.refs.iter().any(|(name, object)| {
        name == "GS249"
            && matches!(object, Object::Dictionary(gs)
                if gs.get(b"CA").ok().and_then(|alpha| alpha.as_float().ok())
                    .is_some_and(|alpha| (alpha - 0.249).abs() < 0.001))
    }));
}

#[test]
fn render_strokes_cap() {
    let stroke = Stroke {
        cap: "round".into(),
        visible: true,
        ..Default::default()
    };
    let node = node_with_stroke(stroke);
    let result = render_strokes(&node, 100.0, false, None, None);
    let s = String::from_utf8_lossy(&result);
    assert!(s.contains("1 J"), "round cap = 1");
}

#[test]
fn render_strokes_join() {
    let stroke = Stroke {
        join: "bevel".into(),
        visible: true,
        ..Default::default()
    };
    let node = node_with_stroke(stroke);
    let result = render_strokes(&node, 100.0, false, None, None);
    let s = String::from_utf8_lossy(&result);
    assert!(s.contains("2 j"), "bevel join = 2");
}

#[test]
fn render_strokes_dash() {
    let stroke = Stroke {
        dash_pattern: vec![4.0, 2.0],
        dash_offset: 1.0,
        visible: true,
        ..Default::default()
    };
    let node = node_with_stroke(stroke);
    let result = render_strokes(&node, 100.0, false, None, None);
    let s = String::from_utf8_lossy(&result);
    assert!(s.contains("["), "dash pattern should have bracket");
    assert!(s.contains("d\n"), "should set dash");
}

#[test]
fn render_strokes_invisible() {
    let stroke = Stroke {
        visible: false,
        ..Default::default()
    };
    let node = node_with_stroke(stroke);
    let result = render_strokes(&node, 100.0, false, None, None);
    assert!(
        result.is_empty(),
        "invisible stroke should produce no output"
    );
}

#[test]
fn render_strokes_empty() {
    let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    let result = render_strokes(&node, 100.0, false, None, None);
    assert!(result.is_empty(), "no strokes should produce no output");
}
// ── render_effects tests ───────────────────────────────────────────

#[test]
fn render_effects_dropshadow() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
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
    let result = render_effects(&node, 100.0, false, None, None);
    let s = String::from_utf8_lossy(&result);
    assert!(s.contains("cm"), "shadow should use translation matrix");
    assert!(s.contains("0.000 0.000 0.000 rg"), "shadow should be black");
    assert!(s.contains("f\n"), "shadow should be filled");
}

#[test]
fn drop_shadow_pdf_uses_its_blend_mode_and_combined_alpha() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.opacity = 0.5;
    node.effects = vec![Effect::DropShadow {
        id: None,
        x: 5.0,
        y: 5.0,
        blur: 0.0,
        spread: 0.0,
        color: EngineColor::Rgb {
            r: 255.0,
            g: 0.0,
            b: 0.0,
            a: 128.0,
            bit_depth: None,
            profile: None,
        },
        opacity: 0.5,
        blend_mode: BlendMode::Screen,
        visible: true,
    }];

    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("PDF with screen shadow");
    let (resources, content) = page_resources_and_content(&bytes);
    assert!(
        content.contains("/BMScreen gs"),
        "shadow blend state: {content}"
    );
    assert!(
        content.contains("/GS125 gs"),
        "node × effect alpha: {content}"
    );
    assert_every_graphics_state_precedes_a_paint(&content);

    let ext = resources
        .get(b"ExtGState")
        .expect("ExtGState resources")
        .as_dict()
        .expect("ExtGState dictionary");
    let alpha = ext
        .get(b"GS125")
        .expect("combined alpha state")
        .as_dict()
        .expect("alpha dictionary");
    let expected_alpha = 0.5 * 0.5 * 128.0 / 255.0;
    assert!(
        (alpha.get(b"ca").unwrap().as_float().unwrap() - expected_alpha).abs() < 1e-12,
        "node × effect × shadow-colour alpha"
    );
    let blend = ext
        .get(b"BMScreen")
        .expect("Screen blend state")
        .as_dict()
        .expect("blend dictionary");
    assert_eq!(blend.get(b"BM").unwrap().as_name().unwrap(), b"Screen");
}

#[test]
fn normal_drop_shadow_overrides_its_nodes_non_normal_blend_mode() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.blend_mode = BlendMode::Screen;
    node.effects = vec![Effect::DropShadow {
        id: None,
        x: 5.0,
        y: 5.0,
        blur: 0.0,
        spread: 0.0,
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
    }];

    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("PDF with normal shadow");
    let (resources, content) = page_resources_and_content(&bytes);
    assert!(content.contains("/BMScreen gs"));
    assert!(content.contains("/BMNormal gs"));
    assert_every_graphics_state_precedes_a_paint(&content);
    let ext = resources
        .get(b"ExtGState")
        .expect("ExtGState resources")
        .as_dict()
        .expect("ExtGState dictionary");
    let normal = ext
        .get(b"BMNormal")
        .expect("explicit Normal effect mode")
        .as_dict()
        .expect("Normal blend dictionary");
    assert_eq!(normal.get(b"BM").unwrap().as_name().unwrap(), b"Normal");
}

#[test]
fn render_effects_no_effects() {
    let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    let result = render_effects(&node, 100.0, false, None, None);
    assert!(result.is_empty(), "no effects should produce no output");
}

#[test]
fn render_effects_adjustment_filters_commented() {
    // A nondestructive adjustment stack (halftone, curves, etc.) has no
    // Rust-side renderer. It must be surfaced as an honest PDF comment
    // rather than silently vanishing from print export.
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.filters = Some(vec![serde_json::json!({ "kind": "halftone" })]);
    let result = render_effects(&node, 100.0, false, None, None);
    let s = String::from_utf8_lossy(&result);
    assert!(
        s.contains("nondestructive adjustment stack"),
        "adjustment/filter stack should be honestly flagged as unrendered, got: {s}"
    );
}

#[test]
fn render_effects_empty_filters_produce_no_output() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.filters = Some(vec![]);
    let result = render_effects(&node, 100.0, false, None, None);
    assert!(
        result.is_empty(),
        "an empty filters array should not produce a spurious comment"
    );
}

#[test]
fn render_effects_inner_shadow_commented() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.effects = vec![Effect::InnerShadow {
        id: None,
        x: 2.0,
        y: 2.0,
        blur: 1.0,
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
    let result = render_effects(&node, 100.0, false, None, None);
    let s = String::from_utf8_lossy(&result);
    assert!(s.contains("innerShadow"), "should have comment");
}

#[test]
fn render_effects_depth_blur_commented() {
    // Depth blur relies on an image-space resource unavailable to the
    // vector PDF renderer. Export must acknowledge that limitation rather
    // than silently omitting a visible effect.
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.effects = vec![Effect::DepthBlur {
        id: Some("depth-blur-1".into()),
        depth_map_id: "depth-map-1".into(),
        depth_map: None,
        focus_depth: 0.5,
        focus_range: 0.2,
        blur_strength: 12.0,
        falloff: 1.0,
        invert: false,
        edge_protection: 0.035,
        visible: true,
    }];
    let result = render_effects(&node, 100.0, false, None, None);
    let s = String::from_utf8_lossy(&result);
    assert!(s.contains("depthBlur depthMapId=depth-map-1"), "got: {s}");
    assert!(s.contains("not rendered in basic PDF"), "got: {s}");
}

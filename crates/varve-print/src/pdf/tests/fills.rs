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

// ── render_fills tests ─────────────────────────────────────────────

#[test]
fn render_fills_solid() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![solid_fill(255, 0, 0, 255, true)]);
    let result = render_fills(&node, 100.0, false, None, None, None, None, false);
    let s = String::from_utf8_lossy(&result);
    assert!(s.contains("rg"), "should contain RGB color");
    assert!(s.contains("f\n"), "should contain fill operator");
    assert!(s.contains("re\n"), "should contain path");
}

#[test]
fn render_fills_gradient() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![gradient_fill(true)]);
    let result = render_fills(&node, 100.0, false, None, None, None, None, false);
    let s = String::from_utf8_lossy(&result);
    assert!(s.contains("rg"), "gradient approximated as solid");
    assert!(s.contains("f\n"), "should fill");
}

#[test]
fn render_fills_spot_color_separation() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    let spot = EngineColor::Spot {
        name: "PANTONE 185 C".into(),
        tint: 80.0,
        a: 255.0,
        process_fallback: Some(varve_core::CmykFallback {
            c: 0.0,
            m: 91.0,
            y: 76.0,
            k: 0.0,
        }),
    };
    node.fills = Some(vec![FillIR::Solid {
        color: spot,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        visible: true,
    }]);
    let result = render_fills(&node, 100.0, false, None, None, None, None, false);
    let s = String::from_utf8_lossy(&result);
    assert!(
        s.contains("/Separation"),
        "spot color should emit /Separation color space: {s}"
    );
    assert!(
        s.contains("PANTONE 185 C"),
        "spot color name should appear in separation: {s}"
    );
}

#[test]
fn render_fills_gradient_emits_shading() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![gradient_fill(true)]);
    let mut registry = ShadingRegistry::new();
    let result = render_fills(
        &node,
        100.0,
        false,
        None,
        None,
        None,
        Some(&mut registry),
        false,
    );
    let s = String::from_utf8_lossy(&result);
    assert!(
        s.contains("/Sh1 sh"),
        "should emit shading operator for gradient"
    );
    assert!(s.contains("W n"), "should clip to path before shading");
    assert_eq!(
        registry.definitions.len(),
        1,
        "should have one gradient definition"
    );
}

#[test]
fn render_fills_gradient_preserves_explicit_affine_in_page_space() {
    let mut node = rect_node(1, 10.0, 20.0, 100.0, 80.0);
    node.fills = Some(vec![FillIR::Gradient {
        gradient_type: "linear".into(),
        stops: vec![
            GradientStop {
                position: 0.0,
                color: EngineColor::Rgb {
                    r: 255.0,
                    g: 0.0,
                    b: 0.0,
                    a: 255.0,
                    bit_depth: None,
                    profile: None,
                },
                midpoint: None,
            },
            GradientStop {
                position: 1.0,
                color: EngineColor::Rgb {
                    r: 0.0,
                    g: 0.0,
                    b: 255.0,
                    a: 255.0,
                    bit_depth: None,
                    profile: None,
                },
                midpoint: None,
            },
        ],
        rotation: 0.0,
        interpolation_space: None,
        hue_interpolation: None,
        transform: Some([40.0, 10.0, -5.0, 30.0, 12.0, 8.0]),
        tiling_mode: None,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        visible: true,
    }]);
    let mut registry = ShadingRegistry::new();
    let _ = render_fills(
        &node,
        200.0,
        false,
        None,
        None,
        None,
        Some(&mut registry),
        false,
    );
    assert_eq!(registry.definitions.len(), 1);
    assert_eq!(
        registry.definitions[0].1.matrix,
        [40.0, -10.0, -5.0, -30.0, 22.0, 172.0],
        "node/page transforms must be composed with the authored fill matrix"
    );
}

#[test]
fn render_fills_fallback() {
    let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    let result = render_fills(&node, 100.0, false, None, None, None, None, false);
    let s = String::from_utf8_lossy(&result);
    // Default fill is teal: 57, 208, 198
    assert!(s.contains("0.224"), "should contain R component of teal");
    assert!(s.contains("0.816"), "should contain G component of teal");
    assert!(s.contains("f\n"), "should fill");
}

#[test]
fn render_fills_multi() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![
        solid_fill(255, 0, 0, 255, true),
        solid_fill(0, 255, 0, 255, true),
    ]);
    let result = render_fills(&node, 100.0, false, None, None, None, None, false);
    let s = String::from_utf8_lossy(&result);
    assert!(s.contains("1.000 0.000 0.000 rg"), "first fill red");
    assert!(s.contains("0.000 1.000 0.000 rg"), "second fill green");
    // Should render both fills
    let count = s.matches("f\n").count();
    assert_eq!(count, 2, "should fill twice for two fills");
}

#[test]
fn render_fills_opacity() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![FillIR::Solid {
        color: EngineColor::Rgb {
            r: 255.0,
            g: 0.0,
            b: 0.0,
            a: 255.0,
            bit_depth: None,
            profile: None,
        },
        opacity: 0.5,
        blend_mode: BlendMode::Normal,
        visible: true,
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
        s.contains("/GS500 gs"),
        "a 0.5 solid fill must be painted through an ExtGState, not a comment: {s}"
    );
    assert_every_graphics_state_precedes_a_paint(&s);
    assert!(
        !s.contains("opacity="),
        "opacity must not survive as a non-rendering PDF comment: {s}"
    );
}

#[test]
fn render_fills_invisible() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![solid_fill(255, 0, 0, 255, false)]);
    let result = render_fills(&node, 100.0, false, None, None, None, None, false);
    let s = String::from_utf8_lossy(&result);
    assert!(!s.contains("rg"), "invisible fill should not render");
}

#[test]
fn render_fills_image_not_rendered_as_solid_black() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![FillIR::Image {
        src: "data:image/png;base64,AAAA".into(),
        fit: "fill".into(),
        x: 0.0,
        y: 0.0,
        scale: 1.0,
        image_width: None,
        image_height: None,
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
    let result = render_fills(&node, 100.0, false, None, None, None, None, false);
    let s = String::from_utf8_lossy(&result);
    assert!(
        !s.contains("0 0 0 rg") && !s.contains("f\n"),
        "image fill has no PDF XObject pipeline yet and must not silently \
         paint a solid color in its place: {s}"
    );
    assert!(
        s.contains("not rendered"),
        "should explicitly note the unsupported image fill: {s}"
    );
}

#[test]
fn render_fills_empty_fills_fallsback() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.fills = Some(vec![]);
    let result = render_fills(&node, 100.0, false, None, None, None, None, false);
    let s = String::from_utf8_lossy(&result);
    assert!(s.contains("rg"), "empty fills should fallback");
}

#[test]
fn render_fills_none_fallsback() {
    let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    let result = render_fills(&node, 100.0, false, None, None, None, None, false);
    let s = String::from_utf8_lossy(&result);
    assert!(s.contains("rg"), "None fills should fallback to fill");
}

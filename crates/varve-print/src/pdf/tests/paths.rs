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

// ── shape_path_operators tests ─────────────────────────────────────

#[test]
fn path_ops_rect() {
    let node = rect_node(1, 10.0, 20.0, 100.0, 50.0);
    let ops = shape_path_operators(&node, 200.0);
    let s = String::from_utf8_lossy(&ops);
    assert!(s.contains("re"), "rect should have 're' operator");
    assert!(s.ends_with("re\n"), "should end with re");
}

#[test]
fn path_ops_circle() {
    let node = SceneNode {
        id: varve_core::NodeId(1),
        name: "c".into(),
        transform: Affine::translate((50.0, 50.0)),
        shape: Shape::Circle(Circle::new(Point::new(0.0, 0.0), 30.0)),
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
    let ops = shape_path_operators(&node, 100.0);
    let s = String::from_utf8_lossy(&ops);
    assert!(s.contains("arc"), "circle should have 'arc' operator");
}

#[test]
fn path_ops_path_no_fill_stroke() {
    let node = SceneNode {
        id: varve_core::NodeId(1),
        name: "p".into(),
        transform: Affine::translate((0.0, 0.0)),
        shape: Shape::Path {
            points: vec![
                varve_core::PathPoint {
                    x: 0.0,
                    y: 0.0,
                    handle_in: None,
                    handle_out: None,
                    mode: None,
                },
                varve_core::PathPoint {
                    x: 100.0,
                    y: 100.0,
                    handle_in: None,
                    handle_out: None,
                    mode: None,
                },
            ],
            closed: false,
            tolerance: 1.0,
            contours: Vec::new(),
            holes: vec![],
            fill_rule: None,
        },
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
        fills: None,
        corner_radius: None,
        filters: None,
    };
    let ops = shape_path_operators(&node, 100.0);
    let s = String::from_utf8_lossy(&ops);
    assert!(s.contains("m\n"), "path should have moveto");
    assert!(s.contains("l\n"), "path should have lineto");
    assert!(!s.contains("f"), "path ops should NOT contain fill");
    assert!(!s.contains("S"), "path ops should NOT contain stroke");
    assert!(!s.contains("rg"), "path ops should NOT contain color");
}

#[test]
fn path_ops_compound_path_emits_hole_subpath() {
    let ring = |x: f64, y: f64, size: f64| {
        vec![
            varve_core::PathPoint {
                x,
                y,
                handle_in: None,
                handle_out: None,
                mode: None,
            },
            varve_core::PathPoint {
                x: x + size,
                y,
                handle_in: None,
                handle_out: None,
                mode: None,
            },
            varve_core::PathPoint {
                x: x + size,
                y: y + size,
                handle_in: None,
                handle_out: None,
                mode: None,
            },
            varve_core::PathPoint {
                x,
                y: y + size,
                handle_in: None,
                handle_out: None,
                mode: None,
            },
        ]
    };
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.shape = Shape::Path {
        points: ring(0.0, 0.0, 100.0),
        closed: true,
        tolerance: 1.0,
        contours: Vec::new(),
        holes: vec![ring(25.0, 25.0, 50.0)],
        fill_rule: Some("evenodd".into()),
    };

    let op_bytes = shape_path_operators(&node, 100.0);
    let ops = String::from_utf8_lossy(&op_bytes);
    assert_eq!(ops.matches(" m\n").count(), 2, "outer and hole subpaths");
    assert_eq!(ops.matches("h\n").count(), 2, "both contours close");

    let fill = render_fills(&node, 100.0, false, None, None, None, None, false);
    let fill = String::from_utf8_lossy(&fill);
    assert!(fill.contains("f*\n"), "even-odd compound paths use f*");
}

#[test]
fn path_ops_empty_path() {
    let node = SceneNode {
        id: varve_core::NodeId(1),
        name: "e".into(),
        transform: Affine::translate((0.0, 0.0)),
        shape: Shape::Path {
            points: vec![],
            closed: false,
            tolerance: 1.0,
            contours: Vec::new(),
            holes: vec![],
            fill_rule: None,
        },
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
        fills: None,
        corner_radius: None,
        filters: None,
    };
    let ops = shape_path_operators(&node, 100.0);
    assert!(ops.is_empty(), "empty path should produce empty ops");
}

#[test]
fn pdf_image_placement_matches_canvas_fit_policies() {
    assert_eq!(
        compute_pdf_image_placement("fill", 200.0, 100.0, 100.0, 100.0, 1.0),
        (200.0, 100.0, -50.0, 0.0),
        "fill is cover"
    );
    assert_eq!(
        compute_pdf_image_placement("fit", 200.0, 100.0, 100.0, 100.0, 2.0),
        (200.0, 100.0, -50.0, 0.0),
        "fit policy result is multiplied by user scale"
    );
    assert_eq!(
        compute_pdf_image_placement("crop", 200.0, 100.0, 100.0, 100.0, 0.5),
        (100.0, 50.0, 0.0, 0.0),
        "crop is natural size times scale at the bounds origin"
    );
    assert_eq!(
        compute_pdf_image_placement("stretch", 200.0, 100.0, 80.0, 60.0, 3.0),
        (80.0, 60.0, 0.0, 0.0),
        "stretch intentionally ignores uniform content scale"
    );
}

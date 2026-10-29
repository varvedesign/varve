//! Unit tests for stubs (moved verbatim from lib.rs #[cfg(test)] mod tests; Batch B/B-01).

use super::*;
use crate::test_support::*;
use varve_bridge::IpcSceneNode;
use varve_core::EngineColor;
use varve_core::Point;

#[test]
fn round_trip_build_render_ir() {
    let json = ts_wire_json();
    let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize");
    assert_eq!(nodes.len(), 5);

    let scene = convert_scene(nodes);
    let ir = varve_engine::build_render_ir(&scene);
    assert_eq!(ir.len(), 5);

    // Rect: origin, teal
    assert_eq!(ir[0].transform, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
    assert_eq!(
        ir[0].fill,
        EngineColor::Rgb {
            r: 57.0,
            g: 208.0,
            b: 198.0,
            a: 255.0,
            bit_depth: None,
            profile: None
        }
    );
    assert_eq!(
        ir[0].primitive,
        varve_engine::Primitive::Rect {
            x: 0.0,
            y: 0.0,
            w: 10.0,
            h: 10.0,
            corner_radius: None,
        }
    );

    // Circle: translated (50,50), red
    assert_eq!(ir[1].transform, [1.0, 0.0, 0.0, 1.0, 50.0, 50.0]);
    assert_eq!(
        ir[1].fill,
        EngineColor::Rgb {
            r: 255.0,
            g: 0.0,
            b: 0.0,
            a: 255.0,
            bit_depth: None,
            profile: None
        }
    );
    assert_eq!(
        ir[1].primitive,
        varve_engine::Primitive::Circle {
            cx: 0.0,
            cy: 0.0,
            r: 5.0
        }
    );

    // Ellipse: translated (100,100)
    assert_eq!(ir[2].transform, [1.0, 0.0, 0.0, 1.0, 100.0, 100.0]);
    assert_eq!(
        ir[2].primitive,
        varve_engine::Primitive::Ellipse {
            cx: 10.0,
            cy: 5.0,
            rx: 8.0,
            ry: 4.0
        }
    );

    // Line: at origin
    assert_eq!(ir[3].transform, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
    assert_eq!(
        ir[3].primitive,
        varve_engine::Primitive::Line {
            from: [0.0, 0.0],
            to: [10.0, 10.0],
            tolerance: 2.0
        }
    );

    // Text: translated (25,25), text primitive
    assert_eq!(ir[4].transform, [1.0, 0.0, 0.0, 1.0, 25.0, 25.0]);
    assert_eq!(
        ir[4].fill,
        EngineColor::Rgb {
            r: 16.0,
            g: 21.0,
            b: 31.0,
            a: 255.0,
            bit_depth: None,
            profile: None
        }
    );
    assert!(matches!(
        ir[4].primitive,
        varve_engine::Primitive::Text { .. }
    ));
    if let varve_engine::Primitive::Text {
        ref text,
        font_size,
        ref font_family,
        font_weight,
        ref font_style,
        ..
    } = ir[4].primitive
    {
        assert_eq!(text, "Hello");
        assert_eq!(font_size, 16.0);
        assert_eq!(font_family, "Inter");
        assert_eq!(font_weight, 400);
        assert_eq!(font_style, "normal");
    } else {
        panic!("expected text primitive");
    }
}

#[test]
fn ipc_parity_fills_filters_corner_radius() {
    let json = serde_json::json!([{
        "id": "n0",
        "name": "Rounded",
        "transform": [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        "shape": { "kind": "rect", "x": 0.0, "y": 0.0, "w": 20.0, "h": 20.0, "cornerRadius": 8 },
        "fill": { "space": "rgb", "r": 57, "g": 208, "b": 198, "a": 255 },
        "fills": [{
            "type": "solid",
            "color": {"space": "rgb", "r": 57.0, "g": 208.0, "b": 198.0, "a": 255.0},
            "opacity": 1.0,
            "blendMode": "normal",
            "visible": true
        }],
        "filters": [{ "type": "exposure", "exposure": 0.5 }]
    }]);
    let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize");
    let scene = convert_scene(nodes);
    assert!(scene[0].fills.is_some());
    assert!(scene[0].filters.is_some());
    assert!(scene[0].corner_radius.is_some());
    assert_eq!(
        scene[0].fill,
        EngineColor::Rgb {
            r: 57.0,
            g: 208.0,
            b: 198.0,
            a: 255.0,
            bit_depth: None,
            profile: None
        }
    );

    let ir = varve_engine::build_render_ir(&scene);
    assert!(ir[0].fills.is_some());
    assert!(ir[0].filters.is_some());
    if let varve_engine::Primitive::Rect { corner_radius, .. } = &ir[0].primitive {
        assert!(corner_radius.is_some());
    } else {
        panic!("expected rect");
    }
}

#[test]
fn round_trip_hit_test() {
    let json = ts_wire_json();
    let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize");
    let scene = convert_scene(nodes);
    let hit = varve_core::hit_test(&scene, Point::new(2.0, 8.0));
    assert_eq!(hit, Some(0));

    // Circle at world (50,50) radius 5: (52,50) is inside.
    let hit = varve_core::hit_test(&scene, Point::new(52.0, 50.0));
    assert_eq!(hit, Some(1));

    // Ellipse at world center (110,105), rx=8 ry=4: (115,105) is inside.
    let hit = varve_core::hit_test(&scene, Point::new(115.0, 105.0));
    assert_eq!(hit, Some(2));

    // Point (5,5) is inside both the rect and the line (tolerance 2).
    // hit_test returns the topmost (highest index) — line at index 3.
    let hit = varve_core::hit_test(&scene, Point::new(5.0, 5.0));
    assert_eq!(hit, Some(3));

    // Point outside all shapes
    let hit = varve_core::hit_test(&scene, Point::new(999.0, 999.0));
    assert_eq!(hit, None);
}

#[test]
fn output_serialization_matches_ts_wire_format() {
    let json = ts_wire_json();
    let nodes: Vec<IpcSceneNode> = serde_json::from_value(json).expect("deserialize");
    let scene = convert_scene(nodes);
    let ir = varve_engine::build_render_ir(&scene);

    let serialized = serde_json::to_value(&ir).expect("serialize IR");

    // Verify top-level structure: should be a JSON array
    assert!(serialized.is_array(), "IR should serialize as a JSON array");
    let arr = serialized.as_array().unwrap();
    assert_eq!(arr.len(), 5);

    // Verify transform is an array (not an object with coeffs key)
    let first = &arr[0];
    let tx = first.get("transform").expect("transform field");
    assert!(tx.is_array(), "transform should be a JSON array, got {tx}");
    assert_eq!(tx.as_array().unwrap().len(), 6);

    // Verify primitive has "kind" tag (internally-tagged)
    let prim = first.get("primitive").expect("primitive field");
    assert!(prim.is_object(), "primitive should be an object");
    assert!(
        prim.get("kind").is_some(),
        "primitive should have 'kind' tag"
    );

    // Verify line primitive from/to are arrays (not objects with x,y)
    let line_prim = &arr[3].get("primitive").unwrap();
    assert_eq!(line_prim.get("kind").unwrap(), "line");
    let from = line_prim.get("from").unwrap();
    assert!(
        from.is_array(),
        "line.from should be a JSON array, got {from}"
    );
    let to = line_prim.get("to").unwrap();
    assert!(to.is_array(), "line.to should be a JSON array, got {to}");

    // Verify fill is an EngineColor object tagged by "space"
    let fill = first.get("fill").unwrap();
    assert!(
        fill.is_object(),
        "fill should be a JSON object (EngineColor)"
    );
    assert_eq!(
        fill.get("space").and_then(|v| v.as_str()),
        Some("rgb"),
        "fill should have space='rgb'"
    );
}

// ── allocation bounds ────────────────────────────────────────────

#[test]
fn render_frame_pixels_rejects_oversized_request() {
    // `Response` isn't `Debug`, so match instead of `.unwrap_err()`.
    match render_frame_pixels(100_000, 100_000, 0) {
        Err(err) => assert!(
            err.contains("limit"),
            "expected a clear limit-exceeded error, got: {err}"
        ),
        Ok(_) => panic!("expected an oversized-request error"),
    }
}

#[test]
fn render_frame_pixels_accepts_reasonable_request() {
    assert!(render_frame_pixels(64, 48, 0).is_ok());
}

#[test]
fn build_render_ir_command_rejects_oversized_scene() {
    let err = build_render_ir(oversized_node_list()).unwrap_err();
    assert!(err.contains("limit"), "expected a limit error, got: {err}");
}

#[test]
fn hit_test_command_rejects_oversized_scene() {
    let err = hit_test(oversized_node_list(), 0.0, 0.0).unwrap_err();
    assert!(err.contains("limit"), "expected a limit error, got: {err}");
}

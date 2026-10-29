//! Shared test helpers for the moved lib.rs unit tests (Batch B/B-01).

use crate::stubs::MAX_SCENE_NODES;
use varve_bridge::IpcSceneNode;

pub(crate) fn ts_wire_json() -> serde_json::Value {
    serde_json::json!([
        {
            "id": "n1",
            "name": "Rect-1",
            "transform": [1, 0, 0, 1, 0, 0],
            "shape": { "kind": "rect", "x": 0, "y": 0, "w": 10, "h": 10 },
            "fill": [57, 208, 198, 255]
        },
        {
            "id": "n2",
            "name": "Circle-1",
            "transform": [1, 0, 0, 1, 50, 50],
            "shape": { "kind": "circle", "cx": 0, "cy": 0, "r": 5 },
            "fill": [255, 0, 0, 255]
        },
        {
            "id": "n3",
            "name": "Ellipse-1",
            "transform": [1, 0, 0, 1, 100, 100],
            "shape": { "kind": "ellipse", "cx": 10, "cy": 5, "rx": 8, "ry": 4 },
            "fill": [0, 255, 0, 255]
        },
        {
            "id": "n4",
            "name": "Line-1",
            "transform": [1, 0, 0, 1, 0, 0],
            "shape": { "kind": "line", "from": [0, 0], "to": [10, 10], "tolerance": 2 },
            "fill": [0, 0, 255, 255]
        },
        {
            "id": "n5",
            "name": "Text-1",
            "transform": [1, 0, 0, 1, 25, 25],
            "shape": {
                "kind": "text",
                "text": "Hello",
                "fontSize": 16,
                "fontFamily": "Inter",
                "fontWeight": 400,
                "fontStyle": "normal",
                "textAlign": "left",
                "x": 0.0, "y": 0.0, "w": 100.0, "h": 20.0
            },
            "fill": [16, 21, 31, 255]
        }
    ])
}

pub(crate) fn make_test_png(w: u32, h: u32) -> Vec<u8> {
    let mut buf = image::RgbaImage::new(w, h);
    for (x, _y, px) in buf.enumerate_pixels_mut() {
        *px = if x < w / 2 {
            image::Rgba([255, 0, 0, 255])
        } else {
            image::Rgba([0, 0, 255, 255])
        };
    }
    let mut bytes: Vec<u8> = Vec::new();
    image::DynamicImage::ImageRgba8(buf)
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .expect("encode png");
    bytes
}

pub(crate) fn oversized_node_list() -> Vec<IpcSceneNode> {
    let one = serde_json::json!({
        "id": "n",
        "name": "N",
        "transform": [1, 0, 0, 1, 0, 0],
        "shape": { "kind": "rect", "x": 0, "y": 0, "w": 1, "h": 1 },
        "fill": [0, 0, 0, 255]
    });
    let many = serde_json::Value::Array(vec![one; MAX_SCENE_NODES + 1]);
    serde_json::from_value(many).expect("deserialize oversized node list")
}

pub(crate) fn oversized_node_list_json() -> serde_json::Value {
    let one = serde_json::json!({
        "id": "n",
        "name": "N",
        "transform": [1, 0, 0, 1, 0, 0],
        "shape": { "kind": "rect", "x": 0, "y": 0, "w": 1, "h": 1 },
        "fill": [0, 0, 0, 255]
    });
    serde_json::Value::Array(vec![one; MAX_SCENE_NODES + 1])
}

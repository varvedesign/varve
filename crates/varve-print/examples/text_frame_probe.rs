//! Emit a text-frame sample for independent PDF rendering and visual checks.
//! Run with `cargo run -p varve-print --example text_frame_probe -- /tmp/varve-text-frame`.

use std::path::PathBuf;
use varve_core::{
    Affine, BlendMode, EngineColor, Line, Point, SceneNode, Shape, Stroke, TextFrameBorder,
    TextFrameStyle,
};
use varve_print::{export_pdf, test_fonts, PdfOptions};

fn main() {
    let out_dir = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("varve-text-frame-probe"));
    std::fs::create_dir_all(&out_dir).expect("create probe output directory");
    let font = std::fs::read(test_fonts::bundled_font_path()).expect("read bundled test font");
    let mut nodes = Vec::new();
    // Draw a small, high-contrast floor-plan-like grid under the label so the
    // independent PDF render proves the frame masks busy artwork behind it.
    for (index, y) in [46.0, 52.0, 58.0, 64.0, 70.0, 76.0, 82.0, 88.0, 94.0, 100.0]
        .into_iter()
        .enumerate()
    {
        let stroke = Stroke {
            color: EngineColor::Rgb {
                r: 36.0,
                g: 55.0,
                b: 72.0,
                a: 255.0,
                bit_depth: None,
                profile: None,
            },
            weight: 0.8,
            ..Stroke::default()
        };
        nodes.push(SceneNode {
            id: varve_core::NodeId(index as u64 + 2),
            name: format!("Floor-plan guide {}", index + 1),
            transform: Affine::translate((0.0, 0.0)),
            shape: Shape::Line {
                line: Line::new(Point::new(20.0, y), Point::new(570.0, y + 14.0)),
                tolerance: 0.5,
            },
            fill: EngineColor::Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 0.0,
                bit_depth: None,
                profile: None,
            },
            children: Vec::new(),
            component_id: None,
            slots: None,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            rotation: 0.0,
            strokes: vec![stroke],
            effects: Vec::new(),
            fills: None,
            corner_radius: None,
            filters: None,
        });
    }
    let node = SceneNode {
        id: varve_core::NodeId(1),
        name: "Text frame sample".into(),
        transform: Affine::translate((0.0, 0.0)),
        shape: Shape::Text {
            text: "Readable labels keep their own frame".into(),
            text_frame: Some(TextFrameStyle {
                fill: Some(EngineColor::Rgb {
                    r: 221.0,
                    g: 246.0,
                    b: 243.0,
                    a: 255.0,
                    bit_depth: None,
                    profile: None,
                }),
                border: Some(TextFrameBorder {
                    color: EngineColor::Rgb {
                        r: 18.0,
                        g: 91.0,
                        b: 91.0,
                        a: 255.0,
                        bit_depth: None,
                        profile: None,
                    },
                    width: 2.0,
                }),
            }),
            font_size: 24.0,
            font_family: "DejaVu Sans".into(),
            font_weight: 400,
            font_style: "normal".into(),
            text_align: "left".into(),
            text_align_vertical: None,
            x: 30.0,
            y: 44.0,
            w: 520.0,
            h: 64.0,
            letter_spacing: None,
            line_height: None,
            paragraph_spacing: None,
            text_case: None,
            text_decoration: None,
            text_overflow: None,
            list_style: None,
            rich_text: None,
            open_type_features: None,
            variable_axes: None,
            text_mode: None,
            path_text_settings: None,
            path_shape: None,
        },
        fill: EngineColor::Rgb {
            r: 20.0,
            g: 30.0,
            b: 45.0,
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
    let opts = PdfOptions {
        page_width: 595.0,
        page_height: 150.0,
        subset_fonts: true,
        fonts: vec![("DejaVu Sans".into(), font)],
        ..Default::default()
    };
    nodes.push(node);
    let pdf = export_pdf(&nodes, &opts).expect("export text frame probe");
    let path = out_dir.join("text-frame.pdf");
    std::fs::write(&path, pdf).expect("write text frame PDF");
    println!("{}", path.display());
}

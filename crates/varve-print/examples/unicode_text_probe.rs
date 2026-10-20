//! Emit an authored Unicode text sample for independent PDF renderer checks.
//! Run with `cargo run -p varve-print --example unicode_text_probe -- /tmp/pdf-unicode`.

use std::path::PathBuf;
use varve_core::{Affine, BlendMode, EngineColor, SceneNode, Shape};
use varve_print::{export_pdf, test_fonts, PdfOptions};

fn main() {
    let out_dir = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("varve-pdf-unicode-probe"));
    std::fs::create_dir_all(&out_dir).expect("create probe output directory");
    let font = std::fs::read(test_fonts::bundled_font_path()).expect("read bundled test font");
    let sample = "Łódź: zażółć gęślą jaźń";
    let node = SceneNode {
        id: varve_core::NodeId(1),
        name: "Polish sample".into(),
        transform: Affine::translate((0.0, 0.0)),
        shape: Shape::Text {
            text: sample.into(),
            font_size: 32.0,
            font_family: "Open Sans".into(),
            font_weight: 400,
            font_style: "normal".into(),
            text_align: "left".into(),
            text_align_vertical: None,
            x: 30.0,
            y: 70.0,
            w: 520.0,
            h: 50.0,
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
        page_height: 120.0,
        subset_fonts: true,
        fonts: vec![("Open Sans".into(), font)],
        ..Default::default()
    };
    let pdf = export_pdf(&[node], &opts).expect("export Unicode text probe");
    let path = out_dir.join("unicode-polish.pdf");
    std::fs::write(&path, pdf).expect("write Unicode text probe");
    println!("{}", path.display());
}

//! Temporary verification probe: exports real PDFs so an independent renderer
//! (poppler `pdftoppm`, Ghostscript) can be asked what the file actually paints.
//!
//! Not part of the crate's maintained surface — see §6.3 in
//! `docs/audits/photocraft/findings.md` for the recorded run.

use varve_core::{Affine, BlendMode, EngineColor, FillIR, Rect, SceneNode, Shape};
use varve_print::resources::{ColorSpace, ExportManifest, ImageResource};
use varve_print::{export_pdf, PdfOptions};

fn rgb(r: f64, g: f64, b: f64) -> EngineColor {
    EngineColor::Rgb {
        r,
        g,
        b,
        a: 255.0,
        bit_depth: None,
        profile: None,
    }
}

fn rect(id: u64, name: &str, x: f64, y: f64, w: f64, h: f64) -> SceneNode {
    SceneNode {
        id: varve_core::NodeId(id),
        name: name.into(),
        transform: Affine::translate((x, y)),
        shape: Shape::Rect(Rect::new(0.0, 0.0, w, h)),
        fill: rgb(57.0, 208.0, 198.0),
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
    }
}

fn solid(node: &mut SceneNode, color: EngineColor, opacity: f64, blend: BlendMode) {
    node.fills = Some(vec![FillIR::Solid {
        color,
        opacity,
        blend_mode: blend,
        visible: true,
    }]);
}

fn main() {
    let out_dir = std::env::args_os()
        .nth(1)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("varve-pdf-blend-verify"));
    std::fs::create_dir_all(&out_dir).unwrap();

    // Page 200x200 pt, y-up.
    let opts = PdfOptions {
        page_width: 200.0,
        page_height: 200.0,
        ..Default::default()
    };

    // 1. Screen over an unpainted area: must stay green (pdfcraft #2970 case).
    let mut screen = rect(1, "Screen over nothing", 20.0, 20.0, 60.0, 60.0);
    solid(&mut screen, rgb(0.0, 255.0, 0.0), 1.0, BlendMode::Screen);
    let bytes = export_pdf(&[screen], &opts).unwrap();
    std::fs::write(out_dir.join("screen-over-empty.pdf"), bytes).unwrap();

    // 2. Multiply red baked over an opaque blue rect: must be black.
    let mut blue = rect(1, "blue", 100.0, 20.0, 60.0, 60.0);
    solid(&mut blue, rgb(0.0, 0.0, 255.0), 1.0, BlendMode::Normal);
    let mut red_multiply = rect(2, "red multiply", 130.0, 50.0, 60.0, 60.0);
    solid(
        &mut red_multiply,
        rgb(255.0, 0.0, 0.0),
        1.0,
        BlendMode::Multiply,
    );
    let bytes = export_pdf(&[blue.clone(), red_multiply], &opts).unwrap();
    std::fs::write(out_dir.join("multiply-over-blue.pdf"), bytes).unwrap();

    // 3. A raster fill uses its own Screen mode over the same opaque blue:
    //    red Screen blue = magenta. This exercises the image-fill writer, not
    //    only vector fills.
    let mut red_image = rect(2, "red image screen", 130.0, 50.0, 60.0, 60.0);
    red_image.fills = Some(vec![FillIR::Image {
        src: "red-pixel".into(),
        fit: "stretch".into(),
        x: 0.0,
        y: 0.0,
        scale: 1.0,
        image_width: Some(1.0),
        image_height: Some(1.0),
        opacity: 1.0,
        blend_mode: BlendMode::Screen,
        visible: true,
        alpha_mask: None,
        crop: None,
        rotation: None,
        flip_h: None,
        flip_v: None,
        perspective: None,
    }]);
    let manifest = ExportManifest {
        images: vec![ImageResource {
            id: "red-pixel".into(),
            src: Some("red-pixel".into()),
            mime_type: "image/raw-rgba".into(),
            width: 1,
            height: 1,
            data: vec![255, 0, 0, 255],
            color_space: ColorSpace::Rgb,
        }],
        patterns: vec![],
    };
    let bytes = export_pdf(
        &[blue.clone(), red_image],
        &PdfOptions {
            page_width: opts.page_width,
            page_height: opts.page_height,
            manifest: Some(manifest),
            ..Default::default()
        },
    )
    .unwrap();
    std::fs::write(out_dir.join("image-screen-over-blue.pdf"), bytes).unwrap();

    // 4. Node opacity 0.5 red over opaque blue: must be (128, 0, 128).
    let mut half_red = rect(2, "half red node", 20.0, 100.0, 60.0, 60.0);
    half_red.opacity = 0.5;
    solid(&mut half_red, rgb(255.0, 0.0, 0.0), 1.0, BlendMode::Normal);
    let mut blue_low = rect(1, "blue low", 20.0, 70.0, 60.0, 60.0);
    solid(&mut blue_low, rgb(0.0, 0.0, 255.0), 1.0, BlendMode::Normal);
    let bytes = export_pdf(&[blue_low.clone(), half_red], &opts).unwrap();
    std::fs::write(out_dir.join("node-opacity-half.pdf"), bytes).unwrap();

    // 5. Fill opacity 0.5 red over opaque blue, node opacity 0.5 as well:
    //    the canvas multiplies (0.5 * 0.5 = 0.25), so the result over blue is
    //    0.25 * red + 0.75 * blue = (64, 0, 191).
    let mut quarter = rect(2, "quarter red", 120.0, 100.0, 60.0, 60.0);
    quarter.opacity = 0.5;
    solid(&mut quarter, rgb(255.0, 0.0, 0.0), 0.5, BlendMode::Normal);
    let mut blue_low2 = rect(1, "blue low 2", 120.0, 70.0, 60.0, 60.0);
    solid(&mut blue_low2, rgb(0.0, 0.0, 255.0), 1.0, BlendMode::Normal);
    let bytes = export_pdf(&[blue_low2, quarter], &opts).unwrap();
    std::fs::write(out_dir.join("multiplied-opacity.pdf"), bytes).unwrap();

    println!("wrote 5 PDFs to {}", out_dir.display());
}

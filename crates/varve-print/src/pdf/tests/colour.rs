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

// ── CMYK export integration ────────────────────────────────────────

#[test]
fn export_pdf_with_cmyk_profile() {
    let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    let opts = PdfOptions {
        print_profile: Some(PrintProfile::Fogra39),
        ..Default::default()
    };
    let bytes = export_pdf(&[node], &opts).expect("cmyk pdf");
    assert!(bytes.starts_with(b"%PDF"), "should be valid PDF");
}

#[test]
fn fill_to_color_string_icc_differs_from_analytical() {
    // When a print profile is set, CMYK conversion uses the ICC path,
    // which differs from the analytical (1-C)(1-K) formula.
    let color = varve_core::EngineColor::Rgb {
        r: 180.0,
        g: 100.0,
        b: 60.0,
        a: 255.0,
        bit_depth: None,
        profile: None,
    };
    let fill = varve_core::FillIR::Solid {
        color,
        opacity: 1.0,
        blend_mode: varve_core::BlendMode::Normal,
        visible: true,
    };

    let analytical = fill_to_color_string(&fill, true, None, false);
    let icc = fill_to_color_string(&fill, true, Some(PrintProfile::Fogra39), false);

    // The ICC path produces different CMYK values than analytical
    assert_ne!(
        analytical, icc,
        "ICC and analytical CMYK conversion should differ for this color"
    );
    // Both should contain CMYK operators (end with 'k')
    assert!(
        analytical.ends_with('k'),
        "analytical should be CMYK: {analytical}"
    );
    assert!(icc.ends_with('k'), "icc should be CMYK: {icc}");
}
// ── Native CMYK emission (no RGB round trip) ───────────────────────

#[test]
fn color_to_cmyk_string_emits_native_channels() {
    // Pure K must stay (0 0 0 1) — never a four-color build.
    let pure_k = cmyk_color(0.0, 0.0, 0.0, 255.0, 255.0, None);
    let s = color_to_cmyk_string(&pure_k, None);
    assert_eq!(s, "0.000 0.000 0.000 1.000 k");

    let rich = cmyk_color(60.0, 50.0, 50.0, 100.0, 255.0, None);
    let s = color_to_cmyk_string(&rich, None);
    assert_eq!(s, "0.235 0.196 0.196 0.392 k");
}

#[test]
fn color_to_cmyk_string_bit_depth_scaled() {
    // uint16 channels scale by 65535.
    let u16 = cmyk_color(0.0, 0.0, 0.0, 65535.0, 65535.0, Some("uint16".into()));
    let s = color_to_cmyk_string(&u16, None);
    assert_eq!(s, "0.000 0.000 0.000 1.000 k");

    // float channels pass through unchanged.
    let f = cmyk_color(0.0, 0.5, 0.0, 1.0, 1.0, Some("float32".into()));
    let s = color_to_cmyk_string(&f, None);
    assert_eq!(s, "0.000 0.500 0.000 1.000 k");
}

#[test]
fn color_to_stroke_cmyk_string_emits_native_channels() {
    let pure_k = cmyk_color(0.0, 0.0, 0.0, 255.0, 255.0, None);
    let s = color_to_stroke_cmyk_string(&pure_k, None);
    assert_eq!(s, "0.000 0.000 0.000 1.000 K");
}

#[test]
fn sample_gradient_cmyk_stops_stay_in_cmyk() {
    // Pure K → 0/0/0/255 gradient: every sample must be pure K.
    let stops = vec![
        GradientStop {
            position: 0.0,
            color: cmyk_color(0.0, 0.0, 0.0, 255.0, 255.0, None),
            midpoint: None,
        },
        GradientStop {
            position: 1.0,
            color: cmyk_color(0.0, 0.0, 0.0, 255.0, 255.0, None),
            midpoint: None,
        },
    ];
    for t in [0.0, 0.25, 0.5, 0.75, 1.0] {
        let c = sample_gradient(&stops, t);
        match c {
            EngineColor::Cmyk { k, c, m, y, .. } => {
                assert!((c - 0.0).abs() < 1e-6, "cyan must stay 0");
                assert!((m - 0.0).abs() < 1e-6, "magenta must stay 0");
                assert!((y - 0.0).abs() < 1e-6, "yellow must stay 0");
                assert!((k - 1.0).abs() < 1e-6, "black must stay pure K");
            }
            _ => panic!("native CMYK stops must interpolate in CMYK space"),
        }
    }
}

#[test]
fn gradient_samples_cmyk_preserve_pure_k() {
    // A pure-K gradient exported with use_cmyk must produce K=255 samples
    // (i.e. no four-color build from the naive formula).
    let stops = vec![
        GradientStop {
            position: 0.0,
            color: cmyk_color(0.0, 0.0, 0.0, 255.0, 255.0, None),
            midpoint: None,
        },
        GradientStop {
            position: 1.0,
            color: cmyk_color(0.0, 0.0, 0.0, 255.0, 255.0, None),
            midpoint: None,
        },
    ];
    let mut doc = Document::default();
    let id = create_sampled_function(&mut doc, &stops, true, None);
    assert_ne!(id, ObjectId::default(), "shading should be registered");
    // Extract the sampled stream and check the CMYK samples.
    if let Object::Stream(stream) = &doc.objects[&id] {
        let dict = &stream.dict;
        let size = dict
            .get(b"Size")
            .ok()
            .and_then(|v| match v {
                Object::Array(a) => a.first().and_then(|o| match o {
                    Object::Integer(i) => Some(*i as usize),
                    _ => None,
                }),
                _ => None,
            })
            .unwrap_or(0);
        assert_eq!(size, 256, "gradient samples");
        let data = &stream.content;
        // Every 4th byte (K channel) must be 255 for a pure-K gradient.
        for i in (3..data.len()).step_by(4) {
            assert_eq!(data[i], 255, "K channel must stay pure");
        }
    }
}

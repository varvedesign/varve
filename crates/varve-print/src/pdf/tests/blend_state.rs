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

// ── Blend modes and opacity reach the page, or are reported ──────────
//
// The canvas paints a node's blend mode and opacity
// (`globalCompositeOperation` / `globalAlpha`), so the exported page has
// to carry them too. Before these tests the writer never read
// `blend_mode`, node opacity and solid-fill opacity were emitted as PDF
// comments, and every page started with an opaque white rectangle that
// blend modes then composited against.

#[test]
fn blend_mode_is_written_as_pdf_graphics_state() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.blend_mode = BlendMode::Multiply;
    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("pdf export");
    let (resources, content) = page_resources_and_content(&bytes);
    let states = blend_state_names(&resources);
    assert_eq!(
        states,
        vec!["BMMultiply=Multiply".to_string()],
        "a Multiply node must carry a /BM /Multiply graphics state: {states:?}"
    );
    assert!(
        content.contains("/BMMultiply gs"),
        "the node must select its blend state: {content}"
    );
    assert_every_graphics_state_precedes_a_paint(&content);
}

#[test]
fn searchable_text_fast_path_preserves_node_blend_mode() {
    let font_data = test_font_data();
    let mut node = text_node(1, 10.0, 10.0, "Multiply text", 24.0);
    node.blend_mode = BlendMode::Multiply;
    let opts = PdfOptions {
        subset_fonts: true,
        fonts: vec![("DejaVu Sans".into(), font_data)],
        ..Default::default()
    };

    let bytes = export_pdf(&[node], &opts).expect("searchable text pdf");
    let (resources, content) = page_resources_and_content(&bytes);
    assert_eq!(
        blend_state_names(&resources),
        vec!["BMMultiply=Multiply".to_string()]
    );
    assert!(content.contains("/BMMultiply gs"));
    assert!(content.contains("TJ"));
}

#[test]
fn outlined_text_fast_path_preserves_node_blend_mode() {
    let mut node = text_node(1, 10.0, 10.0, "Multiply text", 24.0);
    node.blend_mode = BlendMode::Multiply;
    let opts = PdfOptions {
        outline_text: true,
        font_data: Some(test_font_data()),
        ..Default::default()
    };

    let bytes = export_pdf(&[node], &opts).expect("outlined text pdf");
    let (resources, content) = page_resources_and_content(&bytes);
    assert_eq!(
        blend_state_names(&resources),
        vec!["BMMultiply=Multiply".to_string()]
    );
    assert!(content.contains("/BMMultiply gs"));
    assert!(content.contains("f\n"));
}

#[test]
fn normal_blend_mode_writes_no_blend_state() {
    let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("pdf export");
    let (resources, content) = page_resources_and_content(&bytes);
    assert!(
        blend_state_names(&resources).is_empty(),
        "Normal is the page default and needs no /BM entry"
    );
    assert!(
        !content.contains(" gs\n"),
        "no blend state selected: {content}"
    );
}

#[test]
fn fill_blend_mode_overrides_the_node_blend_mode() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    let mut fill = solid_fill(0, 128, 255, 255, true);
    if let FillIR::Solid { blend_mode, .. } = &mut fill {
        *blend_mode = BlendMode::Screen;
    }
    node.fills = Some(vec![fill]);
    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("pdf export");
    let (resources, content) = page_resources_and_content(&bytes);
    assert_eq!(
        blend_state_names(&resources),
        vec!["BMScreen=Screen".to_string()],
        "a fill's own blend mode must be written"
    );
    assert!(content.contains("/BMScreen gs"));
    assert_every_graphics_state_precedes_a_paint(&content);
}

#[test]
fn node_and_fill_opacity_multiply_like_the_canvas() {
    // `replay.ts` paints with `globalAlpha = itemAlpha * fill.opacity`, and
    // PDF `/ca` is a single value, so 0.5 * 0.5 must reach the page as
    // 0.25 — writing two states would leave only the inner one in effect.
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.opacity = 0.5;
    let mut fill = solid_fill(255, 0, 0, 255, true);
    if let FillIR::Solid { opacity, .. } = &mut fill {
        *opacity = 0.5;
    }
    node.fills = Some(vec![fill]);
    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("pdf export");
    let (_, content) = page_resources_and_content(&bytes);
    assert!(
        content.contains("/GS500 gs") && content.contains("/GS250 gs"),
        "node 0.5 selects GS500 and the fill resolves to 0.25 (GS250): {content}"
    );
    assert_every_graphics_state_precedes_a_paint(&content);
    assert!(
        !content.contains("opacity="),
        "opacity must not survive as a non-rendering comment: {content}"
    );
}

#[test]
fn node_opacity_is_applied_not_commented() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.opacity = 0.4;
    node.strokes.push(Stroke {
        weight: 2.0,
        visible: true,
        ..Default::default()
    });
    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("pdf export");
    let (resources, content) = page_resources_and_content(&bytes);
    assert!(
        content.contains("/GS400 gs"),
        "node opacity applied: {content}"
    );
    assert_every_graphics_state_precedes_a_paint(&content);
    assert!(
        resources
            .get(b"ExtGState")
            .ok()
            .and_then(|value| value.as_dict().ok())
            .is_some_and(|states| states.has(b"GS400")),
        "the selected opacity state must resolve in the page resources"
    );
    let opacity_state = resources
        .get(b"ExtGState")
        .ok()
        .and_then(|value| value.as_dict().ok())
        .and_then(|states| states.get(b"GS400").ok())
        .and_then(|value| value.as_dict().ok())
        .expect("the node opacity state");
    assert_eq!(opacity_state.get(b"ca").unwrap().as_float().unwrap(), 0.4);
    assert_eq!(opacity_state.get(b"CA").unwrap().as_float().unwrap(), 0.4);
    assert!(
        content.contains("S\n"),
        "the node stroke is present: {content}"
    );
}

#[test]
fn page_keeps_its_neutral_backdrop_instead_of_inventing_paper() {
    // A white rectangle painted first becomes the backdrop every blend mode
    // composites against, so `Screen` over an unpainted area would export
    // white while the canvas shows the source colour. Verified against
    // poppler and Ghostscript (see the module doc).
    let node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("pdf export");
    let (_, content) = page_resources_and_content(&bytes);
    assert!(
        !content.contains("1.000 1.000 1.000 rg"),
        "the exporter must not paint white paper the document does not contain: {content}"
    );
}

#[test]
fn screen_over_an_unpainted_area_keeps_the_source_colour() {
    // The page there is what a `Screen`-blended object composites with.
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.blend_mode = BlendMode::Screen;
    let bytes = export_pdf(&[node], &PdfOptions::default()).expect("pdf export");
    let (_, content) = page_resources_and_content(&bytes);
    assert!(content.contains("/BMScreen gs"));
    assert_every_graphics_state_precedes_a_paint(&content);
    assert!(
        !content.contains("1.000 1.000 1.000 rg"),
        "nothing may be painted under the blend: {content}"
    );
}

#[test]
fn a_mode_without_a_pdf_name_is_reported_not_silently_normalised() {
    let mut lighter = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    lighter.name = "Glow".into();
    lighter.blend_mode = BlendMode::PlusLighter;
    let mut fill_only = rect_node(2, 100.0, 0.0, 10.0, 10.0);
    fill_only.name = "Tint".into();
    let mut fill = solid_fill(0, 0, 0, 255, true);
    if let FillIR::Solid { blend_mode, .. } = &mut fill {
        *blend_mode = BlendMode::PlusDarker;
    }
    fill_only.fills = Some(vec![fill]);

    let error = export_pdf(
        &[lighter.clone(), fill_only.clone()],
        &PdfOptions::default(),
    )
    .unwrap_err();
    assert!(error.contains("PDF export stopped"));
    assert!(error.contains("Glow"));
    assert!(error.contains("Plus Lighter"));
    assert!(error.contains("Tint"));
    assert!(error.contains("Plus Darker"));

    let reported = unrepresented_blend_modes(&[lighter, fill_only], true);
    assert_eq!(
        reported,
        vec![
            UnrepresentedBlend {
                node_name: "Glow".into(),
                mode: "Plus Lighter",
            },
            UnrepresentedBlend {
                node_name: "Tint".into(),
                mode: "Plus Darker",
            },
        ],
        "the export must be able to name what it could not represent"
    );
}

#[test]
fn drop_shadow_with_a_mode_without_a_pdf_name_is_reported() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.name = "Glow".into();
    node.effects = vec![Effect::DropShadow {
        id: None,
        x: 0.0,
        y: 0.0,
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
        blend_mode: BlendMode::PlusLighter,
        visible: true,
    }];
    let error = export_pdf(&[node.clone()], &PdfOptions::default()).unwrap_err();
    assert!(error.contains("Glow"));
    assert!(error.contains("Plus Lighter"));
    assert_eq!(
        unrepresented_blend_modes(&[node], true),
        vec![UnrepresentedBlend {
            node_name: "Glow".into(),
            mode: "Plus Lighter",
        }]
    );
}

#[test]
fn representable_modes_are_never_reported_as_unrepresented() {
    let mut node = rect_node(1, 0.0, 0.0, 100.0, 100.0);
    node.blend_mode = BlendMode::Luminosity;
    let mut fill = solid_fill(0, 0, 0, 255, true);
    if let FillIR::Solid { blend_mode, .. } = &mut fill {
        *blend_mode = BlendMode::Overlay;
    }
    node.fills = Some(vec![fill]);
    assert!(unrepresented_blend_modes(&[node], true).is_empty());
}

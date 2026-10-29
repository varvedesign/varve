//! Shared helper functions for the relocated PDF pipeline tests.

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
use crate::pdf::tests::support::nodes::*;
use crate::pdf::text::*;

pub(crate) fn node_with_stroke(stroke: Stroke) -> SceneNode {
    SceneNode {
        id: varve_core::NodeId(1),
        name: "s".into(),
        transform: Affine::translate((0.0, 0.0)),
        shape: Shape::Rect(Rect::new(0.0, 0.0, 100.0, 100.0)),
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
        strokes: vec![stroke],
        effects: Vec::new(),
        fills: None,
        corner_radius: None,
        filters: None,
    }
}

pub(crate) fn cmyk_color(
    c: f64,
    m: f64,
    y: f64,
    k: f64,
    a: f64,
    bit_depth: Option<String>,
) -> EngineColor {
    EngineColor::Cmyk {
        c,
        m,
        y,
        k,
        a,
        bit_depth,
        profile: Some("fogra39".into()),
    }
}

/// Resources + content of the single page in `bytes`.
pub(crate) fn page_resources_and_content(bytes: &[u8]) -> (lopdf::Dictionary, String) {
    let doc = Document::load_mem(bytes).expect("parse exported PDF");
    let page_id = *doc.get_pages().values().next().expect("PDF has a page");
    let page = doc.get_object(page_id).unwrap().as_dict().unwrap().clone();
    let resources = page
        .get(b"Resources")
        .ok()
        .and_then(|value| value.as_dict().ok())
        .cloned()
        .unwrap_or_default();
    (
        resources,
        String::from_utf8_lossy(&doc.get_page_content(page_id)).into_owned(),
    )
}

/// A PDF graphics state affects only the operators that follow it, so a
/// `gs` inside a `q`/`Q` block that paints nothing is silently inert.
///
/// This is not hypothetical: the first version of the blend and fill-alpha
/// support emitted `/BM… gs` after the `f` of its own fill. Every
/// "the content contains the state" assertion passed, and poppler and
/// Ghostscript both rendered the unblended colour. Only rendering the file
/// caught it, so the ordering is asserted here from now on.
pub(crate) fn assert_every_graphics_state_precedes_a_paint(content: &str) {
    // One entry per open `q` block: states selected in that block that no
    // later paint in the same block has consumed.
    let mut unresolved: Vec<Vec<&str>> = vec![Vec::new()];
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match line {
            "q" => unresolved.push(Vec::new()),
            "Q" => {
                let pending = unresolved.pop().unwrap_or_default();
                assert!(
                    pending.is_empty(),
                    "graphics state {pending:?} is selected in a block that never paints \
                     with it, so it has no effect\n{content}"
                );
            }
            _ => {
                if line.ends_with(" gs") {
                    unresolved.last_mut().expect("balanced q/Q").push(line);
                } else if is_paint_operator(line) {
                    // A paint inside a nested `q` block inherits — and so
                    // consumes — the state selected in every enclosing
                    // block.
                    for block in unresolved.iter_mut() {
                        block.clear();
                    }
                }
            }
        }
    }
    assert!(
        unresolved.iter().all(|block| block.is_empty()),
        "unbalanced or inert graphics state\n{content}"
    );
}

/// Painting operators that consume the current graphics state.
pub(crate) fn is_paint_operator(line: &str) -> bool {
    line == "f"
        || line == "F"
        || line.starts_with("f*")
        || line.starts_with("S")
        || line.starts_with("B")
        || line.ends_with(" sh")
        || line.ends_with(" Do")
        || line.ends_with(" Tj")
        || line.ends_with(" TJ")
        || line.ends_with("'")
        || line.ends_with('"')
}

pub(crate) fn blend_state_names(resources: &lopdf::Dictionary) -> Vec<String> {
    let Some(states) = resources
        .get(b"ExtGState")
        .ok()
        .and_then(|value| value.as_dict().ok())
    else {
        return Vec::new();
    };
    states
        .iter()
        .filter_map(|(name, value)| {
            let dict = value.as_dict().ok()?;
            let blend = dict.get(b"BM").ok()?.as_name().ok()?;
            Some(format!(
                "{}={}",
                String::from_utf8_lossy(name),
                String::from_utf8_lossy(blend)
            ))
        })
        .collect()
}

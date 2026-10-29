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
use crate::pdf::tests::support::inspect::*;
use crate::pdf::tests::support::nodes::*;
use crate::pdf::text::*;

pub(crate) fn image_fill_node(id: u64, x: f64, y: f64, w: f64, h: f64) -> SceneNode {
    let mut node = rect_node(id, x, y, w, h);
    node.fills = Some(vec![FillIR::Image {
        src: "data:image/png;base64,AAAA".into(),
        fit: "fill".into(),
        x: 0.0,
        y: 0.0,
        scale: 1.0,
        image_width: Some(32.0),
        image_height: Some(32.0),
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
    node
}

pub(crate) fn image_manifest(src: &str, width: u32, height: u32) -> resources::ExportManifest {
    resources::ExportManifest {
        images: vec![resources::ImageResource {
            id: "image".into(),
            src: Some(src.into()),
            mime_type: "image/png".into(),
            width,
            height,
            data: vec![180; (width * height * 4) as usize],
            color_space: resources::ColorSpace::Rgb,
        }],
        patterns: Vec::new(),
    }
}

/// Widths of every embedded image XObject in the render-state document.
pub(crate) fn embedded_image_widths(doc: &Document) -> Vec<i64> {
    let mut widths: Vec<i64> = doc
        .objects
        .values()
        .filter_map(|obj| match obj {
            Object::Stream(s) => {
                let is_image = s
                    .dict
                    .get(b"Subtype")
                    .ok()
                    .and_then(|o| o.as_name().ok())
                    .map(|b| b == b"Image")
                    .unwrap_or(false);
                if is_image {
                    s.dict.get(b"Width").ok().and_then(|o| o.as_i64().ok())
                } else {
                    None
                }
            }
            _ => None,
        })
        .collect();
    widths.sort_unstable();
    widths
}

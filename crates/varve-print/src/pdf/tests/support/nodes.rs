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
use crate::pdf::tests::support::inspect::*;
use crate::pdf::text::*;

// ── Helpers ────────────────────────────────────────────────────────

pub(crate) fn rect_node(id: u64, x: f64, y: f64, w: f64, h: f64) -> SceneNode {
    SceneNode {
        id: varve_core::NodeId(id),
        name: format!("r{id}"),
        transform: Affine::translate((x, y)),
        shape: Shape::Rect(Rect::new(0.0, 0.0, w, h)),
        fill: EngineColor::Rgb {
            r: 57.0,
            g: 208.0,
            b: 198.0,
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
    }
}

pub(crate) fn text_node(id: u64, x: f64, y: f64, text: &str, font_size: f64) -> SceneNode {
    SceneNode {
        id: varve_core::NodeId(id),
        name: format!("t{id}"),
        transform: Affine::translate((x, y)),
        shape: Shape::Text {
            text: text.into(),
            font_size,
            font_family: "DejaVu Sans".into(),
            font_weight: 400,
            font_style: "normal".into(),
            text_align: "left".into(),
            text_align_vertical: None,
            x: 0.0,
            y: 0.0,
            w: font_size * text.len() as f64 * 0.6,
            h: font_size * 1.2,
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
    }
}

pub(crate) fn test_font_data() -> Vec<u8> {
    crate::test_fonts::test_font_bytes().to_vec()
}

pub(crate) fn solid_fill(r: u8, g: u8, b: u8, a: u8, visible: bool) -> FillIR {
    FillIR::Solid {
        color: EngineColor::Rgb {
            r: r as f64,
            g: g as f64,
            b: b as f64,
            a: a as f64,
            bit_depth: None,
            profile: None,
        },
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        visible,
    }
}

pub(crate) fn gradient_fill(visible: bool) -> FillIR {
    FillIR::Gradient {
        gradient_type: "linear".into(),
        stops: vec![
            GradientStop {
                position: 0.0,
                color: EngineColor::Rgb {
                    r: 255.0,
                    g: 0.0,
                    b: 0.0,
                    a: 255.0,
                    bit_depth: None,
                    profile: None,
                },
                midpoint: None,
            },
            GradientStop {
                position: 1.0,
                color: EngineColor::Rgb {
                    r: 0.0,
                    g: 0.0,
                    b: 255.0,
                    a: 255.0,
                    bit_depth: None,
                    profile: None,
                },
                midpoint: None,
            },
        ],
        rotation: 0.0,
        interpolation_space: None,
        hue_interpolation: None,
        transform: None,
        tiling_mode: None,
        opacity: 1.0,
        blend_mode: BlendMode::Normal,
        visible,
    }
}

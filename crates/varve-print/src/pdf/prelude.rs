//! Shared imports for the PDF pipeline modules.
//!
//! Every pipeline module starts with a prelude glob import so the external
//! dependency imports and crate-module aliases exist exactly once.

#![allow(unused_imports)]

pub(crate) use std::collections::HashMap;

pub(crate) use ab_glyph::Font as AbGlyphFont;
pub(crate) use lopdf::{dictionary, Document, Object, ObjectId, Stream};
pub(crate) use varve_colour::engine_color_rgba;
pub(crate) use varve_core::{
    compound_path_fill_rule, compound_path_rings, Effect, EngineColor, FillIR, GradientStop,
    PathFillRule, SceneNode, Shape,
};

pub(crate) use crate::profiles::PrintProfile;
pub(crate) use crate::subset::{
    collect_used_chars, get_subset_tag, subset_font, validate_embedding_permission,
    EmbeddingPermission, EmbeddingRestriction,
};

pub(crate) use crate::{blend, cmyk, profiles, resources};

pub(crate) use crate::blend::{
    blend_mode_label, needs_blend_graphics_state, pdf_blend_name, UnrepresentedBlend,
};
pub(crate) use crate::outline::{
    commands_to_svg_path, outline_text, outline_text_multi, GlyphOutline, PathCommand,
};

#[cfg(test)]
pub(crate) use varve_core::scene::FillPerspective;
#[cfg(test)]
pub(crate) use varve_core::{Affine, BlendMode, Circle, Point, Rect, Stroke};

//! Print/PDF pipeline, split from the crate root for the source-file budget.
//!
//! The crate-root public API is re-exported from lib.rs; the entry point
//! delegates to the export module.

pub(crate) mod colour;
pub(crate) mod export;
pub(crate) mod fills;
pub(crate) mod fills_image;
pub(crate) mod fills_pattern;
pub(crate) mod fonts;
pub(crate) mod geometry;
pub(crate) mod options;
pub(crate) mod paint;
pub(crate) mod paths;
pub(crate) mod prelude;
pub(crate) mod resources;
pub(crate) mod rich_text;
pub(crate) mod shading;
pub(crate) mod text;

#[cfg(test)]
mod tests;

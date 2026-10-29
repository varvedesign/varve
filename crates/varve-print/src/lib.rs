//! Print pipeline: font outlining, RGB/CMYK PDF export.
//!
//! `export_pdf()` converts a flat scene into PDF bytes using lopdf, emitting
//! path operators for each shape node. CMYK/PDF-X export lives in `cmyk.rs`.
//!
//! Research basis: lopdf for PDF generation. PDF graphics model uses path
//! construction operators (m, l, re, h, f) per the ISO 32000 spec.

#![forbid(unsafe_code)]
// Pre-existing clippy exceptions (low-priority, not introduced by this session).
#![allow(
    clippy::too_many_arguments,
    clippy::option_as_ref_deref,
    clippy::derivable_impls
)]

pub mod blend;
pub mod cmyk;
pub mod icc;
pub mod marks;
pub mod outline;
pub mod profiles;
pub mod resources;
pub mod shaper;
pub mod subset;

pub use blend::{blend_mode_label, needs_blend_graphics_state, pdf_blend_name, UnrepresentedBlend};

/// Shared cross-platform test-font resolver. Kept non-`cfg(test)` so the
/// desktop crate's test module can reuse the bundled fixture instead of
/// duplicating Linux-only font paths (which broke macOS/Windows CI).
pub mod test_fonts;

pub use outline::{
    commands_to_svg_path, outline_text, outline_text_multi, GlyphOutline, PathCommand,
};

mod pdf;

pub(crate) use pdf::colour::assert_pdf_blends_are_representable;
pub use pdf::colour::{blend_is_representable, unrepresented_blend_modes};
pub use pdf::options::PdfOptions;
pub(crate) use pdf::paint::shape_to_pdf_content;
pub(crate) use pdf::resources::{add_image_render_resources, ImageRenderState};
pub use pdf::resources::{
    embed_image, embed_image_with_colorspace, rgba_extract_alpha, rgba_to_rgb,
};
pub(crate) use pdf::text::collect_text_per_family;
pub use pdf::text::{has_non_winansi, requires_outline};

/// Convert a flat scene into PDF bytes.
///
/// This is the crate-root entry point; the pipeline body lives in pdf::export.
pub fn export_pdf(
    nodes: &[varve_core::SceneNode],
    opts: &pdf::options::PdfOptions,
) -> Result<Vec<u8>, String> {
    pdf::export::export_pdf(nodes, opts)
}

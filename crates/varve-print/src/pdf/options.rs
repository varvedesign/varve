//! Options for PDF export.

use super::prelude::*;

/// Options for PDF export.
#[derive(Debug, Clone)]
pub struct PdfOptions {
    pub page_width: f64,
    pub page_height: f64,
    pub title: String,
    pub author: String,
    /// When true, text nodes are outlined into vector paths using `font_data`.
    pub outline_text: bool,
    /// Raw TTF/OTF font bytes for text outlining (legacy single-font).
    pub font_data: Option<Vec<u8>>,
    /// Multiple fonts for multi-font outlining: (family_name, raw bytes).
    pub fonts: Vec<(String, Vec<u8>)>,
    /// Whether to draw registration marks.
    pub registration_marks: bool,
    /// Whether to draw a color bar.
    pub color_bar: bool,
    /// Print profile for CMYK conversion (None = RGB).
    pub print_profile: Option<PrintProfile>,
    /// When true, subset and embed fonts for text runs representable by the
    /// PDF writer's WinAnsi text path. Other Unicode runs are outlined.
    pub subset_fonts: bool,
    /// How to handle fonts whose OS/2 fsType restricts embedding.
    pub embedding_restriction_handling: EmbeddingRestriction,
    /// Optional resource manifest carrying decoded image bytes for image and
    /// pattern fills. Missing pattern sources are omitted with a PDF comment;
    /// they are never substituted with a gray rectangle.
    pub manifest: Option<resources::ExportManifest>,
    /// When true, emit a warning when converting high bit depth colors
    /// (float32/uint16) to 8-bit PDF color values.
    pub lossy: bool,
}

impl Default for PdfOptions {
    fn default() -> Self {
        Self {
            page_width: 1920.0,
            page_height: 1080.0,
            title: "Strata Export".into(),
            author: "Strata".into(),
            outline_text: false,
            font_data: None,
            fonts: Vec::new(),
            registration_marks: false,
            color_bar: false,
            print_profile: None,
            subset_fonts: false,
            embedding_restriction_handling: EmbeddingRestriction::Warn,
            manifest: None,
            lossy: false,
        }
    }
}

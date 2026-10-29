//! PDF blend-mode fidelity for the vector export path.
//!
//! The canvas applies a node's and a fill's `blendMode` through
//! `globalCompositeOperation`, and each mode's editable domains and
//! interoperable names are declared once in
//! `packages/engine/src/blendModeCatalog.ts`. Until this module existed the
//! Rust writers never read `blend_mode` at all, so a document that composited
//! with `multiply` on screen exported as plain `Normal` art with no warning:
//! the capability catalog claimed the format handled blend modes and the page
//! did not.
//!
//! PDF 1.4 (ISO 32000-1, 11.6.3, Table 136) names the blend modes this product
//! exposes except for three entries that are not blend modes with a PDF name:
//!
//! - `passThrough` is a *group* policy — a group that does not composite as a
//!   unit. A node carrying it paints with `Normal` semantics, which is what
//!   [`pdf_blend_name`] reports by returning `None` and what the writer emits
//!   by writing no `/BM` at all (the PDF page default).
//! - `plusLighter` / `plusDarker` are Porter-Duff separator operators in the
//!   CSS model (`lighter`), not separable blend functions, and PDF defines no
//!   equivalent. They cannot be written as `/BM`, so they are reported rather
//!   than silently normalised.
//!
//! Keeping this table in Rust (rather than shipping names in the wire format)
//! keeps the PDF names next to the only code that writes them; the exhaustive
//! `match` makes a new `BlendMode` variant a compile error here, and
//! `packages/engine/src/blendModeCatalog.test.ts` pins the same set on the TS
//! side.

use varve_core::BlendMode;

/// The PDF blend-mode name for `mode`, or `None` when PDF has no name for it.
///
/// `None` is a *fidelity* answer, never "treat it as Normal": callers report
/// it (see `crate::unrepresented_blend_modes`) instead of quietly producing a
/// different composition from the one the canvas shows.
pub fn pdf_blend_name(mode: &BlendMode) -> Option<&'static str> {
    match mode {
        BlendMode::Normal => Some("Normal"),
        BlendMode::Multiply => Some("Multiply"),
        BlendMode::Screen => Some("Screen"),
        BlendMode::Overlay => Some("Overlay"),
        BlendMode::Darken => Some("Darken"),
        BlendMode::Lighten => Some("Lighten"),
        BlendMode::ColorDodge => Some("ColorDodge"),
        BlendMode::ColorBurn => Some("ColorBurn"),
        BlendMode::HardLight => Some("HardLight"),
        BlendMode::SoftLight => Some("SoftLight"),
        BlendMode::Difference => Some("Difference"),
        BlendMode::Exclusion => Some("Exclusion"),
        BlendMode::Hue => Some("Hue"),
        BlendMode::Saturation => Some("Saturation"),
        BlendMode::Color => Some("Color"),
        BlendMode::Luminosity => Some("Luminosity"),
        BlendMode::PassThrough | BlendMode::PlusDarker | BlendMode::PlusLighter => None,
    }
}

/// True when `mode` needs a `/BM` entry in the graphics state.
///
/// `Normal` is the PDF page default, so writing it is noise; every other
/// representable mode changes the composite and must be written. Modes with no
/// PDF name are `false` here and are reported by the caller instead.
pub fn needs_blend_graphics_state(mode: &BlendMode) -> bool {
    matches!(pdf_blend_name(mode), Some(name) if name != "Normal")
}

/// Product label for a mode, for export diagnostics that name the offender.
pub fn blend_mode_label(mode: &BlendMode) -> &'static str {
    match mode {
        BlendMode::PassThrough => "Pass Through",
        BlendMode::Normal => "Normal",
        BlendMode::Multiply => "Multiply",
        BlendMode::Screen => "Screen",
        BlendMode::Overlay => "Overlay",
        BlendMode::Darken => "Darken",
        BlendMode::Lighten => "Lighten",
        BlendMode::ColorDodge => "Color Dodge",
        BlendMode::ColorBurn => "Color Burn",
        BlendMode::HardLight => "Hard Light",
        BlendMode::SoftLight => "Soft Light",
        BlendMode::Difference => "Difference",
        BlendMode::Exclusion => "Exclusion",
        BlendMode::Hue => "Hue",
        BlendMode::Saturation => "Saturation",
        BlendMode::Color => "Color",
        BlendMode::Luminosity => "Luminosity",
        BlendMode::PlusDarker => "Plus Darker",
        BlendMode::PlusLighter => "Plus Lighter",
    }
}

/// One node whose paint the vector writer cannot reproduce faithfully.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnrepresentedBlend {
    /// Authored node name, so a report can point at the object.
    pub node_name: String,
    /// Product label of the offending mode.
    pub mode: &'static str,
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_MODES: [BlendMode; 19] = [
        BlendMode::PassThrough,
        BlendMode::Normal,
        BlendMode::Multiply,
        BlendMode::Screen,
        BlendMode::Overlay,
        BlendMode::Darken,
        BlendMode::Lighten,
        BlendMode::ColorDodge,
        BlendMode::ColorBurn,
        BlendMode::HardLight,
        BlendMode::SoftLight,
        BlendMode::Difference,
        BlendMode::Exclusion,
        BlendMode::Hue,
        BlendMode::Saturation,
        BlendMode::Color,
        BlendMode::Luminosity,
        BlendMode::PlusDarker,
        BlendMode::PlusLighter,
    ];

    #[test]
    fn fifteen_non_normal_modes_have_a_pdf_name() {
        let named: Vec<&str> = ALL_MODES
            .iter()
            .filter_map(pdf_blend_name)
            .filter(|name| *name != "Normal")
            .collect();
        assert_eq!(named.len(), 15, "15 non-Normal PDF blend names: {named:?}");
        assert!(named.contains(&"Multiply"));
        assert!(named.contains(&"Luminosity"));
    }

    #[test]
    fn mode_without_a_pdf_name_is_reported_rather_than_written_as_normal() {
        for mode in [
            BlendMode::PassThrough,
            BlendMode::PlusDarker,
            BlendMode::PlusLighter,
        ] {
            assert_eq!(pdf_blend_name(&mode), None, "{mode:?}");
            assert!(!needs_blend_graphics_state(&mode), "{mode:?}");
        }
    }

    #[test]
    fn normal_needs_no_graphics_state_and_other_named_modes_do() {
        assert!(!needs_blend_graphics_state(&BlendMode::Normal));
        for mode in [
            BlendMode::Multiply,
            BlendMode::Screen,
            BlendMode::Overlay,
            BlendMode::Luminosity,
        ] {
            assert!(needs_blend_graphics_state(&mode), "{mode:?}");
        }
    }

    #[test]
    fn every_mode_has_a_label() {
        for mode in ALL_MODES {
            assert!(!blend_mode_label(&mode).is_empty(), "{mode:?}");
        }
        assert_eq!(blend_mode_label(&BlendMode::PlusLighter), "Plus Lighter");
    }
}

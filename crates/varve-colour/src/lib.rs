//! `varve-colour` — Colour-science crate with WASM bindings.
//!
//! Provides colour conversion functions (naive RGB↔CMYK, analytical
//! ICC-aware RGB→CMYK with profile-specific GCR/TAC), ICC profile
//! loading and transforms via `tintbox`, and bundled ICC profiles for
//! deterministic cross-target colour math.
//!
//! ## Architecture
//!
//! ```text
//! varve-colour
//!   ├── conversions   Analytical colour-space math (no ICC needed)
//!   ├── profiles      PrintProfile enum, ICC header validation, bundled data
//!   ├── icc           tintbox-based ICC transform engine
//!   └── lib           Re-exports + wasm-bindgen exports
//! ```
//!
//! Cross-target: all colour science is deterministic across native (tintbox)
//! and WASM (`wasm-bindgen`) builds — the same profile bytes are embedded,
//! the same arithmetic applies, and the same tolerance guarantees hold.

#![forbid(unsafe_code)]

use wasm_bindgen::prelude::*;

pub mod conversions;
pub mod icc;
pub mod profiles;
pub mod proof;

pub use conversions::{
    apply_tac, cmyk_to_rgb, engine_color_rgba, linear_rgb_to_xyz, linear_to_srgb, profile_gcr,
    profile_tac, rgb_to_cmyk, rgb_to_cmyk_icc, srgb_to_linear, xyz_to_linear_rgb,
};
pub use icc::{profile_fingerprint, BundledProfile, IccEngine};
pub use profiles::{
    bundled_cmyk, bundled_srgb, parse_icc_profile_info, tetrahedral_interpolate,
    validate_icc_profile, PrintProfile, ProfileInfo, RenderingIntent,
};
pub use proof::{
    ProofEngine, ProofParams, ProofSimulationSupport, ProofTransformKey,
    DEFAULT_MAX_PROOF_TRANSFORMS,
};

/// Return the crate version string.
///
/// Useful for diagnostics and cross-target consistency checks.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn colour_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ── WASM-bindgen exports ────────────────────────────────────────────────
//
// These are only compiled when the `wasm` feature is enabled (default in
// wasm-pack builds). They provide a stable, typed JS API for colour ops.
//
// All conversions return Vec<u8> in CHANNELS_4 format: [c0,c1,c2,c3] where
// each channel is u8 in range 0..=255. Buffer conversions return the packed
// output bytes directly.

#[wasm_bindgen]
pub fn wasm_rgb_to_cmyk(r: u8, g: u8, b: u8) -> Vec<u8> {
    let (c, m, y, k) = conversions::rgb_to_cmyk(r, g, b);
    vec![c, m, y, k]
}

/// Inverse CMYK → RGB (naive formula).
#[wasm_bindgen]
pub fn wasm_cmyk_to_rgb(c: u8, m: u8, y: u8, k: u8) -> Vec<u8> {
    let (r, g, b, a) = conversions::cmyk_to_rgb(c, m, y, k);
    vec![r, g, b, a]
}

/// Analytical ICC-aware RGB → CMYK using the pure-arithmetic pipeline.
///
/// `profile_name` must be one of: "Fogra39", "Gracol2006", "SwopCoated".
/// `rendering_intent` must be one of: "perceptual", "relative", "absolute", "saturation".
///
/// Returns `[C, M, Y, K]` as a 4-byte array, or an error if parameters are invalid.
#[wasm_bindgen]
pub fn wasm_rgb_to_cmyk_icc(
    r: u8,
    g: u8,
    b: u8,
    profile_name: &str,
    rendering_intent: &str,
    black_point_compensation: bool,
) -> Result<Vec<u8>, JsValue> {
    let profile = profiles::PrintProfile::parse(profile_name).ok_or_else(|| {
        JsValue::from_str(&format!(
            "Unknown print profile: '{profile_name}'. Expected: Fogra39, Gracol2006, SwopCoated"
        ))
    })?;

    let intent = profiles::RenderingIntent::parse_intent(rendering_intent).ok_or_else(|| {
        JsValue::from_str(&format!(
            "Unknown rendering intent: '{rendering_intent}'. Expected: perceptual, relative, absolute, saturation"
        ))
    })?;

    let (c, m, y, k) =
        conversions::rgb_to_cmyk_icc(profile, r, g, b, intent, black_point_compensation);
    Ok(vec![c, m, y, k])
}

/// Convert an sRGB pixel buffer to CMYK using a real ICC transform.
///
/// `profile_data` must be the raw bytes of a valid ICC CMYK profile.
/// `rendering_intent` can be "perceptual" (default), "relative", "absolute", or "saturation".
///
/// On success, returns a Uint8Array of length `(data.len() / 3) * 4` containing
/// packed CMYK pixels (C, M, Y, K per pixel).
#[wasm_bindgen]
pub fn wasm_convert_srgb_buffer_to_cmyk(
    data: Vec<u8>,
    profile_data: Vec<u8>,
    rendering_intent: &str,
    black_point_compensation: bool,
) -> Result<Vec<u8>, JsValue> {
    if data.len() % 3 != 0 {
        return Err(JsValue::from_str(&format!(
            "Input data length {} is not a multiple of 3 (RGB)",
            data.len()
        )));
    }

    let n_pixels = data.len() / 3;
    if n_pixels == 0 {
        return Ok(Vec::new());
    }

    let intent = profiles::RenderingIntent::parse_intent(rendering_intent)
        .unwrap_or(profiles::RenderingIntent::Perceptual);

    // Build a temporary ICC engine with the provided profile
    let mut engine = crate::icc::IccEngine::new();
    engine
        .load_all_for_print()
        .map_err(|e| JsValue::from_str(&e))?;
    engine
        .load_bytes("user_cmyk", &profile_data)
        .map_err(|e| JsValue::from_str(&e))?;

    // Convert the flat buffer to &[(u8,u8,u8)]
    let rgb_pixels: Vec<(u8, u8, u8)> = data
        .chunks_exact(3)
        .map(|chunk| (chunk[0], chunk[1], chunk[2]))
        .collect();

    let result = engine
        .srgb_buffer_to_cmyk("user_cmyk", &rgb_pixels, intent, black_point_compensation)
        .map_err(|e| JsValue::from_str(&e))?;

    // Flatten back to Vec<u8>
    let mut out = Vec::with_capacity(result.len() * 4);
    for (c, m, y, k) in result {
        out.push(c);
        out.push(m);
        out.push(y);
        out.push(k);
    }
    Ok(out)
}

// ── Soft proofing (real ICC proofing chain) ─────────────────────────────
//
// These bindings expose `proof::ProofEngine` to the browser runtime, where the
// renderer needs a display-only proof transform. The engine is stateful (it
// holds compiled transforms) and is therefore an opaque handle rather than a
// collection of free functions.
//
// Profile identity is a content fingerprint computed in Rust; the JS side never
// constructs a cache key from a path or a display name.

/// Raw bytes of the bundled sRGB display profile, for fingerprinting on the JS
/// side and for handing the same bytes back to `WasmProofEngine`.
#[wasm_bindgen]
pub fn wasm_bundled_srgb_profile() -> Vec<u8> {
    profiles::bundled_srgb().to_vec()
}

/// Raw bytes of the bundled ISO Coated v2 (FOGRA39) output profile.
#[wasm_bindgen]
pub fn wasm_bundled_cmyk_profile() -> Vec<u8> {
    profiles::bundled_cmyk().to_vec()
}

/// Content fingerprint of ICC profile bytes (FNV-1a 64-bit, returned as a hex
/// string). Callers use this as the profile identity in cache keys and UI.
#[wasm_bindgen]
pub fn wasm_profile_fingerprint(data: &[u8]) -> String {
    format!("{:016x}", icc::profile_fingerprint(data))
}

fn proof_error(message: String) -> JsValue {
    JsValue::from_str(&message)
}

fn parse_proof_intent(name: &str) -> Result<RenderingIntent, JsValue> {
    profiles::RenderingIntent::parse_intent(name)
        .ok_or_else(|| proof_error(format!("Unknown rendering intent: '{name}'")))
}

/// A display-only ICC proof engine.
///
/// Register the display profile and the output (proof) condition, then proof
/// normalized sRGB buffers. Nothing here writes to a document.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub struct WasmProofEngine {
    inner: proof::ProofEngine,
}

#[cfg_attr(feature = "wasm", wasm_bindgen)]
impl WasmProofEngine {
    /// Create an engine with no profiles registered. Registering at least one
    /// display and one output profile is a precondition for proofing.
    #[cfg_attr(feature = "wasm", wasm_bindgen(constructor))]
    pub fn new() -> WasmProofEngine {
        WasmProofEngine {
            inner: proof::ProofEngine::new(),
        }
    }

    /// Register the RGB display profile. Rejects bytes that are not a valid,
    /// parseable RGB ICC profile; a rejected profile leaves the previous one
    /// (and its transforms) untouched.
    pub fn set_display_profile(&mut self, name: &str, data: &[u8]) -> Result<(), JsValue> {
        self.inner
            .set_display_profile(name, data)
            .map_err(proof_error)
    }

    /// Register the output (proof) condition profile. RGB, CMYK and Gray output
    /// profiles are accepted.
    pub fn set_output_profile(&mut self, name: &str, data: &[u8]) -> Result<(), JsValue> {
        self.inner
            .set_output_profile(name, data)
            .map_err(proof_error)
    }

    /// Identity of the registered display profile, or an empty string when none
    /// is registered. This is the fingerprint, not the name.
    pub fn display_profile_fingerprint(&self) -> String {
        self.inner
            .display_profile_fingerprint()
            .map(|f| format!("{f:016x}"))
            .unwrap_or_default()
    }

    /// Identity of the registered output profile, or an empty string.
    pub fn output_profile_fingerprint(&self) -> String {
        self.inner
            .output_profile_fingerprint()
            .map(|f| format!("{f:016x}"))
            .unwrap_or_default()
    }

    /// Proof an interleaved normalized sRGB buffer (`rgb.len() % 3 == 0`,
    /// channels in `[0, 1]`). Returns the display-referred result.
    #[allow(clippy::too_many_arguments)]
    pub fn proof_buffer(
        &mut self,
        rgb: Vec<f32>,
        rendering_intent: &str,
        black_point_compensation: bool,
        simulate_paper_color: bool,
        gamut_check: bool,
    ) -> Result<Vec<f32>, JsValue> {
        let params = proof::ProofParams {
            rendering_intent: parse_proof_intent(rendering_intent)?,
            black_point_compensation,
            simulate_paper_color,
            gamut_check,
            simulate_black_ink: false,
        };
        self.inner
            .proof_rgb_buffer(&rgb, &params)
            .map_err(proof_error)
    }

    /// Proof a single normalized sRGB colour.
    pub fn proof_pixel(
        &mut self,
        r: f32,
        g: f32,
        b: f32,
        rendering_intent: &str,
        black_point_compensation: bool,
        simulate_paper_color: bool,
    ) -> Result<Vec<f32>, JsValue> {
        let params = proof::ProofParams {
            rendering_intent: parse_proof_intent(rendering_intent)?,
            black_point_compensation,
            simulate_paper_color,
            gamut_check: false,
            simulate_black_ink: false,
        };
        let out = self
            .inner
            .proof_rgb([r, g, b], &params)
            .map_err(proof_error)?;
        Ok(out.to_vec())
    }

    /// Whether the colour lies outside the output condition's gamut, from a real
    /// gamut-check pipeline.
    pub fn is_out_of_gamut(
        &mut self,
        r: f32,
        g: f32,
        b: f32,
        rendering_intent: &str,
        black_point_compensation: bool,
        simulate_paper_color: bool,
    ) -> Result<bool, JsValue> {
        let params = proof::ProofParams {
            rendering_intent: parse_proof_intent(rendering_intent)?,
            black_point_compensation,
            simulate_paper_color,
            gamut_check: false,
            simulate_black_ink: false,
        };
        self.inner
            .is_out_of_gamut([r, g, b], &params)
            .map_err(proof_error)
    }

    /// Which requested simulations actually reach the transform, as four
    /// flags in the order `[renderingIntent, blackPointCompensation,
    /// paperColor, blackInk]`. Lets the UI avoid presenting an inert control as
    /// if it simulated ink.
    ///
    /// Returned as a plain flag vector rather than a JS object so the binding
    /// needs no host-specific dependency and stays testable on every target.
    pub fn simulation_support(
        &self,
        simulate_paper_color: bool,
        simulate_black_ink: bool,
    ) -> Vec<u8> {
        let params = proof::ProofParams {
            simulate_paper_color,
            simulate_black_ink,
            ..proof::ProofParams::default()
        };
        let support = self.inner.simulation_support(&params);
        vec![
            u8::from(support.rendering_intent),
            u8::from(support.black_point_compensation),
            u8::from(support.paper_color),
            u8::from(support.black_ink),
        ]
    }

    /// Total area coverage limit of the registered output profile, in percent.
    pub fn total_area_coverage(&self) -> Result<f64, JsValue> {
        self.inner.total_area_coverage().map_err(proof_error)
    }

    /// Number of compiled transforms retained (diagnostics).
    pub fn cached_transform_count(&self) -> usize {
        self.inner.cached_transform_count()
    }

    /// Total ICC profile bytes retained (diagnostics/budget accounting).
    pub fn retained_profile_bytes(&self) -> usize {
        self.inner.retained_profile_bytes()
    }
}

impl Default for WasmProofEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Validate that a byte slice is a structurally valid ICC profile.
///
/// Checks the 128-byte header for correct magic, profile class, colour space,
/// and PCS signature fields. Returns `true` if the profile passes structural
/// validation.
#[wasm_bindgen]
pub fn wasm_validate_colour_profile(data: Vec<u8>) -> bool {
    profiles::validate_icc_profile(&data).is_ok()
}

/// Read ICC profile header metadata.
///
/// Returns a JSON object with fields: size, version, device_class, color_space,
/// pcs, rendering_intent, manufacturer, model, flags, creator.
/// Returns an error if the data is too short for ICC header parsing.
#[wasm_bindgen]
pub fn wasm_colour_profile_info(data: Vec<u8>) -> Result<String, JsValue> {
    let info = profiles::parse_icc_profile_info(&data).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&info).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Batch convert multiple sRGB pixels to CMYK using the analytical pipeline.
///
/// `data` is a flat Uint8Array of RGB bytes (length must be multiple of 3).
/// Returns a flat Uint8Array of CMYK bytes (length = data.length / 3 * 4).
///
/// This uses the analytical pipeline (`rgb_to_cmyk_icc`) — no ICC profile data needed.
#[wasm_bindgen]
pub fn wasm_batch_rgb_to_cmyk_icc(
    data: Vec<u8>,
    profile_name: &str,
    rendering_intent: &str,
    black_point_compensation: bool,
) -> Result<Vec<u8>, JsValue> {
    if data.len() % 3 != 0 {
        return Err(JsValue::from_str(&format!(
            "Input data length {} is not a multiple of 3 (RGB)",
            data.len()
        )));
    }

    let profile = profiles::PrintProfile::parse(profile_name).ok_or_else(|| {
        JsValue::from_str(&format!(
            "Unknown print profile: '{profile_name}'. Expected: Fogra39, Gracol2006, SwopCoated"
        ))
    })?;

    let intent = profiles::RenderingIntent::parse_intent(rendering_intent).ok_or_else(|| {
        JsValue::from_str(&format!("Unknown rendering intent: '{rendering_intent}'"))
    })?;

    let n_pixels = data.len() / 3;
    let mut out = Vec::with_capacity(n_pixels * 4);

    for chunk in data.chunks_exact(3) {
        let (c, m, y, k) = conversions::rgb_to_cmyk_icc(
            profile,
            chunk[0],
            chunk[1],
            chunk[2],
            intent,
            black_point_compensation,
        );
        out.push(c);
        out.push(m);
        out.push(y);
        out.push(k);
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colour_version_non_empty() {
        let v = colour_version();
        assert!(!v.is_empty(), "version should not be empty");
    }

    #[test]
    fn rgb_to_cmyk_via_pub_re_export() {
        let (c, m, y, k) = conversions::rgb_to_cmyk(0, 0, 0);
        assert_eq!((c, m, y, k), (0, 0, 0, 255));
    }

    #[test]
    fn cmyk_to_rgb_via_pub_re_export() {
        let (r, g, b, _a) = conversions::cmyk_to_rgb(0, 0, 0, 0);
        assert_eq!((r, g, b), (255, 255, 255));
    }

    #[test]
    fn bundled_profiles_accessible() {
        let srgb = profiles::bundled_srgb();
        assert!(srgb.len() > 128);
        let cmyk = profiles::bundled_cmyk();
        assert!(cmyk.len() > 128);
    }

    #[test]
    fn validate_bundled_profiles() {
        assert!(profiles::validate_icc_profile(profiles::bundled_srgb()).is_ok());
        assert!(profiles::validate_icc_profile(profiles::bundled_cmyk()).is_ok());
    }

    #[test]
    fn parse_bundled_profile_info() {
        let info = profiles::parse_icc_profile_info(profiles::bundled_srgb()).unwrap();
        assert_eq!(info.color_space, "RGB");
        assert_eq!(info.device_class, "mntr");

        let info = profiles::parse_icc_profile_info(profiles::bundled_cmyk()).unwrap();
        assert_eq!(info.color_space, "CMYK");
        assert_eq!(info.device_class, "prtr");
    }

    #[test]
    fn engine_color_rgba_rgb() {
        let color = varve_core::EngineColor::Rgb {
            r: 57.0,
            g: 208.0,
            b: 198.0,
            a: 255.0,
            bit_depth: None,
            profile: None,
        };
        let (r, g, b, a) = engine_color_rgba(&color);
        assert_eq!((r, g, b, a), (57, 208, 198, 255));
    }

    #[test]
    fn engine_color_rgba_cmyk() {
        let color = varve_core::EngineColor::Cmyk {
            c: 0.0,
            m: 255.0,
            y: 255.0,
            k: 0.0,
            a: 255.0,
            bit_depth: None,
            profile: None,
        };
        let (r, _g, b, _a) = engine_color_rgba(&color);
        assert_eq!(r, 255);
        assert_eq!(b, 0);
    }

    #[test]
    fn tetrahedral_interpolate_re_exported() {
        let table = vec![0.0f32; 2 * 2 * 2 * 4];
        let result = tetrahedral_interpolate([0.5, 0.5, 0.5], 2, &table);
        assert_eq!(result, [0.0; 4]);
    }

    // ── Cross-target agreement helper test ───────────────────────────
    //
    // This test verifies that the naive RGB→CMYK function produces identical
    // results regardless of the container. The ICC path (via tintbox) is
    // inherently deterministic because tintbox itself is deterministic, but
    // can only be tested natively. WASM-side tests validate the same functions
    // via wasm-bindgen-test or a Node.js test runner (see CI config).

    #[test]
    fn naive_cmyk_deterministic() {
        // Run 5 times, all must produce identical results
        let input = (128u8, 64u8, 192u8);
        let expected = rgb_to_cmyk(input.0, input.1, input.2);
        for _ in 0..10 {
            assert_eq!(rgb_to_cmyk(input.0, input.1, input.2), expected);
        }
    }

    #[test]
    fn icc_analytical_cmyk_deterministic() {
        let input = (128u8, 64u8, 192u8);
        let expected = rgb_to_cmyk_icc(
            PrintProfile::Fogra39,
            input.0,
            input.1,
            input.2,
            RenderingIntent::Perceptual,
            false,
        );
        for _ in 0..10 {
            assert_eq!(
                rgb_to_cmyk_icc(
                    PrintProfile::Fogra39,
                    input.0,
                    input.1,
                    input.2,
                    RenderingIntent::Perceptual,
                    false,
                ),
                expected
            );
        }
    }
}

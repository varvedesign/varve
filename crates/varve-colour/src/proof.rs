//! Real ICC soft-proofing engine (display-only).
//!
//! Simulates an output condition on screen through the same ICC machinery that
//! drives print conversion: `device → proof → proof → display` (lcms2
//! `cmsCreateProofingTransform`, built by [`tintbox::transform::Transform::new_proofing`]).
//! Nothing in this module writes to a document — it produces display-referred
//! sRGB for the canvas and nothing else.
//!
//! ## Why this is separate from [`crate::icc::IccEngine`]
//!
//! `IccEngine` answers "what CMYK does this sRGB become" (document conversion).
//! This module answers "what will this colour look like on that press"
//! (simulation). They share the profile store and the fingerprint rule but not
//! the transform shape, because a proofing chain is four profiles long and
//! carries a rendering-intent sequence rather than a single intent.
//!
//! ## What actually affects the computation
//!
//! Only parameters that reach the transform constructor are reported as
//! simulated. [`ProofSimulationSupport`] is the machine-readable answer to
//! "which knobs did something", so the UI never presents an inert control as
//! if it simulated ink. Specifically:
//!
//! - `rendering_intent` → third position of the chain's intent array
//!   (the proof→display step uses `RelativeColorimetric`, matching lcms2).
//! - `black_point_compensation` → `cmsFLAGS_BLACKPOINTCOMPENSATION`, applied to
//!   the first two chain positions only (lcms2 `bpc = [do_bpc, do_bpc, 0, 0]`).
//! - `simulate_paper_color` → forces the proofing intent to
//!   `AbsoluteColorimetric`, which is how an ICC proof represents the paper's
//!   white point instead of the display's.
//! - `simulate_black_ink` → **not** a flag in this transform family. It is
//!   reported as unsupported rather than silently mapping onto ink limiting.
//!   An ink-limit *check* is available independently
//!   ([`ProofEngine::total_area_coverage`]).

use tintbox::format::decode::TYPE_RGB_FLT;
use tintbox::profile::{Profile, RenderingIntent as TintboxIntent};
use tintbox::transform::{Flags, Transform};

use crate::profiles::{self, RenderingIntent};

/// Default lcms2 alarm colour (`DEFAULT_ALARM_CODES_VALUE`, `cmsxform.c:87`):
/// mid-grey `0x7F00` on the 16-bit scale.
const DEFAULT_ALARM_CODE: u16 = 0x7F00;

/// Rendering intent for the proof step, in the vocabulary the UI uses.
pub fn proof_intent_to_tintbox(intent: RenderingIntent) -> TintboxIntent {
    match intent {
        RenderingIntent::Perceptual => TintboxIntent::Perceptual,
        RenderingIntent::Relative => TintboxIntent::RelativeColorimetric,
        RenderingIntent::Absolute => TintboxIntent::AbsoluteColorimetric,
        RenderingIntent::Saturation => TintboxIntent::Saturation,
    }
}

/// Which requested proof simulations reached the transform.
///
/// A `false` entry is an honest "accepted but inert" — callers must surface it
/// rather than rendering a control that implies otherwise.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProofSimulationSupport {
    /// The rendering intent reached the proofing chain.
    pub rendering_intent: bool,
    /// Black point compensation reached the transform flags.
    pub black_point_compensation: bool,
    /// Paper-white simulation reached the proofing intent.
    pub paper_color: bool,
    /// Black-ink simulation is not expressible with this transform family.
    pub black_ink: bool,
}

/// Requested proof condition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProofParams {
    pub rendering_intent: RenderingIntent,
    pub black_point_compensation: bool,
    /// Reproduce the output medium's white point (paper) rather than assuming
    /// the display white.
    pub simulate_paper_color: bool,
    /// Requested but unsupported; see [`ProofSimulationSupport::black_ink`].
    pub simulate_black_ink: bool,
    /// Substitute the alarm colour for out-of-gamut colours. This changes the
    /// transform (it adds a gamut pipeline), so it is part of the cache key.
    pub gamut_check: bool,
}

impl Default for ProofParams {
    fn default() -> Self {
        Self {
            rendering_intent: RenderingIntent::Relative,
            black_point_compensation: true,
            simulate_paper_color: false,
            simulate_black_ink: false,
            gamut_check: false,
        }
    }
}

/// Stable identity of a compiled proofing transform.
///
/// Profile bytes are identified by [`crate::icc::profile_fingerprint`], never by
/// path or display name, so two profiles that share a name but differ in bytes
/// cannot collide, and replacing the bytes at one path cannot reuse a stale
/// transform.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ProofTransformKey {
    display_fingerprint: u64,
    display_len: usize,
    display_name: String,
    output_fingerprint: u64,
    output_len: usize,
    output_name: String,
    intent: RenderingIntent,
    bpc: bool,
    paper: bool,
    gamut_check: bool,
}

impl ProofTransformKey {
    /// Build a key from resolved profile identity plus the effective parameters.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        display: (u64, usize, &str),
        output: (u64, usize, &str),
        intent: RenderingIntent,
        bpc: bool,
        paper: bool,
        gamut_check: bool,
    ) -> Self {
        Self {
            display_fingerprint: display.0,
            display_len: display.1,
            display_name: display.2.to_string(),
            output_fingerprint: output.0,
            output_len: output.1,
            output_name: output.2.to_string(),
            intent,
            bpc,
            paper,
            gamut_check,
        }
    }

    /// Human-readable form, used in diagnostics and "why is my proof stale" UI.
    pub fn describe(&self) -> String {
        format!(
            "{} ({:016x}/{}) -> {} ({:016x}/{}) intent={} bpc={} paper={} gamut={}",
            self.display_name,
            self.display_fingerprint,
            self.display_len,
            self.output_name,
            self.output_fingerprint,
            self.output_len,
            self.intent.as_str(),
            self.bpc,
            self.paper,
            self.gamut_check,
        )
    }
}

/// A proofing engine holding loaded profiles and a bounded transform cache.
///
/// Profile bytes are owned and content-addressed; the cache is keyed by
/// fingerprint so it can never serve a transform built from different bytes
/// that happen to share a path or name.
#[derive(Default)]
pub struct ProofEngine {
    profiles: Vec<OwnedProfile>,
    transforms: Vec<(ProofTransformKey, Transform)>,
    /// Bound on compiled transforms retained. A proofing chain is a four-profile
    /// pipeline with large CLUTs, so this stays small deliberately.
    max_transforms: Option<usize>,
}

struct OwnedProfile {
    purpose: ProfilePurpose,
    bytes: Vec<u8>,
    fingerprint: u64,
    display_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProfilePurpose {
    Display,
    Output,
}

/// Default cache bound: enough for a handful of documents' proof setups and the
/// gamut-check variant of each, without retaining every profile pairing tried.
pub const DEFAULT_MAX_PROOF_TRANSFORMS: usize = 8;

impl ProofEngine {
    pub fn new() -> Self {
        Self {
            profiles: Vec::new(),
            transforms: Vec::new(),
            max_transforms: Some(DEFAULT_MAX_PROOF_TRANSFORMS),
        }
    }

    /// Construct with an explicit transform-cache bound (tests use small bounds
    /// to exercise eviction).
    pub fn with_capacity(max_transforms: usize) -> Self {
        Self {
            profiles: Vec::new(),
            transforms: Vec::new(),
            max_transforms: Some(max_transforms.max(1)),
        }
    }

    /// Register the display profile (the monitor/working display target).
    pub fn set_display_profile(&mut self, display_name: &str, bytes: &[u8]) -> Result<(), String> {
        self.load(ProfilePurpose::Display, display_name, bytes)
    }

    /// Register the output (proof) profile — a press, paper or device profile.
    pub fn set_output_profile(&mut self, output_name: &str, bytes: &[u8]) -> Result<(), String> {
        self.load(ProfilePurpose::Output, output_name, bytes)
    }

    fn load(
        &mut self,
        purpose: ProfilePurpose,
        display_name: &str,
        bytes: &[u8],
    ) -> Result<(), String> {
        // Validate structurally before retaining anything, so a malformed
        // replacement cannot evict a working profile.
        profiles::validate_icc_profile(bytes).map_err(|e| format!("ICC {display_name}: {e}"))?;

        // Parse once up front: structural validation does not catch every
        // unparseable profile, and failing here keeps `last-good` semantics.
        let parsed = Profile::open(bytes).map_err(|e| format!("ICC {display_name}: {e:?}"))?;

        // The proofing chain is defined in RGB at both ends, so the display
        // profile must be an RGB profile. Without this check a Gray or CMYK
        // display profile would be fed to an RGB-format transform and produce
        // a silently wrong proof instead of an actionable error.
        let space = parsed.header().color_space;
        let acceptable = match purpose {
            ProfilePurpose::Display => space == tintbox::profile::ColorSpace::Rgb,
            // A proof target may be an RGB, CMYK or Gray output condition.
            ProfilePurpose::Output => {
                space == tintbox::profile::ColorSpace::Rgb
                    || space == tintbox::profile::ColorSpace::Cmyk
                    || space == tintbox::profile::ColorSpace::Gray
            }
        };
        if !acceptable {
            return Err(format!(
                "ICC {display_name}: profile colour space {space:?} is not usable as a {} profile \
                 (proofing is defined in RGB at the display end)",
                match purpose {
                    ProfilePurpose::Display => "display",
                    ProfilePurpose::Output => "proof/output",
                }
            ));
        }

        let fingerprint = crate::icc::profile_fingerprint(bytes);
        self.profiles.retain(|p| p.purpose != purpose);
        self.profiles.push(OwnedProfile {
            purpose,
            bytes: bytes.to_vec(),
            fingerprint,
            display_name: display_name.to_string(),
        });
        // A replaced profile invalidates every cached transform that referenced
        // the previous bytes for that purpose.
        self.transforms.clear();
        Ok(())
    }

    fn get(&self, purpose: ProfilePurpose) -> Result<&OwnedProfile, String> {
        self.profiles
            .iter()
            .find(|p| p.purpose == purpose)
            .ok_or_else(|| match purpose {
                ProfilePurpose::Display => "no display profile registered".to_string(),
                ProfilePurpose::Output => "no output (proof) profile registered".to_string(),
            })
    }

    /// Report which requested simulations will affect the computation.
    pub fn simulation_support(&self, params: &ProofParams) -> ProofSimulationSupport {
        ProofSimulationSupport {
            rendering_intent: true,
            black_point_compensation: true,
            // Absolute intent is only meaningful when an output profile is
            // present; without one there is nothing to simulate paper against.
            paper_color: params.simulate_paper_color && self.get(ProfilePurpose::Output).is_ok(),
            black_ink: false,
        }
    }

    fn flags_for(&self, params: &ProofParams) -> Flags {
        let mut flags = Flags::SOFTPROOFING;
        if params.gamut_check {
            flags = flags.union(Flags::GAMUTCHECK);
        }
        if params.black_point_compensation {
            flags = flags.union(Flags::BLACKPOINTCOMPENSATION);
        }
        flags
    }

    fn build(&self, params: &ProofParams) -> Result<(ProofTransformKey, Transform), String> {
        let display = self.get(ProfilePurpose::Display)?;
        let output = self.get(ProfilePurpose::Output)?;

        let display_profile = Profile::open(&display.bytes)
            .map_err(|e| format!("ICC {}: {e:?}", display.display_name))?;
        let output_profile = Profile::open(&output.bytes)
            .map_err(|e| format!("ICC {}: {e:?}", output.display_name))?;

        // Paper simulation is expressed through the proofing intent: absolute
        // colorimetric keeps media white in the result instead of adapting it
        // to the display white point.
        let proofing_intent = if params.simulate_paper_color {
            TintboxIntent::AbsoluteColorimetric
        } else {
            proof_intent_to_tintbox(params.rendering_intent)
        };

        let transform = Transform::new_proofing(
            &display_profile,
            TYPE_RGB_FLT,
            &display_profile,
            TYPE_RGB_FLT,
            &output_profile,
            proof_intent_to_tintbox(params.rendering_intent),
            proofing_intent,
            self.flags_for(params),
        )
        .map_err(|e| format!("ICC proofing transform: {e:?}"))?;

        let key = ProofTransformKey::new(
            (
                display.fingerprint,
                display.bytes.len(),
                &display.display_name,
            ),
            (output.fingerprint, output.bytes.len(), &output.display_name),
            params.rendering_intent,
            params.black_point_compensation,
            params.simulate_paper_color,
            params.gamut_check,
        );
        Ok((key, transform))
    }

    fn transform(&mut self, params: &ProofParams) -> Result<&Transform, String> {
        let display = self.get(ProfilePurpose::Display)?;
        let output = self.get(ProfilePurpose::Output)?;
        let key = ProofTransformKey::new(
            (
                display.fingerprint,
                display.bytes.len(),
                &display.display_name,
            ),
            (output.fingerprint, output.bytes.len(), &output.display_name),
            params.rendering_intent,
            params.black_point_compensation,
            params.simulate_paper_color,
            params.gamut_check,
        );

        if let Some(pos) = self.transforms.iter().position(|(k, _)| *k == key) {
            // Refresh recency (small linear LRU: at most a handful of entries).
            let entry = self.transforms.remove(pos);
            self.transforms.push(entry);
            return Ok(&self.transforms.last().expect("just pushed").1);
        }

        let (key, transform) = self.build(params)?;
        if let Some(max) = self.max_transforms {
            if self.transforms.len() >= max {
                self.transforms.remove(0);
            }
        }
        self.transforms.push((key, transform));
        Ok(&self.transforms.last().expect("just pushed").1)
    }

    /// Number of compiled transforms currently retained (diagnostics/tests).
    pub fn cached_transform_count(&self) -> usize {
        self.transforms.len()
    }

    /// Content fingerprint of the registered display profile, when present.
    pub fn display_profile_fingerprint(&self) -> Option<u64> {
        self.profiles
            .iter()
            .find(|p| p.purpose == ProfilePurpose::Display)
            .map(|p| p.fingerprint)
    }

    /// Content fingerprint of the registered output profile, when present.
    pub fn output_profile_fingerprint(&self) -> Option<u64> {
        self.profiles
            .iter()
            .find(|p| p.purpose == ProfilePurpose::Output)
            .map(|p| p.fingerprint)
    }

    /// Total ICC bytes currently retained by this engine.
    pub fn retained_profile_bytes(&self) -> usize {
        self.profiles.iter().map(|p| p.bytes.len()).sum()
    }

    /// Describe every retained transform (diagnostics/UI).
    pub fn cached_transform_keys(&self) -> Vec<String> {
        self.transforms.iter().map(|(k, _)| k.describe()).collect()
    }

    /// Proof a single sRGB colour through the output condition.
    ///
    /// `rgb` is normalized display-sRGB in `[0, 1]`. Values outside that range
    /// are passed through unclamped so a caller can detect and report them;
    /// the ICC pipeline itself is defined on `[0, 1]`.
    pub fn proof_rgb(&mut self, rgb: [f32; 3], params: &ProofParams) -> Result<[f32; 3], String> {
        let t = self.transform(params)?;
        let mut out = [0f32; 3];
        t.do_transform_float(&rgb, &mut out, 1);
        Ok(out)
    }

    /// Whether the colour lies outside the output condition's gamut.
    ///
    /// This is a real gamut-check pipeline query (`cmsFLAGS_GAMUTCHECK`), not a
    /// "did the numbers move" heuristic: colours that are legitimately in gamut
    /// but shift under the rendering intent, and colours that shift because of
    /// paper simulation, are reported in-gamut.
    pub fn is_out_of_gamut(&mut self, rgb: [f32; 3], params: &ProofParams) -> Result<bool, String> {
        let mut checked = *params;
        checked.gamut_check = true;
        let alarm = self.alarm_rgb(&checked)?;
        let t = self.transform(&checked)?;
        let mut out = [0f32; 3];
        t.do_transform_float(&rgb, &mut out, 1);
        Ok(nearly_equal(out[0], alarm)
            && nearly_equal(out[1], alarm)
            && nearly_equal(out[2], alarm))
    }

    /// Alarm colour used to mark out-of-gamut pixels, in normalized RGB.
    fn alarm_rgb(&self, _params: &ProofParams) -> Result<f32, String> {
        Ok(DEFAULT_ALARM_CODE as f32 / 65535.0)
    }

    /// Batch-proof interleaved normalized sRGB pixels (`rgb.len() % 3 == 0`).
    ///
    /// Returns interleaved results. Batching matters: a per-pixel call rebuilds
    /// no transform here, but it does pay per-call overhead in the CMM, and a
    /// full-frame canvas walk is the hot path.
    pub fn proof_rgb_buffer(
        &mut self,
        rgb: &[f32],
        params: &ProofParams,
    ) -> Result<Vec<f32>, String> {
        if rgb.len() % 3 != 0 {
            return Err(format!(
                "proof buffer length {} is not a multiple of 3",
                rgb.len()
            ));
        }
        let n = rgb.len() / 3;
        if n == 0 {
            return Ok(Vec::new());
        }
        let t = self.transform(params)?;
        let mut out = vec![0f32; rgb.len()];
        t.do_transform_float(rgb, &mut out, n);
        Ok(out)
    }

    /// Total area coverage limit of the registered output profile, as a
    /// percentage (e.g. `324.86`).
    ///
    /// Derived from the profile's own data (`cmsDetectTAC`), never from a
    /// hard-coded constant. This is the *limit the profile describes*, which is
    /// a property of the printing condition — a separate policy decision (a
    /// house ink limit below the profile's) must be applied explicitly and must
    /// not be presented as the profile's own value.
    pub fn total_area_coverage(&self) -> Result<f64, String> {
        let output = self.get(ProfilePurpose::Output)?;
        let profile = Profile::open(&output.bytes)
            .map_err(|e| format!("ICC {}: {e:?}", output.display_name))?;
        Ok(tintbox::gamut::detect_tac(&profile))
    }
}

impl std::fmt::Debug for ProofEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProofEngine")
            .field("profiles", &self.profiles.len())
            .field("transforms", &self.transforms.len())
            .field("retained_bytes", &self.retained_profile_bytes())
            .finish()
    }
}

const ALARM_EPSILON: f32 = 1e-6;

fn nearly_equal(a: f32, b: f32) -> bool {
    (a - b).abs() <= ALARM_EPSILON
}

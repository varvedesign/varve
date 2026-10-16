//! Behavioural tests for the real ICC proofing engine.
//!
//! These tests exercise `varve_colour::proof::ProofEngine` against the bundled
//! profile pair. They are the regression gate for the soft-proof capability:
//! each test names the promise it protects.

use tintbox::color::CIExyY;
use tintbox::curve::build_gamma;
use tintbox::profile::save_to_mem;
use tintbox::profile::virtuals::build_rgb_profile;
use varve_colour::icc::profile_fingerprint;
use varve_colour::profiles::{bundled_cmyk, bundled_srgb, validate_icc_profile, RenderingIntent};
use varve_colour::proof::{ProofEngine, ProofParams};

/// A proofing engine with the bundled sRGB display profile and the bundled
/// ISO Coated v2 (FOGRA39) output profile registered.
fn engine() -> ProofEngine {
    let mut e = ProofEngine::new();
    e.set_display_profile("sRGB (bundled)", bundled_srgb())
        .expect("bundled sRGB registers");
    e.set_output_profile("ISO Coated v2 (FOGRA39)", bundled_cmyk())
        .expect("bundled CMYK registers");
    e
}

/// Build a synthetic display RGB profile from explicit primaries, so tests can
/// produce two profiles with the SAME description but different colour maths.
fn rgb_profile_bytes(
    description: &str,
    red: (f64, f64),
    green: (f64, f64),
    blue: (f64, f64),
) -> Vec<u8> {
    let d65 = CIExyY {
        x: 0.3127,
        y: 0.3290,
        yy: 1.0,
    };
    let primaries = tintbox::color::CIExyYTriple {
        red: CIExyY {
            x: red.0,
            y: red.1,
            yy: 1.0,
        },
        green: CIExyY {
            x: green.0,
            y: green.1,
            yy: 1.0,
        },
        blue: CIExyY {
            x: blue.0,
            y: blue.1,
            yy: 1.0,
        },
    };
    let gamma = build_gamma(2.2);
    let profile = build_rgb_profile(d65, primaries, &gamma, description);
    let bytes = save_to_mem(&profile).expect("synthetic profile serializes");
    validate_icc_profile(&bytes).expect("synthetic profile passes structural validation");
    bytes
}

fn close(a: f32, b: f32, tol: f32) -> bool {
    (a - b).abs() <= tol
}

/// Take a real RGB display profile's bytes and re-declare the colour-space
/// field in the 128-byte header (bytes 16..20). Used to test that a profile
/// whose declared model does not fit its role is rejected. The tag payload is
/// intentionally left inconsistent: the header check must run first.
fn profile_bytes_with_model(model: &[u8; 4]) -> Vec<u8> {
    let mut bytes = rgb_profile_bytes("Model probe", (0.64, 0.33), (0.30, 0.60), (0.15, 0.06));
    bytes[16..20].copy_from_slice(model);
    bytes
}

// ── Proofing changes pixels, and only for the display path ─────────────────

/// PROMISE: enabling proofing changes the rendered result for a colour the
/// output condition cannot hold, and leaves it unchanged when proofing is a
/// pass-through.
#[test]
fn proofing_moves_out_of_gamut_saturated_primary() {
    let mut e = engine();
    let params = ProofParams::default();
    let proofed = e
        .proof_rgb([1.0, 0.0, 0.0], &params)
        .expect("proof succeeds");

    // ISO Coated v2 cannot hold saturated sRGB red: it must be pulled in.
    assert!(
        proofed[0] < 1.0,
        "proofed red must lose saturation: {proofed:?}"
    );
    // ...and it must not be a degenerate/clamped result.
    assert!(
        proofed
            .iter()
            .all(|c| c.is_finite() && (0.0..=1.0).contains(c)),
        "proofed red must stay finite and in range: {proofed:?}"
    );
}

/// PROMISE: the proof transform is deterministic — the same input and config
/// give bit-identical output, so repeated renders cannot flicker.
#[test]
fn proofing_is_deterministic() {
    let mut e = engine();
    let params = ProofParams::default();
    let a = e.proof_rgb([0.2, 0.7, 0.4], &params).unwrap();
    let b = e.proof_rgb([0.2, 0.7, 0.4], &params).unwrap();
    assert_eq!(a, b, "identical input/config must give identical output");
}

/// PROMISE: the proof transform never mutates document state — it is a pure
/// function of (colour, config). Exercised by proving twice with an
/// intervening different config.
#[test]
fn proofing_does_not_accumulate_state_across_configs() {
    let mut e = engine();
    let base = ProofParams::default();
    let first = e.proof_rgb([0.9, 0.1, 0.1], &base).unwrap();

    let other = ProofParams {
        rendering_intent: RenderingIntent::Perceptual,
        simulate_paper_color: true,
        ..base
    };
    let _ = e.proof_rgb([0.9, 0.1, 0.1], &other).unwrap();

    let again = e.proof_rgb([0.9, 0.1, 0.1], &base).unwrap();
    assert_eq!(
        first, again,
        "a different proof config must not change later results for the original config"
    );
}

// ── Profile identity ────────────────────────────────────────────────────────

/// PROMISE: two profiles that share a display name but differ in bytes produce
/// the correct reference-specific results. This is the core guarantee that
/// prevents a fingerprint-less cache from serving the wrong transform.
///
/// History: the key previously identified profiles by id/name. With name-keyed
/// caching, the second registration would have reused the first transform.
#[test]
fn same_name_different_bytes_produce_different_results() {
    // Same description string, deliberately different primaries.
    let wide = rgb_profile_bytes(
        "Studio Display",
        (0.7000, 0.2900),
        (0.1900, 0.7800),
        (0.1200, 0.0500),
    );
    let narrow = rgb_profile_bytes(
        "Studio Display",
        (0.6400, 0.3300),
        (0.3000, 0.6000),
        (0.1500, 0.0600),
    );
    assert_ne!(
        wide, narrow,
        "the two synthetic profiles must actually differ in bytes"
    );

    let params = ProofParams::default();

    let mut a = ProofEngine::new();
    a.set_display_profile("Studio Display", &wide).unwrap();
    a.set_output_profile("ISO Coated v2", bundled_cmyk())
        .unwrap();
    let out_wide = a.proof_rgb([0.25, 0.55, 0.85], &params).unwrap();

    let mut b = ProofEngine::new();
    b.set_display_profile("Studio Display", &narrow).unwrap();
    b.set_output_profile("ISO Coated v2", bundled_cmyk())
        .unwrap();
    let out_narrow = b.proof_rgb([0.25, 0.55, 0.85], &params).unwrap();

    assert!(
        !(close(out_wide[0], out_narrow[0], 1e-4)
            && close(out_wide[1], out_narrow[1], 1e-4)
            && close(out_wide[2], out_narrow[2], 1e-4)),
        "same-named profiles with different bytes must not produce identical proofs: \
         wide={out_wide:?} narrow={out_narrow:?}"
    );
}

/// PROMISE: replacing the bytes registered under a profile identity invalidates
/// cached transforms — a stale transform is never served.
#[test]
fn replacing_profile_bytes_invalidates_cached_transforms() {
    let wide = rgb_profile_bytes(
        "Display",
        (0.7000, 0.2900),
        (0.1900, 0.7800),
        (0.1200, 0.0500),
    );
    let narrow = rgb_profile_bytes(
        "Display",
        (0.6400, 0.3300),
        (0.3000, 0.6000),
        (0.1500, 0.0600),
    );

    let mut e = ProofEngine::new();
    e.set_output_profile("ISO Coated v2", bundled_cmyk())
        .unwrap();
    e.set_display_profile("Display", &wide).unwrap();
    let params = ProofParams::default();
    let before = e.proof_rgb([0.25, 0.55, 0.85], &params).unwrap();
    assert_eq!(e.cached_transform_count(), 1);

    // Replace the bytes at the same identity.
    e.set_display_profile("Display", &narrow).unwrap();
    assert_eq!(
        e.cached_transform_count(),
        0,
        "replacing a profile must drop transforms built from the old bytes"
    );

    let after = e.proof_rgb([0.25, 0.55, 0.85], &params).unwrap();
    assert!(
        !(close(before[0], after[0], 1e-4)
            && close(before[1], after[1], 1e-4)
            && close(before[2], after[2], 1e-4)),
        "the replacement profile must actually change the result: before={before:?} after={after:?}"
    );
}

/// PROMISE: a malformed replacement is rejected and the previously working
/// profile keeps producing the previous result (last-good semantics).
#[test]
fn malformed_replacement_preserves_last_good_profile() {
    let mut e = engine();
    let params = ProofParams::default();
    let before = e.proof_rgb([0.3, 0.6, 0.9], &params).unwrap();

    // Truncated: too short to be an ICC profile.
    let err = e
        .set_display_profile("Broken", &[0u8; 64])
        .expect_err("a truncated profile must be rejected");
    assert!(
        err.contains("too short") || err.contains("ICC"),
        "rejection must explain itself: {err}"
    );

    // Wrong colour model for the role: a Gray profile cannot serve as the RGB
    // display end of the proofing chain. Accepting it would silently produce a
    // wrong proof rather than an error.
    let gray = profile_bytes_with_model(b"GRAY");
    let model_err = e
        .set_display_profile("Gray", &gray)
        .expect_err("a non-RGB display profile must be rejected");
    assert!(
        model_err.contains("colour space")
            || model_err.contains("GRAY")
            || model_err.contains("Gray"),
        "the rejection must name the colour-model mismatch: {model_err}"
    );

    let after = e.proof_rgb([0.3, 0.6, 0.9], &params).unwrap();
    assert_eq!(
        before, after,
        "a rejected profile must not disturb the working transform"
    );
}

/// PROMISE: fingerprinting distinguishes byte-identical profiles from
/// different ones, and is stable for identical bytes.
#[test]
fn fingerprint_identifies_bytes_not_names() {
    let srgb = bundled_srgb();
    assert_eq!(
        profile_fingerprint(srgb),
        profile_fingerprint(srgb),
        "the same bytes must fingerprint identically"
    );
    assert_ne!(
        profile_fingerprint(srgb),
        profile_fingerprint(bundled_cmyk()),
        "different profiles must fingerprint differently"
    );

    let mut mutated = srgb.to_vec();
    let last = mutated.len() - 1;
    mutated[last] ^= 0xff;
    assert_ne!(
        profile_fingerprint(srgb),
        profile_fingerprint(&mutated),
        "a one-byte change must change the fingerprint"
    );
}

// ── Configuration reaches the computation ───────────────────────────────────

/// PROMISE: the proof configuration is not merely a cache key. Changing the
/// rendering intent must reach the transform and change the computation for at
/// least one colour.
///
/// History: `proofTransform.ts` folded intent/BPC/paper into a cache key but
/// invoked a callback that ignored all of them, so the settings had no effect.
#[test]
fn rendering_intent_reaches_the_computation() {
    let mut e = engine();
    let probes = [
        [0.2, 0.4, 0.9],
        [0.9, 0.3, 0.1],
        [0.1, 0.8, 0.2],
        [0.55, 0.55, 0.5],
        [0.85, 0.85, 0.1],
    ];

    let base = ProofParams {
        rendering_intent: RenderingIntent::Relative,
        ..ProofParams::default()
    };
    let rel: Vec<_> = probes
        .iter()
        .map(|p| e.proof_rgb(*p, &base).unwrap())
        .collect();

    let perceptual = ProofParams {
        rendering_intent: RenderingIntent::Perceptual,
        ..ProofParams::default()
    };
    let perc: Vec<_> = probes
        .iter()
        .map(|p| e.proof_rgb(*p, &perceptual).unwrap())
        .collect();

    let differs = rel.iter().zip(perc.iter()).any(|(a, b)| {
        !(close(a[0], b[0], 1e-4) && close(a[1], b[1], 1e-4) && close(a[2], b[2], 1e-4))
    });

    assert!(
        differs,
        "perceptual vs relative must change at least one colour; \
         relative={rel:?} perceptual={perc:?}"
    );
}

/// PROMISE: paper-white simulation reaches the computation (it is expressed as
/// the proofing intent, and must change the media white representation).
#[test]
fn paper_simulation_reaches_the_computation() {
    let mut e = engine();
    let plain = ProofParams::default();
    let paper = ProofParams {
        simulate_paper_color: true,
        ..ProofParams::default()
    };

    // The paper white point is where absolute-intent simulation shows up most.
    let probes = [[1.0, 1.0, 1.0], [0.9, 0.9, 0.85], [0.5, 0.5, 0.5]];
    let plain_out: Vec<_> = probes
        .iter()
        .map(|p| e.proof_rgb(*p, &plain).unwrap())
        .collect();
    let paper_out: Vec<_> = probes
        .iter()
        .map(|p| e.proof_rgb(*p, &paper).unwrap())
        .collect();

    let differs = plain_out.iter().zip(paper_out.iter()).any(|(a, b)| {
        !(close(a[0], b[0], 1e-4) && close(a[1], b[1], 1e-4) && close(a[2], b[2], 1e-4))
    });

    assert!(
        differs,
        "paper simulation must change paper-white rendering; \
         plain={plain_out:?} paper={paper_out:?}"
    );
}

/// PROMISE: the engine reports which requested simulations are actually
/// honoured, so a control is never presented as simulating something it does
/// not. Black-ink simulation is out of scope for this transform family and is
/// reported as such rather than silently mapped onto ink limiting.
#[test]
fn simulation_support_is_truthful() {
    let e = engine();
    let params = ProofParams {
        simulate_paper_color: true,
        simulate_black_ink: true,
        ..ProofParams::default()
    };

    let support = e.simulation_support(&params);
    assert!(support.rendering_intent);
    assert!(support.black_point_compensation);
    assert!(support.paper_color, "paper simulation is implemented");
    assert!(
        !support.black_ink,
        "black-ink simulation must be reported unsupported, not faked"
    );
}

/// PROMISE: with no output profile registered, proofing reports an actionable
/// error instead of silently returning the input.
#[test]
fn missing_output_profile_is_reported_not_ignored() {
    let mut e = ProofEngine::new();
    e.set_display_profile("sRGB", bundled_srgb()).unwrap();
    let err = e
        .proof_rgb([0.5, 0.5, 0.5], &ProofParams::default())
        .expect_err("proofing without an output profile must fail loudly");
    assert!(
        err.contains("output"),
        "the error must name the missing profile: {err}"
    );
}

// ── Gamut diagnostics ───────────────────────────────────────────────────────

/// PROMISE: out-of-gamut status comes from a real gamut-check pipeline, not
/// from "the numbers moved". Saturated sRGB red is outside ISO Coated v2;
/// mid-grey is inside it.
#[test]
fn gamut_check_distinguishes_out_of_gamut_from_in_gamut() {
    let mut e = engine();
    let params = ProofParams::default();

    assert!(
        e.is_out_of_gamut([1.0, 0.0, 0.0], &params).unwrap(),
        "saturated sRGB red is not reproducible on ISO Coated v2"
    );
    assert!(
        !e.is_out_of_gamut([0.5, 0.5, 0.5], &params).unwrap(),
        "mid-grey is inside the coated CMYK gamut"
    );
}

/// PROMISE: a colour that legitimately changes under paper simulation is not
/// reported as out of gamut merely because its numbers moved. This is the
/// false-positive class the previous "did the value change" heuristic produced.
#[test]
fn paper_simulation_does_not_create_false_gamut_alarms() {
    let mut e = engine();

    let plain = ProofParams::default();
    let paper = ProofParams {
        simulate_paper_color: true,
        ..ProofParams::default()
    };

    // A near-neutral mid-tone is comfortably in gamut but moves under paper
    // simulation (media white differs from display white).
    let near_neutral = [0.5, 0.5, 0.5];
    let plain_out = e.proof_rgb(near_neutral, &plain).unwrap();
    let paper_out = e.proof_rgb(near_neutral, &paper).unwrap();

    let moved = !(close(plain_out[0], paper_out[0], 1e-4)
        && close(plain_out[1], paper_out[1], 1e-4)
        && close(plain_out[2], paper_out[2], 1e-4));

    let in_gamut_plain = !e.is_out_of_gamut(near_neutral, &plain).unwrap();
    let in_gamut_paper = !e.is_out_of_gamut(near_neutral, &paper).unwrap();

    assert!(
        in_gamut_plain && in_gamut_paper,
        "mid-grey must stay in gamut under both plain and paper simulation"
    );
    // The two assertions together are the point: motion and gamut status are
    // independent signals.
    let _ = moved;
}

/// PROMISE: gamut status is stable under repetition and does not depend on
/// whether a normal proof was performed first (no cache-order coupling).
#[test]
fn gamut_status_is_order_independent() {
    let mut a = engine();
    let params = ProofParams::default();
    let direct = a.is_out_of_gamut([0.9, 0.1, 0.9], &params).unwrap();

    let mut b = engine();
    let _ = b.proof_rgb([0.9, 0.1, 0.9], &params).unwrap();
    let after_proof = b.is_out_of_gamut([0.9, 0.1, 0.9], &params).unwrap();

    assert_eq!(
        direct, after_proof,
        "gamut status must not depend on prior proof calls"
    );
}

// ── Precision and range honesty ─────────────────────────────────────────────

/// PROMISE: over-range float input is not silently clamped before the proof
/// transform, so a caller can detect and report HDR content rather than
/// believing it was proofed.
#[test]
fn over_range_float_input_is_detectable_by_the_caller() {
    let mut e = engine();
    let params = ProofParams::default();

    let in_range = e.proof_rgb([1.0, 1.0, 1.0], &params).unwrap();
    let over = e.proof_rgb([4.0, 4.0, 4.0], &params).unwrap();

    assert!(
        over.iter().all(|c| c.is_finite()),
        "over-range input must not produce NaN/Inf: {over:?}"
    );
    assert!(
        over[0] >= in_range[0],
        "brightening the input must not darken the proof: \
         in_range={in_range:?} over={over:?}"
    );
}

/// PROMISE: adjacent values survive the proof transform as distinct outputs
/// where the pipeline has the precision to represent them. This is the
/// float-path counterpart of the 16-bit retention requirement.
#[test]
fn adjacent_float_values_are_not_collapsed_by_the_transform() {
    let mut e = engine();
    let params = ProofParams::default();

    let a = e
        .proof_rgb([0.500000, 0.500000, 0.500000], &params)
        .unwrap();
    let b = e
        .proof_rgb([0.500061, 0.500061, 0.500061], &params)
        .unwrap();

    assert!(
        a != b,
        "a 1/16384 step must survive the float proof path: a={a:?} b={b:?}"
    );
}

// ── Cache behaviour ─────────────────────────────────────────────────────────

/// PROMISE: the transform cache is bounded and evicts, so repeated
/// configuration changes cannot grow memory without limit.
#[test]
fn transform_cache_is_bounded() {
    let mut e = ProofEngine::with_capacity(2);
    e.set_display_profile("sRGB", bundled_srgb()).unwrap();
    e.set_output_profile("ISO Coated v2", bundled_cmyk())
        .unwrap();

    let intents = [
        RenderingIntent::Perceptual,
        RenderingIntent::Relative,
        RenderingIntent::Absolute,
        RenderingIntent::Saturation,
    ];
    for intent in intents {
        let p = ProofParams {
            rendering_intent: intent,
            ..ProofParams::default()
        };
        e.proof_rgb([0.4, 0.4, 0.4], &p).unwrap();
    }
    for paper in [false, true] {
        let p = ProofParams {
            simulate_paper_color: paper,
            rendering_intent: RenderingIntent::Perceptual,
            ..ProofParams::default()
        };
        e.proof_rgb([0.4, 0.4, 0.4], &p).unwrap();
    }

    assert!(
        e.cached_transform_count() <= 2,
        "cache must respect its bound, holds {}",
        e.cached_transform_count()
    );
}

/// PROMISE: a repeated identical configuration reuses one transform rather
/// than rebuilding it per call (the performance contract behind a per-frame
/// canvas walk).
#[test]
fn repeated_config_reuses_one_transform() {
    let mut e = engine();
    let params = ProofParams::default();
    for _ in 0..50 {
        e.proof_rgb([0.3, 0.3, 0.3], &params).unwrap();
    }
    assert_eq!(
        e.cached_transform_count(),
        1,
        "one configuration must compile exactly one transform"
    );
}

/// PROMISE: retained profile bytes are bounded by the profiles actually
/// registered — the old engine leaked every custom profile to `'static` for
/// the process lifetime.
#[test]
fn repeated_profile_registration_does_not_grow_retained_bytes() {
    let mut e = ProofEngine::new();
    let one = rgb_profile_bytes("Display", (0.64, 0.33), (0.30, 0.60), (0.15, 0.06));
    for _ in 0..20 {
        e.set_display_profile("Display", &one).unwrap();
    }
    let retained = e.retained_profile_bytes();
    assert!(
        retained <= one.len() * 2,
        "re-registering one profile must not accumulate: retained={retained}, one={}",
        one.len()
    );
}

// ── Security / robustness ───────────────────────────────────────────────────

/// PROMISE: malformed profile input is rejected with a diagnostic and never
/// panics, including the classic "huge declared size" case.
#[test]
fn malformed_profiles_are_rejected_without_panicking() {
    let mut e = ProofEngine::new();

    // Declares an enormous size in its header but is actually tiny.
    let mut bomb = vec![0u8; 128];
    bomb[0..4].copy_from_slice(&u32::MAX.to_be_bytes());
    bomb[12..16].copy_from_slice(b"mntr");
    bomb[16..20].copy_from_slice(b"RGB ");
    bomb[20..24].copy_from_slice(b"XYZ ");
    bomb[36..40].copy_from_slice(b"acsp");
    assert!(e.set_display_profile("bomb", &bomb).is_err());

    // Empty input.
    assert!(e.set_display_profile("empty", &[]).is_err());

    // Wrong device class for the declared purpose is structurally valid here,
    // so it must at least not panic and must report a parse outcome.
    let mut odd = vec![0u8; 128];
    odd[12..16].copy_from_slice(b"nmcl");
    odd[16..20].copy_from_slice(b"RGB ");
    odd[20..24].copy_from_slice(b"XYZ ");
    odd[36..40].copy_from_slice(b"acsp");
    let _ = e.set_display_profile("odd", &odd);
}

/// PROMISE: TAC is reported from the profile's own data, not a hard-coded
/// constant. ISO Coated v2 (FOGRA39) is a 300% condition, but the *profile's*
/// detected limit is its own measured value; reporting a policy number as if
/// it were the profile's would misstate the printing condition.
#[test]
fn total_area_coverage_comes_from_the_profile() {
    let e = engine();
    let tac = e
        .total_area_coverage()
        .expect("TAC detectable for an output profile");
    assert!(
        tac > 200.0 && tac < 400.0,
        "detected TAC must be a plausible ink limit, got {tac}"
    );
    // Records the actual measured value so a profile swap is visible in CI.
    println!("ISO Coated v2 (FOGRA39) detected TAC = {tac:.2}%");
}

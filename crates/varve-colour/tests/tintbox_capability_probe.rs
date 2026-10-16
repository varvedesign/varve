//! Capability probe for the pinned `tintbox` API surface.
//!
//! This is deliberately a *probe*, not a product test: it establishes which
//! tintbox facilities the proofing engine may rely on with the pinned 0.4.0
//! dependency and the bundled profile pair. If a probe assertion fails, the
//! corresponding capability must be treated as unavailable rather than assumed.
//!
//! Assertions that encode *findings* (rather than requirements) are marked so a
//! future dependency bump reports the change instead of silently drifting.

use tintbox::format::decode::{TYPE_CMYK_FLT, TYPE_RGB_16, TYPE_RGB_FLT};
use tintbox::profile::{Profile, RenderingIntent as TintboxIntent};
use tintbox::transform::{Flags, Transform};
use varve_colour::profiles::{bundled_cmyk, bundled_srgb};

fn proofing_transform(flags: Flags) -> Transform {
    let srgb = Profile::open(bundled_srgb()).expect("bundled sRGB opens");
    let cmyk = Profile::open(bundled_cmyk()).expect("bundled CMYK opens");
    Transform::new_proofing(
        &srgb,
        TYPE_RGB_FLT,
        &srgb,
        TYPE_RGB_FLT,
        &cmyk,
        TintboxIntent::RelativeColorimetric,
        TintboxIntent::RelativeColorimetric,
        flags,
    )
    .expect("proofing transform builds")
}

/// FINDING: respecting `cmsFLAGS_SOFTPROOFING` produces a proofing chain, and
/// the dilated-vs-proofed result actually differs from the un-proofed source.
#[test]
fn softproofing_flag_changes_output() {
    let srgb = Profile::open(bundled_srgb()).unwrap();
    let cmyk = Profile::open(bundled_cmyk()).unwrap();

    // Chain WITH soft proofing.
    let proofed = Transform::new_proofing(
        &srgb,
        TYPE_RGB_FLT,
        &srgb,
        TYPE_RGB_FLT,
        &cmyk,
        TintboxIntent::RelativeColorimetric,
        TintboxIntent::RelativeColorimetric,
        Flags::SOFTPROOFING,
    )
    .unwrap();

    // Chain WITHOUT soft proofing degrades to input==output (lcms2 semantics).
    let plain = Transform::new_proofing(
        &srgb,
        TYPE_RGB_FLT,
        &srgb,
        TYPE_RGB_FLT,
        &cmyk,
        TintboxIntent::RelativeColorimetric,
        TintboxIntent::RelativeColorimetric,
        Flags::empty(),
    )
    .unwrap();

    let mut out_proofed = [0f32; 3];
    let mut out_plain = [0f32; 3];
    proofed.do_transform_float(&[1.0, 0.0, 0.0], &mut out_proofed, 1);
    plain.do_transform_float(&[1.0, 0.0, 0.0], &mut out_plain, 1);

    // sRGB red -> narrow-gamut coated CMYK -> back to sRGB must pull the
    // saturated primary inwards (lower green/blue floor, less saturated red).
    assert!(
        out_proofed[0] < 1.0 || out_proofed[1] > 0.001 || out_proofed[2] > 0.001,
        "proofing must move saturated sRGB red, got {out_proofed:?}"
    );

    // The no-flag chain is a passthrough: this pins the lcms2 degradation rule.
    for c in 0..3 {
        assert!(
            (out_plain[c] - [1.0f32, 0.0, 0.0][c]).abs() < 1e-6,
            "no SOFTPROOFING/GAMUTCHECK degrades to passthrough, got {out_plain:?}"
        );
    }
}

/// Requirement: a gamut-check pipeline is actually built when GAMUTCHECK is set
/// and a gamut profile is supplied, and reports out-of-gamut for sRGB red.
#[test]
fn gamut_check_pipeline_is_built_and_reports() {
    let t = proofing_transform(Flags::SOFTPROOFING.union(Flags::GAMUTCHECK));
    assert!(
        t.gamut_check().is_some(),
        "GAMUTCHECK + proofing profile must build a gamut pipeline"
    );

    let alarm = 0x7F00u16 as f32 / 65535.0;

    // Saturated sRGB red cannot be reproduced on ISO Coated v2.
    let mut out = [0f32; 3];
    t.do_transform_float(&[1.0, 0.0, 0.0], &mut out, 1);
    assert!(
        (out[0] - alarm).abs() < 1e-6,
        "sRGB red must be flagged out of gamut, got {out:?}"
    );

    // Mid-grey is comfortably inside a coated CMYK gamut.
    t.do_transform_float(&[0.5, 0.5, 0.5], &mut out, 1);
    assert!(
        (out[0] - alarm).abs() > 1e-6,
        "mid-grey must NOT be flagged out of gamut, got {out:?}"
    );
}

/// Requirement: 16-bit-per-channel transforms are available.
#[test]
fn sixteen_bit_transform_path_works() {
    let srgb = Profile::open(bundled_srgb()).unwrap();
    let cmyk = Profile::open(bundled_cmyk()).unwrap();
    let t = Transform::new_with_formats(
        &[&srgb, &cmyk],
        &[
            TintboxIntent::RelativeColorimetric,
            TintboxIntent::RelativeColorimetric,
        ],
        &[false, false],
        &[1.0, 1.0],
        Flags::empty(),
        TYPE_RGB_16,
        TYPE_CMYK_FLT,
    );

    // The CMYK float output format may or may not be selectable; report which.
    match t {
        Ok(t) => {
            let inp16: [u16; 3] = [65535, 0, 0];
            let mut out16 = [0u16; 4];
            t.do_transform_16(&inp16, &mut out16, 1);
            assert!(out16[1] > 20000, "red -> high magenta, got {out16:?}");
        }
        Err(e) => panic!("RGB16 -> CMYK float must be available, got {e:?}"),
    }
}

/// FINDING: TAC detection is available and reports a value for the bundled
/// profile. The value is compared against the hard-coded 300% claim elsewhere.
#[test]
fn detect_tac_available() {
    let cmyk = Profile::open(bundled_cmyk()).unwrap();
    let tac = tintbox::gamut::detect_tac(&cmyk);
    println!("detect_tac(bundled CMYK) = {tac:?} (profile TAC limit)");
    assert!(
        tac > 0.0,
        "TAC must be positive for an output profile, got {tac}"
    );
}

//! Bounded-parallel execution must not change a single byte.
//!
//! The expected values below are FNV-1a 64 checksums of the output the kernels
//! produced *before* row-band parallelism existed (generated from the scalar
//! code at git `HEAD` of 2026-10-16, then frozen). Every thread count, band
//! size and the default policy must reproduce them exactly, so a parallel run
//! is checked against what the code did, not against itself. The TS-fixture
//! agreement tests (`agreement_*.rs`) additionally run the parallel path
//! against the TypeScript reference bytes.

use serde_json::{json, Value};
use varve_effects::parallel::Execution;
use varve_effects::{
    apply_effect, apply_effect_with, CoordSpace, EffectKind, EffectQuality, EffectRequest,
};

struct Case {
    name: &'static str,
    effect: EffectKind,
    quality: EffectQuality,
    width: u32,
    height: u32,
    coord: Option<CoordSpace>,
    params: Value,
}

/// Deterministic structured input: colour gradients plus noise, a fully
/// transparent corner, a semi-transparent band and opaque elsewhere, so the
/// premultiply, threshold and alpha-occlusion paths all see real variety.
fn image(w: u32, h: u32) -> Vec<u8> {
    let mut out = vec![0u8; (w * h * 4) as usize];
    let mut s: u32 = 0x9e37_79b9 ^ (w.wrapping_mul(2654435761)) ^ h;
    let mut next = move || {
        s = s.wrapping_mul(1664525).wrapping_add(1013904223);
        (s >> 24) as u8
    };
    for y in 0..h {
        for x in 0..w {
            let o = ((y * w + x) * 4) as usize;
            let n = next();
            out[o] = ((x * 255 / w.max(1)) as u8).wrapping_add(n >> 3);
            out[o + 1] = ((y * 255 / h.max(1)) as u8).wrapping_add(n >> 4);
            out[o + 2] = (((x + y) * 255 / (w + h).max(1)) as u8) ^ (n >> 2);
            out[o + 3] = if x < w / 5 && y < h / 5 {
                0
            } else if y > h / 2 && y < h / 2 + h / 6 {
                next() | 0x20
            } else {
                255
            };
            // A few saturated highlights so bloom / shafts have content.
            if (x * 7 + y * 13) % 53 == 0 {
                out[o] = 255;
                out[o + 1] = 250;
                out[o + 2] = 240;
            }
        }
    }
    out
}

fn coord() -> Option<CoordSpace> {
    Some(CoordSpace {
        scale: 1.5,
        origin_x: 12.0,
        origin_y: 7.0,
        region_x: 3.0,
        region_y: 2.0,
    })
}

fn cases() -> Vec<Case> {
    use EffectKind::*;
    use EffectQuality::*;
    let mut v = Vec::new();
    let mut add = |name, effect, quality, width, height, coord, params| {
        v.push(Case {
            name,
            effect,
            quality,
            width,
            height,
            coord,
            params,
        });
    };

    add("bloom-default", Bloom, Normal, 203, 131, None, json!({}));
    add(
        "bloom-add-tint-streak-export",
        Bloom,
        Export,
        203,
        131,
        coord(),
        json!({"radius": 12, "intensity": 1.3, "composite": "add", "tint": [255, 180, 120],
               "tintAmount": 0.5, "streakEnabled": true, "streakAngle": 25, "streakLength": 30,
               "threshold": 0.45}),
    );
    add(
        "bloom-interactive",
        Bloom,
        Interactive,
        97,
        61,
        None,
        json!({"radius": 8, "threshold": 0.4}),
    );
    add(
        "bloom-tiny",
        Bloom,
        Normal,
        9,
        7,
        None,
        json!({"threshold": 0.3}),
    );

    add(
        "shafts-default",
        LightShafts,
        Normal,
        203,
        131,
        None,
        json!({}),
    );
    add(
        "shafts-directional-alpha-tint",
        LightShafts,
        Export,
        97,
        61,
        None,
        json!({"lightType": "directional", "direction": 30, "occlusionSource": "alpha",
               "scattering": 0.9, "tint": [255, 230, 200], "sampleCount": 30, "density": 0.4}),
    );
    add(
        "shafts-no-scatter-blur",
        LightShafts,
        Interactive,
        131,
        89,
        None,
        json!({"scattering": 0, "lightX": 0.2, "lightY": 0.7, "exposure": 0.3}),
    );

    for (name, border) in [
        ("rgbsplit-offset-transparent", "transparent"),
        ("rgbsplit-offset-clamp", "clamp"),
        ("rgbsplit-offset-wrap", "wrap"),
        ("rgbsplit-offset-mirror", "mirror"),
    ] {
        add(
            name,
            RgbSplit,
            Normal,
            203,
            131,
            coord(),
            json!({"mode": "offset", "redX": 3.5, "redY": -2.25, "blueX": -4, "blueY": 1.5,
                   "greenX": 0.5, "borderMode": border, "intensity": 0.9}),
        );
    }
    add(
        "rgbsplit-radial",
        RgbSplit,
        Normal,
        203,
        131,
        None,
        json!({"mode": "radial", "amount": 8, "falloff": 0.8, "fringeAngle": 20,
               "centerX": 0.4, "centerY": 0.6, "borderMode": "clamp"}),
    );

    add("crt-default", Crt, Normal, 203, 131, None, json!({}));
    add(
        "crt-stripe-glow-vignette",
        Crt,
        Normal,
        203,
        131,
        None,
        json!({"curvature": 0.4, "scanlineStrength": 0.6, "scanlinePeriod": 3.5,
               "phosphorMask": "rgb-stripe", "phosphorPitch": 3, "glow": 0.4, "vignette": 0.5,
               "convergenceX": 0.5, "convergenceY": 0.3, "contrast": 1.1, "brightness": 0.05}),
    );
    add(
        "crt-shadow-mask-glow",
        Crt,
        Normal,
        97,
        61,
        None,
        json!({"curvature": 0.2, "phosphorMask": "shadow-mask", "phosphorPitch": 3, "glow": 0.7,
               "scanlineStrength": 0.8}),
    );

    add("leak-default", LightLeak, Normal, 203, 131, None, json!({}));
    add(
        "leak-custom",
        LightLeak,
        Normal,
        131,
        89,
        None,
        json!({"seed": 5, "x": 0.2, "y": 0.8, "angle": 40, "size": 1.3, "softness": 0.9,
               "hue": 200, "intensity": 1.2, "noiseScale": 0.8}),
    );

    add(
        "caustics-default",
        Caustics,
        Normal,
        203,
        131,
        None,
        json!({}),
    );
    add(
        "caustics-tileable-lighting-export",
        Caustics,
        Export,
        131,
        89,
        coord(),
        json!({"tileable": true, "output": "lighting", "dispersion": 0.5, "time": 1.3,
               "waveCount": 6, "seed": 9, "waterTint": [30, 120, 200]}),
    );
    add(
        "caustics-interactive",
        Caustics,
        Interactive,
        97,
        61,
        None,
        json!({"refractionAmount": 0.7, "distortionAmount": 0.8}),
    );

    // Kernels that stay serial: they must be untouched by the change.
    add(
        "dither-floyd",
        Dither,
        Normal,
        131,
        89,
        coord(),
        json!({"algorithm": "floyd-steinberg", "paletteMode": "levels", "levels": 3,
               "serpentine": true, "strength": 0.8}),
    );
    add(
        "dither-bayer",
        Dither,
        Normal,
        131,
        89,
        coord(),
        json!({"algorithm": "bayer", "paletteMode": "levels", "levels": 4, "bayerSize": 4}),
    );
    add(
        "palette-snap",
        PaletteSnap,
        Normal,
        131,
        89,
        None,
        json!({"colors": [[0,0,0],[255,255,255],[200,40,40],[40,200,40],[40,40,200]],
               "metric": "oklab", "amount": 0.9}),
    );
    add(
        "vhs-default",
        Vhs,
        Normal,
        131,
        89,
        None,
        json!({"lumaNoise": 0.5, "chromaNoise": 0.4, "chromaBleed": 0.5, "jitter": 0.4,
               "tearing": 0.3, "signalBlur": 0.3, "seed": 4, "time": 0.7}),
    );
    add(
        "lens-flare",
        LensFlare,
        Normal,
        131,
        89,
        None,
        json!({"brightness": 1.2, "scale": 0.8, "ghostCount": 4, "halo": 0.5, "seed": 6,
               "sourceX": 0.6, "sourceY": 0.4}),
    );

    // Degenerate geometry: a single column, a single row, two rows.
    add(
        "bloom-one-column",
        Bloom,
        Normal,
        1,
        40,
        None,
        json!({"threshold": 0.2}),
    );
    add(
        "rgbsplit-one-row",
        RgbSplit,
        Normal,
        40,
        1,
        None,
        json!({"redX": 2}),
    );
    add(
        "crt-two-rows",
        Crt,
        Normal,
        33,
        2,
        None,
        json!({"glow": 0.5, "curvature": 0.3}),
    );
    add(
        "shafts-three-rows",
        LightShafts,
        Normal,
        51,
        3,
        None,
        json!({"intensity": 4, "density": 0.9, "decay": 0.99, "weight": 1, "lightX": 0.9}),
    );
    v
}

fn request(case: &Case) -> EffectRequest {
    EffectRequest {
        effect: case.effect,
        width: case.width,
        height: case.height,
        quality: case.quality,
        coord_space: case.coord,
        params: case.params.clone(),
    }
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Prints the table to paste below. Run against the scalar code only.
#[test]
#[ignore = "generator for GOLDEN; run with --ignored --nocapture"]
fn print_goldens() {
    for case in cases() {
        let input = image(case.width, case.height);
        let out = apply_effect(&request(&case), &input).expect("effect");
        println!("    (\"{}\", 0x{:016x}),", case.name, fnv1a64(&out));
    }
}

const GOLDEN: &[(&str, u64)] = &[
    ("bloom-default", 0xc661350903881e0d),
    ("bloom-add-tint-streak-export", 0x7b49a232ebdaed50),
    ("bloom-interactive", 0x431fa300070494ca),
    ("bloom-tiny", 0x3292acec0eb3bc0b),
    ("shafts-default", 0xab56cdf45339273c),
    ("shafts-directional-alpha-tint", 0x16b62a765d429dac),
    ("shafts-no-scatter-blur", 0xd5ada63078941446),
    ("rgbsplit-offset-transparent", 0x16f340aeb699718f),
    ("rgbsplit-offset-clamp", 0x69cae126c2902ea6),
    ("rgbsplit-offset-wrap", 0x0923578735ebd3e4),
    ("rgbsplit-offset-mirror", 0x177c00deb5effeb9),
    ("rgbsplit-radial", 0xc044f1400a10fc4c),
    ("crt-default", 0xf622a08cd2e0045c),
    ("crt-stripe-glow-vignette", 0x1039dd0172cb0695),
    ("crt-shadow-mask-glow", 0xbc7a1a6deb20128f),
    ("leak-default", 0xb59727f91716212d),
    ("leak-custom", 0x2f09a1e89defaf2d),
    ("caustics-default", 0x4c5c05672a75cf17),
    ("caustics-tileable-lighting-export", 0x0b399edfb659b3de),
    ("caustics-interactive", 0x9b2fe1f853218722),
    ("dither-floyd", 0x3db61fac4053a922),
    ("dither-bayer", 0x1d0b908471699267),
    ("palette-snap", 0xa9abafd3a2aed229),
    ("vhs-default", 0x028817d00172e7b1),
    ("lens-flare", 0xe94c59dd978936d2),
    ("bloom-one-column", 0xa51c778650780df0),
    ("rgbsplit-one-row", 0xd62cc64d4aa1861f),
    ("crt-two-rows", 0xfbe8bdb0f81bf2d1),
    ("shafts-three-rows", 0x72a393e039e6014f),
];

fn golden(name: &str) -> u64 {
    GOLDEN
        .iter()
        .find(|(n, _)| *n == name)
        .unwrap_or_else(|| panic!("no golden for {name}"))
        .1
}

fn check(exec: Execution, label: &str) {
    let mut failures = Vec::new();
    for case in cases() {
        let input = image(case.width, case.height);
        let out = apply_effect_with(&request(&case), &input, exec).expect("effect");
        let got = fnv1a64(&out);
        let want = golden(case.name);
        if got != want {
            failures.push(format!(
                "{}: got 0x{got:016x}, expected 0x{want:016x}",
                case.name
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{label}: output drifted from the pre-parallel kernels:\n{}",
        failures.join("\n")
    );
}

/// A case whose output equals its input proves nothing about the kernel.
#[test]
fn no_case_is_a_vacuous_no_op() {
    let mut inert = Vec::new();
    for case in cases() {
        let input = image(case.width, case.height);
        let out = apply_effect_with(&request(&case), &input, Execution::scalar()).expect("effect");
        if out == input {
            inert.push(case.name);
        }
    }
    assert!(
        inert.is_empty(),
        "cases that leave the image unchanged: {inert:?}"
    );
}

#[test]
fn every_case_has_a_golden() {
    for case in cases() {
        golden(case.name);
    }
    assert_eq!(GOLDEN.len(), cases().len(), "stale golden entries");
}

#[test]
fn scalar_execution_matches_the_pre_parallel_kernels() {
    check(Execution::scalar(), "scalar");
}

#[test]
fn forced_row_bands_match_the_pre_parallel_kernels() {
    for threads in [2, 3, 4] {
        // min_band_items = 1 forces a split even on these small images, so the
        // band boundaries (including a remainder band) are exercised.
        check(
            Execution::with_threads(threads).with_min_band_items(1),
            &format!("{threads} forced bands"),
        );
    }
}

#[test]
fn default_policy_matches_the_pre_parallel_kernels() {
    check(Execution::bounded(), "bounded default");
}

/// Large enough that the default work floor really does split the image, so
/// the shipped policy (not only a forced one) is compared with the scalar path.
#[test]
fn default_policy_splits_a_large_image_without_changing_it() {
    let (w, h) = (613u32, 487u32);
    let exec = Execution::bounded();
    if exec.threads() > 1 {
        assert!(
            exec.bands_for(h as usize, (w * h * 4) as usize) > 1,
            "the fixture is meant to be parallel under the default policy"
        );
    }
    let input = image(w, h);
    let kinds = [
        (EffectKind::Bloom, json!({"radius": 10})),
        (
            EffectKind::LightShafts,
            json!({"sampleCount": 12, "intensity": 4, "density": 0.8, "weight": 1, "decay": 0.98}),
        ),
        (
            EffectKind::RgbSplit,
            json!({"redX": 3, "blueX": -3, "borderMode": "clamp"}),
        ),
        (
            EffectKind::Crt,
            json!({"glow": 0.3, "curvature": 0.2, "phosphorMask": "rgb-stripe"}),
        ),
        (EffectKind::LightLeak, json!({"seed": 3})),
        (EffectKind::Caustics, json!({"seed": 2, "waveCount": 4})),
    ];
    for (effect, params) in kinds {
        let request = EffectRequest {
            effect,
            width: w,
            height: h,
            quality: EffectQuality::Normal,
            coord_space: None,
            params,
        };
        let scalar = apply_effect_with(&request, &input, Execution::scalar()).expect("scalar");
        let parallel = apply_effect(&request, &input).expect("default");
        assert!(
            scalar == parallel,
            "{effect:?}: default policy changed the output"
        );
        assert!(
            scalar != input,
            "{effect:?}: fixture did not change the image"
        );
    }
}

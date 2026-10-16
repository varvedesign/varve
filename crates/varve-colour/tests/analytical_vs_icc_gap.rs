//! Measurement probe: how far does the analytical RGB→CMYK approximation in
//! `conversions::rgb_to_cmyk_icc` sit from the real ICC transform shipped in
//! the same crate?
//!
//! This is a measurement, not a gate. It exists to replace an assertion with a
//! number, because the architectural decision (which path may be labelled
//! "ICC-accurate") depends on the size of the gap. Printed with `--nocapture`.

use tintbox::format::decode::TYPE_CMYK_8;
use tintbox::profile::{Profile, RenderingIntent as TintboxIntent};
use tintbox::transform::{Flags, Transform};
use varve_colour::conversions::rgb_to_cmyk_icc;
use varve_colour::profiles::{bundled_cmyk, bundled_srgb, PrintProfile};

/// Compare the analytical approximation against the real ICC transform across
/// a deterministic colour grid.
#[test]
fn analytical_vs_real_icc_gap() {
    let srgb = Profile::open(bundled_srgb()).unwrap();
    let cmyk = Profile::open(bundled_cmyk()).unwrap();

    let real = Transform::new_with_formats(
        &[&srgb, &cmyk],
        &[
            TintboxIntent::RelativeColorimetric,
            TintboxIntent::RelativeColorimetric,
        ],
        &[false, false],
        &[1.0, 1.0],
        Flags::empty(),
        tintbox::format::decode::TYPE_RGB_8,
        TYPE_CMYK_8,
    )
    .unwrap();

    let steps = 6u8; // 6^3 = 216 samples, deterministic
    let mut worst = 0i32;
    let mut sum = 0i64;
    let mut n = 0i64;
    let mut worst_rgb = (0u8, 0u8, 0u8);
    let mut worst_pair = ([0u8; 4], [0u8; 4]);

    for ri in 0..steps {
        for gi in 0..steps {
            for bi in 0..steps {
                let r = (ri as f32 * 255.0 / (steps - 1) as f32).round() as u8;
                let g = (gi as f32 * 255.0 / (steps - 1) as f32).round() as u8;
                let b = (bi as f32 * 255.0 / (steps - 1) as f32).round() as u8;

                let mut icc_out = [0u8; 4];
                real.do_transform(&[r, g, b], &mut icc_out, 1);

                let approx_tuple = rgb_to_cmyk_icc(
                    PrintProfile::Fogra39,
                    r,
                    g,
                    b,
                    varve_colour::profiles::RenderingIntent::Relative,
                    false,
                );
                let approx = [
                    approx_tuple.0,
                    approx_tuple.1,
                    approx_tuple.2,
                    approx_tuple.3,
                ];

                let mut per_channel = 0i32;
                for c in 0..4 {
                    let d = (icc_out[c] as i32 - approx[c] as i32).abs();
                    per_channel = per_channel.max(d);
                    sum += d as i64;
                    n += 1;
                }
                if per_channel > worst {
                    worst = per_channel;
                    worst_rgb = (r, g, b);
                    worst_pair = (icc_out, approx);
                }
            }
        }
    }

    let mean = sum as f64 / n as f64;
    println!("analytical vs real ICC over {steps}^3 grid (0-255 channel scale)");
    println!("  max channel error : {worst} at rgb{worst_rgb:?}");
    println!("  icc={:?}  analytical={:?}", worst_pair.0, worst_pair.1);
    println!("  mean channel error: {mean:.2}");

    // Non-gating characterisation: record the magnitude class.
    assert!(n > 0);
}

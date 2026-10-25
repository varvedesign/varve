//! MODNet's dynamic portrait contract. Keep geometry, area sampling and alpha
//! reconstruction in parity with backgroundRemoval/modnetPortrait.ts.
use image::{DynamicImage, GenericImageView};

use crate::inference::{TensorOutput, TensorShape};

pub(crate) fn input_dimensions(width: u32, height: u32) -> Result<(usize, usize), String> {
    if width == 0 || height == 0 {
        return Err("MODNet source dimensions must be positive".into());
    }
    let (mut w, mut h) = (width as u64, height as u64);
    if width.max(height) < 512 || width.min(height) > 512 {
        if width >= height {
            h = 512;
            w = u64::from(width) * 512 / u64::from(height);
        } else {
            w = 512;
            h = u64::from(height) * 512 / u64::from(width);
        }
    }
    w = (w - w % 32).max(32);
    h = (h - h % 32).max(32);
    // Dynamic shapes must not turn an extremely thin image into an unbounded
    // tensor. This is an allocation bound, not a measured model memory peak.
    if w * h > 8 * 1024 * 1024 {
        return Err("MODNet input aspect ratio requires an oversized tensor; crop the portrait region first".into());
    }
    Ok((w as usize, h as usize))
}

fn area_weights(source: usize, target: usize) -> Vec<Vec<(usize, f64)>> {
    (0..target)
        .map(|index| {
            let from = index as f64 * source as f64 / target as f64;
            let to = (index + 1) as f64 * source as f64 / target as f64;
            let first = from.floor() as usize;
            let last = (to.ceil() as usize).min(source);
            (first..last)
                .map(|pixel| {
                    (
                        pixel,
                        (to.min((pixel + 1) as f64) - from.max(pixel as f64)) / (to - from),
                    )
                })
                .collect()
        })
        .collect()
}

fn resize_plane(source: &[f32], sw: usize, sh: usize, tw: usize, th: usize) -> Vec<f32> {
    let mut output = vec![0.0; tw * th];
    if tw <= sw && th <= sh {
        let xs = area_weights(sw, tw);
        let ys = area_weights(sh, th);
        for (y, row) in ys.iter().enumerate() {
            for (x, column) in xs.iter().enumerate() {
                let mut value = 0.0;
                for &(sy, wy) in row {
                    for &(sx, wx) in column {
                        value += f64::from(source[sy * sw + sx]) * wx * wy;
                    }
                }
                output[y * tw + x] = value as f32;
            }
        }
    } else {
        for y in 0..th {
            for x in 0..tw {
                output[y * tw + x] = source[(y * sh / th) * sw + x * sw / tw];
            }
        }
    }
    output
}

pub(crate) fn preprocess(image: &DynamicImage) -> Result<TensorOutput, String> {
    let (w, h) = input_dimensions(image.width(), image.height())?;
    let (sw, sh) = image.dimensions();
    let pixels = image.to_rgb8();
    let mut data = Vec::with_capacity(3 * w * h);
    for channel in 0..3 {
        let plane: Vec<f32> = pixels
            .pixels()
            .map(|pixel| f32::from(pixel[channel]))
            .collect();
        data.extend(
            resize_plane(&plane, sw as usize, sh as usize, w, h)
                .into_iter()
                .map(|value| value / 127.5 - 1.0),
        );
    }
    Ok(TensorOutput {
        data,
        shape: TensorShape(vec![1, 3, h, w]),
    })
}

pub(crate) fn decode(output: TensorOutput, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let [1, 1, h, w] = output.shape.0.as_slice() else {
        return Err(format!(
            "MODNet returned an invalid matte shape {:?}",
            output.shape.0
        ));
    };
    if *w == 0 || *h == 0 || w.checked_mul(*h) != Some(output.data.len()) {
        return Err("MODNet matte dimensions do not match its data".into());
    }
    // The pinned export includes sigmoid. Non-finite or non-probability output
    // is a model/runtime defect, not permission to invent another activation.
    if output
        .data
        .iter()
        .any(|v| !v.is_finite() || !(-0.0001..=1.0001).contains(v))
    {
        return Err("MODNet returned invalid alpha probabilities".into());
    }
    Ok(
        resize_plane(&output.data, *w, *h, width as usize, height as usize)
            .into_iter()
            .map(|value| (value.clamp(0.0, 1.0) * 255.0).round() as u8)
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dynamic_geometry_tracks_the_short_edge_and_stride_without_letterboxing() {
        for (source, expected) in [
            ((300, 200), (768, 512)),
            ((4000, 3000), (672, 512)),
            ((512, 1024), (512, 1024)),
            ((800, 300), (800, 288)),
        ] {
            assert_eq!(input_dimensions(source.0, source.1).unwrap(), expected);
        }
        assert!(input_dimensions(0, 200).is_err());
        assert!(input_dimensions(1, 511).is_err());
    }

    #[test]
    fn area_resize_preserves_fractional_alpha_and_rgb_contract() {
        assert_eq!(
            resize_plane(&[0.0, 0.25, 0.75, 1.0], 4, 1, 2, 1),
            [0.125, 0.875]
        );
        let source = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            32,
            512,
            image::Rgb([0, 128, 255]),
        ));
        let tensor = preprocess(&source).unwrap();
        assert_eq!(tensor.shape.0, [1, 3, 512, 32]);
        assert_eq!(tensor.data[0], -1.0);
        assert!((tensor.data[512 * 32] - (128.0 / 127.5 - 1.0)).abs() < 1e-6);
        assert_eq!(tensor.data[512 * 32 * 2], 1.0);
    }

    #[test]
    fn matte_is_not_minmax_stretched_or_sigmoided_again() {
        let output = TensorOutput {
            data: vec![0.0, 0.25, 0.75, 1.0],
            shape: TensorShape(vec![1, 1, 1, 4]),
        };
        assert_eq!(decode(output.clone(), 2, 1).unwrap(), [32, 223]);
        for bad in [f32::NAN, f32::INFINITY, 2.0] {
            let mut invalid = output.clone();
            invalid.data[0] = bad;
            assert!(decode(invalid, 2, 1).is_err());
        }
    }
}

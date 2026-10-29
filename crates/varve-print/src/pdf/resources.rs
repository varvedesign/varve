//! Image and colour resource embedding: image XObjects, placement, and checks.

use super::prelude::*;

/// State for rendering image fills in PDF output.
///
/// Carries the `Document` + a counter for naming image XObjects (`/Im0`, `/Im1`, ...)
/// and collects the references so the caller can add an `XObject` resource dict
/// to the page.
pub(crate) struct ImageRenderState<'a> {
    pub doc: &'a mut Document,
    pub counter: u32,
    pub refs: Vec<(String, Object)>,
    /// Graphics state dictionaries for alpha (opacity -> GS name).
    gs_cache: HashMap<u32, String>,
    /// Graphics state dictionaries for blend modes (PDF name -> GS name).
    blend_gs_cache: HashMap<&'static str, String>,
    /// False for formats that forbid live transparency (PDF/X-1a), where a
    /// `/BM` entry would break the declared conformance. Blend modes are then
    /// reported by `unrepresented_blend_modes` instead of written.
    pub allow_blend_modes: bool,
}

impl<'a> ImageRenderState<'a> {
    pub fn new(doc: &'a mut Document) -> Self {
        Self {
            doc,
            counter: 0,
            refs: Vec::new(),
            gs_cache: HashMap::new(),
            blend_gs_cache: HashMap::new(),
            allow_blend_modes: true,
        }
    }

    /// Get-or-create an ExtGState dictionary for a given alpha value.
    /// Sets both non-stroking (`ca`) and stroking (`CA`) alpha so a node's
    /// global opacity applies to fills and strokes. Returns the GS name (e.g.
    /// "GS075") to use with `gs` in the content stream.
    pub fn get_or_create_opacity_gs(&mut self, opacity: f64) -> String {
        let key = (opacity.clamp(0.0, 1.0) * 1000.0) as u32;
        if let Some(name) = self.gs_cache.get(&key) {
            return name.clone();
        }
        let name = format!("GS{key:03}");
        let gs = dictionary! {
            "Type" => "ExtGState",
            "ca" => opacity.clamp(0.0, 1.0),
            "CA" => opacity.clamp(0.0, 1.0),
        };
        self.refs.push((name.clone(), Object::Dictionary(gs)));
        self.gs_cache.insert(key, name.clone());
        name
    }

    /// Get-or-create an ExtGState dictionary for a PDF blend mode.
    ///
    /// Returns the GS name (e.g. "BMMultiply") to use with `gs` in the content
    /// stream, or `None` when `mode` has no PDF representation — the caller
    /// reports that instead of writing `Normal`, which would export a
    /// different composition than the canvas shows. A blend ExtGState and an
    /// opacity ExtGState stack: PDF applies the entries each one defines and
    /// leaves every other graphics-state parameter untouched.
    pub fn get_or_create_blend_gs(&mut self, mode: &varve_core::BlendMode) -> Option<String> {
        if !self.allow_blend_modes {
            return None;
        }
        let pdf_name = blend::pdf_blend_name(mode)?;
        if pdf_name == "Normal" {
            return None;
        }
        if let Some(name) = self.blend_gs_cache.get(pdf_name) {
            return Some(name.clone());
        }
        let name = format!("BM{pdf_name}");
        let gs = dictionary! {
            "Type" => "ExtGState",
            "BM" => Object::Name(pdf_name.as_bytes().to_vec()),
        };
        self.refs.push((name.clone(), Object::Dictionary(gs)));
        self.blend_gs_cache.insert(pdf_name, name.clone());
        Some(name)
    }

    /// Get-or-create an effect blend state, including `/BM /Normal`.
    ///
    /// A drop shadow's blend mode is local to the effect and can override a
    /// non-Normal node mode. The regular node/fill helper omits Normal because
    /// the page default is Normal; effects need an explicit Normal entry when
    /// the surrounding node state selected another mode.
    pub(crate) fn get_or_create_effect_blend_gs(
        &mut self,
        mode: &varve_core::BlendMode,
    ) -> Option<String> {
        if !self.allow_blend_modes {
            return None;
        }
        let pdf_name = blend::pdf_blend_name(mode)?;
        if let Some(name) = self.blend_gs_cache.get(pdf_name) {
            return Some(name.clone());
        }
        let name = format!("BM{pdf_name}");
        let gs = dictionary! {
            "Type" => "ExtGState",
            "BM" => Object::Name(pdf_name.as_bytes().to_vec()),
        };
        self.refs.push((name.clone(), Object::Dictionary(gs)));
        self.blend_gs_cache.insert(pdf_name, name.clone());
        Some(name)
    }
}

/// Add image XObjects and opacity graphics states collected by the fill
/// renderer to a page resource dictionary. Both the standard PDF and PDF/X
/// builders share this split so an `/GS… gs` operator always has an
/// `/ExtGState` resource with the matching name.
pub(crate) fn add_image_render_resources(
    resources: &mut lopdf::Dictionary,
    refs: &[(String, Object)],
) {
    let mut xobjects = lopdf::Dictionary::new();
    let mut graphics_states = lopdf::Dictionary::new();
    for (name, object) in refs {
        let is_graphics_state = match object {
            Object::Dictionary(dictionary) => {
                dictionary
                    .get(b"Type")
                    .ok()
                    .and_then(|value| value.as_name().ok())
                    == Some(b"ExtGState")
            }
            _ => false,
        };
        if is_graphics_state {
            graphics_states.set(name.as_bytes(), object.clone());
        } else {
            xobjects.set(name.as_bytes(), object.clone());
        }
    }
    if !xobjects.is_empty() {
        resources.set("XObject", xobjects);
    }
    if !graphics_states.is_empty() {
        resources.set("ExtGState", graphics_states);
    }
}

/// Generate a small checkerboard placeholder image (16×16 RGB pixels).
/// Used as a stand-in for image fills when the real pixel data is unavailable
/// (the live renderer owns the actual decoded bitmap).
pub(crate) fn generate_checkerboard() -> Vec<u8> {
    const SIZE: u32 = 16;
    let mut data = Vec::with_capacity((SIZE * SIZE * 3) as usize);
    for y in 0..SIZE {
        for x in 0..SIZE {
            if (x / 4 + y / 4) % 2 == 0 {
                data.extend_from_slice(&[57, 208, 198]); // teal
            } else {
                data.extend_from_slice(&[255, 240, 245]); // light pink
            }
        }
    }
    data
}

/// Compute the axis-aligned bounding box of a shape node in PDF space (Y-up).
/// Returns `(x, y, w, h)` where `(x, y)` is the bottom-left corner.
/// Compute PDF image placement (draw rect + offset) for the given fit mode,
/// source dimensions, destination bounds, and scale override.
///
/// Returns (draw_w, draw_h, draw_offset_x, draw_offset_y) where the draw rect
/// is positioned at shape_bounds + draw_offset in PDF coordinate space.
#[allow(clippy::too_many_arguments)]
pub(crate) fn compute_pdf_image_placement(
    fit: &str,
    src_w: f64,
    src_h: f64,
    dst_w: f64,
    dst_h: f64,
    user_scale: f64,
) -> (f64, f64, f64, f64) {
    if !src_w.is_finite()
        || !src_h.is_finite()
        || !dst_w.is_finite()
        || !dst_h.is_finite()
        || !user_scale.is_finite()
        || src_w <= 0.0
        || src_h <= 0.0
        || dst_w <= 0.0
        || dst_h <= 0.0
        || user_scale <= 0.0
    {
        return (dst_w, dst_h, 0.0, 0.0);
    }
    match fit {
        "stretch" => (dst_w, dst_h, 0.0, 0.0),
        "fit" => {
            // CSS contain: fit within bounds while maintaining aspect ratio
            let aspect = src_w / src_h;
            let dst_aspect = dst_w / dst_h;
            if aspect > dst_aspect {
                // Source is wider: width matches bounds
                let h = dst_w / aspect;
                let w = dst_w * user_scale;
                let h = h * user_scale;
                (w, h, (dst_w - w) / 2.0, (dst_h - h) / 2.0)
            } else {
                let w = dst_h * aspect;
                let w = w * user_scale;
                let h = dst_h * user_scale;
                (w, h, (dst_w - w) / 2.0, (dst_h - h) / 2.0)
            }
        }
        "tile" => {
            // Tile mode: use source size × user scale as tile size
            (src_w * user_scale, src_h * user_scale, 0.0, 0.0)
        }
        "crop" => {
            // Manual crop mode: natural source size × user scale, anchored at
            // the node bounds origin. Fill x/y supplies the user pan.
            (src_w * user_scale, src_h * user_scale, 0.0, 0.0)
        }
        _ => {
            // Default "fill": CSS cover, then multiply the policy result by
            // user scale around the destination centre.
            let aspect = src_w / src_h;
            let dst_aspect = dst_w / dst_h;
            let (base_w, base_h) = if aspect > dst_aspect {
                (dst_h * aspect, dst_h)
            } else {
                (dst_w, dst_w / aspect)
            };
            let w = base_w * user_scale;
            let h = base_h * user_scale;
            (w, h, (dst_w - w) / 2.0, (dst_h - h) / 2.0)
        }
    }
}

/// Embed raw image data as a PDF Image XObject in the document.
///
/// Returns the object reference that can be used in content streams
/// via `/ImName Do`. The image data should be raw pixel data
/// (R,G,B per pixel, `width * height * 3` bytes).
pub fn embed_image(
    doc: &mut Document,
    image_data: &[u8],
    width: u32,
    height: u32,
) -> Result<Object, String> {
    let expected = (width * height * 3) as usize;
    if image_data.len() < expected {
        return Err(format!(
            "Image data too short: got {} bytes, expected {expected}",
            image_data.len()
        ));
    }

    let image_id = doc.new_object_id();
    let stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => width as i64,
            "Height" => height as i64,
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8,
            "Length" => expected as i64,
        },
        image_data[..expected].to_vec(),
    );
    doc.objects.insert(image_id, Object::Stream(stream));
    Ok(Object::Reference(image_id))
}

/// Embed image data with an explicit color space.
///
/// `bpc` = bytes per component (3 for RGB, 4 for CMYK).
/// `color_space_name` = PDF color space name (e.g. "DeviceRGB", "DeviceCMYK").
pub fn embed_image_with_colorspace(
    doc: &mut Document,
    image_data: &[u8],
    width: u32,
    height: u32,
    bpc: u32,
    color_space_name: &str,
    alpha_data: Option<&[u8]>,
) -> Result<Object, String> {
    let expected = (width * height * bpc) as usize;
    if image_data.len() < expected {
        return Err(format!(
            "Image data too short: got {} bytes, expected {expected}",
            image_data.len()
        ));
    }

    let mut image_dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Image",
        "Width" => width as i64,
        "Height" => height as i64,
        "ColorSpace" => color_space_name,
        "BitsPerComponent" => 8,
        "Length" => expected as i64,
    };

    // Embed alpha channel as a soft mask (SMask) for transparency support.
    // The alpha is stored as a separate 1-component 8-bit image XObject
    // and linked via /SMask in the image dictionary.
    if let Some(alpha) = alpha_data {
        let alpha_expected = (width * height) as usize;
        if alpha.len() >= alpha_expected {
            let mask_id = doc.new_object_id();
            let mask_stream = Stream::new(
                dictionary! {
                    "Type" => "XObject",
                    "Subtype" => "Image",
                    "Width" => width as i64,
                    "Height" => height as i64,
                    "ColorSpace" => "DeviceGray",
                    "BitsPerComponent" => 8,
                    "Length" => alpha_expected as i64,
                },
                alpha[..alpha_expected].to_vec(),
            );
            doc.objects.insert(mask_id, Object::Stream(mask_stream));
            image_dict.set("SMask", Object::Reference(mask_id));
        }
    }

    let image_id = doc.new_object_id();
    let stream = Stream::new(image_dict, image_data[..expected].to_vec());
    doc.objects.insert(image_id, Object::Stream(stream));
    Ok(Object::Reference(image_id))
}

/// Extract the alpha channel from RGBA pixel data.
/// Returns Vec<u8> with one byte per pixel (the alpha value).
pub fn rgba_extract_alpha(data: &[u8]) -> Vec<u8> {
    data.chunks_exact(4).map(|rgba| rgba[3]).collect()
}

/// Convert RGBA pixel data to RGB by stripping the alpha channel.
pub fn rgba_to_rgb(data: &[u8]) -> Vec<u8> {
    data.chunks_exact(4)
        .flat_map(|rgba| [rgba[0], rgba[1], rgba[2]])
        .collect()
}

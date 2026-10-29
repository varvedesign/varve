//! Gradient shading definitions and PDF shading objects.

use super::colour::cmyk_normalized;
use super::paths::{apply_pdf_affine, multiply_pdf_affine, node_affine, shape_local_bounds};
use super::prelude::*;

/// Return the canonical unit-fill → page-space matrix used by PDF shadings.
///
/// Explicit gradient transforms are authoritative. Legacy rotation-only
/// gradients are materialized against the pre-transform local bounds so a
/// native export cannot silently reset them to a new bounding-box default.
pub(crate) fn gradient_page_affine(
    node: &SceneNode,
    page_height: f64,
    transform: Option<[f64; 6]>,
    rotation: f64,
) -> [f64; 6] {
    let local = transform.unwrap_or_else(|| {
        let (x, y, w, h) = shape_local_bounds(node);
        let radius = (w * w + h * h).sqrt() / 2.0;
        let cx = x + w / 2.0;
        let cy = y + h / 2.0;
        let radians = rotation.to_radians();
        let (sin, cos) = radians.sin_cos();
        [
            2.0 * radius * cos,
            2.0 * radius * sin,
            -2.0 * radius * sin,
            2.0 * radius * cos,
            cx - radius * cos + radius * sin,
            cy - radius * sin - radius * cos,
        ]
    });
    let page_flip = [1.0, 0.0, 0.0, -1.0, 0.0, page_height];
    multiply_pdf_affine(page_flip, multiply_pdf_affine(node_affine(node), local))
}

/// Render stacked fills from `node.fills` (bottom-to-top, last = topmost).
/// Falls back to `node.fill` when `fills` is None or empty.
///
/// A gradient shading definition collected during render.
/// The actual PDF objects are created later (after the render borrow ends).
#[derive(Clone)]
pub(crate) enum ShadingKind {
    Linear,
    Radial,
}

pub(crate) struct GradientShadingDef {
    pub(crate) kind: ShadingKind,
    pub(crate) stops: Vec<GradientStop>,
    pub(crate) use_cmyk: bool,
    pub(crate) profile: Option<PrintProfile>,
    /// Canonical unit-fill → PDF page-space matrix.
    pub(crate) matrix: [f64; 6],
}

/// Tracks gradient shading definitions during render. Collects gradient
/// data without borrowing the document, then creates PDF objects in a
/// deferred pass.
pub(crate) struct ShadingRegistry {
    pub(crate) definitions: Vec<(String, GradientShadingDef)>,
    pub(crate) next_id: u64,
}

impl ShadingRegistry {
    pub(crate) fn new() -> Self {
        Self {
            definitions: Vec::new(),
            next_id: 1,
        }
    }

    /// Register a linear gradient. Returns the resource name (e.g., "Sh1").
    pub(crate) fn add_linear_gradient(
        &mut self,
        stops: &[GradientStop],
        use_cmyk: bool,
        profile: Option<PrintProfile>,
        matrix: [f64; 6],
    ) -> String {
        let name = format!("Sh{}", self.next_id);
        self.next_id += 1;
        self.definitions.push((
            name.clone(),
            GradientShadingDef {
                kind: ShadingKind::Linear,
                stops: stops.to_vec(),
                use_cmyk,
                profile,
                matrix,
            },
        ));
        name
    }

    /// Register a radial gradient. Returns the resource name (e.g., "Sh1").
    pub(crate) fn add_radial_gradient(
        &mut self,
        stops: &[GradientStop],
        use_cmyk: bool,
        profile: Option<PrintProfile>,
        matrix: [f64; 6],
    ) -> String {
        let name = format!("Sh{}", self.next_id);
        self.next_id += 1;
        self.definitions.push((
            name.clone(),
            GradientShadingDef {
                kind: ShadingKind::Radial,
                stops: stops.to_vec(),
                use_cmyk,
                profile,
                matrix,
            },
        ));
        name
    }

    /// Create all PDF shading objects in the document and return resource refs.
    pub(crate) fn create_pdf_objects(&self, doc: &mut Document) -> Vec<(String, ObjectId)> {
        let mut resources = Vec::new();
        for (name, def) in &self.definitions {
            let func_id = create_sampled_function(doc, &def.stops, def.use_cmyk, def.profile);
            let color_space = if def.use_cmyk {
                "DeviceCMYK"
            } else {
                "DeviceRGB"
            };
            match def.kind {
                ShadingKind::Linear => {
                    // Type 2 axial gradients accept page-space endpoints.
                    // Transforming both endpoints preserves translation,
                    // scale, reflection and skew instead of retaining only an
                    // angle.
                    let (x1, y1) = apply_pdf_affine(def.matrix, 0.0, 0.5);
                    let (x2, y2) = apply_pdf_affine(def.matrix, 1.0, 0.5);
                    let shading_dict = dictionary! {
                        "ShadingType" => 2i64,
                        "ColorSpace" => color_space,
                        "Domain" => vec![Object::Real(0.0), Object::Real(1.0)],
                        "Coords" => vec![
                            Object::Real(x1 as f32), Object::Real(y1 as f32),
                            Object::Real(x2 as f32), Object::Real(y2 as f32),
                        ],
                        "Function" => Object::Reference(func_id),
                        "Extend" => vec![Object::Boolean(true), Object::Boolean(true)],
                    };
                    let shading_id = doc.new_object_id();
                    doc.objects
                        .insert(shading_id, Object::Dictionary(shading_dict));
                    resources.push((name.clone(), shading_id));
                }
                ShadingKind::Radial => {
                    // Type 3's canonical circles are mapped through the full
                    // page-space matrix. PDF consumers that honour the
                    // shading matrix retain elliptical/skewed radial fields;
                    // targets without that capability are rasterized by the
                    // compositor before reaching this writer.
                    let shading_dict = dictionary! {
                        "ShadingType" => 3i64,
                        "ColorSpace" => color_space,
                        "Domain" => vec![Object::Real(0.0), Object::Real(1.0)],
                        "Coords" => vec![
                            Object::Real(0.5), Object::Real(0.5), Object::Real(0.0),
                            Object::Real(0.5), Object::Real(0.5), Object::Real(std::f64::consts::FRAC_1_SQRT_2 as f32),
                        ],
                        "Matrix" => def.matrix.iter().map(|value| Object::Real(*value as f32)).collect::<Vec<_>>(),
                        "Function" => Object::Reference(func_id),
                        "Extend" => vec![Object::Boolean(true), Object::Boolean(true)],
                    };
                    let shading_id = doc.new_object_id();
                    doc.objects
                        .insert(shading_id, Object::Dictionary(shading_dict));
                    resources.push((name.clone(), shading_id));
                }
            }
        }
        resources
    }
}

/// Create a Type 0 sampled function for gradient color interpolation.
pub(crate) fn create_sampled_function(
    doc: &mut Document,
    stops: &[GradientStop],
    use_cmyk: bool,
    profile: Option<PrintProfile>,
) -> ObjectId {
    const SAMPLES: usize = 256;
    let mut samples: Vec<u8> = Vec::with_capacity(SAMPLES * if use_cmyk { 4 } else { 3 });

    for i in 0..SAMPLES {
        let t = i as f64 / (SAMPLES - 1) as f64;
        let color = sample_gradient(stops, t);
        if use_cmyk {
            // Native CMYK samples (from CMYK-space interpolation) emit
            // directly; RGB samples convert via the profile/naive path.
            let (cc, cm, cy, ck) = match cmyk_normalized(&color) {
                Some((c, m, y, k)) => (
                    (c * 255.0) as u8,
                    (m * 255.0) as u8,
                    (y * 255.0) as u8,
                    (k * 255.0) as u8,
                ),
                None => {
                    let (r, g, b, _) = engine_color_rgba(&color);
                    match profile {
                        Some(p) => crate::cmyk::rgb_to_cmyk_icc(
                            p,
                            r,
                            g,
                            b,
                            crate::profiles::RenderingIntent::Relative,
                            true,
                        ),
                        None => crate::cmyk::rgb_to_cmyk(r, g, b),
                    }
                }
            };
            samples.push(cc);
            samples.push(cm);
            samples.push(cy);
            samples.push(ck);
        } else {
            let (r, g, b, _) = engine_color_rgba(&color);
            samples.push(r);
            samples.push(g);
            samples.push(b);
        }
    }

    let func_dict = dictionary! {
        "FunctionType" => 0i64,
        "Domain" => vec![Object::Real(0.0), Object::Real(1.0)],
        "Range" => vec![
            Object::Real(0.0), Object::Real(255.0),
            Object::Real(0.0), Object::Real(255.0),
            Object::Real(0.0), Object::Real(255.0),
            Object::Real(0.0), Object::Real(255.0),
        ],
        "Size" => vec![Object::Integer(SAMPLES as i64)],
        "BitsPerSample" => 8i64,
        "Order" => 1i64,
    };

    let func_stream = Stream::new(func_dict, samples);
    let func_id = doc.new_object_id();
    doc.objects.insert(func_id, Object::Stream(func_stream));
    func_id
}

/// Sample a gradient at position t (0.0-1.0) by interpolating between stops.
pub(crate) fn sample_gradient(stops: &[GradientStop], t: f64) -> EngineColor {
    if stops.is_empty() {
        return EngineColor::Rgb {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 255.0,
            bit_depth: None,
            profile: None,
        };
    }
    if stops.len() == 1 {
        return stops[0].color.clone();
    }
    // Find the two stops surrounding t
    let mut lower = &stops[0];
    let mut upper = &stops[stops.len() - 1];
    for window in stops.windows(2) {
        if t >= window[0].position && t <= window[1].position {
            lower = &window[0];
            upper = &window[1];
            break;
        }
    }
    let range = upper.position - lower.position;
    let local_t = if range > 0.0 {
        (t - lower.position) / range
    } else {
        0.0
    };
    // Native CMYK stops interpolate in CMYK space (channel lerp on the
    // normalized values) so authored print values — including pure K — are
    // never round-tripped through a naive RGB build.
    if let (Some((c1, m1, y1, k1)), Some((c2, m2, y2, k2))) =
        (cmyk_normalized(&lower.color), cmyk_normalized(&upper.color))
    {
        let lerp = |a: f32, b: f32| -> f64 { a as f64 + (b as f64 - a as f64) * local_t };
        return EngineColor::Cmyk {
            c: lerp(c1, c2),
            m: lerp(m1, m2),
            y: lerp(y1, y2),
            k: lerp(k1, k2),
            a: 255.0,
            bit_depth: Some("float32".to_string()),
            profile: None,
        };
    }
    // Linear interpolation in RGB space (mixed-space gradients)
    let (r1, g1, b1, a1) = engine_color_rgba(&lower.color);
    let (r2, g2, b2, a2) = engine_color_rgba(&upper.color);
    let lerp = |a: u8, b: u8| -> f64 { a as f64 + (b as f64 - a as f64) * local_t };
    EngineColor::Rgb {
        r: lerp(r1, r2),
        g: lerp(g1, g2),
        b: lerp(b1, b2),
        a: lerp(a1, a2),
        bit_depth: None,
        profile: None,
    }
}

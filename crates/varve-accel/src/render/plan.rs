//! Render-IR to native-draw-plan lowering, with an explicit admission verdict.
//!
//! The plan is a *derived projection* of the existing render IR, never a second
//! scene representation: the same `varve_engine::RenderItem` values that the
//! webview replay consumes are lowered here, in paint order, and every item
//! that this stage cannot reproduce exactly is reported as a rejection rather
//! than approximated. That is what makes frame-level admission possible: a
//! caller either gets a native frame that is defined to match the Canvas2D
//! replay for every admitted item, or it gets the reason and keeps the
//! authoritative replay.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use varve_core::{
    compound_path_fill_rule, compound_path_rings, EngineColor, PathFillRule, PathPoint,
};
use varve_engine::{Primitive, RenderItem};

/// Shape families the analytic stage can reproduce.
pub const KIND_RECT: u32 = 0;
pub const KIND_ELLIPSE: u32 = 1;
pub const KIND_REGULAR: u32 = 2;
pub const KIND_STAR: u32 = 3;

/// Must match `MAX_VERTICES` in `shaders/shape.wgsl`.
pub const MAX_SHAPE_VERTICES: u32 = 24;

/// Bounded work ceiling for one frame, mirroring the spirit of the native
/// effect ceiling. Exceeding it is a *render-scoped* refusal (the frame keeps
/// the authoritative replay), never a device fault.
pub const MAX_PLAN_ITEMS: usize = 200_000;
pub const MAX_PLAN_VERTICES: usize = 4_000_000;

/// Why one IR item could not be admitted to the native stage.
///
/// Finer than a boolean on purpose: the diagnostics surface names the exact
/// boundary, so "the GPU is off" can never hide which content drove it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RejectReason {
    /// `text`, `table`, `rasterLayer` — no native stage yet.
    UnsupportedPrimitive,
    /// Any paint other than exactly one visible solid fill.
    UnsupportedPaint,
    /// Stroke geometry is not lowered yet; strokes must not be dropped.
    UnsupportedStroke,
    /// Non-normal item blend mode, or a fill-level blend override.
    UnsupportedBlend,
    /// Content effects or nondestructive adjustment filters.
    UnsupportedEffects,
    /// Corner smoothing (squircle) has no analytic analogue yet.
    UnsupportedCornerSmoothing,
    /// Degenerate geometry (zero area, non-finite coordinates).
    EmptyGeometry,
    /// More ring vertices than the fixed-trip-count shader can walk.
    TooManyVertices,
    /// Non-invertible or non-finite node transform.
    NonFiniteTransform,
    /// The frame exceeds the bounded plan budget.
    OutOfBudget,
}

impl RejectReason {
    /// Stable, non-identifying key used by diagnostics and tests.
    pub fn key(self) -> &'static str {
        match self {
            RejectReason::UnsupportedPrimitive => "unsupported-primitive",
            RejectReason::UnsupportedPaint => "unsupported-paint",
            RejectReason::UnsupportedStroke => "unsupported-stroke",
            RejectReason::UnsupportedBlend => "unsupported-blend",
            RejectReason::UnsupportedEffects => "unsupported-effects",
            RejectReason::UnsupportedCornerSmoothing => "unsupported-corner-smoothing",
            RejectReason::EmptyGeometry => "empty-geometry",
            RejectReason::TooManyVertices => "too-many-vertices",
            RejectReason::NonFiniteTransform => "non-finite-transform",
            RejectReason::OutOfBudget => "out-of-budget",
        }
    }

    /// Every variant, for exhaustive reporting.
    pub const ALL: [RejectReason; 10] = [
        RejectReason::UnsupportedPrimitive,
        RejectReason::UnsupportedPaint,
        RejectReason::UnsupportedStroke,
        RejectReason::UnsupportedBlend,
        RejectReason::UnsupportedEffects,
        RejectReason::UnsupportedCornerSmoothing,
        RejectReason::EmptyGeometry,
        RejectReason::TooManyVertices,
        RejectReason::NonFiniteTransform,
        RejectReason::OutOfBudget,
    ];
}

/// Admission verdict for one planned frame.
///
/// `complete` is the only field a caller should branch on to decide whether the
/// native frame may be presented: a partial plan is *not* a valid frame under
/// this design, because a GPU-only surface cannot composite a Canvas2D island
/// without a bridge that does not exist yet.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmissionReport {
    pub considered: usize,
    pub admitted: usize,
    pub rejected: usize,
    /// Every rejection, keyed by `RejectReason::key` so the frontend cannot
    /// depend on Rust enum spelling.
    pub reasons: BTreeMap<String, usize>,
}

impl AdmissionReport {
    pub fn complete(&self) -> bool {
        self.rejected == 0 && self.considered > 0
    }

    /// Compact, non-identifying summary for logs and diagnostics.
    pub fn summary(&self) -> String {
        if self.rejected == 0 {
            return format!("{} items admitted natively", self.admitted);
        }
        let detail = self
            .reasons
            .iter()
            .map(|(reason, count)| format!("{reason} x{count}"))
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "{} of {} items admitted natively ({detail})",
            self.admitted, self.considered
        )
    }
}

/// A vertex shared by the stencil fan and the cover quad.
///
/// Positions are already in clip space; `color` is straight (non-premultiplied)
/// encoded-sRGB with the item opacity folded into alpha.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolidVertex {
    pub position: [f32; 2],
    pub color: [f32; 4],
}

/// `Pod`-style layout contract for the vertex buffer. The struct is a plain
/// `[f32; N]` aggregate with no padding, which is what `bytemuck`-free
/// `cast_slice` requires; a unit test pins it.
pub const SOLID_VERTEX_BYTES: usize = 24;

/// One record in the instanced shape buffer. Field layout must match the
/// `Item` struct in `shaders/shape.wgsl` exactly.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShapeRecord {
    pub mv: [f32; 4],
    pub mv2: [f32; 4],
    pub quad: [f32; 4],
    pub shape: [u32; 4],
    pub p0: [f32; 4],
    pub p1: [f32; 4],
    pub radii: [f32; 4],
    pub color: [f32; 4],
}

/// `ShapeRecord` is 8 x 16 bytes; the shader's `Item` relies on that.
pub const SHAPE_RECORD_BYTES: usize = 128;

/// One ordered draw. Paint order is the `ops` vector order, always.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DrawOp {
    /// Instanced analytic shape run. Instances are contiguous in the shape
    /// buffer; adjacent runs are coalesced during planning.
    Shapes {
        first_instance: u32,
        instance_count: u32,
    },
    /// Stencil fan followed by the cover quad, both indexed.
    Fill {
        fan_index_start: u32,
        fan_index_count: u32,
        cover_index_start: u32,
        cover_index_count: u32,
        even_odd: bool,
    },
}

/// A fully lowered frame.
#[derive(Debug, Clone, Default)]
pub struct NativePlan {
    pub shapes: Vec<ShapeRecord>,
    pub vertices: Vec<SolidVertex>,
    pub indices: Vec<u32>,
    pub ops: Vec<DrawOp>,
    pub report: AdmissionReport,
}

impl NativePlan {
    pub fn is_presentable(&self) -> bool {
        self.report.complete() && !self.ops.is_empty()
    }
}

/// Straight-alpha encoded-sRGB conversion.
///
/// `managedColorToRgba` in the TypeScript replay returns 0-255 sRGB-encoded
/// channel values and an alpha in the same range; Canvas2D's default canvas
/// space is sRGB and its compositing operates on those encoded values, so the
/// native stage must not linearize them. Returning 0..1 here keeps the shader
/// free of scale factors.
fn color_to_rgba(color: &EngineColor) -> [f32; 4] {
    match color {
        EngineColor::Rgb { r, g, b, a, .. } => [
            (*r as f32 / 255.0).clamp(0.0, 1.0),
            (*g as f32 / 255.0).clamp(0.0, 1.0),
            (*b as f32 / 255.0).clamp(0.0, 1.0),
            (*a as f32 / 255.0).clamp(0.0, 1.0),
        ],
        EngineColor::Cmyk { c, m, y, k, a, .. } => {
            // Naive conversion, present only so the stage can *reject* CMYK
            // honestly rather than silently mis-paint. `is_rgb` refuses
            // non-RGB colours before this is reached.
            let (c, m, y, k) = (
                *c as f32 / 255.0,
                *m as f32 / 255.0,
                *y as f32 / 255.0,
                *k as f32 / 255.0,
            );
            [
                ((1.0 - c) * (1.0 - k)).clamp(0.0, 1.0),
                ((1.0 - m) * (1.0 - k)).clamp(0.0, 1.0),
                ((1.0 - y) * (1.0 - k)).clamp(0.0, 1.0),
                (*a as f32 / 255.0).clamp(0.0, 1.0),
            ]
        }
        EngineColor::Gray { v, a, .. } => {
            let level = (*v as f32 / 255.0).clamp(0.0, 1.0);
            [level, level, level, (*a as f32 / 255.0).clamp(0.0, 1.0)]
        }
        EngineColor::Spot { tint, a, .. } => [
            (*tint as f32 / 255.0).clamp(0.0, 1.0),
            0.0,
            0.0,
            (*a as f32 / 255.0).clamp(0.0, 1.0),
        ],
    }
}

fn is_rgb(color: &EngineColor) -> bool {
    matches!(color, EngineColor::Rgb { .. })
}

/// Whether a stacked fill is painted. The flag lives on each variant rather
/// than on the enum, so this is the one place that knows the mapping.
fn fill_visible(fill: &varve_core::FillIR) -> bool {
    match fill {
        varve_core::FillIR::Solid { visible, .. }
        | varve_core::FillIR::Gradient { visible, .. }
        | varve_core::FillIR::Image { visible, .. }
        | varve_core::FillIR::Pattern { visible, .. } => *visible,
    }
}

/// 2x3 affine helpers. `[a, b, c, d, e, f]` maps `(x, y)` to
/// `(a x + c y + e, b x + d y + f)` — the same coefficient order as the TS
/// `Affine` and `DOMMatrix` construction in the replay.
pub type Affine = [f64; 6];

pub fn multiply(left: Affine, right: Affine) -> Affine {
    [
        left[0] * right[0] + left[2] * right[1],
        left[1] * right[0] + left[3] * right[1],
        left[0] * right[2] + left[2] * right[3],
        left[1] * right[2] + left[3] * right[3],
        left[0] * right[4] + left[2] * right[5] + left[4],
        left[1] * right[4] + left[3] * right[5] + left[5],
    ]
}

pub fn apply(transform: Affine, point: [f64; 2]) -> [f64; 2] {
    [
        transform[0] * point[0] + transform[2] * point[1] + transform[4],
        transform[1] * point[0] + transform[3] * point[1] + transform[5],
    ]
}

/// Longest column of the 2x2 linear part: the local-units-per-device-pixel
/// scale used to size the antialiasing margin and to bound the flattening
/// tolerance. Non-uniform scale and skew are covered by taking the maximum.
pub fn max_scale(transform: Affine) -> f64 {
    let sx = (transform[0] * transform[0] + transform[1] * transform[1]).sqrt();
    let sy = (transform[2] * transform[2] + transform[3] * transform[3]).sqrt();
    sx.max(sy)
}

fn affine_is_finite(transform: Affine) -> bool {
    transform.iter().all(|v| v.is_finite())
}

fn finite(value: f64) -> bool {
    value.is_finite()
}

/// Parse `cornerRadius`, which the IR carries as an untyped JSON value: a
/// single number or a four-element array in top-left/top-right/bottom-right/
/// bottom-left order.
pub fn parse_corner_radii(value: Option<&serde_json::Value>) -> [f64; 4] {
    match value {
        Some(serde_json::Value::Number(n)) => {
            let v = n.as_f64().unwrap_or(0.0);
            [v, v, v, v]
        }
        Some(serde_json::Value::Array(items)) => {
            let mut out = [0.0; 4];
            for (index, slot) in out.iter_mut().enumerate() {
                *slot = items.get(index).and_then(|v| v.as_f64()).unwrap_or(0.0);
            }
            out
        }
        _ => [0.0; 4],
    }
}

/// Flatten one cubic segment with a bounded, tolerance-driven step count.
///
/// The step count is derived from the control polygon length against the
/// caller's flattening tolerance, clamped to `[1, 64]`. Varve's IR carries a
/// per-primitive `tolerance`, which is what the Canvas2D replay hands to the
/// path tracer, so this uses the same input rather than a fixed constant.
fn flatten_cubic(
    p0: [f64; 2],
    p1: [f64; 2],
    p2: [f64; 2],
    p3: [f64; 2],
    tolerance: f64,
    max_vertices: usize,
    out: &mut Vec<[f64; 2]>,
) -> bool {
    let chord = ((p3[0] - p0[0]).powi(2) + (p3[1] - p0[1]).powi(2)).sqrt();
    let hull = ((p1[0] - p0[0]).powi(2) + (p1[1] - p0[1]).powi(2)).sqrt()
        + ((p2[0] - p1[0]).powi(2) + (p2[1] - p1[1]).powi(2)).sqrt()
        + ((p3[0] - p2[0]).powi(2) + (p3[1] - p2[1]).powi(2)).sqrt();
    // Standard bound: error <= (hull - chord) / 4 for a cubic.
    let error = ((hull - chord) / 4.0).max(0.0);
    let tolerance = if tolerance.is_finite() && tolerance > 0.0 {
        tolerance
    } else {
        0.25
    };
    let steps = if error <= tolerance {
        1
    } else {
        let ratio = error / tolerance;
        // steps ∝ sqrt(1/tolerance) for a cubic; 4 = 2^2.
        (ratio.sqrt().ceil() as usize)
            .saturating_mul(4)
            .clamp(1, 64)
    };
    if steps > max_vertices.saturating_sub(out.len()) {
        return false;
    }

    for step in 1..=steps {
        let t = step as f64 / steps as f64;
        let mt = 1.0 - t;
        let a = mt * mt * mt;
        let b = 3.0 * mt * mt * t;
        let c = 3.0 * mt * t * t;
        let d = t * t * t;
        out.push([
            a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
            a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
        ]);
    }
    true
}

/// Flatten a Varve contour to a polyline.
///
/// Handle semantics are the ones `replay.ts` uses: `handleIn`/`handleOut` are
/// **relative offsets** from the point, and the segment from `a` to `b` is the
/// cubic `a, a + a.handleOut, b + b.handleIn, b`.
pub fn flatten_contour(points: &[PathPoint], closed: bool, tolerance: f64) -> Vec<[f64; 2]> {
    flatten_contour_with_budget(points, closed, tolerance, MAX_PLAN_VERTICES).unwrap_or_default()
}

pub(super) fn flatten_contour_with_budget(
    points: &[PathPoint],
    closed: bool,
    tolerance: f64,
    max_vertices: usize,
) -> Option<Vec<[f64; 2]>> {
    if points.is_empty() {
        return Some(Vec::new());
    }
    if max_vertices == 0 {
        return None;
    }
    let mut out: Vec<[f64; 2]> = Vec::with_capacity(points.len().min(max_vertices));
    out.push([points[0].x, points[0].y]);

    let last = if closed {
        points.len()
    } else {
        points.len().saturating_sub(1)
    };
    for index in 0..last {
        let a = &points[index];
        let b = &points[(index + 1) % points.len()];
        let control_a = match a.handle_out {
            Some([hx, hy]) => [a.x + hx, a.y + hy],
            None => [a.x, a.y],
        };
        let control_b = match b.handle_in {
            Some([hx, hy]) => [b.x + hx, b.y + hy],
            None => [b.x, b.y],
        };
        let straight = control_a == [a.x, a.y] && control_b == [b.x, b.y];
        if straight {
            if out.len() == max_vertices {
                return None;
            }
            out.push([b.x, b.y]);
        } else {
            if !flatten_cubic(
                [a.x, a.y],
                control_a,
                control_b,
                [b.x, b.y],
                tolerance,
                max_vertices,
                &mut out,
            ) {
                return None;
            }
        }
    }

    // A closed contour walks its closing segment, which re-emits the start
    // point. The stencil fan closes implicitly, so a duplicate vertex would
    // only add a degenerate triangle; drop it.
    if closed && out.len() > 1 && out.last() == out.first() {
        out.pop();
    }
    Some(out)
}

/// Reply from `lower_item`: either a drawable description or the reason the
/// item stays on the authoritative replay.
enum Lowered {
    Shape(ShapeRecord, Affine),
    Fill {
        contours: Vec<Vec<[f64; 2]>>,
        even_odd: bool,
        color: [f32; 4],
    },
}

fn reject_reason(item: &RenderItem) -> Option<RejectReason> {
    if !item.effects.is_empty() {
        return Some(RejectReason::UnsupportedEffects);
    }
    if item.filters.as_ref().is_some_and(|f| !f.is_empty()) {
        return Some(RejectReason::UnsupportedEffects);
    }
    if !matches!(item.blend_mode, varve_core::BlendMode::Normal) {
        return Some(RejectReason::UnsupportedBlend);
    }
    if item.strokes.iter().any(|stroke| stroke.visible) {
        // Lines and arrows carry a default stroke even with an empty list, so
        // they reject below rather than here.
        return Some(RejectReason::UnsupportedStroke);
    }
    // Exactly one visible solid fill, or the legacy singular `fill`.
    let visible: Vec<&varve_core::FillIR> = item
        .fills
        .as_ref()
        .map(|fills| fills.iter().filter(|fill| fill_visible(fill)).collect())
        .unwrap_or_default();
    if visible.len() > 1 {
        return Some(RejectReason::UnsupportedPaint);
    }
    if let Some(fill) = visible.first() {
        match fill {
            varve_core::FillIR::Solid {
                color,
                blend_mode,
                opacity,
                ..
            } => {
                if !matches!(blend_mode, varve_core::BlendMode::Normal) {
                    return Some(RejectReason::UnsupportedBlend);
                }
                if !opacity.is_finite() {
                    return Some(RejectReason::UnsupportedPaint);
                }
                if !is_rgb(color) {
                    return Some(RejectReason::UnsupportedPaint);
                }
            }
            _ => return Some(RejectReason::UnsupportedPaint),
        }
    } else if !is_rgb(&item.fill) {
        return Some(RejectReason::UnsupportedPaint);
    }
    None
}

/// Effective straight-alpha colour and opacity for an item, or the reason the
/// paint is outside the admitted set.
fn resolve_solid(item: &RenderItem) -> Result<[f32; 4], RejectReason> {
    let item_opacity = if item.opacity.is_finite() {
        item.opacity.clamp(0.0, 1.0) as f32
    } else {
        return Err(RejectReason::UnsupportedPaint);
    };
    let visible = item
        .fills
        .as_ref()
        .and_then(|fills| fills.iter().find(|fill| fill_visible(fill)));
    let (color, fill_opacity) = match visible {
        Some(varve_core::FillIR::Solid { color, opacity, .. }) => (color.clone(), *opacity),
        Some(_) => return Err(RejectReason::UnsupportedPaint),
        None => (item.fill.clone(), 1.0),
    };
    let mut rgba = color_to_rgba(&color);
    // Mirrors replay.ts: globalAlpha = itemAlpha * fill.opacity.
    rgba[3] *= fill_opacity.clamp(0.0, 1.0) as f32 * item_opacity;
    Ok(rgba)
}

fn lower_item(item: &RenderItem, max_vertices: usize) -> Result<Lowered, RejectReason> {
    if let Some(reason) = reject_reason(item) {
        return Err(reason);
    }
    let color = resolve_solid(item)?;
    if color[3] <= 0.0 {
        return Err(RejectReason::EmptyGeometry);
    }

    match &item.primitive {
        Primitive::Rect {
            x,
            y,
            w,
            h,
            corner_radius,
        } => {
            if !(finite(*x) && finite(*y) && finite(*w) && finite(*h)) || *w <= 0.0 || *h <= 0.0 {
                return Err(RejectReason::EmptyGeometry);
            }
            let radii = parse_corner_radii(corner_radius.as_ref());
            if radii.iter().any(|r| !finite(*r) || *r < 0.0) {
                return Err(RejectReason::EmptyGeometry);
            }
            let limit = 0.5 * w.min(*h);
            let mut four = [0.0_f32; 4];
            for (slot, value) in four.iter_mut().zip(radii.iter()) {
                *slot = (*value).min(limit) as f32;
            }
            Ok(Lowered::Shape(
                ShapeRecord {
                    mv: [0.0; 4],
                    mv2: [0.0; 4],
                    quad: [0.0; 4],
                    shape: [KIND_RECT, 0, 1, 0],
                    p0: [*x as f32, *y as f32, *w as f32, *h as f32],
                    p1: [0.0; 4],
                    radii: four,
                    color,
                },
                [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            ))
        }
        Primitive::Ellipse { cx, cy, rx, ry } => {
            if !(finite(*cx) && finite(*cy) && finite(*rx) && finite(*ry))
                || *rx <= 0.0
                || *ry <= 0.0
            {
                return Err(RejectReason::EmptyGeometry);
            }
            Ok(Lowered::Shape(
                ShapeRecord {
                    mv: [0.0; 4],
                    mv2: [0.0; 4],
                    quad: [0.0; 4],
                    shape: [KIND_ELLIPSE, 0, 1, 0],
                    p0: [*cx as f32, *cy as f32, *rx as f32, *ry as f32],
                    p1: [0.0; 4],
                    radii: [0.0; 4],
                    color,
                },
                [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            ))
        }
        Primitive::Circle { cx, cy, r } => {
            if !(finite(*cx) && finite(*cy) && finite(*r)) || *r <= 0.0 {
                return Err(RejectReason::EmptyGeometry);
            }
            Ok(Lowered::Shape(
                ShapeRecord {
                    mv: [0.0; 4],
                    mv2: [0.0; 4],
                    quad: [0.0; 4],
                    shape: [KIND_ELLIPSE, 0, 1, 0],
                    p0: [*cx as f32, *cy as f32, *r as f32, *r as f32],
                    p1: [0.0; 4],
                    radii: [0.0; 4],
                    color,
                },
                [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            ))
        }
        Primitive::Polygon {
            cx,
            cy,
            radius,
            sides,
            rotation,
        } => {
            if !(finite(*cx) && finite(*cy) && finite(*radius) && finite(*rotation))
                || *radius <= 0.0
                || *sides < 3
            {
                return Err(RejectReason::EmptyGeometry);
            }
            if *sides > MAX_SHAPE_VERTICES {
                return Err(RejectReason::TooManyVertices);
            }
            Ok(Lowered::Shape(
                ShapeRecord {
                    mv: [0.0; 4],
                    mv2: [0.0; 4],
                    quad: [0.0; 4],
                    // A regular polygon is convex by construction.
                    shape: [KIND_REGULAR, *sides, 1, 0],
                    p0: [*cx as f32, *cy as f32, *radius as f32, *rotation as f32],
                    p1: [0.0; 4],
                    radii: [0.0; 4],
                    color,
                },
                [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            ))
        }
        Primitive::Star {
            cx,
            cy,
            inner_radius,
            outer_radius,
            points,
            rotation,
        } => {
            if !(finite(*cx)
                && finite(*cy)
                && finite(*inner_radius)
                && finite(*outer_radius)
                && finite(*rotation))
                || *outer_radius <= 0.0
                || *inner_radius < 0.0
                || *points < 3
            {
                return Err(RejectReason::EmptyGeometry);
            }
            if points.saturating_mul(2) > MAX_SHAPE_VERTICES {
                return Err(RejectReason::TooManyVertices);
            }
            Ok(Lowered::Shape(
                ShapeRecord {
                    mv: [0.0; 4],
                    mv2: [0.0; 4],
                    quad: [0.0; 4],
                    // Alternating outer/inner ring, non-convex in general.
                    shape: [KIND_STAR, *points, 0, 0],
                    p0: [
                        *cx as f32,
                        *cy as f32,
                        *outer_radius as f32,
                        *rotation as f32,
                    ],
                    p1: [*inner_radius as f32, 0.0, 0.0, 0.0],
                    radii: [0.0; 4],
                    color,
                },
                [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            ))
        }
        Primitive::Path {
            points,
            // The authored `closed` flag does not reach a fill: every fill
            // ring closes (see the loop below), matching `paintPathFill`.
            closed: _,
            tolerance,
            contours,
            holes,
            fill_rule,
            ..
        } => {
            // Ring resolution mirrors `pathRings` in the TS replay: authored
            // `contours` supersede `points` + `holes` when non-empty.
            let rings = compound_path_rings(points, contours, holes);
            if rings.is_empty() {
                return Err(RejectReason::EmptyGeometry);
            }
            let mut flattened_rings = Vec::with_capacity(rings.len());
            let mut remaining_vertices = max_vertices;
            for ring in rings.iter() {
                // A fill closes every ring, and the replay's closing segment
                // is a bezier through the end handles (strokeReplay's
                // tracePathSegment with closed=true), so the flattened ring
                // must include the last->first closing curve, never a straight
                // chord stand-in.
                let Some(flattened) =
                    flatten_contour_with_budget(ring, true, *tolerance, remaining_vertices)
                else {
                    return Err(RejectReason::OutOfBudget);
                };
                remaining_vertices = remaining_vertices.saturating_sub(flattened.len());
                if flattened.len() >= 3 {
                    flattened_rings.push(flattened);
                }
            }
            if flattened_rings.is_empty() {
                return Err(RejectReason::EmptyGeometry);
            }
            let even_odd =
                compound_path_fill_rule(fill_rule.as_deref(), contours.len(), holes.len())
                    == PathFillRule::EvenOdd;
            Ok(Lowered::Fill {
                contours: flattened_rings,
                even_odd,
                color,
            })
        }
        // `line`/`arrow` render through a default stroke in the replay, so
        // treating them as unsupported *paint* would mislead; the stroke path
        // is the missing piece.
        Primitive::Line { .. } | Primitive::Arrow { .. } => Err(RejectReason::UnsupportedStroke),
        _ => Err(RejectReason::UnsupportedPrimitive),
    }
}

fn bounds_of(points: &[[f64; 2]]) -> Option<[f64; 4]> {
    if points.is_empty() {
        return None;
    }
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for point in points {
        min_x = min_x.min(point[0]);
        min_y = min_y.min(point[1]);
        max_x = max_x.max(point[0]);
        max_y = max_y.max(point[1]);
    }
    if !(min_x.is_finite() && min_y.is_finite() && max_x.is_finite() && max_y.is_finite()) {
        return None;
    }
    Some([min_x, min_y, max_x - min_x, max_y - min_y])
}

fn push_solid_vertex(out: &mut Vec<SolidVertex>, clip: [f64; 2], color: [f32; 4]) {
    out.push(SolidVertex {
        position: [clip[0] as f32, clip[1] as f32],
        color,
    });
}

/// Lower a full frame in paint order.
///
/// `view` is the camera transform already multiplied by the display scale, in
/// the same coefficient order as `Affine`. Nothing here mutates the document,
/// the IR, or any cache: the plan is a pure function of its inputs.
pub fn lower_frame(items: &[RenderItem], view: Affine) -> NativePlan {
    let mut plan = NativePlan {
        shapes: Vec::new(),
        vertices: Vec::new(),
        indices: Vec::new(),
        ops: Vec::new(),
        report: AdmissionReport::default(),
    };

    if !affine_is_finite(view) {
        plan.report.considered = items.len();
        plan.report.rejected = items.len();
        plan.report.reasons.insert(
            RejectReason::NonFiniteTransform.key().to_string(),
            items.len(),
        );
        return plan;
    }

    let mut run_start: Option<u32> = None;
    let mut run_len: u32 = 0;

    let flush_run = |plan: &mut NativePlan, start: &mut Option<u32>, len: &mut u32| {
        if let Some(first) = start.take() {
            if *len > 0 {
                plan.ops.push(DrawOp::Shapes {
                    first_instance: first,
                    instance_count: *len,
                });
            }
        }
        *len = 0;
    };

    for item in items {
        plan.report.considered += 1;
        if plan.report.considered > MAX_PLAN_ITEMS || plan.vertices.len() > MAX_PLAN_VERTICES {
            plan.report.rejected += 1;
            *plan
                .report
                .reasons
                .entry(RejectReason::OutOfBudget.key().to_string())
                .or_insert(0) += 1;
            continue;
        }
        if !affine_is_finite(item.transform) {
            plan.report.rejected += 1;
            *plan
                .report
                .reasons
                .entry(RejectReason::NonFiniteTransform.key().to_string())
                .or_insert(0) += 1;
            continue;
        }

        let remaining_vertices = MAX_PLAN_VERTICES.saturating_sub(plan.vertices.len());
        match lower_item(item, remaining_vertices) {
            Ok(Lowered::Shape(mut record, local)) => {
                let combined = multiply(view, multiply(item.transform, local));
                let scale = max_scale(combined);
                if !(scale.is_finite() && scale > 0.0) {
                    plan.report.rejected += 1;
                    *plan
                        .report
                        .reasons
                        .entry(RejectReason::NonFiniteTransform.key().to_string())
                        .or_insert(0) += 1;
                    continue;
                }

                // Bounds follow the primitive family. Ring shapes bound by
                // their circumscribed square; rect/ellipse by their extents.
                let (bounds, _) = match record.shape[0] {
                    KIND_RECT => ([record.p0[0], record.p0[1], record.p0[2], record.p0[3]], ()),
                    KIND_ELLIPSE => (
                        [
                            record.p0[0] - record.p0[2],
                            record.p0[1] - record.p0[3],
                            record.p0[2] * 2.0,
                            record.p0[3] * 2.0,
                        ],
                        (),
                    ),
                    _ => (
                        [
                            record.p0[0] - record.p0[2],
                            record.p0[1] - record.p0[2],
                            record.p0[2] * 2.0,
                            record.p0[2] * 2.0,
                        ],
                        (),
                    ),
                };
                if !(bounds[2] > 0.0 && bounds[3] > 0.0) {
                    plan.report.rejected += 1;
                    *plan
                        .report
                        .reasons
                        .entry(RejectReason::EmptyGeometry.key().to_string())
                        .or_insert(0) += 1;
                    continue;
                }

                // Halt-and-catch-fire guard: an item far larger than the frame
                // would tessellate the whole viewport per instance. The
                // analytic stage is cheap, but the quad is per-instance
                // geometry, so bound the *local* extent by the frame diagonal
                // measured in local units.
                let margin = (1.5 / scale) as f32;
                record.mv = [
                    combined[0] as f32,
                    combined[1] as f32,
                    combined[2] as f32,
                    combined[3] as f32,
                ];
                record.mv2 = [combined[4] as f32, combined[5] as f32, 0.0, 0.0];
                record.quad = [
                    bounds[0] - margin,
                    bounds[1] - margin,
                    bounds[2] + margin * 2.0,
                    bounds[3] + margin * 2.0,
                ];

                if run_start.is_none() {
                    run_start = Some(plan.shapes.len() as u32);
                }
                run_len += 1;
                plan.shapes.push(record);
                plan.report.admitted += 1;
            }
            Ok(Lowered::Fill {
                contours,
                even_odd,
                color,
            }) => {
                flush_run(&mut plan, &mut run_start, &mut run_len);

                // Clip-space fan, one contour at a time. For a closed contour
                // the signed fan {v0, vi, vi+1} sums to the winding number for
                // every sample, so non-zero fill is exact for concave and
                // self-intersecting contours without any triangulator.
                let fan_index_start = plan.indices.len() as u32;
                let mut bounds = [
                    f64::INFINITY,
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                    f64::NEG_INFINITY,
                ];
                let mut emitted_any = false;

                for contour in &contours {
                    let Some(local_bounds) = bounds_of(contour) else {
                        continue;
                    };
                    bounds[0] = bounds[0].min(local_bounds[0]);
                    bounds[1] = bounds[1].min(local_bounds[1]);
                    bounds[2] = bounds[2].max(local_bounds[0] + local_bounds[2]);
                    bounds[3] = bounds[3].max(local_bounds[1] + local_bounds[3]);

                    let combined = multiply(view, item.transform);
                    let base = plan.vertices.len() as u32;
                    for point in contour {
                        push_solid_vertex(&mut plan.vertices, apply(combined, *point), color);
                    }
                    let count = contour.len() as u32;
                    for index in 1..count.saturating_sub(1) {
                        plan.indices.push(base);
                        plan.indices.push(base + index);
                        plan.indices.push(base + index + 1);
                    }
                    emitted_any = true;
                }

                let has_area = bounds[2] > bounds[0] && bounds[3] > bounds[1];
                if !emitted_any || !has_area {
                    plan.report.rejected += 1;
                    *plan
                        .report
                        .reasons
                        .entry(RejectReason::EmptyGeometry.key().to_string())
                        .or_insert(0) += 1;
                    continue;
                }

                let fan_index_count = plan.indices.len() as u32 - fan_index_start;

                // Cover quad: the path's local bounding box in clip space, as
                // two triangles so no index buffer growth is needed beyond the
                // existing pattern.
                let combined = multiply(view, item.transform);
                let corners = [
                    [bounds[0], bounds[1]],
                    [bounds[2], bounds[1]],
                    [bounds[0], bounds[3]],
                    [bounds[2], bounds[3]],
                ];
                // The cover draw addresses the *index buffer*, not the vertex
                // buffer, so the offset must be taken before the cover indices
                // are appended. Using the vertex base here happens to work only
                // while the fan emits exactly one index per vertex, which is
                // true for a triangle and false for every larger contour.
                let cover_vertex_base = plan.vertices.len() as u32;
                for corner in corners {
                    push_solid_vertex(&mut plan.vertices, apply(combined, corner), color);
                }
                let cover_index_start = plan.indices.len() as u32;
                plan.indices.extend_from_slice(&[
                    cover_vertex_base,
                    cover_vertex_base + 1,
                    cover_vertex_base + 2,
                    cover_vertex_base + 2,
                    cover_vertex_base + 1,
                    cover_vertex_base + 3,
                ]);

                plan.ops.push(DrawOp::Fill {
                    fan_index_start,
                    fan_index_count,
                    cover_index_start,
                    cover_index_count: 6,
                    even_odd,
                });
                plan.report.admitted += 1;
            }
            Err(reason) => {
                plan.report.rejected += 1;
                *plan
                    .report
                    .reasons
                    .entry(reason.key().to_string())
                    .or_insert(0) += 1;
            }
        }
    }

    flush_run(&mut plan, &mut run_start, &mut run_len);
    plan
}

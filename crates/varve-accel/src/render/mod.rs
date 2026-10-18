//! Native GPU rasterization of the Varve render IR.
//!
//! This module is the native *scene rasterization* stage. It is deliberately
//! narrower than "native presentation": the pixels it produces reach the window
//! through the existing Canvas2D present surface, and every reason it declines
//! a frame is reported rather than papered over. See ADR-0244 and
//! `docs/architecture/native-render-stage.md`.
//!
//! The contract with the rest of Varve is narrow on purpose:
//!
//! * Input is the **same** `varve_engine::RenderItem` list the webview replay
//!   consumes. There is no second scene model and no second document.
//! * Output is pixels plus an `AdmissionReport`. A plan that admits every item
//!   is defined to match the Canvas2D replay for those items; a plan that does
//!   not is not presentable, and the caller keeps the authoritative replay.
//! * Nothing here mutates the document, history, selection, or any cache the
//!   editor owns. Renderer state is derived state with an explicit generation.

pub mod gpu;
pub mod plan;

pub use gpu::{
    FailureStage, NativeRaster, RasterizedFrame, RenderError, RenderHealth, FRAME_READBACK_TIMEOUT,
    MAX_CONSECUTIVE_RENDER_FAILURES, TARGET_FORMAT,
};
pub use plan::{
    lower_frame, AdmissionReport, NativePlan, RejectReason, MAX_PLAN_ITEMS, MAX_SHAPE_VERTICES,
};

use varve_engine::RenderItem;

/// The complete native raster surface: lowering plus device submission plus the
/// bounded health policy that decides whether to keep trying.
///
/// One instance owns one device. It is created lazily, replaced only after a
/// genuine device loss, and never silently downgraded: when health pauses the
/// stage, `health().paused_reason` says why and `retry()` is the explicit
/// recovery.
pub struct NativeRenderStage {
    raster: NativeRaster,
    health: RenderHealth,
}

impl NativeRenderStage {
    /// Create the stage, or report precisely why no hardware device is usable.
    pub fn create(preferred_device_id: Option<&str>) -> Result<Self, crate::discovery::AccelError> {
        Self::create_with_sample_count(preferred_device_id, None)
    }

    /// Create the stage with a forced MSAA sample count (ADR-0244 open item
    /// 5); an unsupported count on this adapter is a named error.
    pub fn create_with_sample_count(
        preferred_device_id: Option<&str>,
        forced_sample_count: Option<u32>,
    ) -> Result<Self, crate::discovery::AccelError> {
        Ok(Self {
            raster: NativeRaster::create_with_sample_count(
                preferred_device_id,
                forced_sample_count,
            )?,
            health: RenderHealth::default(),
        })
    }

    pub fn health(&self) -> &RenderHealth {
        &self.health
    }

    pub fn device_name(&self) -> &str {
        self.raster.device_name()
    }

    pub fn backend(&self) -> String {
        self.raster.backend()
    }

    pub fn sample_count(&self) -> u32 {
        self.raster.sample_count()
    }

    pub fn stencil_format(&self) -> wgpu::TextureFormat {
        self.raster.stencil_format()
    }

    pub fn driver(&self) -> Option<String> {
        self.raster.driver()
    }

    pub fn device_is_lost(&self) -> bool {
        self.raster.device_is_lost()
    }

    /// Clear a pause so the next frame tries the device again. This is the
    /// explicit retry action; it deliberately does not clear loss, because a
    /// lost device is never resurrected.
    pub fn retry(&mut self) {
        self.health.reset();
    }

    /// Record the outcome of an attempt made through this stage.
    ///
    /// Exposed because callers that lower and rasterize separately (the desktop
    /// command layer does, so it can report the admission verdict before paying
    /// for a submission) still need the bounded health policy applied exactly
    /// once per attempt.
    pub fn record_health<T>(&mut self, result: &Result<T, RenderError>) {
        self.health.record(result);
    }

    /// Lower the IR and, if the whole frame is admitted, rasterize it.
    ///
    /// `view` is the camera transform premultiplied by the display scale, in
    /// the coefficient order `[a, b, c, d, e, f]`.
    pub fn render(
        &mut self,
        items: &[RenderItem],
        view: [f64; 6],
        width: u32,
        height: u32,
    ) -> Result<RasterizedFrame, RenderError> {
        let lowered = lower_frame(items, view);
        let outcome = if !lowered.is_presentable() {
            Err(RenderError::Unsupported(lowered.report.summary()))
        } else {
            self.raster.rasterize(&lowered, width, height)
        };
        // Health is recorded for every attempt, including content refusals:
        // three consecutive refusals mean the stage stops offering itself
        // rather than re-lowering a document it cannot draw on every frame.
        self.health.record(&outcome);
        outcome
    }

    /// Lower without touching the device. Used by the diagnostics path and by
    /// callers that need the coverage verdict before paying for a submission.
    pub fn plan(&self, items: &[RenderItem], view: [f64; 6]) -> NativePlan {
        lower_frame(items, view)
    }
}

/// Report shape shared with the desktop command layer.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRasterDiagnostics {
    pub available: bool,
    pub device_name: String,
    pub backend: String,
    pub driver: Option<String>,
    pub sample_count: u32,
    pub stencil_format: String,
    pub health: RenderHealth,
    pub last_report: Option<AdmissionReport>,
    pub last_error: Option<String>,
    pub last_error_stage: Option<FailureStage>,
    pub last_draw_calls: u32,
    pub last_build_ms: f64,
    pub last_encode_ms: f64,
    pub last_readback_ms: f64,
}

impl NativeRasterDiagnostics {
    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            available: false,
            device_name: String::new(),
            backend: String::new(),
            driver: None,
            sample_count: 0,
            stencil_format: String::new(),
            health: RenderHealth::default(),
            last_report: None,
            last_error: Some(reason.into()),
            last_error_stage: None,
            last_draw_calls: 0,
            last_build_ms: 0.0,
            last_encode_ms: 0.0,
            last_readback_ms: 0.0,
        }
    }
}

/// Convenience wrapper used by the desktop command layer to keep the last
/// diagnostics without threading a report through every call.
#[derive(Debug, Default)]
pub struct RasterMetrics {
    pub last_report: Option<AdmissionReport>,
    pub last_draw_calls: u32,
    pub last_build_ms: f64,
    pub last_encode_ms: f64,
    pub last_readback_ms: f64,
}

impl RasterMetrics {
    pub fn record_plan(&mut self, report: &AdmissionReport) {
        self.last_report = Some(report.clone());
    }

    pub fn record_frame(&mut self, frame: &RasterizedFrame) {
        self.last_draw_calls = frame.draw_calls;
        self.last_build_ms = frame.build_ms;
        self.last_encode_ms = frame.encode_ms;
        self.last_readback_ms = frame.readback_ms;
    }
}

/// Re-exported so the desktop crate can name the health report without
/// depending on `gpu` directly.
pub type RasterHealthReport = RenderHealth;

#[cfg(test)]
mod tests {
    use super::plan::*;
    use super::*;
    use varve_core::{EngineColor, FillIR, PathPoint};
    use varve_engine::Primitive;

    fn rgb(r: f64, g: f64, b: f64, a: f64) -> EngineColor {
        EngineColor::Rgb {
            r,
            g,
            b,
            a,
            bit_depth: None,
            profile: None,
        }
    }

    fn identity() -> [f64; 6] {
        [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
    }

    fn solid_item(primitive: Primitive) -> RenderItem {
        RenderItem {
            transform: identity(),
            fill: rgb(10.0, 20.0, 30.0, 255.0),
            primitive,
            opacity: 1.0,
            blend_mode: varve_core::BlendMode::Normal,
            strokes: Vec::new(),
            effects: Vec::new(),
            fills: None,
            filters: None,
        }
    }

    fn rect_item(x: f64, y: f64, w: f64, h: f64) -> RenderItem {
        solid_item(Primitive::Rect {
            x,
            y,
            w,
            h,
            corner_radius: None,
        })
    }

    fn path_points(points: &[(f64, f64)]) -> Vec<PathPoint> {
        points
            .iter()
            .map(|(x, y)| PathPoint {
                x: *x,
                y: *y,
                handle_in: None,
                handle_out: None,
                mode: None,
            })
            .collect()
    }

    #[test]
    fn record_strides_match_the_shader_contract() {
        // The storage layout is asserted here rather than at runtime because a
        // mismatch would silently mis-read every instance.
        assert_eq!(SHAPE_RECORD_BYTES, 128);
        assert_eq!(std::mem::size_of::<ShapeRecord>(), 128);
        assert_eq!(SOLID_VERTEX_BYTES, 24);
        assert_eq!(std::mem::size_of::<SolidVertex>(), 24);
    }

    #[test]
    fn a_plain_rect_is_admitted_completely() {
        let plan = lower_frame(&[rect_item(0.0, 0.0, 10.0, 20.0)], identity());
        assert!(plan.report.complete(), "{}", plan.report.summary());
        assert_eq!(plan.report.admitted, 1);
        assert_eq!(plan.ops.len(), 1);
        assert_eq!(plan.shapes.len(), 1);
        assert_eq!(plan.shapes[0].shape[0], KIND_RECT);
        // Local bounds plus one buffer of AA margin on every side.
        assert_eq!(plan.shapes[0].p0, [0.0, 0.0, 10.0, 20.0]);
        assert!(plan.vertices.is_empty(), "analytic shapes need no vertices");
    }

    #[test]
    fn corner_radius_accepts_a_number_and_a_four_element_array() {
        let mut item = solid_item(Primitive::Rect {
            x: 0.0,
            y: 0.0,
            w: 10.0,
            h: 10.0,
            corner_radius: Some(serde_json::json!(3)),
        });
        let plan = lower_frame(&[item.clone()], identity());
        assert_eq!(plan.shapes[0].radii, [3.0, 3.0, 3.0, 3.0]);

        if let Primitive::Rect { corner_radius, .. } = &mut item.primitive {
            *corner_radius = Some(serde_json::json!([1, 2, 3, 4]));
        }
        let plan = lower_frame(&[item], identity());
        assert_eq!(plan.shapes[0].radii, [1.0, 2.0, 3.0, 4.0]);
    }

    #[test]
    fn corner_radius_is_clamped_to_half_the_shorter_side() {
        // Canvas2D clamps overlapping radii rather than producing a
        // self-intersecting outline, so the native stage must too.
        let item = solid_item(Primitive::Rect {
            x: 0.0,
            y: 0.0,
            w: 10.0,
            h: 4.0,
            corner_radius: Some(serde_json::json!(100)),
        });
        let plan = lower_frame(&[item], identity());
        assert_eq!(plan.shapes[0].radii, [2.0, 2.0, 2.0, 2.0]);
    }

    #[test]
    fn paint_order_survives_a_mixed_frame() {
        let rect = rect_item(0.0, 0.0, 10.0, 10.0);
        let path = solid_item(Primitive::Path {
            points: path_points(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)]),
            closed: true,
            tolerance: 0.25,
            contours: Vec::new(),
            holes: Vec::new(),
            fill_rule: Some("nonzero".to_string()),
        });
        let plan = lower_frame(&[rect.clone(), path.clone(), rect], identity());
        assert!(plan.report.complete(), "{}", plan.report.summary());
        assert_eq!(
            plan.ops.len(),
            3,
            "a fill between two shape runs must split the runs, not reorder them"
        );
        assert!(matches!(plan.ops[0], DrawOp::Shapes { .. }));
        assert!(matches!(plan.ops[1], DrawOp::Fill { .. }));
        assert!(matches!(plan.ops[2], DrawOp::Shapes { .. }));
    }

    #[test]
    fn adjacent_shapes_coalesce_into_one_draw() {
        let plan = lower_frame(
            &[
                rect_item(0.0, 0.0, 1.0, 1.0),
                rect_item(2.0, 2.0, 1.0, 1.0),
                rect_item(4.0, 4.0, 1.0, 1.0),
            ],
            identity(),
        );
        assert_eq!(plan.ops.len(), 1);
        match plan.ops[0] {
            DrawOp::Shapes {
                first_instance,
                instance_count,
            } => {
                assert_eq!(first_instance, 0);
                assert_eq!(instance_count, 3);
            }
            _ => panic!("expected a coalesced shape run"),
        }
    }

    #[test]
    fn strokes_are_rejected_rather_than_dropped() {
        let mut item = rect_item(0.0, 0.0, 10.0, 10.0);
        item.strokes = vec![varve_core::Stroke::default()];
        let plan = lower_frame(&[item], identity());
        assert!(!plan.report.complete());
        assert_eq!(plan.report.admitted, 0);
        assert_eq!(
            plan.report
                .reasons
                .get(RejectReason::UnsupportedStroke.key()),
            Some(&1)
        );
    }

    #[test]
    fn text_is_rejected_with_a_named_reason() {
        let item = solid_item(Primitive::Text {
            text: "hello".to_string(),
            font_size: 14.0,
            font_family: "Inter".to_string(),
            font_weight: 400,
            font_style: "normal".to_string(),
            text_align: "left".to_string(),
            text_align_vertical: "top".to_string(),
            x: 0.0,
            y: 0.0,
            w: 100.0,
            h: 20.0,
            letter_spacing: 0.0,
            line_height: 1.4,
            paragraph_spacing: 0.0,
            text_case: "none".to_string(),
            text_decoration: "none".to_string(),
            text_overflow: "visible".to_string(),
            list_style: "none".to_string(),
            rich_text: None,
            open_type_features: None,
            variable_axes: None,
            text_mode: "point".to_string(),
            path_text_settings: None,
            path_shape: None,
        });
        let plan = lower_frame(&[item], identity());
        assert_eq!(
            plan.report
                .reasons
                .get(RejectReason::UnsupportedPrimitive.key()),
            Some(&1)
        );
    }

    #[test]
    fn gradient_and_multi_fill_paints_are_rejected() {
        let mut gradient = rect_item(0.0, 0.0, 10.0, 10.0);
        gradient.fills = Some(vec![varve_core::FillIR::Gradient {
            gradient_type: "linear".to_string(),
            stops: Vec::new(),
            rotation: 0.0,
            interpolation_space: None,
            hue_interpolation: None,
            transform: None,
            tiling_mode: None,
            opacity: 1.0,
            blend_mode: varve_core::BlendMode::Normal,
            visible: true,
        }]);
        let plan = lower_frame(&[gradient], identity());
        assert_eq!(
            plan.report
                .reasons
                .get(RejectReason::UnsupportedPaint.key()),
            Some(&1)
        );

        let mut stacked = rect_item(0.0, 0.0, 10.0, 10.0);
        let solid = || varve_core::FillIR::Solid {
            color: rgb(0.0, 0.0, 0.0, 255.0),
            opacity: 1.0,
            blend_mode: varve_core::BlendMode::Normal,
            visible: true,
        };
        stacked.fills = Some(vec![solid(), solid()]);
        let plan = lower_frame(&[stacked], identity());
        assert_eq!(
            plan.report
                .reasons
                .get(RejectReason::UnsupportedPaint.key()),
            Some(&1)
        );
    }

    #[test]
    fn an_invisible_fill_does_not_hide_the_legacy_singular_fill() {
        let mut item = rect_item(0.0, 0.0, 10.0, 10.0);
        item.fills = Some(vec![FillIR::Solid {
            color: rgb(0.0, 0.0, 0.0, 255.0),
            opacity: 1.0,
            blend_mode: varve_core::BlendMode::Normal,
            visible: false,
        }]);
        // An all-invisible stack paints nothing, matching replay.ts which skips
        // invisible fills and never falls back to the singular fill.
        let plan = lower_frame(&[item], identity());
        assert_eq!(plan.report.admitted, 1);
        assert_eq!(plan.shapes[0].color[3], 1.0, "legacy fill alpha is used");
    }

    #[test]
    fn item_and_fill_opacity_multiply_like_the_replay_does() {
        let mut item = rect_item(0.0, 0.0, 10.0, 10.0);
        item.opacity = 0.5;
        item.fills = Some(vec![FillIR::Solid {
            color: rgb(0.0, 0.0, 0.0, 128.0),
            opacity: 0.5,
            blend_mode: varve_core::BlendMode::Normal,
            visible: true,
        }]);
        let plan = lower_frame(&[item], identity());
        let expected = (128.0 / 255.0) as f32 * 0.5 * 0.5;
        assert!((plan.shapes[0].color[3] - expected).abs() < 1e-6);
    }

    #[test]
    fn blend_modes_outside_normal_are_rejected() {
        let mut item = rect_item(0.0, 0.0, 10.0, 10.0);
        item.blend_mode = varve_core::BlendMode::Multiply;
        let plan = lower_frame(&[item], identity());
        assert_eq!(
            plan.report
                .reasons
                .get(RejectReason::UnsupportedBlend.key()),
            Some(&1)
        );
    }

    #[test]
    fn polygon_and_star_carry_their_ring_parameters() {
        let polygon = solid_item(Primitive::Polygon {
            cx: 5.0,
            cy: 5.0,
            radius: 4.0,
            sides: 6,
            rotation: 0.0,
        });
        let plan = lower_frame(&[polygon], identity());
        assert_eq!(plan.shapes[0].shape[0], KIND_REGULAR);
        assert_eq!(plan.shapes[0].shape[1], 6);
        assert_eq!(plan.shapes[0].shape[2], 1, "regular polygons are convex");

        let star = solid_item(Primitive::Star {
            cx: 5.0,
            cy: 5.0,
            inner_radius: 2.0,
            outer_radius: 5.0,
            points: 5,
            rotation: 0.0,
        });
        let plan = lower_frame(&[star], identity());
        assert_eq!(plan.shapes[0].shape[0], KIND_STAR);
        assert_eq!(plan.shapes[0].shape[2], 0, "a star is not convex");
        assert_eq!(plan.shapes[0].p1[0], 2.0);
    }

    #[test]
    fn rings_beyond_the_fixed_shader_loop_are_rejected_not_truncated() {
        let polygon = solid_item(Primitive::Polygon {
            cx: 0.0,
            cy: 0.0,
            radius: 10.0,
            sides: MAX_SHAPE_VERTICES + 1,
            rotation: 0.0,
        });
        let plan = lower_frame(&[polygon], identity());
        assert_eq!(
            plan.report.reasons.get(RejectReason::TooManyVertices.key()),
            Some(&1)
        );
    }

    #[test]
    fn a_closed_path_becomes_a_fan_plus_one_cover_quad() {
        let item = solid_item(Primitive::Path {
            points: path_points(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]),
            closed: true,
            tolerance: 0.25,
            contours: Vec::new(),
            holes: Vec::new(),
            fill_rule: Some("nonzero".to_string()),
        });
        let plan = lower_frame(&[item], identity());
        assert!(plan.report.complete(), "{}", plan.report.summary());
        match plan.ops[0] {
            DrawOp::Fill {
                fan_index_count,
                cover_index_start,
                cover_index_count,
                even_odd,
                ..
            } => {
                // Four vertices -> two fan triangles -> six indices.
                assert_eq!(fan_index_count, 6);
                assert_eq!(cover_index_count, 6);
                assert!(!even_odd);
                // Regression: the cover offset addresses the INDEX buffer, not
                // the vertex buffer. When it was taken from the vertex count it
                // happened to be correct for a triangle and wrong for every
                // larger contour, which silently painted only the last fan
                // triangle of a quad.
                assert_eq!(
                    cover_index_start, fan_index_count,
                    "the cover quad must start where the fan's indices end"
                );
                let cover = &plan.indices
                    [cover_index_start as usize..(cover_index_start + cover_index_count) as usize];
                let fan_vertices = plan.vertices.len() as u32 - 4;
                for index in cover {
                    assert!(
                        *index >= fan_vertices && *index < fan_vertices + 4,
                        "cover index {index} must address a cover vertex"
                    );
                }
            }
            _ => panic!("expected a fill op"),
        }
        // 4 fan vertices + 4 cover vertices.
        assert_eq!(plan.vertices.len(), 8);
        assert_eq!(plan.indices.len(), 12);
    }

    #[test]
    fn even_odd_paths_are_flagged_for_the_invert_pipeline() {
        let item = solid_item(Primitive::Path {
            points: path_points(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)]),
            closed: true,
            tolerance: 0.25,
            contours: Vec::new(),
            holes: Vec::new(),
            fill_rule: Some("evenodd".to_string()),
        });
        let plan = lower_frame(&[item], identity());
        match plan.ops[0] {
            DrawOp::Fill { even_odd, .. } => assert!(even_odd),
            _ => panic!("expected a fill op"),
        }
    }

    #[test]
    fn holes_contribute_to_the_fan() {
        let item = solid_item(Primitive::Path {
            points: path_points(&[(0.0, 0.0), (20.0, 0.0), (20.0, 20.0), (0.0, 20.0)]),
            closed: true,
            tolerance: 0.25,
            contours: Vec::new(),
            holes: vec![path_points(&[
                (5.0, 5.0),
                (15.0, 5.0),
                (15.0, 15.0),
                (5.0, 15.0),
            ])],
            fill_rule: Some("nonzero".to_string()),
        });
        let plan = lower_frame(&[item], identity());
        // Two contours x (4 vertices, 6 indices) + one cover quad.
        assert_eq!(plan.vertices.len(), 12);
        match plan.ops[0] {
            DrawOp::Fill {
                fan_index_count,
                cover_index_count,
                ..
            } => {
                assert_eq!(fan_index_count, 12);
                assert_eq!(cover_index_count, 6);
            }
            _ => panic!("expected a fill op"),
        }
    }

    #[test]
    fn contours_supersede_points_and_holes_like_the_replay_resolves_them() {
        // A boolean-result shape: `points` is empty and the rings live in
        // `contours`. Before the contours contract this frame was refused as
        // empty geometry; the replay rendered it fine.
        let item = solid_item(Primitive::Path {
            points: Vec::new(),
            closed: true,
            tolerance: 0.25,
            contours: vec![
                path_points(&[(0.0, 0.0), (40.0, 0.0), (40.0, 40.0), (0.0, 40.0)]),
                path_points(&[(10.0, 10.0), (30.0, 10.0), (30.0, 30.0), (10.0, 30.0)]),
            ],
            holes: Vec::new(),
            fill_rule: None,
        });
        let plan = lower_frame(&[item], identity());
        assert!(plan.report.complete(), "{}", plan.report.summary());
        // Two rings x (4 vertices, 6 indices) + one cover quad.
        assert_eq!(plan.vertices.len(), 12);
        match plan.ops[0] {
            DrawOp::Fill { even_odd, .. } => {
                // No explicit rule; two contours derive even-odd exactly like
                // `pathFillRule` in the replay.
                assert!(even_odd);
            }
            _ => panic!("expected a fill op"),
        }
    }

    #[test]
    fn explicit_fill_rule_wins_over_the_contours_derivation() {
        let item = solid_item(Primitive::Path {
            points: Vec::new(),
            closed: true,
            tolerance: 0.25,
            contours: vec![
                path_points(&[(0.0, 0.0), (40.0, 0.0), (40.0, 40.0), (0.0, 40.0)]),
                path_points(&[(10.0, 10.0), (30.0, 10.0), (30.0, 30.0), (10.0, 30.0)]),
            ],
            holes: Vec::new(),
            fill_rule: Some("nonzero".to_string()),
        });
        let plan = lower_frame(&[item], identity());
        match plan.ops[0] {
            DrawOp::Fill { even_odd, .. } => assert!(!even_odd),
            _ => panic!("expected a fill op"),
        }
    }

    #[test]
    fn a_degenerate_contour_ring_is_filtered_not_fatal() {
        let item = solid_item(Primitive::Path {
            points: Vec::new(),
            closed: true,
            tolerance: 0.25,
            contours: vec![
                path_points(&[(0.0, 0.0), (40.0, 0.0), (40.0, 40.0), (0.0, 40.0)]),
                path_points(&[(5.0, 5.0)]), // below the two-point floor
            ],
            holes: Vec::new(),
            fill_rule: Some("evenodd".to_string()),
        });
        let plan = lower_frame(&[item], identity());
        assert!(plan.report.complete(), "{}", plan.report.summary());
        assert_eq!(plan.vertices.len(), 8, "only the valid ring lowers");
    }

    #[test]
    fn bezier_handles_are_relative_offsets_like_the_replay_treats_them() {
        let mut points = path_points(&[(0.0, 0.0), (10.0, 0.0)]);
        points[0].handle_out = Some([5.0, -5.0]);
        points[1].handle_in = Some([-5.0, -5.0]);
        let flattened = flatten_contour(&points, false, 0.05);
        assert!(
            flattened.len() > 2,
            "a curved segment must flatten to more than its endpoints"
        );
        // The curve starts and ends exactly at the authored points.
        assert_eq!(flattened.first().copied(), Some([0.0, 0.0]));
        assert_eq!(flattened.last().copied(), Some([10.0, 0.0]));
        // Every flattened sample stays inside the control hull.
        for point in &flattened {
            assert!(point[1] <= 0.0 + 1e-9, "curve must bow upward: {point:?}");
            assert!(
                point[1] >= -4.0,
                "curve must not exceed the hull: {point:?}"
            );
        }
    }

    #[test]
    fn a_larger_tolerance_flattens_more_coarsely() {
        let mut points = path_points(&[(0.0, 0.0), (100.0, 0.0)]);
        points[0].handle_out = Some([40.0, -60.0]);
        points[1].handle_in = Some([-40.0, -60.0]);
        let fine = flatten_contour(&points, false, 0.01).len();
        let coarse = flatten_contour(&points, false, 5.0).len();
        assert!(fine > coarse, "fine={fine} coarse={coarse}");
    }

    #[test]
    fn native_path_flattening_rejects_work_before_exceeding_its_vertex_budget() {
        let mut points = path_points(&[(0.0, 0.0), (10.0, 0.0)]);
        points[0].handle_out = Some([5.0, -5.0]);
        points[1].handle_in = Some([-5.0, -5.0]);

        assert!(super::plan::flatten_contour_with_budget(&points, false, 0.05, 3).is_none());
        assert!(super::plan::flatten_contour_with_budget(&points, false, 0.05, 128).is_some());
    }

    #[test]
    fn degenerate_geometry_is_rejected_rather_than_drawn_empty() {
        let cases = [
            solid_item(Primitive::Rect {
                x: 0.0,
                y: 0.0,
                w: 0.0,
                h: 10.0,
                corner_radius: None,
            }),
            solid_item(Primitive::Ellipse {
                cx: 0.0,
                cy: 0.0,
                rx: 0.0,
                ry: 5.0,
            }),
            solid_item(Primitive::Circle {
                cx: 0.0,
                cy: 0.0,
                r: 0.0,
            }),
        ];
        for item in cases {
            let plan = lower_frame(&[item], identity());
            assert!(!plan.report.complete());
            assert_eq!(
                plan.report.reasons.get(RejectReason::EmptyGeometry.key()),
                Some(&1)
            );
        }
    }

    #[test]
    fn non_finite_transforms_are_rejected() {
        let mut item = rect_item(0.0, 0.0, 10.0, 10.0);
        item.transform = [f64::NAN, 0.0, 0.0, 1.0, 0.0, 0.0];
        let plan = lower_frame(&[item], identity());
        assert_eq!(
            plan.report
                .reasons
                .get(RejectReason::NonFiniteTransform.key()),
            Some(&1)
        );
    }

    #[test]
    fn a_non_finite_view_rejects_the_whole_frame_without_panicking() {
        let plan = lower_frame(
            &[rect_item(0.0, 0.0, 1.0, 1.0), rect_item(1.0, 1.0, 1.0, 1.0)],
            [f64::INFINITY, 0.0, 0.0, 1.0, 0.0, 0.0],
        );
        assert!(!plan.report.complete());
        assert_eq!(plan.report.rejected, 2);
    }

    #[test]
    fn the_view_transform_is_composed_into_every_record() {
        let item = rect_item(0.0, 0.0, 10.0, 10.0);
        // A camera that translates by (100, 50) and scales by 2.
        let view = [2.0, 0.0, 0.0, 2.0, 100.0, 50.0];
        let plan = lower_frame(&[item], view);
        assert_eq!(plan.shapes[0].mv, [2.0, 0.0, 0.0, 2.0]);
        assert_eq!(plan.shapes[0].mv2[0], 100.0);
        assert_eq!(plan.shapes[0].mv2[1], 50.0);
    }

    #[test]
    fn shape_quads_carry_one_and_a_half_device_pixels_of_margin() {
        let item = rect_item(0.0, 0.0, 100.0, 100.0);
        // At 2x device scale one device pixel is 0.5 local units, so the
        // margin is 1.5 * 0.5 = 0.75.
        let view = [2.0, 0.0, 0.0, 2.0, 0.0, 0.0];
        let plan = lower_frame(&[item], view);
        let quad = plan.shapes[0].quad;
        assert!((quad[0] + 0.75).abs() < 1e-5, "quad={quad:?}");
        assert!((quad[2] - 101.5).abs() < 1e-4, "quad={quad:?}");
    }

    #[test]
    fn a_partial_frame_is_never_presentable() {
        let plan = lower_frame(
            &[
                rect_item(0.0, 0.0, 1.0, 1.0),
                solid_item(Primitive::Text {
                    text: String::new(),
                    font_size: 12.0,
                    font_family: "Inter".to_string(),
                    font_weight: 400,
                    font_style: "normal".to_string(),
                    text_align: "left".to_string(),
                    text_align_vertical: "top".to_string(),
                    x: 0.0,
                    y: 0.0,
                    w: 1.0,
                    h: 1.0,
                    letter_spacing: 0.0,
                    line_height: 1.4,
                    paragraph_spacing: 0.0,
                    text_case: "none".to_string(),
                    text_decoration: "none".to_string(),
                    text_overflow: "visible".to_string(),
                    list_style: "none".to_string(),
                    rich_text: None,
                    open_type_features: None,
                    variable_axes: None,
                    text_mode: "point".to_string(),
                    path_text_settings: None,
                    path_shape: None,
                }),
            ],
            identity(),
        );
        assert!(!plan.is_presentable());
        assert!(!plan.report.complete());
        // The admitted item is still lowered, so the diagnostics can name what
        // *did* work alongside what did not.
        assert_eq!(plan.report.admitted, 1);
    }

    #[test]
    fn an_empty_frame_is_not_presentable() {
        let plan = lower_frame(&[], identity());
        assert!(!plan.report.complete());
        assert!(!plan.is_presentable());
    }

    #[test]
    fn admission_reports_are_stable_and_non_identifying() {
        let plan = lower_frame(&[rect_item(0.0, 0.0, 1.0, 1.0)], identity());
        let summary = plan.report.summary();
        assert!(summary.contains("1 items admitted"));
        assert!(
            !summary.contains('/') && !summary.contains('\\'),
            "summaries must not leak paths: {summary}"
        );
    }

    #[test]
    fn health_pauses_after_bounded_render_scoped_failures_and_retries_explicitly() {
        let mut health = RenderHealth::default();
        let failure = Err::<(), _>(RenderError::Unsupported("text".to_string()));
        for _ in 0..MAX_CONSECUTIVE_RENDER_FAILURES {
            assert!(health.is_available());
            health.record(&failure);
        }
        assert!(
            !health.is_available(),
            "three refusals must pause the stage"
        );
        assert_eq!(health.last_error_key.as_deref(), Some("unsupported"));
        health.reset();
        assert!(health.is_available());
        assert_eq!(health.consecutive_failures, 0);
    }

    #[test]
    fn a_devices_loss_is_fatal_while_a_timeout_is_not() {
        let mut health = RenderHealth::default();
        let timeout = Err::<(), _>(RenderError::Timeout("slow".to_string()));
        health.record(&timeout);
        assert!(
            health.is_available(),
            "a timeout must not retire the device"
        );
        assert_eq!(health.consecutive_failures, 1);

        let lost_error = RenderError::DeviceLost("gone".to_string());
        assert!(lost_error.is_device_fatal());
        let timeout_error = RenderError::Timeout("slow".to_string());
        assert!(!timeout_error.is_device_fatal());

        let lost = Err::<(), _>(lost_error);
        health.record(&lost);
        assert!(!health.is_available());
    }

    #[test]
    fn a_success_clears_an_accumulated_failure_streak() {
        let mut health = RenderHealth::default();
        let failure = Err::<(), _>(RenderError::ShaderFailed("fxc".to_string()));
        health.record(&failure);
        health.record(&failure);
        assert_eq!(health.consecutive_failures, 2);
        health.record(&Ok::<(), RenderError>(()));
        assert_eq!(health.consecutive_failures, 0);
        assert!(!health.paused);
    }

    #[test]
    fn failure_stages_separate_plan_from_device_faults() {
        assert_eq!(
            RenderError::Unsupported(String::new()).stage(),
            FailureStage::Plan
        );
        assert_eq!(
            RenderError::OutOfBudget(String::new()).stage(),
            FailureStage::Plan
        );
        assert_eq!(
            RenderError::ShaderFailed(String::new()).stage(),
            FailureStage::Pipeline
        );
        assert_eq!(
            RenderError::Timeout(String::new()).stage(),
            FailureStage::Readback
        );
        assert_eq!(
            RenderError::DeviceLost(String::new()).stage(),
            FailureStage::Submit
        );
    }

    #[test]
    fn affine_multiplication_matches_the_dom_matrix_order() {
        let scale = [2.0, 0.0, 0.0, 3.0, 0.0, 0.0];
        let translate = [1.0, 0.0, 0.0, 1.0, 10.0, 20.0];
        let combined = multiply(translate, scale);
        assert_eq!(apply(combined, [1.0, 1.0]), [12.0, 23.0]);
    }
}

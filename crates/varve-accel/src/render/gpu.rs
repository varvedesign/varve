//! wgpu resources and frame encoding for the native IR rasterizer.
//!
//! Design commitments, each of which answers a measured or reported failure of
//! a native GPU canvas (see
//! `docs/research/native-gpu-canvas-research-2026-10-16.md`):
//!
//! * **Failure is classified per outcome, not per callback.** A render-scoped
//!   refusal (out of budget, readback timeout, shader rejected on this backend)
//!   never retires the device. Only a positive device-loss signal does.
//!   `RenderError::is_device_fatal` is the single place that decides.
//! * **Never poll a lost device.** wgpu 30 routes `poll` on a lost device to a
//!   fatal path; the loss callback sets a flag this module checks first.
//! * **A reused target is fully written every frame.** The target is cached by
//!   size for allocation reasons, but every frame begins with `LoadOp::Clear`
//!   on both colour and stencil, so a reused surface can never present a
//!   partial or previous-frame result. No incremental path exists that could
//!   leave stale pixels behind.
//! * **Capabilities are probed, not asserted.** MSAA sample count and stencil
//!   format are established by attempting the allocation inside a validation
//!   error scope and reading the result, so a driver that refuses either
//!   degrades by one step instead of failing the whole stage.
//! * **Shader and pipeline creation is error-scoped.** A WGSL module this
//!   backend's shader compiler rejects (the FXC-rejects-naga class) becomes
//!   `RenderError::ShaderFailed` carrying the compiler's message — not a panic,
//!   and not a process-wide "GPU is off".

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::discovery::{AccelError, GpuCompute};

use super::plan::{DrawOp, NativePlan, ShapeRecord, SHAPE_RECORD_BYTES, SOLID_VERTEX_BYTES};

/// Colour target format. Deliberately the **non-sRGB** view of RGBA8: Canvas2D
/// composites encoded-sRGB channel values, so the hardware blend must operate
/// on those same encoded values. `Rgba8UnormSrgb` here would silently
/// linearize every blend and change the artwork.
pub const TARGET_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// Bounded wait for one frame's readback. Sized for a display-resolution frame,
/// not for an export: exceeding it degrades *this frame* only, and the pending
/// map is cancelled by destroying the staging buffer.
pub const FRAME_READBACK_TIMEOUT: Duration = Duration::from_secs(10);

/// Maximum MSAA sample count offered to the probe, highest first.
const SAMPLE_COUNT_CANDIDATES: [u32; 3] = [4, 2, 1];

/// Stencil formats offered to the probe, cheapest first.
const STENCIL_CANDIDATES: [wgpu::TextureFormat; 2] = [
    wgpu::TextureFormat::Stencil8,
    wgpu::TextureFormat::Depth24PlusStencil8,
];

/// Where in the frame pipeline a failure happened. Kept separate from the
/// cause because the recovery differs: a plan-stage refusal is content-scoped
/// and self-heals on the next frame, while a submission-stage failure is not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureStage {
    Plan,
    Pipeline,
    Encode,
    Submit,
    Readback,
}

/// A native raster failure, classified so the caller can decide whether the
/// device is still trustworthy.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "detail")]
pub enum RenderError {
    /// Content outside the admitted set. Frame-scoped; the authoritative
    /// replay paints it. Never a device problem.
    Unsupported(String),
    /// A shader module or pipeline this backend's compiler rejected.
    /// Backend-scoped: retrying on another adapter is legitimate, retiring the
    /// device is not.
    ShaderFailed(String),
    /// The requested surface or buffer exceeds the adapter's reported limits.
    OutOfBudget(String),
    /// A bounded wait expired. Explicitly **not** evidence of device loss.
    Timeout(String),
    /// The device reported loss. The only variant that retires the device.
    DeviceLost(String),
    /// Anything else, reported with its stage rather than guessed at.
    Internal(FailureStage, String),
}

impl RenderError {
    pub fn stage(&self) -> FailureStage {
        match self {
            RenderError::Unsupported(_) | RenderError::OutOfBudget(_) => FailureStage::Plan,
            RenderError::ShaderFailed(_) => FailureStage::Pipeline,
            RenderError::Timeout(_) => FailureStage::Readback,
            RenderError::DeviceLost(_) => FailureStage::Submit,
            RenderError::Internal(stage, _) => *stage,
        }
    }

    /// True only for a positive device-loss signal.
    pub fn is_device_fatal(&self) -> bool {
        matches!(self, RenderError::DeviceLost(_))
    }

    /// Stable key for diagnostics; the frontend never matches on `Display`.
    pub fn key(&self) -> &'static str {
        match self {
            RenderError::Unsupported(_) => "unsupported",
            RenderError::ShaderFailed(_) => "shader-failed",
            RenderError::OutOfBudget(_) => "out-of-budget",
            RenderError::Timeout(_) => "timeout",
            RenderError::DeviceLost(_) => "device-lost",
            RenderError::Internal(..) => "internal",
        }
    }

    pub fn detail(&self) -> &str {
        match self {
            RenderError::Unsupported(detail)
            | RenderError::ShaderFailed(detail)
            | RenderError::OutOfBudget(detail)
            | RenderError::Timeout(detail)
            | RenderError::DeviceLost(detail)
            | RenderError::Internal(_, detail) => detail,
        }
    }
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.key(), self.detail())
    }
}

impl std::error::Error for RenderError {}

/// Consecutive render-scoped failures tolerated before the stage pauses itself.
pub const MAX_CONSECUTIVE_RENDER_FAILURES: u32 = 3;

/// Bounded retry policy for the native raster stage.
///
/// A render-scoped failure is retried because the next frame is usually
/// different content; a device-level failure is not, because nothing about the
/// device changed. Exhausting the budget produces a *paused* native raster with
/// an explicit re-detect action — never a silent permanent CPU switch, which is
/// the defect class this mirrors.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderHealth {
    pub consecutive_failures: u32,
    pub paused: bool,
    pub paused_reason: Option<String>,
    pub last_error_key: Option<String>,
    pub last_error_stage: Option<FailureStage>,
    pub device_generation: u32,
}

impl Default for RenderHealth {
    fn default() -> Self {
        Self {
            consecutive_failures: 0,
            paused: false,
            paused_reason: None,
            last_error_key: None,
            last_error_stage: None,
            device_generation: 1,
        }
    }
}

impl RenderHealth {
    pub fn is_available(&self) -> bool {
        !self.paused
    }

    /// Record the outcome of one attempt.
    pub fn record<T>(&mut self, result: &Result<T, RenderError>) {
        match result {
            Ok(_) => {
                self.consecutive_failures = 0;
                self.paused = false;
                self.paused_reason = None;
                self.last_error_key = None;
                self.last_error_stage = None;
            }
            Err(error) => {
                self.last_error_key = Some(error.key().to_string());
                self.last_error_stage = Some(error.stage());
                if error.is_device_fatal() {
                    // Device replacement is the only cure; the caller creates a
                    // new engine and bumps the generation.
                    self.paused = true;
                    self.paused_reason = Some(error.detail().to_string());
                    return;
                }
                self.consecutive_failures = self.consecutive_failures.saturating_add(1);
                if self.consecutive_failures >= MAX_CONSECUTIVE_RENDER_FAILURES {
                    self.paused = true;
                    self.paused_reason = Some(error.detail().to_string());
                }
            }
        }
    }

    /// Explicit user-facing re-detect / retry.
    pub fn reset(&mut self) {
        self.consecutive_failures = 0;
        self.paused = false;
        self.paused_reason = None;
        self.last_error_key = None;
        self.last_error_stage = None;
    }
}

/// One rasterized frame, row-major RGBA8 in the encoded-sRGB values the shaders
/// produced. Alpha is straight rather than premultiplied because the consumer
/// is a browser canvas expecting `ImageData` semantics.
#[derive(Debug, Clone, PartialEq)]
pub struct RasterizedFrame {
    pub width: u32,
    pub height: u32,
    /// Unpadded rows: exactly `width * height * 4` bytes.
    pub pixels: Vec<u8>,
    pub build_ms: f64,
    pub encode_ms: f64,
    /// GPU synchronisation plus the padded-to-unpadded row copy.
    pub transfer_ms: f64,
    /// Premultiplied -> straight-alpha conversion, required by the browser
    /// canvas APIs. Separated so the bridge's cost is attributable rather than
    /// hidden inside one number.
    pub straighten_ms: f64,
    pub readback_ms: f64,
    pub draw_calls: u32,
    pub sample_count: u32,
}

impl RasterizedFrame {
    pub fn total_ms(&self) -> f64 {
        self.build_ms + self.encode_ms + self.readback_ms
    }
}

struct Target {
    width: u32,
    height: u32,
    sample_count: u32,
    /// MSAA colour attachment; `None` at sample count 1, where rendering goes
    /// straight into `resolved` and no resolve step exists.
    _color: Option<wgpu::Texture>,
    color_view: Option<wgpu::TextureView>,
    /// Single-sample resolve destination, also the readback source (and, at
    /// sample count 1, the render target itself).
    resolved: wgpu::Texture,
    resolved_view: wgpu::TextureView,
    depth_stencil: wgpu::TextureView,
    staging: wgpu::Buffer,
    padded_bytes_per_row: u32,
}

/// Reusable device-owned resources plus the pipelines drawn with them.
pub struct NativeRaster {
    gpu: GpuCompute,
    sample_count: u32,
    stencil_format: wgpu::TextureFormat,
    shape_pipeline: wgpu::RenderPipeline,
    /// Kept so the per-frame viewport bind group can be built without
    /// re-deriving the layout.
    viewport_layout: wgpu::BindGroupLayout,
    stencil_nonzero_pipeline: wgpu::RenderPipeline,
    stencil_evenodd_pipeline: wgpu::RenderPipeline,
    cover_pipeline: wgpu::RenderPipeline,
    target: Option<Target>,
    device_lost: Arc<AtomicBool>,
    lost_reason: Arc<std::sync::Mutex<Option<String>>>,
}

fn check_extent(limits: wgpu::Limits, width: u32, height: u32) -> Result<(), RenderError> {
    if width == 0 || height == 0 {
        return Err(RenderError::OutOfBudget(
            "native raster refused a zero-sized frame".to_string(),
        ));
    }
    if width > limits.max_texture_dimension_2d || height > limits.max_texture_dimension_2d {
        return Err(RenderError::OutOfBudget(format!(
            "{width}x{height} exceeds the adapter's {}-texel texture limit",
            limits.max_texture_dimension_2d
        )));
    }
    Ok(())
}

fn vertex_layout() -> wgpu::VertexBufferLayout<'static> {
    wgpu::VertexBufferLayout {
        array_stride: SOLID_VERTEX_BYTES as u64,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &[
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x2,
                offset: 0,
                shader_location: 0,
            },
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x4,
                offset: 8,
                shader_location: 1,
            },
        ],
    }
}

fn premultiplied_over() -> wgpu::BlendState {
    wgpu::BlendState {
        color: wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::One,
            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
            operation: wgpu::BlendOperation::Add,
        },
        alpha: wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::One,
            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
            operation: wgpu::BlendOperation::Add,
        },
    }
}

/// Stencil state that leaves the buffer untouched: used by the analytic shape
/// stage, which occupies the same render pass as the path stage.
fn passthrough_stencil() -> wgpu::StencilState {
    wgpu::StencilState {
        front: wgpu::StencilFaceState::IGNORE,
        back: wgpu::StencilFaceState::IGNORE,
        read_mask: 0,
        write_mask: 0,
    }
}

/// Stencil state that accumulates winding numbers. Colour writes are disabled
/// on the same pipeline, so this pass only builds coverage.
fn stencil_writer(
    front_op: wgpu::StencilOperation,
    back_op: wgpu::StencilOperation,
) -> wgpu::StencilState {
    wgpu::StencilState {
        front: wgpu::StencilFaceState {
            compare: wgpu::CompareFunction::Always,
            fail_op: wgpu::StencilOperation::Keep,
            depth_fail_op: front_op,
            pass_op: front_op,
        },
        back: wgpu::StencilFaceState {
            compare: wgpu::CompareFunction::Always,
            fail_op: wgpu::StencilOperation::Keep,
            depth_fail_op: back_op,
            pass_op: back_op,
        },
        read_mask: 0xFF,
        write_mask: 0xFF,
    }
}

/// Cover state: paint where the accumulated winding is non-zero, then reset
/// those samples to zero so the next path starts from a clean buffer without a
/// per-path render pass. Every sample left non-zero by the fan lies inside the
/// cover quad, so the reset is total.
fn cover_stencil() -> wgpu::StencilState {
    let face = wgpu::StencilFaceState {
        compare: wgpu::CompareFunction::NotEqual,
        fail_op: wgpu::StencilOperation::Keep,
        // No depth test is configured, so `depth_fail_op` is unreachable; Keep
        // is stated rather than Zero so the intent is explicit.
        depth_fail_op: wgpu::StencilOperation::Keep,
        pass_op: wgpu::StencilOperation::Zero,
    };
    wgpu::StencilState {
        front: face,
        back: face,
        read_mask: 0xFF,
        write_mask: 0xFF,
    }
}

impl NativeRaster {
    /// Create the stage on the best hardware adapter, or report why none is
    /// usable. A shader/pipeline rejection surfaces as a named unavailable
    /// reason instead of a validation panic.
    pub fn create(preferred_device_id: Option<&str>) -> Result<Self, AccelError> {
        Self::create_with_sample_count(preferred_device_id, None)
    }

    /// Create the stage with a forced MSAA sample count (MSAA-cost
    /// experiments; ADR-0244 open item 5). The value is still probed against
    /// the device: an unsupported forced count is a named error, never a
    /// silent fallback to a different sample count than the caller asked for.
    pub fn create_with_sample_count(
        preferred_device_id: Option<&str>,
        forced_sample_count: Option<u32>,
    ) -> Result<Self, AccelError> {
        let gpu = GpuCompute::create(preferred_device_id)?;
        Self::from_compute_with_sample_count(gpu, forced_sample_count).map_err(|error| match error {
            RenderError::ShaderFailed(detail) | RenderError::OutOfBudget(detail) => {
                AccelError::Unavailable(
                    crate::capability::UnavailableReason::UnsupportedOperator,
                    detail,
                )
            }
            other => AccelError::Execution(other.to_string()),
        })
    }

    fn from_compute_with_sample_count(
        gpu: GpuCompute,
        forced_sample_count: Option<u32>,
    ) -> Result<Self, RenderError> {
        let sample_count = match forced_sample_count {
            Some(forced) => {
                if !matches!(forced, 1 | 2 | 4 | 8 | 16) {
                    return Err(RenderError::OutOfBudget(format!(
                        "forced sample count {forced} is not a power-of-two MSAA count"
                    )));
                }
                if !sample_count_supported(gpu.device(), forced) {
                    return Err(RenderError::OutOfBudget(format!(
                        "forced sample count {forced} unsupported on this adapter"
                    )));
                }
                forced
            }
            None => probe_sample_count(gpu.device()),
        };
        let stencil_format = probe_stencil_format(gpu.device())?;

        let shape_module = create_module(gpu.device(), "varve-native-shape", SHAPE_WGSL)?;
        let solid_module = create_module(gpu.device(), "varve-native-solid", SOLID_WGSL)?;

        let shape_bind_group_layout =
            gpu.device()
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("varve-native-shape-layout"),
                    entries: &[
                        wgpu::BindGroupLayoutEntry {
                            binding: 0,
                            visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Buffer {
                                ty: wgpu::BufferBindingType::Storage { read_only: true },
                                has_dynamic_offset: false,
                                min_binding_size: wgpu::BufferSize::new(SHAPE_RECORD_BYTES as u64),
                            },
                            count: None,
                        },
                        wgpu::BindGroupLayoutEntry {
                            binding: 1,
                            visibility: wgpu::ShaderStages::VERTEX,
                            ty: wgpu::BindingType::Buffer {
                                ty: wgpu::BufferBindingType::Uniform,
                                has_dynamic_offset: false,
                                min_binding_size: wgpu::BufferSize::new(16),
                            },
                            count: None,
                        },
                    ],
                });
        let shape_pipeline_layout =
            gpu.device()
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("varve-native-shape-pipeline-layout"),
                    bind_group_layouts: &[Some(&shape_bind_group_layout)],
                    immediate_size: 0,
                });
        let viewport_layout =
            gpu.device()
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("varve-native-viewport-layout"),
                    entries: &[wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: wgpu::BufferSize::new(16),
                        },
                        count: None,
                    }],
                });
        let solid_pipeline_layout =
            gpu.device()
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("varve-native-solid-pipeline-layout"),
                    bind_group_layouts: &[Some(&viewport_layout)],
                    immediate_size: 0,
                });

        let multisample = wgpu::MultisampleState {
            count: sample_count,
            mask: !0,
            alpha_to_coverage_enabled: false,
        };
        // Orientation is irrelevant to non-zero fill: a globally flipped facing
        // flips the sign of every winding number, and `!= 0` is sign-invariant.
        // Stated explicitly so a reader does not have to re-derive it.
        let primitive = wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleList,
            front_face: wgpu::FrontFace::Ccw,
            cull_mode: None,
            ..Default::default()
        };

        let shape_pipeline = create_pipeline(
            gpu.device(),
            &wgpu::RenderPipelineDescriptor {
                label: Some("varve-native-shape-pipeline"),
                layout: Some(&shape_pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shape_module,
                    entry_point: Some("vs_shape"),
                    compilation_options: Default::default(),
                    // Instanced from a storage buffer: no vertex buffers.
                    buffers: &[],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shape_module,
                    entry_point: Some("fs_shape"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: TARGET_FORMAT,
                        blend: Some(premultiplied_over()),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive,
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: stencil_format,
                    depth_write_enabled: Some(false),
                    depth_compare: Some(wgpu::CompareFunction::Always),
                    stencil: passthrough_stencil(),
                    bias: Default::default(),
                }),
                multisample,
                multiview_mask: None,
                cache: None,
            },
        )?;

        let stencil_only_targets = [Some(wgpu::ColorTargetState {
            format: TARGET_FORMAT,
            blend: None,
            // `NONE` is stated rather than relying on the absent blend: this
            // pass must not touch colour.
            write_mask: wgpu::ColorWrites::empty(),
        })];
        let cover_targets = [Some(wgpu::ColorTargetState {
            format: TARGET_FORMAT,
            blend: Some(premultiplied_over()),
            write_mask: wgpu::ColorWrites::ALL,
        })];

        let make_solid_pipeline = |label: &'static str,
                                   stencil: wgpu::StencilState,
                                   targets: &[Option<wgpu::ColorTargetState>]|
         -> Result<wgpu::RenderPipeline, RenderError> {
            create_pipeline(
                gpu.device(),
                &wgpu::RenderPipelineDescriptor {
                    label: Some(label),
                    layout: Some(&solid_pipeline_layout),
                    vertex: wgpu::VertexState {
                        module: &solid_module,
                        entry_point: Some("vs_solid"),
                        compilation_options: Default::default(),
                        buffers: &[Some(vertex_layout())],
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: &solid_module,
                        entry_point: Some("fs_solid"),
                        compilation_options: Default::default(),
                        targets,
                    }),
                    primitive,
                    depth_stencil: Some(wgpu::DepthStencilState {
                        format: stencil_format,
                        depth_write_enabled: Some(false),
                        depth_compare: Some(wgpu::CompareFunction::Always),
                        stencil,
                        bias: Default::default(),
                    }),
                    multisample,
                    multiview_mask: None,
                    cache: None,
                },
            )
        };

        let stencil_nonzero_pipeline = make_solid_pipeline(
            "varve-native-stencil-nonzero",
            stencil_writer(
                wgpu::StencilOperation::IncrementWrap,
                wgpu::StencilOperation::DecrementWrap,
            ),
            &stencil_only_targets,
        )?;
        let stencil_evenodd_pipeline = make_solid_pipeline(
            "varve-native-stencil-evenodd",
            stencil_writer(
                wgpu::StencilOperation::Invert,
                wgpu::StencilOperation::Invert,
            ),
            &stencil_only_targets,
        )?;
        let cover_pipeline =
            make_solid_pipeline("varve-native-cover", cover_stencil(), &cover_targets)?;

        let device_lost = Arc::new(AtomicBool::new(false));
        let lost_reason = Arc::new(std::sync::Mutex::new(None));
        {
            let lost = Arc::clone(&device_lost);
            let reason = Arc::clone(&lost_reason);
            gpu.device()
                .set_device_lost_callback(move |_reason, message| {
                    lost.store(true, Ordering::SeqCst);
                    if let Ok(mut slot) = reason.lock() {
                        *slot = Some(message);
                    }
                });
        }

        Ok(Self {
            gpu,
            sample_count,
            stencil_format,
            shape_pipeline,
            viewport_layout,
            stencil_nonzero_pipeline,
            stencil_evenodd_pipeline,
            cover_pipeline,
            target: None,
            device_lost,
            lost_reason,
        })
    }

    pub fn sample_count(&self) -> u32 {
        self.sample_count
    }

    pub fn stencil_format(&self) -> wgpu::TextureFormat {
        self.stencil_format
    }

    pub fn device_name(&self) -> &str {
        &self.gpu.info().name
    }

    /// Backend name as reported by wgpu (`Vulkan`, `Metal`, `Dx12`, …).
    pub fn backend(&self) -> String {
        self.gpu.adapter_info().backend.to_string()
    }

    pub fn driver(&self) -> Option<String> {
        let info = self.gpu.adapter_info();
        if info.driver_info.is_empty() {
            None
        } else {
            Some(info.driver_info.clone())
        }
    }

    /// True once the device has reported loss. Callers must stop submitting.
    pub fn device_is_lost(&self) -> bool {
        self.device_lost.load(Ordering::SeqCst)
    }

    pub fn lost_reason(&self) -> Option<String> {
        self.lost_reason.lock().ok().and_then(|slot| slot.clone())
    }

    fn ensure_target(&mut self, width: u32, height: u32) -> Result<(), RenderError> {
        check_extent(self.gpu.device().limits(), width, height)?;
        if let Some(target) = self.target.as_ref() {
            if target.width == width
                && target.height == height
                && target.sample_count == self.sample_count
            {
                return Ok(());
            }
        }
        self.target = Some(self.create_target(width, height)?);
        Ok(())
    }

    fn create_target(&self, width: u32, height: u32) -> Result<Target, RenderError> {
        let device = self.gpu.device();
        let size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };
        let (color, color_view) = if self.sample_count > 1 {
            let color = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("varve-native-color-msaa"),
                size,
                mip_level_count: 1,
                sample_count: self.sample_count,
                dimension: wgpu::TextureDimension::D2,
                format: TARGET_FORMAT,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            });
            let view = color.create_view(&wgpu::TextureViewDescriptor::default());
            (Some(color), Some(view))
        } else {
            (None, None)
        };
        let resolved = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("varve-native-color-resolved"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: TARGET_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let resolved_view = resolved.create_view(&wgpu::TextureViewDescriptor::default());
        let depth_stencil = device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("varve-native-stencil"),
                size,
                mip_level_count: 1,
                sample_count: self.sample_count,
                dimension: wgpu::TextureDimension::D2,
                format: self.stencil_format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            })
            .create_view(&wgpu::TextureViewDescriptor::default());

        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let padded_bytes_per_row = (width * 4).div_ceil(align) * align;
        let staging = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("varve-native-readback"),
            size: (padded_bytes_per_row as u64) * (height as u64),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        Ok(Target {
            width,
            height,
            sample_count: self.sample_count,
            _color: color,
            color_view,
            resolved,
            resolved_view,
            depth_stencil,
            staging,
            padded_bytes_per_row,
        })
    }

    /// Rasterize a lowered plan and read it back.
    ///
    /// The target is cleared at the start of the single render pass, so the
    /// returned pixels are always the complete result of this plan and never a
    /// composite with a previous frame.
    pub fn rasterize(
        &mut self,
        plan: &NativePlan,
        width: u32,
        height: u32,
    ) -> Result<RasterizedFrame, RenderError> {
        if self.device_is_lost() {
            return Err(RenderError::DeviceLost(self.lost_reason().unwrap_or_else(
                || "device reported lost before submission".to_string(),
            )));
        }
        if !plan.is_presentable() {
            return Err(RenderError::Unsupported(plan.report.summary()));
        }

        let build_started = Instant::now();
        self.ensure_target(width, height)?;

        let device = self.gpu.device();
        let queue = self.gpu.queue();

        let shape_buffer =
            (!plan.shapes.is_empty()).then(|| create_shape_buffer(device, &plan.shapes));
        let vertex_buffer =
            (!plan.vertices.is_empty()).then(|| create_vertex_buffer(device, &plan.vertices));
        let index_buffer =
            (!plan.indices.is_empty()).then(|| create_index_buffer(device, &plan.indices));

        // Device-pixel -> clip-space mapping, shared by both stages.
        let viewport_bytes = encode_viewport(width, height);
        let viewport_buffer = upload(
            device,
            "varve-native-viewport",
            &viewport_bytes,
            wgpu::BufferUsages::UNIFORM,
        );
        let solid_viewport_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("varve-native-solid-viewport"),
            layout: &self.viewport_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: viewport_buffer.as_entire_binding(),
            }],
        });
        let shape_bind_group = shape_buffer.as_ref().map(|buffer| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("varve-native-shape-bind-group"),
                layout: &self.shape_pipeline.get_bind_group_layout(0),
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: viewport_buffer.as_entire_binding(),
                    },
                ],
            })
        });

        let build_ms = build_started.elapsed().as_secs_f64() * 1000.0;
        let encode_started = Instant::now();

        let target = self
            .target
            .as_ref()
            .ok_or_else(|| RenderError::Internal(FailureStage::Encode, "no target".to_string()))?;
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("varve-native-frame"),
        });

        let mut draw_calls = 0_u32;
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("varve-native-frame-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    // At sample count 1 there is no resolve step: the
                    // readback texture is the render target.
                    view: target.color_view.as_ref().unwrap_or(&target.resolved_view),
                    depth_slice: None,
                    resolve_target: if self.sample_count > 1 {
                        Some(&target.resolved_view)
                    } else {
                        None
                    },
                    ops: wgpu::Operations {
                        // The full-frame clear is what makes target reuse safe.
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &target.depth_stencil,
                    depth_ops: None,
                    stencil_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(0),
                        store: wgpu::StoreOp::Discard,
                    }),
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });

            if let Some(vertex_buffer) = vertex_buffer.as_ref() {
                pass.set_vertex_buffer(0, vertex_buffer.slice(..));
            }
            if let Some(index_buffer) = index_buffer.as_ref() {
                pass.set_index_buffer(index_buffer.slice(..), wgpu::IndexFormat::Uint32);
            }

            // Group 0 is shared by both pipeline layouts with different
            // contents, so the binding is tracked rather than assumed: a shape
            // run leaves the shape bind group bound, and the next fill must put
            // the viewport group back before its pipeline can draw.
            #[derive(PartialEq)]
            enum Bound {
                Nothing,
                Viewport,
                Shapes,
            }
            let mut bound = Bound::Nothing;
            let bind_viewport = |pass: &mut wgpu::RenderPass<'_>, bound: &mut Bound| {
                if *bound != Bound::Viewport {
                    pass.set_bind_group(0, &solid_viewport_bind_group, &[]);
                    *bound = Bound::Viewport;
                }
            };

            for op in &plan.ops {
                match op {
                    DrawOp::Shapes {
                        first_instance,
                        instance_count,
                    } => {
                        if *instance_count == 0 {
                            continue;
                        }
                        let Some(bind_group) = shape_bind_group.as_ref() else {
                            continue;
                        };
                        pass.set_pipeline(&self.shape_pipeline);
                        if bound != Bound::Shapes {
                            pass.set_bind_group(0, bind_group, &[]);
                            bound = Bound::Shapes;
                        }
                        pass.draw(0..6, *first_instance..(*first_instance + *instance_count));
                        draw_calls += 1;
                    }
                    DrawOp::Fill {
                        fan_index_start,
                        fan_index_count,
                        cover_index_start,
                        cover_index_count,
                        even_odd,
                    } => {
                        if *fan_index_count > 0 {
                            pass.set_pipeline(if *even_odd {
                                &self.stencil_evenodd_pipeline
                            } else {
                                &self.stencil_nonzero_pipeline
                            });
                            bind_viewport(&mut pass, &mut bound);
                            pass.set_stencil_reference(0);
                            pass.draw_indexed(
                                *fan_index_start..(*fan_index_start + *fan_index_count),
                                0,
                                0..1,
                            );
                            draw_calls += 1;
                        }
                        if *cover_index_count > 0 {
                            pass.set_pipeline(&self.cover_pipeline);
                            bind_viewport(&mut pass, &mut bound);
                            pass.set_stencil_reference(0);
                            pass.draw_indexed(
                                *cover_index_start..(*cover_index_start + *cover_index_count),
                                0,
                                0..1,
                            );
                            draw_calls += 1;
                        }
                    }
                }
            }
        }

        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &target.resolved,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &target.staging,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(target.padded_bytes_per_row),
                    rows_per_image: Some(target.height),
                },
            },
            wgpu::Extent3d {
                width: target.width,
                height: target.height,
                depth_or_array_layers: 1,
            },
        );

        let encode_ms = encode_started.elapsed().as_secs_f64() * 1000.0;

        queue.submit(Some(encoder.finish()));
        if self.device_is_lost() {
            return Err(RenderError::DeviceLost(self.lost_reason().unwrap_or_else(
                || "device reported lost after submission".to_string(),
            )));
        }

        let readback_started = Instant::now();
        let slice = target.staging.slice(..);
        let (sender, receiver) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });

        // Never poll a device that has already reported loss.
        if self.device_is_lost() {
            return Err(RenderError::DeviceLost(self.lost_reason().unwrap_or_else(
                || "device reported lost during readback".to_string(),
            )));
        }
        match device.poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: Some(FRAME_READBACK_TIMEOUT),
        }) {
            Ok(_) => {}
            Err(wgpu::PollError::Timeout) => {
                // Cancellation, not a fault: destroying the staging buffer
                // retires the pending map. The device stays usable and the next
                // frame builds a fresh target.
                target.staging.destroy();
                self.target = None;
                return Err(RenderError::Timeout(format!(
                    "native readback exceeded {} ms",
                    FRAME_READBACK_TIMEOUT.as_millis()
                )));
            }
            Err(error) => {
                self.target = None;
                if self.device_is_lost() {
                    return Err(RenderError::DeviceLost(format!("{error}")));
                }
                return Err(RenderError::Internal(
                    FailureStage::Readback,
                    format!("poll failed: {error}"),
                ));
            }
        }

        let mapped = receiver
            .recv_timeout(FRAME_READBACK_TIMEOUT)
            .map_err(|_| RenderError::Timeout("native readback map callback never fired".into()))?;
        if let Err(error) = mapped {
            self.target = None;
            return Err(RenderError::Internal(
                FailureStage::Readback,
                format!("map failed: {error}"),
            ));
        }

        let transfer_ms = readback_started.elapsed().as_secs_f64() * 1000.0;
        let straighten_started = Instant::now();
        let mut pixels = Vec::with_capacity((width as usize) * (height as usize) * 4);
        {
            let view = slice.get_mapped_range().map_err(|error| {
                RenderError::Internal(FailureStage::Readback, format!("map range: {error}"))
            })?;
            let row_bytes = (width as usize) * 4;
            for row in 0..height as usize {
                let start = row * target.padded_bytes_per_row as usize;
                pixels.extend_from_slice(&view[start..start + row_bytes]);
            }
        }
        target.staging.unmap();
        straighten_alpha(&mut pixels);
        let straighten_ms = straighten_started.elapsed().as_secs_f64() * 1000.0;
        let readback_ms = readback_started.elapsed().as_secs_f64() * 1000.0;

        Ok(RasterizedFrame {
            width,
            height,
            pixels,
            build_ms,
            encode_ms,
            transfer_ms,
            straighten_ms,
            readback_ms,
            draw_calls,
            sample_count: self.sample_count,
        })
    }
}

/// Probe the highest MSAA sample count this device will actually allocate a
/// render target at. Capability is established by attempting it, not asserted.
fn probe_sample_count(device: &wgpu::Device) -> u32 {
    for count in SAMPLE_COUNT_CANDIDATES {
        if sample_count_supported(device, count) {
            return count;
        }
    }
    1
}

/// A 4x4 render-attachment allocation is the smallest honest probe: it asks
/// the device, not the feature table.
fn sample_count_supported(device: &wgpu::Device, count: u32) -> bool {
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let probe = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("varve-native-msaa-probe"),
        size: wgpu::Extent3d {
            width: 4,
            height: 4,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: count,
        dimension: wgpu::TextureDimension::D2,
        format: TARGET_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let supported = pollster::block_on(scope.pop()).is_none();
    drop(probe);
    supported
}

/// Probe a stencil render-attachment format the same way.
fn probe_stencil_format(device: &wgpu::Device) -> Result<wgpu::TextureFormat, RenderError> {
    for format in STENCIL_CANDIDATES {
        let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let _probe = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("varve-native-stencil-probe"),
            size: wgpu::Extent3d {
                width: 4,
                height: 4,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        if pollster::block_on(scope.pop()).is_none() {
            return Ok(format);
        }
    }
    Err(RenderError::OutOfBudget(
        "no stencil render-attachment format was available".to_string(),
    ))
}

const SHAPE_WGSL: &str = include_str!("shaders/shape.wgsl");
const SOLID_WGSL: &str = include_str!("shaders/solid.wgsl");

/// Create a shader module inside a validation error scope so a backend that
/// rejects this WGSL becomes a classified error instead of an uncaptured-error
/// panic or a process-wide device retirement.
fn create_module(
    device: &wgpu::Device,
    label: &str,
    source: &str,
) -> Result<wgpu::ShaderModule, RenderError> {
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(label),
        source: wgpu::ShaderSource::Wgsl(source.into()),
    });
    if let Some(error) = pollster::block_on(scope.pop()) {
        return Err(RenderError::ShaderFailed(format!(
            "{label} failed validation: {error}"
        )));
    }
    Ok(module)
}

fn create_pipeline(
    device: &wgpu::Device,
    descriptor: &wgpu::RenderPipelineDescriptor<'_>,
) -> Result<wgpu::RenderPipeline, RenderError> {
    let label = descriptor.label.unwrap_or("unnamed");
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let pipeline = device.create_render_pipeline(descriptor);
    if let Some(error) = pollster::block_on(scope.pop()) {
        return Err(RenderError::ShaderFailed(format!(
            "{label} failed pipeline creation: {error}"
        )));
    }
    Ok(pipeline)
}

/// Safe byte encoder for the shape storage buffer.
///
/// Written field by field rather than reinterpreted as bytes so the crate stays
/// `unsafe_code = deny`; the field order here *is* the std430 layout the
/// shader's `Item` declares, and a unit test pins the total stride.
fn encode_shape_records(records: &[ShapeRecord]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(records.len() * SHAPE_RECORD_BYTES);
    for record in records {
        for value in record
            .mv
            .iter()
            .chain(record.mv2.iter())
            .chain(record.quad.iter())
        {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for value in record.shape.iter() {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for value in record
            .p0
            .iter()
            .chain(record.p1.iter())
            .chain(record.radii.iter())
            .chain(record.color.iter())
        {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    bytes
}

fn encode_solid_vertices(vertices: &[super::plan::SolidVertex]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vertices.len() * SOLID_VERTEX_BYTES);
    for vertex in vertices {
        for value in vertex.position.iter() {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for value in vertex.color.iter() {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    bytes
}

/// Convert the premultiplied framebuffer to the straight-alpha form every
/// browser canvas API consumes.
///
/// The render target must be premultiplied — that is what makes
/// `(One, OneMinusSrcAlpha)` compositing match Canvas2D — but `ImageData`,
/// `putImageData`, and `createImageBitmap` are all defined on straight alpha.
/// Handing premultiplied bytes to any of them darkens every translucent pixel,
/// so the conversion happens once, here, and its cost is inside the reported
/// `readback_ms` rather than hidden.
///
/// Fully transparent and fully opaque pixels are left untouched, which is the
/// overwhelming majority of a design canvas.
fn straighten_alpha(pixels: &mut [u8]) {
    for texel in pixels.chunks_exact_mut(4) {
        let alpha = texel[3];
        if alpha == 0 || alpha == 255 {
            continue;
        }
        let scale = 255.0 / alpha as f32;
        for channel in &mut texel[..3] {
            let straight = (*channel as f32 * scale).round();
            *channel = straight.clamp(0.0, 255.0) as u8;
        }
    }
}

fn encode_viewport(width: u32, height: u32) -> [u8; 16] {
    let mut bytes = [0_u8; 16];
    bytes[0..4].copy_from_slice(&(width as f32).to_le_bytes());
    bytes[4..8].copy_from_slice(&(height as f32).to_le_bytes());
    bytes
}

fn encode_u32(values: &[u32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn upload(
    device: &wgpu::Device,
    label: &str,
    bytes: &[u8],
    usage: wgpu::BufferUsages,
) -> wgpu::Buffer {
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size: bytes.len().max(4) as u64,
        usage: usage | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: true,
    });
    {
        let mut view = buffer
            .slice(..bytes.len() as u64)
            .get_mapped_range_mut()
            .expect("freshly created buffer maps");
        view.copy_from_slice(bytes);
    }
    buffer.unmap();
    buffer
}

fn create_shape_buffer(device: &wgpu::Device, records: &[ShapeRecord]) -> wgpu::Buffer {
    upload(
        device,
        "varve-native-shapes",
        &encode_shape_records(records),
        wgpu::BufferUsages::STORAGE,
    )
}

fn create_vertex_buffer(
    device: &wgpu::Device,
    vertices: &[super::plan::SolidVertex],
) -> wgpu::Buffer {
    upload(
        device,
        "varve-native-vertices",
        &encode_solid_vertices(vertices),
        wgpu::BufferUsages::VERTEX,
    )
}

fn create_index_buffer(device: &wgpu::Device, indices: &[u32]) -> wgpu::Buffer {
    upload(
        device,
        "varve-native-indices",
        &encode_u32(indices),
        wgpu::BufferUsages::INDEX,
    )
}

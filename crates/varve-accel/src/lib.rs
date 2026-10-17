//! Varve native acceleration.
//!
//! One capability model with native implementations: device discovery,
//! execution stages, and offscreen GPU compute for live effects.
//!
//! Boundaries (see `docs/architecture/native-acceleration.md`):
//! - **Presentation** stays in the webview (Canvas2D replay, ADR-0001/0003).
//! - **Compute** (effects, resampling) may run on a native GPU device.
//! - **Inference** is ONNX Runtime; this crate reports what the loaded
//!   runtime actually provides instead of assuming compiled features.

pub mod capability;

#[cfg(not(target_arch = "wasm32"))]
pub mod discovery;

#[cfg(not(target_arch = "wasm32"))]
pub mod effects;

/// Native scene rasterization of the render IR. This is *rasterization*, not
/// presentation: the pixels it produces reach the window through the existing
/// Canvas2D present surface. See ADR-0244.
#[cfg(not(target_arch = "wasm32"))]
pub mod render;

pub use capability::{
    AccelStage, AcceleratorDevice, ComputeCapabilities, CpuCapabilities, DeviceKind,
    EffectiveBackend, InferenceCapabilities, InferenceProviderStatus, NativeAccelerationReport,
    RequestedBackend, UnavailableReason,
};

//! ONNX model inference for AI-powered background removal.
//!
//! Uses the `ort` crate (ONNX Runtime Rust bindings) to run
//! segmentation models on-device. Opt-in via the `ai` Cargo feature.
//!
//! Architecture: The `InferenceRuntime` trait abstracts ONNX Runtime
//! behind a swappable interface so that future alternatives (tract,
//! burn, ort C API) can be substituted without rewriting the inference
//! pipeline. `OrtInferenceRuntime` is the current implementation.

mod denoise;
mod integrity;
mod lama;
mod prelude;
mod runtime;
mod segmentation;
mod session;

#[cfg(test)]
mod tests;

pub use denoise::{denoise_image, denoise_image_cancellable, DenoiseResult};
pub use integrity::{stream_sha256, verify_model_sha256};
pub use lama::{lama_inpaint, lama_inpaint_cancellable, LamaInpaintRequest, LamaInpaintResult};
pub(crate) use runtime::OrtSession;
pub use runtime::{
    InferenceRuntime, InferenceSession, OrtInferenceRuntime, TensorOutput, TensorShape,
};
pub use segmentation::{remove_ai, remove_ai_cancellable};
pub use session::{
    auto_gpu_model_fallback_reason, auto_gpu_model_fallbacks, clear_auto_gpu_model_quarantine,
    session_pool_metrics, set_runtime, unload_all_model_sessions, unload_model_session,
};

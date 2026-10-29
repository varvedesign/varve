//! The swappable inference-runtime abstraction and its ONNX Runtime implementation.

use super::prelude::*;

// ── InferenceRuntime trait ────────────────────────────────────────────

/// Swappable ONNX inference backend.
///
/// The sole concrete implementation is [`OrtInferenceRuntime`].
/// Future backends (tract, burn, ort C API) implement this trait
/// and are selected at the call site via a builder or config.
pub trait InferenceRuntime: Send + Sync {
    /// Create an inference session for the given model path.
    fn create_session(&self, model_path: &Path) -> Result<Box<dyn InferenceSession>, String>;

    /// Create a CPU-only session for a bounded fallback retry. Test and
    /// alternate runtimes inherit the normal constructor because they may
    /// not expose a separate provider selector; the production ORT runtime
    /// overrides this to bypass the process-wide accelerator policy.
    fn create_cpu_session(&self, model_path: &Path) -> Result<Box<dyn InferenceSession>, String> {
        self.create_session(model_path)
    }
}

/// Shape of an ONNX tensor.
#[derive(Clone, Debug)]
pub struct TensorShape(pub Vec<usize>);

/// A tensor value: data + shape.
#[derive(Clone, Debug)]
pub struct TensorOutput {
    pub data: Vec<f32>,
    pub shape: TensorShape,
}

/// A single loaded ONNX inference session.
pub trait InferenceSession: Send {
    /// Attach request-scoped cancellation before a run. Alternate runtimes
    /// without an interrupt API still honor the surrounding boundary checks.
    fn set_cancellation(&mut self, _token: &InferenceCancellationToken) -> Result<(), String> {
        Ok(())
    }

    /// Run inference on preprocessed float32 input in CHW layout.
    /// Returns the raw output tensor data.
    ///
    /// Legacy `input_size`-based entry point for square fixed-size models
    /// (segmentation). Prefer [`InferenceSession::run_nd`] for dynamic and
    /// non-square models (denoise, OCR).
    fn run(&mut self, input: &[f32], input_size: u32) -> Result<Vec<f32>, String>;

    /// Run inference with explicit input dimensions and return the output
    /// tensor with its real shape. Required for fully-convolutional models
    /// (SCUNet, PaddleOCR detection/recognition) whose input and output
    /// shapes are not fixed squares.
    ///
    /// Default implementation delegates to [`InferenceSession::run`] for
    /// square single-output models; OrtSession overrides this.
    fn run_nd(&mut self, input: &[f32], input_dims: &[usize]) -> Result<TensorOutput, String> {
        if input_dims.len() != 4 {
            return Err(format!(
                "run_nd expected 4D input [N,C,H,W], got {}D",
                input_dims.len()
            ));
        }
        let h = input_dims[2] as u32;
        let w = input_dims[3] as u32;
        if h != w {
            return Err(format!(
                "run_nd fallback only supports square inputs (got {h}×{w}); override run_nd"
            ));
        }
        let data = self.run(input, h)?;
        Ok(TensorOutput {
            data,
            shape: TensorShape(vec![input_dims[0], input_dims[1], h as usize, w as usize]),
        })
    }

    /// List the model's output names (for commands that need to pick one).
    fn output_names(&self) -> Vec<String>;

    /// Execution provider that created this session (`native-webgpu` or
    /// `native-cpu`). Defaults to the CPU provider for non-ORT runtimes.
    fn execution_provider(&self) -> &'static str {
        "native-cpu"
    }

    /// List the model's input names (for multi-input model validation).
    fn input_names(&self) -> Vec<String> {
        Vec::new()
    }

    /// Run inference with multiple named inputs, each with explicit dimensions.
    /// Used by multi-input models (LaMa, etc.).
    fn run_multi(&mut self, _inputs: &[(&str, &[f32], &[usize])]) -> Result<TensorOutput, String> {
        Err("run_multi not implemented by this runtime".to_string())
    }
}

// ── OrtInferenceRuntime ───────────────────────────────────────────────

/// ONNX Runtime implementation of [`InferenceRuntime`].
///
/// Wraps `ort::session::Session` behind the trait interface.
/// This is the only runtime used in production builds; the trait
/// exists to reduce bus-factor risk (the `ort` crate is single-maintainer)
/// and to enable testing without a real ONNX Runtime installation.
pub struct OrtInferenceRuntime;

/// A session created by [`OrtInferenceRuntime`].
pub(crate) struct OrtSession {
    pub(crate) inner: Session,
    run_options: Arc<ort::session::RunOptions>,
    output_name: String,
    output_names: Vec<String>,
    provider: &'static str,
}

impl OrtInferenceRuntime {
    pub(crate) fn create_session_with_policy(
        &self,
        model_path: &Path,
        policy: crate::webgpu_ep::InferenceProviderPolicy,
    ) -> Result<OrtSession, String> {
        use crate::webgpu_ep::InferenceProviderPolicy;

        // Disable the actual CPU arena, not an arbitrary configuration entry.
        // ORT accepted "session.enable_cpu_mem_arena=0" while still reporting
        // enable_cpu_mem_arena:1 and allocating a BFCArena. The CPU EP builder
        // calls DisableCpuMemArena; native_memory_policy checks the real options.
        // This controls retained allocations, not the graph's required peak.
        let base_builder = || -> Result<ort::session::builder::SessionBuilder, String> {
            Session::builder()
                .map_err(|e| format!("Failed to create ONNX session: {e}"))?
                .with_execution_providers([ort::ep::CPU::default()
                    .with_arena_allocator(false)
                    .build()])
                .map_err(|e| format!("Failed to disable CPU memory arena: {e}"))?
                .with_memory_pattern(false)
                .map_err(|e| format!("Failed to disable memory pattern: {e}"))
        };

        // Provider policy: Auto prefers the WebGPU plugin EP when a device is
        // registered, Cpu always uses the CPU EP, Gpu requires WebGPU. Any
        // Auto failure falls back to a fresh CPU builder, never to a broken
        // session, and the user-visible status names what happened.
        let (mut builder, mut provider) = if crate::webgpu_ep::device_usable()
            && !matches!(policy, InferenceProviderPolicy::Cpu)
        {
            match crate::webgpu_ep::attach_webgpu(base_builder()?) {
                Ok(builder) => (builder, "native-webgpu"),
                Err(err) => {
                    if matches!(policy, InferenceProviderPolicy::Gpu) {
                        return Err(err);
                    }
                    crate::webgpu_ep::note_attach_failure(&err);
                    (base_builder()?, "native-cpu")
                }
            }
        } else {
            if matches!(policy, InferenceProviderPolicy::Gpu) {
                return Err(
                    "WebGPU execution provider is unavailable; select Automatic or CPU".to_string(),
                );
            }
            (base_builder()?, "native-cpu")
        };

        let session = match builder.commit_from_file(model_path) {
            Ok(session) => session,
            Err(error)
                if provider == "native-webgpu"
                    && matches!(policy, InferenceProviderPolicy::Auto) =>
            {
                let gpu_error = format!(
                    "Failed to load model from '{}' with native WebGPU: {error}",
                    model_path.display()
                );
                crate::webgpu_ep::note_attach_failure(&gpu_error);
                provider = "native-cpu";
                base_builder()?
                    .commit_from_file(model_path)
                    .map_err(|cpu_error| {
                        format!(
                            "{gpu_error}; CPU session fallback also failed for '{}': {cpu_error}",
                            model_path.display()
                        )
                    })?
            }
            Err(error) => {
                return Err(format!(
                    "Failed to load model from '{}': {error}",
                    model_path.display()
                ));
            }
        };

        let output_names: Vec<String> = session
            .outputs()
            .iter()
            .map(|o| o.name().to_owned())
            .collect();
        let output_name = output_names
            .first()
            .ok_or("No output found in model")?
            .clone();

        Ok(OrtSession {
            inner: session,
            run_options: Arc::new(
                ort::session::RunOptions::new()
                    .map_err(|error| format!("Failed to create inference run options: {error}"))?,
            ),
            output_name,
            output_names,
            provider,
        })
    }
}

impl InferenceRuntime for OrtInferenceRuntime {
    fn create_session(&self, model_path: &Path) -> Result<Box<dyn InferenceSession>, String> {
        self.create_session_with_policy(model_path, crate::webgpu_ep::inference_provider_policy())
            .map(|session| Box::new(session) as Box<dyn InferenceSession>)
    }

    fn create_cpu_session(&self, model_path: &Path) -> Result<Box<dyn InferenceSession>, String> {
        self.create_session_with_policy(model_path, crate::webgpu_ep::InferenceProviderPolicy::Cpu)
            .map(|session| Box::new(session) as Box<dyn InferenceSession>)
    }
}

impl InferenceSession for OrtSession {
    fn set_cancellation(&mut self, token: &InferenceCancellationToken) -> Result<(), String> {
        self.run_options = token.bind_run_options()?;
        Ok(())
    }

    fn execution_provider(&self) -> &'static str {
        self.provider
    }

    fn run(&mut self, input: &[f32], input_size: u32) -> Result<Vec<f32>, String> {
        let input_name = self
            .inner
            .inputs()
            .first()
            .ok_or("No input found in model")?
            .name()
            .to_owned();

        let tensor = ort::value::Tensor::from_array((
            [1usize, 3, input_size as usize, input_size as usize],
            input.to_vec(),
        ))
        .map_err(|e| format!("Failed to create input tensor: {e}"))?;

        let outputs = self
            .inner
            .run_with_options(
                ort::inputs! { input_name.as_str() => tensor },
                &self.run_options,
            )
            .map_err(|e| format!("ONNX inference failed: {e}"))?;

        let output = outputs
            .get(&self.output_name)
            .ok_or("Output not found in results")?;

        let (_, output_data) = output
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract output tensor: {e}"))?;

        crate::webgpu_ep::note_run(self.provider);
        Ok(output_data.to_vec())
    }

    fn run_nd(&mut self, input: &[f32], input_dims: &[usize]) -> Result<TensorOutput, String> {
        if input_dims.len() < 2 {
            return Err(format!(
                "run_nd expected at least 2D input, got {}D",
                input_dims.len()
            ));
        }
        let input_name = self
            .inner
            .inputs()
            .first()
            .ok_or("No input found in model")?
            .name()
            .to_owned();

        let tensor = ort::value::Tensor::from_array((input_dims.to_vec(), input.to_vec()))
            .map_err(|e| format!("Failed to create input tensor: {e}"))?;

        let outputs = self
            .inner
            .run_with_options(
                ort::inputs! { input_name.as_str() => tensor },
                &self.run_options,
            )
            .map_err(|e| format!("ONNX inference failed: {e}"))?;

        let output = outputs
            .get(&self.output_name)
            .ok_or("Output not found in results")?;

        let (shape, output_data) = output
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract output tensor: {e}"))?;

        let shape_usize: Vec<usize> = shape.iter().map(|&d| d as usize).collect();
        crate::webgpu_ep::note_run(self.provider);
        Ok(TensorOutput {
            data: output_data.to_vec(),
            shape: TensorShape(shape_usize),
        })
    }

    fn output_names(&self) -> Vec<String> {
        self.output_names.clone()
    }

    fn input_names(&self) -> Vec<String> {
        self.inner
            .inputs()
            .iter()
            .map(|i| i.name().to_owned())
            .collect()
    }

    fn run_multi(&mut self, inputs: &[(&str, &[f32], &[usize])]) -> Result<TensorOutput, String> {
        use ort::session::SessionInputValue;
        use std::borrow::Cow;

        let mut ort_inputs: Vec<(Cow<'_, str>, SessionInputValue<'_>)> =
            Vec::with_capacity(inputs.len());
        for (name, data, dims) in inputs {
            let tensor = ort::value::Tensor::from_array((dims.to_vec(), data.to_vec()))
                .map_err(|e| format!("Failed to create input tensor '{name}': {e}"))?;
            ort_inputs.push((Cow::from(name.to_string()), SessionInputValue::from(tensor)));
        }

        let outputs = self
            .inner
            .run_with_options(ort_inputs, &self.run_options)
            .map_err(|e| format!("ONNX multi-input inference failed: {e}"))?;

        let output = outputs
            .get(&self.output_name)
            .ok_or("Output not found in results")?;

        let (shape, output_data) = output
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract output tensor: {e}"))?;

        let shape_usize: Vec<usize> = shape.iter().map(|&d| d as usize).collect();
        crate::webgpu_ep::note_run(self.provider);
        Ok(TensorOutput {
            data: output_data.to_vec(),
            shape: TensorShape(shape_usize),
        })
    }
}

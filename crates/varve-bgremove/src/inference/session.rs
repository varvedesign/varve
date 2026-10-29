//! Process-wide runtime registry, model-session checkout, and automatic-GPU
//! fallback quarantine.

use super::prelude::*;
use super::runtime::{InferenceRuntime, InferenceSession, OrtInferenceRuntime};

// ── Default runtime instance ──────────────────────────────────────────

static CURRENT_RUNTIME: OnceLock<Box<dyn InferenceRuntime>> = OnceLock::new();
static SESSION_POOL: OnceLock<SessionPool<Box<dyn InferenceSession>>> = OnceLock::new();
static AUTO_GPU_MODEL_FAILURES: OnceLock<Mutex<HashMap<PathBuf, String>>> = OnceLock::new();

/// Set the inference runtime for the current process.
/// Must be called before any inference; panics if called twice.
pub fn set_runtime(runtime: Box<dyn InferenceRuntime>) {
    CURRENT_RUNTIME
        .set(runtime)
        .ok()
        .expect("InferenceRuntime already set");
}

fn get_runtime() -> &'static dyn InferenceRuntime {
    CURRENT_RUNTIME
        .get()
        .map(|b| b.as_ref())
        .unwrap_or(&OrtInferenceRuntime)
}

fn get_session_pool() -> &'static SessionPool<Box<dyn InferenceSession>> {
    SESSION_POOL.get_or_init(|| SessionPool::new(SessionPoolLimits::default()))
}

fn auto_gpu_model_failures() -> &'static Mutex<HashMap<PathBuf, String>> {
    AUTO_GPU_MODEL_FAILURES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn model_failure_key(model_path: &Path) -> PathBuf {
    model_path.to_path_buf()
}

pub(super) fn auto_gpu_model_is_quarantined(model_path: &Path) -> bool {
    auto_gpu_model_failures()
        .lock()
        .map(|failures| failures.contains_key(&model_failure_key(model_path)))
        .unwrap_or(false)
}

pub(super) fn quarantine_auto_gpu_model(model_path: &Path, reason: &str) {
    if let Ok(mut failures) = auto_gpu_model_failures().lock() {
        failures.insert(model_failure_key(model_path), reason.to_owned());
    }
}

/// Clear model-scoped automatic GPU fallbacks after a device/provider
/// re-detection. Explicit CPU/GPU policy selection does not mutate this
/// quarantine; re-detection is the deliberate recovery boundary.
pub fn clear_auto_gpu_model_quarantine() {
    if let Ok(mut failures) = auto_gpu_model_failures().lock() {
        failures.clear();
    }
}

/// Return the reason for an automatic GPU fallback for one model, if any.
/// This is diagnostics-only state and is never persisted into a document.
pub fn auto_gpu_model_fallback_reason(model_id: &str) -> Option<String> {
    let path = model::model_path(model_id);
    auto_gpu_model_failures()
        .lock()
        .ok()
        .and_then(|failures| failures.get(&model_failure_key(&path)).cloned())
}

/// All model paths currently quarantined from automatic WebGPU execution,
/// with the reason, for capability/diagnostics surfaces. Diagnostics-only;
/// never persisted.
pub fn auto_gpu_model_fallbacks() -> Vec<(String, String)> {
    let mut entries: Vec<(String, String)> = auto_gpu_model_failures()
        .lock()
        .map(|failures| {
            failures
                .iter()
                .map(|(path, reason)| (path.to_string_lossy().into_owned(), reason.clone()))
                .collect()
        })
        .unwrap_or_default();
    entries.sort();
    entries
}

fn provider_cache_key(model_path: &Path, provider: &str) -> String {
    format!("{}::{provider}", model_path.to_string_lossy())
}

fn model_memory_estimate(model_path: &Path) -> u64 {
    // The graph file size is a poor reservation on its own: BiRefNet Lite is a
    // 224 MB file whose measured native CPU peak RSS is ~432 MiB, while models
    // with larger decoders (IS-Net) need several times their file size. Use the
    // canonical model metadata for cache eviction and diagnostics, with a
    // conservative file-size fallback for future models that have not yet been
    // qualified.
    let model_id = model_path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    model::model_info(model_id)
        .and_then(|info| info.peak_memory_bytes)
        .or_else(|| {
            std::fs::metadata(model_path)
                .ok()
                .map(|metadata| metadata.len())
        })
        .unwrap_or_default()
}

pub(super) fn automatic_gpu_fallback_allowed() -> bool {
    matches!(
        crate::webgpu_ep::inference_provider_policy(),
        crate::webgpu_ep::InferenceProviderPolicy::Auto
    )
}

pub(super) fn execution_provider_fallback<T, F>(
    model_path: &Path,
    cancellation: &InferenceCancellationToken,
    mut session: SessionLease<Box<dyn InferenceSession>>,
    mut run: F,
    checkout_cpu: impl FnOnce(
        &Path,
        &InferenceCancellationToken,
    ) -> Result<SessionLease<Box<dyn InferenceSession>>, String>,
) -> Result<(T, String), String>
where
    F: FnMut(&mut dyn InferenceSession) -> Result<T, String>,
{
    session.set_cancellation(cancellation)?;
    let provider = session.execution_provider();
    match run(&mut **session) {
        Ok(value) => Ok((value, provider.to_owned())),
        Err(gpu_error) if provider == "native-webgpu" && automatic_gpu_fallback_allowed() => {
            if cancellation.is_cancelled() {
                session.discard();
                return Err("Inference cancelled".to_owned());
            }
            let reason = format!(
                "Model '{}' returned an execution error on native WebGPU: {gpu_error}",
                model_path.display()
            );
            quarantine_auto_gpu_model(model_path, &reason);
            session.discard();

            let mut cpu_session = checkout_cpu(model_path, cancellation).map_err(|error| {
                format!("{reason}; CPU fallback session could not be created: {error}")
            })?;
            let cpu_provider = cpu_session.execution_provider().to_owned();
            cpu_session.set_cancellation(cancellation)?;
            let cpu_result = run(&mut **cpu_session);
            match cpu_result {
                Ok(value) => Ok((value, cpu_provider)),
                Err(cpu_error) => {
                    cpu_session.discard();
                    Err(format!("{reason}; CPU fallback also failed: {cpu_error}"))
                }
            }
        }
        Err(error) => {
            // A failed session is not returned to the cache. This applies to
            // explicit WebGPU requests and to CPU/provider failures alike.
            session.discard();
            Err(error)
        }
    }
}

pub(super) fn checkout_session(
    model_path: &std::path::Path,
    cancellation: &InferenceCancellationToken,
) -> Result<SessionLease<Box<dyn InferenceSession>>, String> {
    let policy = crate::webgpu_ep::inference_provider_policy();
    let use_cpu = matches!(policy, crate::webgpu_ep::InferenceProviderPolicy::Cpu)
        || (matches!(policy, crate::webgpu_ep::InferenceProviderPolicy::Auto)
            && (!crate::webgpu_ep::device_usable() || auto_gpu_model_is_quarantined(model_path)));
    let expected_provider = if use_cpu {
        "native-cpu"
    } else {
        "native-webgpu"
    };
    let key = provider_cache_key(model_path, expected_provider);
    let estimated_bytes = model_memory_estimate(model_path);
    let mut session = get_session_pool().checkout(&key, estimated_bytes, cancellation, || {
        if use_cpu {
            get_runtime().create_cpu_session(model_path)
        } else {
            get_runtime().create_session(model_path)
        }
    })?;
    // Auto attachment may fail closed to CPU, and alternate runtimes may
    // expose a different provider than the requested bucket. Cache by what
    // the session reports, never by the request alone.
    session.set_model_key(provider_cache_key(model_path, session.execution_provider()));
    Ok(session)
}

pub(super) fn checkout_cpu_session(
    model_path: &Path,
    cancellation: &InferenceCancellationToken,
) -> Result<SessionLease<Box<dyn InferenceSession>>, String> {
    let expected_key = provider_cache_key(model_path, "native-cpu");
    let mut session = get_session_pool().checkout(
        &expected_key,
        model_memory_estimate(model_path),
        cancellation,
        || get_runtime().create_cpu_session(model_path),
    )?;
    session.set_model_key(provider_cache_key(model_path, session.execution_provider()));
    Ok(session)
}

/// Snapshot native model-session reuse and admission metrics.
pub fn session_pool_metrics() -> SessionPoolMetrics {
    get_session_pool().metrics()
}

/// Explicitly unload idle sessions for one model. Active inference is not
/// interrupted and can be unloaded after it returns.
pub fn unload_model_session(model_id: &str) -> usize {
    let path = model::model_path(model_id);
    ["native-cpu", "native-webgpu"]
        .iter()
        .map(|provider| get_session_pool().unload(&provider_cache_key(&path, provider)))
        .sum()
}

/// Explicitly unload every idle native model session.
pub fn unload_all_model_sessions() -> usize {
    get_session_pool().unload_all()
}

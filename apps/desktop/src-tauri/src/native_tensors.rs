//! Native sessions behind the shared inference worker's tensor protocol.
//! Handles are opaque, catalog-owned and never freed while a run owns them.

use crate::native_jobs::NativeJobs;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use varve_bgremove::tensor_runtime::TensorSession;
use varve_bgremove::tensor_wire;
use varve_bgremove::InferenceCancellationToken;

// The shared worker retains three sessions and admits one replacement before
// confirming eviction. The incoming model's reservation covers that overlap.
const MAX_SESSIONS: usize = 4;
static JOBS: LazyLock<NativeJobs> = LazyLock::new(NativeJobs::default);
static SESSIONS: LazyLock<Mutex<HashMap<String, Entry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

enum Entry {
    Loading,
    Ready {
        model_id: String,
        session: Arc<Mutex<TensorSession>>,
    },
}

struct LoadingSlot(Option<String>);

impl Drop for LoadingSlot {
    fn drop(&mut self) {
        if let (Some(id), Ok(mut sessions)) = (&self.0, SESSIONS.lock()) {
            sessions.remove(id);
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionInfo {
    session_id: String,
    model_id: String,
    input_names: Vec<String>,
    output_names: Vec<String>,
    execution_provider: String,
}

fn open_at(
    path: &Path,
    model_id: &str,
    cancellation: &InferenceCancellationToken,
) -> Result<SessionInfo, String> {
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".into());
    }
    let id = crate::uuid();
    {
        let mut sessions = SESSIONS
            .lock()
            .map_err(|_| "Native session state is unavailable")?;
        if sessions.len() >= MAX_SESSIONS {
            return Err(
                "Native session capacity is full; release idle models before loading another"
                    .into(),
            );
        }
        sessions.insert(id.clone(), Entry::Loading);
    }
    let mut slot = LoadingSlot(Some(id.clone()));
    let session = TensorSession::open(path)?;
    if cancellation.is_cancelled() {
        return Err("Inference cancelled".into());
    }
    let info = SessionInfo {
        session_id: id.clone(),
        model_id: model_id.to_owned(),
        input_names: session.input_names(),
        output_names: session.output_names(),
        execution_provider: session.execution_provider().into(),
    };
    SESSIONS
        .lock()
        .map_err(|_| "Native session state is unavailable")?
        .insert(
            id,
            Entry::Ready {
                model_id: model_id.to_owned(),
                session: Arc::new(Mutex::new(session)),
            },
        );
    slot.0 = None;
    Ok(info)
}

#[tauri::command]
pub(crate) async fn open_native_tensor_session(
    app: tauri::AppHandle,
    request_id: String,
    model_id: String,
) -> Result<SessionInfo, String> {
    let job = JOBS.start(Some(&request_id))?;
    tauri::async_runtime::spawn_blocking(move || {
        if !crate::ensure_native_ai(&app) {
            return Err("Native ONNX Runtime is unavailable on this desktop build".into());
        }
        let path = crate::inference_models::prepare_path(&app, &model_id)?
            .ok_or_else(|| format!("Native model '{model_id}' is not installed"))?;
        if path.extension().and_then(|extension| extension.to_str()) != Some("onnx") {
            return Err("This catalog entry is not an executable ONNX graph".into());
        }
        open_at(&path, &model_id, &job.cancellation)
    })
    .await
    .map_err(|error| format!("Native session loading failed: {error}"))?
}

fn run_packet(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let (mut context, tensors) = tensor_wire::decode(bytes)?;
    let job = JOBS.start(Some(&context.request_id))?;
    let session = {
        let sessions = SESSIONS
            .lock()
            .map_err(|_| "Native session state is unavailable")?;
        match sessions.get(&context.session_id) {
            Some(Entry::Ready { model_id, session }) if model_id == &context.model_id => {
                Arc::clone(session)
            }
            _ => return Err("Native model/session identity is missing or does not match".into()),
        }
    };
    // The cloned Arc is the reservation: release cannot report success while
    // this reference exists, including the gap before the mutex is acquired.
    let mut loaded = session
        .try_lock()
        .map_err(|_| "This native model is already executing")?;
    context.execution_provider = Some(loaded.execution_provider().into());
    let outputs = loaded.run(tensors, &job.cancellation)?;
    tensor_wire::encode(context, &outputs)
}

#[tauri::command]
pub(crate) async fn run_native_tensor_session(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if bytes.len() <= 256 * 1024 * 1024 + 64 * 1024 + 8 => {
            bytes.clone()
        }
        _ => return Err("Native inference requires a bounded binary tensor packet".into()),
    };
    tauri::async_runtime::spawn_blocking(move || run_packet(&bytes).map(tauri::ipc::Response::new))
        .await
        .map_err(|error| format!("Native inference task failed: {error}"))?
}

fn release(session_id: &str) -> Result<(), String> {
    let entry = {
        let mut sessions = SESSIONS
            .lock()
            .map_err(|_| "Native session state is unavailable")?;
        match sessions.get(session_id) {
            Some(Entry::Loading) => return Err("Native session is still loading".into()),
            Some(Entry::Ready { session, .. }) if Arc::strong_count(session) > 1 => {
                return Err("Native session is still executing".into())
            }
            // A lost IPC acknowledgement may be retried after ORT was already
            // destroyed. An absent opaque handle owns no native resources.
            None => return Ok(()),
            _ => {}
        }
        sessions.remove(session_id)
    };
    // Destruction can be expensive. The command owns this on a blocking worker,
    // and only acknowledges release after ORT has destroyed the session.
    drop(entry);
    Ok(())
}

#[tauri::command]
pub(crate) async fn release_native_tensor_session(session_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || release(&session_id))
        .await
        .map_err(|error| format!("Native session release failed: {error}"))?
}

#[tauri::command]
pub(crate) fn cancel_native_tensor_inference(request_id: String) -> Result<(), String> {
    JOBS.cancel(&request_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use varve_bgremove::tensor_runtime::{NamedTensor, TensorData};

    #[test]
    #[ignore = "executes the bundled U2-NetP graph with the shipped native runtime"]
    fn real_tensor_transport_runs_all_outputs_and_releases_actual_session() {
        varve_bgremove::runtime::init_native_runtime(Path::new(
            &std::env::var("ORT_DYLIB_PATH").expect("shipped runtime"),
        ))
        .unwrap();
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/models/u2netp.onnx");
        let info = open_at(&path, "u2netp", &InferenceCancellationToken::default()).unwrap();
        let packet = tensor_wire::encode(
            tensor_wire::TensorContext {
                request_id: crate::uuid(),
                session_id: info.session_id.clone(),
                model_id: "u2netp".into(),
                execution_provider: None,
            },
            &[NamedTensor {
                name: info.input_names[0].clone(),
                dims: vec![1, 3, 320, 320],
                data: TensorData::Float32(vec![0.5; 3 * 320 * 320]),
            }],
        )
        .unwrap();
        let result = run_packet(&packet);
        release(&info.session_id).unwrap();
        let (context, outputs) = tensor_wire::decode(&result.unwrap()).unwrap();
        assert_eq!(context.execution_provider.as_deref(), Some("native-cpu"));
        assert_eq!(outputs.len(), info.output_names.len());
        assert!(outputs.iter().all(|tensor| tensor.dims == [1, 1, 320, 320]));
        assert!(run_packet(&packet).unwrap_err().contains("identity"));
    }
}

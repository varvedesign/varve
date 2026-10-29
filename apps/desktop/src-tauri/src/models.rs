//! Inference model download/path/delete commands and model-file storage extracted from the crate root (Batch B/B-01).

#[cfg(test)]
mod tests;

use crate::files::write_file_atomic;
use crate::filesystem;
use crate::inference_models;
use crate::model_artifacts;
use crate::native_jobs;
use sha2::Digest;
use sha2::Sha256;
use std::io::Read;
use std::sync::LazyLock;
use tauri::Emitter;

/// Hash an existing native model without loading the whole model into memory.
/// The digest, not the advertised byte count, is the installation authority.
pub(crate) fn sha256_file(path: &std::path::Path) -> Result<(u64, String), String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("Failed to open existing model: {error}"))?;
    let mut digest = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Failed to read existing model: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
        bytes += read as u64;
    }
    let checksum = digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok((bytes, checksum))
}
pub(crate) fn valid_download_request_id(request_id: &str) -> bool {
    !request_id.is_empty()
        && request_id.len() <= 80
        && request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}
// ---------------------------------------------------------------------------
// Generic inference-model downloads (native, CORS-free)
// ---------------------------------------------------------------------------

pub(crate) static INFERENCE_MODEL_DOWNLOADS: LazyLock<native_jobs::NativeJobs> =
    LazyLock::new(native_jobs::NativeJobs::default);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InferenceModelProgress {
    pub(crate) request_id: String,
    pub(crate) model_id: String,
    pub(crate) loaded: u64,
    pub(crate) total: u64,
}

/// Reject ids that could escape the models directory or collide with another
/// model's file.
pub(crate) fn validate_inference_model_id(model_id: &str) -> Result<(), String> {
    if model_id.is_empty() || model_id.len() > 64 {
        return Err("Invalid model id".into());
    }
    if !model_id
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("Model id may only contain lowercase letters, digits, and dashes".into());
    }
    Ok(())
}

pub(crate) fn validate_inference_sha256(sha256: &str) -> Result<(), String> {
    if sha256.len() != 64
        || !sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("Model SHA-256 must be 64 lowercase hex characters".into());
    }
    Ok(())
}

/// Absolute path of an installed generic inference model, if present.
#[tauri::command]
pub(crate) async fn inference_model_path(
    app: tauri::AppHandle,
    model_id: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(inference_models::prepare_path(&app, &model_id)?
            .map(|path| path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| format!("Native model verification failed: {error}"))?
}

pub(crate) fn inference_model_path_at(
    directory: &std::path::Path,
    model_id: &str,
) -> Result<Option<String>, String> {
    Ok(model_artifacts::verified_path(directory, model_id)?
        .map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub(crate) async fn inference_model_external_data(
    model_id: String,
) -> Result<Option<model_artifacts::ExternalData>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        model_artifacts::external_data(&varve_bgremove::model::models_dir(), &model_id)
    })
    .await
    .map_err(|error| format!("Native model verification failed: {error}"))?
}

#[tauri::command]
pub(crate) fn delete_inference_model(model_id: String) -> Result<bool, String> {
    inference_models::delete_at(&varve_bgremove::model::models_dir(), &model_id)
}

#[tauri::command]
pub(crate) fn cancel_inference_model_download(request_id: String) -> Result<(), String> {
    INFERENCE_MODEL_DOWNLOADS.cancel(&request_id)
}

/// Download a generic inference model to the native model directory and verify
/// its SHA-256 before it is exposed to the webview. Native downloads bypass the
/// release-host CORS restrictions that block browser `fetch`, and keep the
/// bytes out of IndexedDB on desktop.
#[tauri::command]
pub(crate) async fn download_inference_model(
    app: tauri::AppHandle,
    request_id: String,
    model_id: String,
) -> Result<String, String> {
    let job = INFERENCE_MODEL_DOWNLOADS.start(Some(&request_id))?;
    let path = inference_models::download_at(
        &varve_bgremove::model::models_dir(),
        &model_id,
        &request_id,
        &job.cancellation,
        |loaded, total| {
            let _ = app.emit(
                "inference-model-progress",
                InferenceModelProgress {
                    request_id: request_id.clone(),
                    model_id: model_id.clone(),
                    loaded,
                    total,
                },
            );
        },
    )
    .await?;
    Ok(path.to_string_lossy().into_owned())
}
pub(crate) fn model_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = filesystem::AppDirectories::resolve(app)
        .map_err(|error| error.message)?
        .models;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create models dir: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub(crate) fn read_model_file(app: tauri::AppHandle, model_id: String) -> Result<Vec<u8>, String> {
    filesystem::validate_storage_key(&model_id).map_err(|error| error.message)?;
    let path = model_dir(&app)?.join(&model_id);
    std::fs::read(&path).map_err(|e| format!("Failed to read model file {model_id}: {e}"))
}

#[tauri::command]
pub(crate) fn write_model_file(
    app: tauri::AppHandle,
    model_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    filesystem::validate_storage_key(&model_id).map_err(|error| error.message)?;
    let path = model_dir(&app)?.join(&model_id);
    write_file_atomic(&path, &data)
}

#[tauri::command]
pub(crate) fn delete_model_file(app: tauri::AppHandle, model_id: String) -> Result<(), String> {
    filesystem::validate_storage_key(&model_id).map_err(|error| error.message)?;
    let path = model_dir(&app)?.join(&model_id);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete model file {model_id}: {e}"))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn list_model_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = model_dir(&app)?;
    let mut ids = Vec::new();
    if dir.exists() {
        for entry in
            std::fs::read_dir(&dir).map_err(|e| format!("Failed to read models dir: {e}"))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                ids.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    Ok(ids)
}

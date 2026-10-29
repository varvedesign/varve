//! Generative model download/cancel commands (Batch B/B-01).

use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOADS;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_AVAILABLE;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_CANCELLATIONS;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_SHA256;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_SIZE;
use crate::inference::generative::config::GENERATIVE_MODEL_FILENAME;
use crate::inference::generative::config::GENERATIVE_MODEL_UNAVAILABLE_REASON;
use crate::inference::generative::download::available_disk_space;
use crate::inference::generative::download::download_generative_model_attempt;
use crate::inference::generative::download::generative_model_download_cancelled;
use crate::inference::generative::import::write_generative_model_metadata;
use crate::inference::generative::model_status::model_status_blocking;
use crate::inference::generative::model_status::GenerativeModelStatus;
use crate::models::model_dir;
use crate::models::sha256_file;
use crate::models::valid_download_request_id;
use std::time::Duration;

/// Claim a model-download request before any filesystem or network work starts.
///
/// Cancellation can arrive after the renderer queues the command but before
/// Tauri polls the command future. Treat that tombstone as authoritative at
/// dispatch time instead of clearing it and accidentally starting the
/// download.
pub(crate) fn begin_generative_model_download(request_id: &str) -> Result<(), String> {
    let mut cancellations = GENERATIVE_MODEL_DOWNLOAD_CANCELLATIONS
        .lock()
        .map_err(|_| "Generative model download state is unavailable".to_string())?;
    if cancellations.remove(request_id) {
        return Err("Download cancelled".into());
    }

    let mut downloads = GENERATIVE_MODEL_DOWNLOADS
        .lock()
        .map_err(|_| "Generative model download state is unavailable".to_string())?;
    if !downloads.insert(request_id.to_owned()) {
        return Err("A generative model download is already active".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn download_generative_edit_model(
    app: tauri::AppHandle,
    request_id: String,
) -> Result<GenerativeModelStatus, String> {
    if !valid_download_request_id(&request_id) {
        return Err("Invalid model-download request id".into());
    }
    if !GENERATIVE_MODEL_DOWNLOAD_AVAILABLE {
        return Err(GENERATIVE_MODEL_UNAVAILABLE_REASON.into());
    }
    begin_generative_model_download(&request_id)?;

    let result = async {
        let destination = model_dir(&app)?.join(GENERATIVE_MODEL_FILENAME);
        if let Ok((size, checksum)) = sha256_file(&destination) {
            if size == GENERATIVE_MODEL_DOWNLOAD_SIZE && checksum == GENERATIVE_MODEL_DOWNLOAD_SHA256 {
                if generative_model_download_cancelled(&request_id) {
                    return Err("Download cancelled".into());
                }
                return model_status_blocking(&app);
            }
        }
        let partial_path = destination.with_extension("gguf.part");
        let partial_bytes = partial_path.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        let required_bytes = GENERATIVE_MODEL_DOWNLOAD_SIZE
            .saturating_sub(partial_bytes)
            .saturating_add(256 * 1024 * 1024);
        if let Some(available) = available_disk_space(&destination) {
            if available < required_bytes {
                return Err(format!(
                    "Not enough free disk space for the diffusion model: {available} bytes available, {required_bytes} required"
                ));
            }
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.url().scheme() == "https" {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .map_err(|error| format!("Could not create model downloader: {error}"))?;
        let mut last_error = String::from("Generative model download failed");
        for attempt in 0..4 {
            if generative_model_download_cancelled(&request_id) {
                return Err("Download cancelled".into());
            }
            match download_generative_model_attempt(&app, &request_id, &destination, &client).await {
                Ok(()) => {
                    last_error.clear();
                    break;
                }
                Err(error) if error == "Download cancelled" => return Err(error),
                Err(error) => {
                    last_error = error;
                    if attempt < 3 {
                        std::thread::sleep(Duration::from_millis(250 * (1 << attempt)));
                    }
                }
            }
        }
        if !last_error.is_empty() {
            return Err(last_error);
        }
        if generative_model_download_cancelled(&request_id) {
            return Err("Download cancelled".into());
        }
        let (size, checksum) = sha256_file(&destination.with_extension("gguf.part"))?;
        if size != GENERATIVE_MODEL_DOWNLOAD_SIZE || checksum != GENERATIVE_MODEL_DOWNLOAD_SHA256 {
            let _ = std::fs::remove_file(destination.with_extension("gguf.part"));
            return Err(format!(
                "Model SHA-256 mismatch: expected {}, received {checksum}",
                GENERATIVE_MODEL_DOWNLOAD_SHA256
            ));
        }
        let partial = destination.with_extension("gguf.part");
        // Linearize the final cancellation check with the rename. A cancel
        // command that acquires this lock first prevents installation; one
        // that arrives after the rename is a cancellation of the completed
        // operation and cannot leave a half-installed model.
        {
            let cancellations = GENERATIVE_MODEL_DOWNLOAD_CANCELLATIONS
                .lock()
                .map_err(|_| "Generative model download state is unavailable".to_string())?;
            if cancellations.contains(&request_id) {
                return Err("Download cancelled".into());
            }
            if destination.exists() {
                std::fs::remove_file(&destination)
                    .map_err(|error| format!("Could not replace old diffusion model: {error}"))?;
            }
            std::fs::rename(&partial, &destination)
                .map_err(|error| format!("Could not atomically install diffusion model: {error}"))?;
        }
        write_generative_model_metadata(&destination, false)?;
        model_status_blocking(&app)
    }
    .await;
    if let Ok(mut requests) = GENERATIVE_MODEL_DOWNLOADS.lock() {
        requests.remove(&request_id);
    }
    if let Ok(mut requests) = GENERATIVE_MODEL_DOWNLOAD_CANCELLATIONS.lock() {
        requests.remove(&request_id);
    }
    result
}

#[tauri::command]
pub(crate) fn cancel_generative_edit_model_download(request_id: String) -> Result<(), String> {
    if !valid_download_request_id(&request_id) {
        return Err("Invalid model-download request id".into());
    }
    GENERATIVE_MODEL_DOWNLOAD_CANCELLATIONS
        .lock()
        .map_err(|_| "Generative model download state is unavailable".to_string())?
        .insert(request_id);
    Ok(())
}

//! Generative model quality/status/metadata helpers and status command (Batch B/B-01).

use crate::generative_resources;
use crate::inference::generative::config::GENERATIVE_MODEL_CUSTOM_PROFILE;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_AVAILABLE;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_SHA256;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_SIZE;
use crate::inference::generative::config::GENERATIVE_MODEL_FILENAME;
use crate::inference::generative::config::GENERATIVE_MODEL_HANDLE;
use crate::inference::generative::config::GENERATIVE_MODEL_IMPORT_AVAILABLE;
use crate::inference::generative::config::GENERATIVE_MODEL_IMPORT_UNAVAILABLE_REASON;
use crate::inference::generative::config::GENERATIVE_MODEL_INCOMPATIBLE_REASON;
use crate::inference::generative::config::GENERATIVE_MODEL_METADATA_SCHEMA_VERSION;
use crate::inference::generative::config::GENERATIVE_MODEL_METADATA_SUFFIX;
use crate::inference::generative::config::GENERATIVE_MODEL_PROFILE;
use crate::inference::generative::config::GENERATIVE_MODEL_RUNTIME_ID;
use crate::inference::generative::config::GENERATIVE_MODEL_STEM;
use crate::inference::generative::config::GENERATIVE_MODEL_UNAVAILABLE_REASON;
use crate::models::model_dir;
use crate::models::sha256_file;
use serde::Deserialize;
use serde::Serialize;

// A model may only become usable after the frozen real-photograph corpus has
// been reviewed and its exact artifact hash has been intentionally promoted
// here. Keeping this list empty is deliberate while the current SD 1.5
// candidates fail prompt adherence. A local metadata file or a cheap red
// pixel probe must never be able to self-certify a model for product use.
pub(crate) const GENERATIVE_MODEL_QUALITY_CERTIFIED_CHECKSUMS: &[&str] = &[];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenerativeModelDownloadProgress {
    pub(crate) request_id: String,
    pub(crate) loaded: u64,
    pub(crate) total: u64,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct GenerativeModelMetadata {
    pub(crate) schema_version: u32,
    pub(crate) model_handle: String,
    pub(crate) profile_id: String,
    pub(crate) size_bytes: u64,
    pub(crate) checksum_sha256: String,
    pub(crate) runtime_id: String,
    pub(crate) execution_backend: String,
    pub(crate) platform: String,
    pub(crate) architecture: String,
    /// Passed the bounded runtime/prompt compatibility probe. This is not a
    /// release-quality certificate; readiness also requires the allowlisted
    /// reviewed artifact hash below.
    pub(crate) preflight_qualified: bool,
    pub(crate) preflight_qualified_at: Option<u64>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenerativeModelStatus {
    pub(crate) installed: bool,
    pub(crate) ready: bool,
    pub(crate) download_available: bool,
    pub(crate) import_available: bool,
    pub(crate) qualification_available: bool,
    pub(crate) model_handle: Option<String>,
    pub(crate) profile_id: Option<String>,
    pub(crate) checksum_sha256: Option<String>,
    pub(crate) size_bytes: u64,
    pub(crate) partial_bytes: u64,
    pub(crate) reason: Option<String>,
    pub(crate) memory_available_bytes: Option<u64>,
    pub(crate) memory_required_bytes: u64,
    pub(crate) resource_tier: String,
    pub(crate) execution_backend: String,
    pub(crate) platform: String,
    pub(crate) architecture: String,
}

pub(crate) fn generative_model_artifact_is_known_incompatible(checksum_sha256: &str) -> bool {
    checksum_sha256 == GENERATIVE_MODEL_DOWNLOAD_SHA256
}

pub(crate) fn generative_model_profile_is_supported(profile_id: &str) -> bool {
    profile_id == GENERATIVE_MODEL_PROFILE
        || (GENERATIVE_MODEL_IMPORT_AVAILABLE && profile_id == GENERATIVE_MODEL_CUSTOM_PROFILE)
}

pub(crate) fn ensure_generative_model_import_supported() -> Result<(), String> {
    if GENERATIVE_MODEL_IMPORT_AVAILABLE {
        Ok(())
    } else {
        Err(GENERATIVE_MODEL_IMPORT_UNAVAILABLE_REASON.into())
    }
}

pub(crate) fn generative_model_record_is_ready(
    record: &GenerativeModelMetadata,
    size_bytes: u64,
    checksum_sha256: &str,
    resource: &generative_resources::NativeResourceSnapshot,
) -> bool {
    generative_model_record_matches_runtime(record, size_bytes, checksum_sha256, resource)
        && record.preflight_qualified
        && !generative_model_artifact_is_known_incompatible(&record.checksum_sha256)
        && GENERATIVE_MODEL_QUALITY_CERTIFIED_CHECKSUMS
            .iter()
            .any(|certified| *certified == record.checksum_sha256)
}

pub(crate) fn generative_model_record_matches_runtime(
    record: &GenerativeModelMetadata,
    size_bytes: u64,
    checksum_sha256: &str,
    resource: &generative_resources::NativeResourceSnapshot,
) -> bool {
    record.schema_version == GENERATIVE_MODEL_METADATA_SCHEMA_VERSION
        && record.model_handle == GENERATIVE_MODEL_HANDLE
        && generative_model_profile_is_supported(&record.profile_id)
        && record.size_bytes == size_bytes
        && record.checksum_sha256 == checksum_sha256
        && record.runtime_id == GENERATIVE_MODEL_RUNTIME_ID
        && record.execution_backend == resource.execution_backend
        && record.platform == resource.platform
        && record.architecture == resource.architecture
}

pub(crate) fn generative_model_is_ready(
    record: &GenerativeModelMetadata,
    size_bytes: u64,
    checksum_sha256: &str,
    resource: &generative_resources::NativeResourceSnapshot,
) -> bool {
    generative_model_record_is_ready(record, size_bytes, checksum_sha256, resource)
        && resource
            .available_memory_bytes
            .is_some_and(|available| available >= resource.required_memory_bytes)
}

pub(crate) fn managed_generative_model_paths(
    app: &tauri::AppHandle,
) -> Result<Vec<std::path::PathBuf>, String> {
    let dir = model_dir(app)?;
    Ok(["safetensors", "gguf"]
        .into_iter()
        .map(|extension| dir.join(format!("{GENERATIVE_MODEL_STEM}.{extension}")))
        .collect())
}

pub(crate) fn generative_model_metadata_path(model_path: &std::path::Path) -> std::path::PathBuf {
    let file_name = model_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(GENERATIVE_MODEL_STEM);
    model_path.with_file_name(format!("{file_name}{GENERATIVE_MODEL_METADATA_SUFFIX}"))
}

fn read_generative_model_metadata(model_path: &std::path::Path) -> Option<GenerativeModelMetadata> {
    let bytes = std::fs::read(generative_model_metadata_path(model_path)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub(crate) fn unix_timestamp_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub(crate) fn model_status_blocking(
    app: &tauri::AppHandle,
) -> Result<GenerativeModelStatus, String> {
    let resource = generative_resources::snapshot(512, 512);
    let paths = managed_generative_model_paths(app)?;
    for path in &paths {
        if let Ok(metadata) = path.metadata() {
            if metadata.is_file() && metadata.len() > 0 {
                let (size_bytes, checksum_sha256) = sha256_file(path)?;
                let record = read_generative_model_metadata(path);
                let record_matches_runtime = record.as_ref().is_some_and(|record| {
                    generative_model_record_matches_runtime(
                        record,
                        size_bytes,
                        &checksum_sha256,
                        &resource,
                    )
                });
                let memory_available = resource.available_memory_bytes;
                let memory_sufficient = memory_available
                    .map(|available| available >= resource.required_memory_bytes)
                    .unwrap_or(false);
                let ready = record.as_ref().is_some_and(|record| {
                    generative_model_is_ready(record, size_bytes, &checksum_sha256, &resource)
                });
                let known_incompatible =
                    generative_model_artifact_is_known_incompatible(&checksum_sha256);
                let reason = if known_incompatible {
                    Some(GENERATIVE_MODEL_INCOMPATIBLE_REASON.into())
                } else if ready {
                    Some("The local model passed Varve's masked inpainting qualification.".into())
                } else if record_matches_runtime
                    && record
                        .as_ref()
                        .is_some_and(|record| record.preflight_qualified)
                    && !GENERATIVE_MODEL_QUALITY_CERTIFIED_CHECKSUMS
                        .iter()
                        .any(|certified| *certified == checksum_sha256)
                {
                    Some("The model passed the compatibility probe, but no reviewed real-photograph quality certificate is available for this model. Prompt-conditioned generation remains unavailable.".into())
                } else if record_matches_runtime
                    && record
                        .as_ref()
                        .is_some_and(|record| record.preflight_qualified)
                    && memory_available.is_none()
                {
                    Some(format!(
                        "The model passed compatibility validation, but available memory could not be measured on this {}/{} device. Use Quick Cleanup or a smaller local model.",
                        resource.platform, resource.architecture
                    ))
                } else if record_matches_runtime
                    && record
                        .as_ref()
                        .is_some_and(|record| record.preflight_qualified)
                    && !memory_sufficient
                {
                    let available_mib = memory_available.unwrap_or_default() / (1024 * 1024);
                    let required_mib = resource.required_memory_bytes.div_ceil(1024 * 1024);
                    Some(format!(
                        "The model passed compatibility validation, but only {available_mib} MiB is currently available and about {required_mib} MiB is required. Close memory-heavy apps or use Quick Cleanup."
                    ))
                } else if record.is_some() {
                    Some("The model changed, was qualified on another runtime/device, or failed qualification. Validate it again before generation.".into())
                } else {
                    Some(if memory_available.is_none() {
                        format!(
                            "Model installed locally, but available memory could not be measured on this {}/{} device. Use Quick Cleanup or a smaller local model.",
                            resource.platform, resource.architecture
                        )
                    } else {
                        "Model installed locally. Validate it with a masked production run before generation.".into()
                    })
                };
                return Ok(GenerativeModelStatus {
                    installed: true,
                    ready,
                    download_available: GENERATIVE_MODEL_DOWNLOAD_AVAILABLE,
                    import_available: GENERATIVE_MODEL_IMPORT_AVAILABLE,
                    qualification_available: !known_incompatible
                        && record.as_ref().is_some_and(|record| {
                            generative_model_profile_is_supported(&record.profile_id)
                        }),
                    model_handle: record
                        .as_ref()
                        .filter(|record| ready && record.model_handle == GENERATIVE_MODEL_HANDLE)
                        .map(|_| GENERATIVE_MODEL_HANDLE.into()),
                    profile_id: record.as_ref().map(|record| record.profile_id.clone()),
                    checksum_sha256: Some(checksum_sha256),
                    size_bytes,
                    partial_bytes: 0,
                    reason,
                    memory_available_bytes: resource.available_memory_bytes,
                    memory_required_bytes: resource.required_memory_bytes,
                    resource_tier: resource.resource_tier.into(),
                    execution_backend: resource.execution_backend.into(),
                    platform: resource.platform.into(),
                    architecture: resource.architecture.into(),
                });
            }
        }
    }
    let partial_bytes = paths
        .iter()
        .find(|path| {
            path.file_name().and_then(|name| name.to_str()) == Some(GENERATIVE_MODEL_FILENAME)
        })
        .map(|path| path.with_extension("gguf.part"))
        .and_then(|path| path.metadata().ok())
        .map(|metadata| metadata.len().min(GENERATIVE_MODEL_DOWNLOAD_SIZE))
        .unwrap_or(0);
    Ok(GenerativeModelStatus {
        installed: false,
        ready: false,
        download_available: GENERATIVE_MODEL_DOWNLOAD_AVAILABLE,
        import_available: GENERATIVE_MODEL_IMPORT_AVAILABLE,
        qualification_available: false,
        model_handle: None,
        profile_id: None,
        checksum_sha256: None,
        size_bytes: 0,
        partial_bytes,
        reason: Some(GENERATIVE_MODEL_UNAVAILABLE_REASON.into()),
        memory_available_bytes: resource.available_memory_bytes,
        memory_required_bytes: resource.required_memory_bytes,
        resource_tier: resource.resource_tier.into(),
        execution_backend: resource.execution_backend.into(),
        platform: resource.platform.into(),
        architecture: resource.architecture.into(),
    })
}

#[tauri::command]
pub(crate) async fn generative_edit_model_status(
    app: tauri::AppHandle,
) -> Result<GenerativeModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || model_status_blocking(&app))
        .await
        .map_err(|error| format!("Generative model status task failed: {error}"))?
}

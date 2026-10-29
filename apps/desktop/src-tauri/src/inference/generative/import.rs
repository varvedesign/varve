//! Generative model import and qualification commands (Batch B/B-01).

use crate::files::resolve_user_path_approved;
use crate::files::write_file_atomic;
use crate::generative_qualification;
use crate::generative_resources;
use crate::inference::denoise::GENERATIVE_CANCELLATIONS;
use crate::inference::generative::config::GenerativeEditOptions;
use crate::inference::generative::config::GENERATIVE_MODEL_CUSTOM_PROFILE;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_SHA256;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_SIZE;
use crate::inference::generative::config::GENERATIVE_MODEL_HANDLE;
use crate::inference::generative::config::GENERATIVE_MODEL_IMPORT_UNAVAILABLE_REASON;
use crate::inference::generative::config::GENERATIVE_MODEL_INCOMPATIBLE_REASON;
use crate::inference::generative::config::GENERATIVE_MODEL_METADATA_SCHEMA_VERSION;
use crate::inference::generative::config::GENERATIVE_MODEL_PROFILE;
use crate::inference::generative::config::GENERATIVE_MODEL_RUNTIME_ID;
use crate::inference::generative::model_status::ensure_generative_model_import_supported;
use crate::inference::generative::model_status::generative_model_artifact_is_known_incompatible;
use crate::inference::generative::model_status::generative_model_metadata_path;
use crate::inference::generative::model_status::generative_model_profile_is_supported;
use crate::inference::generative::model_status::managed_generative_model_paths;
use crate::inference::generative::model_status::model_status_blocking;
use crate::inference::generative::model_status::unix_timestamp_seconds;
use crate::inference::generative::model_status::GenerativeModelMetadata;
use crate::inference::generative::model_status::GenerativeModelStatus;
use crate::inference::generative::run::generative_edit_blocking_with_requirement;
use crate::inference::generative::run::valid_generation_request_id;
use crate::models::sha256_file;
use crate::uuid;
use base64::Engine as _;
use image::load_from_memory;

#[tauri::command]
pub(crate) fn import_generative_edit_model(
    app: tauri::AppHandle,
    path: String,
) -> Result<GenerativeModelStatus, String> {
    ensure_generative_model_import_supported()?;
    let source = resolve_user_path_approved(&path)?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "Choose a .safetensors or .gguf model file".to_string())?;
    if !matches!(extension.as_str(), "safetensors" | "gguf") {
        return Err("Choose a .safetensors or .gguf model file".into());
    }
    let metadata = source
        .metadata()
        .map_err(|error| format!("Could not read selected model: {error}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > 16 * 1024 * 1024 * 1024 {
        return Err(
            "The selected model file is empty or larger than the 16 GB safety limit".into(),
        );
    }
    let paths = managed_generative_model_paths(&app)?;
    let destination = paths
        .iter()
        .find(|candidate| {
            candidate.extension().and_then(|value| value.to_str()) == Some(extension.as_str())
        })
        .cloned()
        .ok_or_else(|| "Could not resolve managed model storage".to_string())?;
    if source != destination {
        let staging = destination.with_extension(format!("{extension}.importing"));
        std::fs::copy(&source, &staging)
            .map_err(|error| format!("Could not stage the selected model: {error}"))?;
        // The staged copy is complete before the destination is replaced.
        // Windows cannot atomically replace an existing file with rename, so
        // remove only the managed destination after staging has succeeded.
        if destination.exists() {
            std::fs::remove_file(&destination)
                .map_err(|error| format!("Could not replace the installed model: {error}"))?;
        }
        if let Err(error) = std::fs::rename(&staging, &destination) {
            let _ = std::fs::remove_file(&staging);
            return Err(format!("Could not install the selected model: {error}"));
        }
    }
    let _ = std::fs::remove_file(generative_model_metadata_path(&destination));
    for other in paths {
        if other != destination {
            let _ = std::fs::remove_file(&other);
            let _ = std::fs::remove_file(generative_model_metadata_path(&other));
        }
    }
    model_status_blocking(&app)
}

pub(crate) fn qualification_request(
    model_handle: &str,
    request_id: String,
) -> GenerativeEditOptions {
    // SD 1.5 inpainting was trained around a 512px working frame. A tiny
    // 64px probe can return a valid PNG while exercising an unsupported
    // latent shape and must not be allowed to mark a model ready.
    const WIDTH: u32 = 512;
    const HEIGHT: u32 = 512;
    let mut image_data = vec![0u8; (WIDTH * HEIGHT * 4) as usize];
    let mut mask = vec![0u8; (WIDTH * HEIGHT) as usize];
    for y in 0..HEIGHT {
        for x in 0..WIDTH {
            let pixel = ((y * WIDTH + x) * 4) as usize;
            image_data[pixel] = 238;
            image_data[pixel + 1] = 238;
            image_data[pixel + 2] = 238;
            image_data[pixel + 3] = 255;
            if (128..384).contains(&x) && (128..384).contains(&y) {
                mask[(y * WIDTH + x) as usize] = 255;
            }
        }
    }
    GenerativeEditOptions {
        request_id,
        model_handle: model_handle.into(),
        image_data,
        image_w: WIDTH,
        image_h: HEIGHT,
        mask,
        mask_w: WIDTH,
        mask_h: HEIGHT,
        mode: "replace".into(),
        prompt: "a red ceramic apple on a plain light background".into(),
        negative_prompt: "text, watermark, blurry".into(),
        output_w: WIDTH,
        output_h: HEIGHT,
        steps: 4,
        guidance_scale: 7.0,
        image_guidance_scale: 1.0,
        mask_input: "image-and-mask".into(),
        mask_convention: "white-edit-black-preserve".into(),
        seed: 417,
        strength: 0.85,
    }
}

pub(crate) fn resolve_generative_model_for_run(
    app: &tauri::AppHandle,
    require_qualified: bool,
) -> Result<std::path::PathBuf, String> {
    let status = model_status_blocking(app)?;
    if !status.installed {
        return Err("The local diffusion model is not installed".into());
    }
    if generative_model_artifact_is_known_incompatible(
        status.checksum_sha256.as_deref().unwrap_or_default(),
    ) {
        return Err(status
            .reason
            .unwrap_or_else(|| GENERATIVE_MODEL_INCOMPATIBLE_REASON.into()));
    }
    if !status
        .profile_id
        .as_deref()
        .is_some_and(generative_model_profile_is_supported)
    {
        return Err(GENERATIVE_MODEL_IMPORT_UNAVAILABLE_REASON.into());
    }
    if require_qualified && !status.ready {
        return Err(status.reason.unwrap_or_else(|| {
            "The local diffusion model has not passed inpainting qualification".into()
        }));
    }
    managed_generative_model_paths(app)?
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| "The installed diffusion model is no longer available".to_string())
}

pub(crate) fn generation_cancel_requested(request_id: &str) -> bool {
    GENERATIVE_CANCELLATIONS
        .lock()
        .map(|requests| requests.contains(request_id))
        .unwrap_or(true)
}

fn clear_generation_cancellation(request_id: &str) {
    if let Ok(mut requests) = GENERATIVE_CANCELLATIONS.lock() {
        requests.remove(request_id);
    }
}

pub(crate) fn take_generation_cancellation(request_id: &str) -> bool {
    GENERATIVE_CANCELLATIONS
        .lock()
        .map(|mut requests| requests.remove(request_id))
        .unwrap_or(true)
}

/// Clear a generation cancellation tombstone when its request reaches a
/// terminal state. The tombstone must outlive the renderer's cancel call long
/// enough to cover helper startup, but it must not accumulate when a request
/// fails before a child process is created.
pub(crate) struct GenerationCancellationGuard {
    pub(crate) request_id: String,
}

impl Drop for GenerationCancellationGuard {
    fn drop(&mut self) {
        clear_generation_cancellation(&self.request_id);
    }
}

pub(crate) fn write_generative_model_metadata(
    model_path: &std::path::Path,
    preflight_qualified: bool,
) -> Result<(), String> {
    let (size_bytes, checksum_sha256) = sha256_file(model_path)?;
    let resource = generative_resources::snapshot(512, 512);
    let profile_id = if size_bytes == GENERATIVE_MODEL_DOWNLOAD_SIZE
        && checksum_sha256 == GENERATIVE_MODEL_DOWNLOAD_SHA256
    {
        GENERATIVE_MODEL_PROFILE
    } else {
        GENERATIVE_MODEL_CUSTOM_PROFILE
    };
    let metadata = GenerativeModelMetadata {
        schema_version: GENERATIVE_MODEL_METADATA_SCHEMA_VERSION,
        model_handle: GENERATIVE_MODEL_HANDLE.into(),
        profile_id: profile_id.into(),
        size_bytes,
        checksum_sha256,
        runtime_id: GENERATIVE_MODEL_RUNTIME_ID.into(),
        execution_backend: resource.execution_backend.into(),
        platform: resource.platform.into(),
        architecture: resource.architecture.into(),
        preflight_qualified,
        preflight_qualified_at: preflight_qualified.then(unix_timestamp_seconds),
    };
    let bytes = serde_json::to_vec_pretty(&metadata)
        .map_err(|error| format!("Could not serialize model metadata: {error}"))?;
    write_file_atomic(&generative_model_metadata_path(model_path), &bytes)
}

#[tauri::command]
pub(crate) async fn qualify_generative_edit_model(
    app: tauri::AppHandle,
    request_id: Option<String>,
) -> Result<GenerativeModelStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let model_path = resolve_generative_model_for_run(&app, false)?;
        let request_id = request_id.unwrap_or_else(|| format!("qualification-{}", uuid()));
        if !valid_generation_request_id(&request_id) {
            return Err("Invalid generative qualification request id".into());
        }
        let options = qualification_request(GENERATIVE_MODEL_HANDLE, request_id);
        let qualification_request_id = options.request_id.clone();
        let qualification_mask = options.mask.clone();
        let qualification_width = options.mask_w;
        let qualification_height = options.mask_h;
        // Invalidate any earlier preflight result before starting. A
        // cancellation, crash, or failed semantic check must never leave a
        // stale compatibility record for the same bytes.
        write_generative_model_metadata(&model_path, false)?;
        let result = generative_edit_blocking_with_requirement(app.clone(), options, false)?;
        if result.width != qualification_width || result.height != qualification_height {
            return Err(format!(
                "The model returned {}x{} during qualification; expected {}x{}",
                result.width, result.height, qualification_width, qualification_height
            ));
        }
        let generated = base64::engine::general_purpose::STANDARD
            .decode(result.png_base64)
            .map_err(|error| format!("Qualification output was not valid PNG data: {error}"))?;
        let decoded = load_from_memory(&generated)
            .map_err(|error| format!("Qualification output could not be decoded: {error}"))?;
        if decoded.width() != qualification_width || decoded.height() != qualification_height {
            return Err("Qualification output dimensions could not be verified".into());
        }
        let output = decoded.to_rgb8();
        if take_generation_cancellation(&qualification_request_id) {
            return Err("Generation was cancelled".into());
        }
        generative_qualification::validate_masked_prompt_output(
            &output,
            &qualification_mask,
            qualification_width,
            qualification_height,
            [238; 3],
        )?;
        if take_generation_cancellation(&qualification_request_id) {
            return Err("Generation was cancelled".into());
        }
        // This records only that the helper and prompt signal were compatible
        // with the fixed probe. Product readiness still requires an exact
        // hash in GENERATIVE_MODEL_QUALITY_CERTIFIED_CHECKSUMS after the
        // reviewed photographic corpus has passed.
        write_generative_model_metadata(&model_path, true)?;
        model_status_blocking(&app)
    })
    .await
    .map_err(|error| format!("Generative model qualification task failed: {error}"))?
}

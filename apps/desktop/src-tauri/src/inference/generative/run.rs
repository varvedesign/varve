//! Generative helper invocation, request/response types, run/cancel commands (Batch B/B-01).

use crate::generative_resources;
use crate::inference::denoise::GENERATIVE_CANCELLATIONS;
use crate::inference::generative::config::validate_generation_buffer;
use crate::inference::generative::config::validate_generative_edit_options;
use crate::inference::generative::config::GenerativeEditOptions;
use crate::inference::generative::config::GENERATIVE_CHILDREN;
use crate::inference::generative::config::GENERATIVE_MODEL_PROFILE;
use crate::inference::generative::import::generation_cancel_requested;
use crate::inference::generative::import::resolve_generative_model_for_run;
use crate::inference::generative::import::take_generation_cancellation;
use crate::inference::generative::import::GenerationCancellationGuard;
use base64::Engine as _;
use std::process::Command as ProcessCommand;
use std::process::Stdio;
use std::time::Duration;
use std::time::Instant;
use tauri::Manager;

#[derive(Debug, serde::Serialize)]
pub struct GenerativeEditResult {
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
    pub execution_backend: String,
    pub processing_time_ms: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenerativeHelperRequest {
    /// This private protocol field binds the request to the model-specific
    /// adapter compiled into the helper. It is not a user-controlled model
    /// selector.
    pub(crate) profile_id: String,
    pub(crate) model_path: String,
    pub(crate) init_image_path: String,
    pub(crate) mask_path: String,
    pub(crate) mask_input: String,
    pub(crate) mask_convention: String,
    pub(crate) output_path: String,
    pub(crate) prompt: String,
    pub(crate) negative_prompt: String,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) steps: u32,
    pub(crate) guidance_scale: f32,
    pub(crate) image_guidance_scale: f32,
    pub(crate) seed: i64,
    pub(crate) strength: f32,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenerativeHelperResponse {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) backend: String,
}

pub(crate) fn valid_generation_request_id(request_id: &str) -> bool {
    !request_id.is_empty()
        && request_id.len() <= 128
        && request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn resolve_generative_helper(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    // The helper is part of the trusted desktop runtime boundary. Do not
    // accept an arbitrary executable path from an environment variable or
    // renderer payload: that would turn the native command into a local code
    // execution hook. Development builds use the exact Cargo target path
    // below, while packaged builds use the bundled resource path.
    let file_name = if cfg!(target_os = "windows") {
        "varve-generative-helper.exe"
    } else {
        "varve-generative-helper"
    };
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join(file_name);
        if bundled.is_file() {
            return Ok(bundled);
        }
    }
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    let dev_path = manifest_dir
        .join("../../../target")
        .join(profile)
        .join(file_name);
    if dev_path.is_file() {
        return Ok(dev_path);
    }
    Err("The packaged local diffusion helper is unavailable. Rebuild the desktop runtime.".into())
}

fn write_generation_inputs(
    work_dir: &std::path::Path,
    options: &GenerativeEditOptions,
) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    validate_generation_buffer(
        options.image_w,
        options.image_h,
        options.image_data.len(),
        4,
        "Generation source image",
    )?;
    validate_generation_buffer(
        options.mask_w,
        options.mask_h,
        options.mask.len(),
        1,
        "Generation mask",
    )?;
    let rgba =
        image::RgbaImage::from_raw(options.image_w, options.image_h, options.image_data.clone())
            .ok_or_else(|| "Generation source image buffer is invalid".to_string())?;
    let mask = image::GrayImage::from_raw(options.mask_w, options.mask_h, options.mask.clone())
        .ok_or_else(|| "Generation mask buffer is invalid".to_string())?;
    let image_path = work_dir.join("source.png");
    let mask_path = work_dir.join("mask.png");
    image::DynamicImage::ImageRgba8(rgba)
        .save(&image_path)
        .map_err(|error| format!("Could not write generation source: {error}"))?;
    image::DynamicImage::ImageLuma8(mask)
        .save(&mask_path)
        .map_err(|error| format!("Could not write generation mask: {error}"))?;
    Ok((image_path, mask_path))
}

fn generative_edit_blocking(
    app: tauri::AppHandle,
    options: GenerativeEditOptions,
) -> Result<GenerativeEditResult, String> {
    generative_edit_blocking_with_requirement(app, options, true)
}

pub(crate) fn generative_edit_blocking_with_requirement(
    app: tauri::AppHandle,
    options: GenerativeEditOptions,
    require_qualified: bool,
) -> Result<GenerativeEditResult, String> {
    if !valid_generation_request_id(&options.request_id) {
        return Err("Invalid generative edit request id".into());
    }
    // A cancel can arrive after IPC dispatch but before this blocking task is
    // scheduled. Consume that startup tombstone before doing any work.
    if take_generation_cancellation(&options.request_id) {
        return Err("Generation was cancelled".into());
    }
    let _cancellation_guard = GenerationCancellationGuard {
        request_id: options.request_id.clone(),
    };
    validate_generative_edit_options(&options)?;
    generative_resources::preflight(options.output_w, options.output_h)?;
    let helper = resolve_generative_helper(&app)?;
    let model_path = resolve_generative_model_for_run(&app, require_qualified)?;
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Could not resolve generation cache: {error}"))?
        .join("generative-edits")
        .join(&options.request_id);
    let scratch_root = root
        .parent()
        .ok_or_else(|| "Could not resolve generation scratch directory".to_string())?;
    generative_resources::remove_stale_workspaces(scratch_root, std::time::SystemTime::now());
    std::fs::create_dir_all(scratch_root)
        .map_err(|error| format!("Could not create generation cache: {error}"))?;
    std::fs::create_dir(&root)
        .map_err(|error| format!("Could not create generation workspace: {error}"))?;
    let _workspace_guard = generative_resources::WorkspaceGuard::new(root.clone());
    let (image_path, mask_path) = write_generation_inputs(&root, &options)?;
    let output_path = root.join("output.png");
    let request_path = root.join("request.json");
    let stdout_path = root.join("helper.stdout");
    let stderr_path = root.join("helper.stderr");
    let helper_request = GenerativeHelperRequest {
        profile_id: GENERATIVE_MODEL_PROFILE.into(),
        model_path: model_path.to_string_lossy().into_owned(),
        init_image_path: image_path.to_string_lossy().into_owned(),
        mask_path: mask_path.to_string_lossy().into_owned(),
        mask_input: options.mask_input,
        mask_convention: options.mask_convention,
        output_path: output_path.to_string_lossy().into_owned(),
        prompt: options.prompt,
        negative_prompt: options.negative_prompt,
        width: options.output_w,
        height: options.output_h,
        steps: options.steps,
        guidance_scale: options.guidance_scale,
        image_guidance_scale: options.image_guidance_scale,
        seed: options.seed,
        strength: options.strength,
    };
    let request_bytes = serde_json::to_vec(&helper_request).map_err(|error| error.to_string())?;
    std::fs::write(&request_path, request_bytes)
        .map_err(|error| format!("Could not write generation request: {error}"))?;
    let stdout_file = std::fs::File::create(&stdout_path)
        .map_err(|error| format!("Could not create diffusion helper stdout log: {error}"))?;
    let stderr_file = std::fs::File::create(&stderr_path)
        .map_err(|error| format!("Could not create diffusion helper stderr log: {error}"))?;

    let started = Instant::now();
    let child = ProcessCommand::new(helper)
        .arg("--request")
        .arg(&request_path)
        .stdin(Stdio::null())
        // File-backed pipes cannot fill a bounded OS pipe while the helper is
        // running. The files remain inside the request workspace and are
        // removed by WorkspaceGuard on every terminal path.
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()
        .map_err(|error| format!("Could not start local diffusion helper: {error}"))?;
    let request_id = options.request_id.clone();
    GENERATIVE_CHILDREN
        .lock()
        .map_err(|_| "Generation process registry is unavailable".to_string())?
        .insert(request_id.clone(), child);

    // The cancel command may have run between the initial check and child
    // registration. Re-check after registration and terminate before the
    // helper gets an opportunity to publish output.
    if take_generation_cancellation(&request_id) {
        if let Ok(mut processes) = GENERATIVE_CHILDREN.lock() {
            if let Some(mut process) = processes.remove(&request_id) {
                let _ = process.kill();
                let _ = process.wait();
            }
        }
        return Err("Generation was cancelled".into());
    }

    let status = loop {
        let mut processes = GENERATIVE_CHILDREN
            .lock()
            .map_err(|_| "Generation process registry is unavailable".to_string())?;
        let process = processes
            .get_mut(&request_id)
            .ok_or_else(|| "Generation was cancelled".to_string())?;
        if let Some(status) = process
            .try_wait()
            .map_err(|error| format!("Could not poll diffusion helper: {error}"))?
        {
            break status;
        }
        drop(processes);
        if started.elapsed() > Duration::from_secs(15 * 60) {
            if let Ok(mut processes) = GENERATIVE_CHILDREN.lock() {
                if let Some(mut process) = processes.remove(&request_id) {
                    let _ = process.kill();
                    let _ = process.wait();
                }
            }
            return Err("Local diffusion generation timed out".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let mut processes = GENERATIVE_CHILDREN
        .lock()
        .map_err(|_| "Generation process registry is unavailable".to_string())?;
    let mut process = match processes.remove(&request_id) {
        Some(process) => process,
        None => {
            drop(processes);
            return Err("Generation was cancelled".into());
        }
    };
    drop(processes);
    process
        .wait()
        .map_err(|error| format!("Could not collect diffusion helper output: {error}"))?;
    if generation_cancel_requested(&request_id) {
        return Err("Generation was cancelled".into());
    }
    let stdout = std::fs::read(&stdout_path)
        .map_err(|error| format!("Could not read diffusion helper stdout: {error}"))?;
    let stderr = std::fs::read(&stderr_path)
        .map_err(|error| format!("Could not read diffusion helper stderr: {error}"))?;
    if generation_cancel_requested(&request_id) {
        return Err("Generation was cancelled".into());
    }
    if !status.success() {
        let reason = String::from_utf8_lossy(&stderr);
        return Err(if reason.trim().is_empty() {
            "Local diffusion generation failed".into()
        } else {
            reason.trim().to_string()
        });
    }
    let helper_response: GenerativeHelperResponse = serde_json::from_slice(&stdout)
        .map_err(|error| format!("Invalid diffusion helper response: {error}"))?;
    if generation_cancel_requested(&request_id) {
        return Err("Generation was cancelled".into());
    }
    let png = std::fs::read(&output_path)
        .map_err(|error| format!("Diffusion helper did not produce an output image: {error}"))?;
    Ok(GenerativeEditResult {
        png_base64: base64::engine::general_purpose::STANDARD.encode(png),
        width: helper_response.width,
        height: helper_response.height,
        execution_backend: helper_response.backend,
        processing_time_ms: started.elapsed().as_millis() as u64,
        warnings: Vec::new(),
    })
}

#[tauri::command]
pub(crate) async fn generative_edit(
    app: tauri::AppHandle,
    options: GenerativeEditOptions,
) -> Result<GenerativeEditResult, String> {
    tauri::async_runtime::spawn_blocking(move || generative_edit_blocking(app, options))
        .await
        .map_err(|error| format!("Generative edit task failed: {error}"))?
}

#[tauri::command]
pub(crate) fn cancel_generative_edit(request_id: String) -> Result<(), String> {
    if !valid_generation_request_id(&request_id) {
        return Err("Invalid generative edit request id".into());
    }
    // Record the tombstone before looking up the child. This closes the race
    // where cancellation wins between command dispatch and helper startup.
    GENERATIVE_CANCELLATIONS
        .lock()
        .map_err(|_| "Generation cancellation state is unavailable".to_string())?
        .insert(request_id.clone());
    let mut processes = GENERATIVE_CHILDREN
        .lock()
        .map_err(|_| "Generation process registry is unavailable".to_string())?;
    if let Some(process) = processes.get_mut(&request_id) {
        if let Err(error) = process.kill() {
            // The child may have exited between the lookup and kill. The
            // tombstone still makes the completion path discard its output.
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("Could not cancel diffusion helper: {error}"));
            }
        }
    }
    Ok(())
}

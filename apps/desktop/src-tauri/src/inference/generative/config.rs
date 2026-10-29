//! Generative-edit options, constants and validation extracted from the crate root (Batch B/B-01).

use crate::clipboard::validate_bounded_image_dimensions;
use std::collections::HashMap;
use std::collections::HashSet;
use std::process::Child;
use std::sync::LazyLock;
use std::sync::Mutex;

// ── Isolated prompt-capable generative editing ──────────────────────────

pub(crate) static GENERATIVE_CHILDREN: LazyLock<Mutex<HashMap<String, Child>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
pub(crate) static GENERATIVE_MODEL_DOWNLOADS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));
pub(crate) static GENERATIVE_MODEL_DOWNLOAD_CANCELLATIONS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

#[derive(Debug, serde::Deserialize)]
pub struct GenerativeEditOptions {
    pub request_id: String,
    pub model_handle: String,
    pub image_data: Vec<u8>,
    pub image_w: u32,
    pub image_h: u32,
    pub mask: Vec<u8>,
    pub mask_w: u32,
    pub mask_h: u32,
    pub mode: String,
    pub prompt: String,
    pub negative_prompt: String,
    pub output_w: u32,
    pub output_h: u32,
    pub steps: u32,
    pub guidance_scale: f32,
    #[serde(default = "default_image_guidance_scale")]
    pub image_guidance_scale: f32,
    #[serde(default = "default_generative_mask_input")]
    pub mask_input: String,
    #[serde(default = "default_generative_mask_convention")]
    pub mask_convention: String,
    pub seed: i64,
    pub strength: f32,
}

const MAX_GENERATIVE_OUTPUT_DIMENSION: u32 = 2_048;
const MAX_GENERATIVE_STEPS: u32 = 100;
pub(crate) const MAX_GENERATIVE_PROMPT_CHARS: usize = 16_384;

fn default_image_guidance_scale() -> f32 {
    1.0
}

fn default_generative_mask_input() -> String {
    "image-and-mask".into()
}

fn default_generative_mask_convention() -> String {
    "white-edit-black-preserve".into()
}

pub(crate) fn validate_generation_buffer(
    width: u32,
    height: u32,
    byte_len: usize,
    bytes_per_pixel: u64,
    label: &str,
) -> Result<(), String> {
    validate_bounded_image_dimensions(width, height, label)?;
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| format!("{label} dimensions overflow"))?;
    let expected_bytes = pixels
        .checked_mul(bytes_per_pixel)
        .ok_or_else(|| format!("{label} buffer size overflow"))?;
    if byte_len as u64 != expected_bytes {
        return Err(format!(
            "{label} buffer does not match its declared dimensions"
        ));
    }
    Ok(())
}

pub(crate) fn validate_generative_edit_options(
    options: &GenerativeEditOptions,
) -> Result<(), String> {
    if options.model_handle != GENERATIVE_MODEL_HANDLE {
        return Err("Unknown or unqualified generative model handle".into());
    }
    if options.mask_input != "image-and-mask" {
        return Err(
            "The packaged SD 1.5 adapter requires the image-and-mask conditioning contract".into(),
        );
    }
    if options.mask_convention != "white-edit-black-preserve" {
        return Err(
            "The packaged SD 1.5 adapter requires the white-edit-black-preserve mask convention"
                .into(),
        );
    }
    if options.mode != "fill" && options.mode != "replace" && options.mode != "expand" {
        return Err("The diffusion helper supports Fill, Replace, and Expand only".into());
    }
    if options.prompt.trim().is_empty() {
        return Err("A prompt is required for prompt-capable generation".into());
    }
    if options.prompt.chars().count() > MAX_GENERATIVE_PROMPT_CHARS {
        return Err(format!(
            "Generation prompt exceeds the {MAX_GENERATIVE_PROMPT_CHARS}-character limit"
        ));
    }
    if options.negative_prompt.chars().count() > MAX_GENERATIVE_PROMPT_CHARS {
        return Err(format!(
            "Generation negative prompt exceeds the {MAX_GENERATIVE_PROMPT_CHARS}-character limit"
        ));
    }
    if options.output_w == 0
        || options.output_h == 0
        || options.output_w > MAX_GENERATIVE_OUTPUT_DIMENSION
        || options.output_h > MAX_GENERATIVE_OUTPUT_DIMENSION
    {
        return Err(format!(
            "Generation output dimensions must be between 1 and {MAX_GENERATIVE_OUTPUT_DIMENSION} pixels"
        ));
    }
    if options.image_w != options.output_w || options.image_h != options.output_h {
        return Err("Generation source dimensions must match the output working frame".into());
    }
    if options.mask_w != options.output_w || options.mask_h != options.output_h {
        return Err("Generation mask dimensions must match the output working frame".into());
    }
    if options.steps == 0 || options.steps > MAX_GENERATIVE_STEPS {
        return Err(format!(
            "Generation steps must be between 1 and {MAX_GENERATIVE_STEPS}"
        ));
    }
    if !options.guidance_scale.is_finite() || !(0.0..=50.0).contains(&options.guidance_scale) {
        return Err("Generation guidance scale must be between 0 and 50".into());
    }
    if !options.image_guidance_scale.is_finite()
        || !(0.0..=50.0).contains(&options.image_guidance_scale)
    {
        return Err("Generation image guidance scale must be between 0 and 50".into());
    }
    if !options.strength.is_finite() || !(0.0..=1.0).contains(&options.strength) {
        return Err("Generation strength must be between 0 and 1".into());
    }
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
    Ok(())
}

pub(crate) const GENERATIVE_MODEL_STEM: &str = "varve-diffusion-inpainting";
pub(crate) const GENERATIVE_MODEL_HANDLE: &str = "varve-diffusion-inpainting";
pub(crate) const GENERATIVE_MODEL_PROFILE: &str = "sd15-inpainting-q4_0-v1";
pub(crate) const GENERATIVE_MODEL_CUSTOM_PROFILE: &str = "custom-safe-inpainting-v1";
pub(crate) const GENERATIVE_MODEL_METADATA_SUFFIX: &str = ".metadata.json";
// The inexpensive masked fixture below is a compatibility/preflight probe,
// not a release-quality qualification. Qualification is tied to the exact
// helper/runtime, backend, and target platform. Older records did not carry
// that provenance and must be re-qualified instead of being trusted on ARM,
// another OS, or after a helper change.
pub(crate) const GENERATIVE_MODEL_METADATA_SCHEMA_VERSION: u32 = 4;
// This identifier includes Varve's safe image-guidance extension. Changing
// the helper or its binding must invalidate qualification metadata so a
// result cannot be trusted under a different runtime contract.
pub(crate) const GENERATIVE_MODEL_RUNTIME_ID: &str =
    "diffusion-rs-0.1.20-varve-image-cfg-profile-contract-v2";
pub(crate) const GENERATIVE_MODEL_FILENAME: &str = "varve-diffusion-inpainting.gguf";
pub(crate) const GENERATIVE_MODEL_DOWNLOAD_URL: &str = "https://huggingface.co/gpustack/stable-diffusion-v1-5-inpainting-GGUF/resolve/21491e4/stable-diffusion-v1-5-inpainting-Q4_0.gguf?download=true";
pub(crate) const GENERATIVE_MODEL_DOWNLOAD_SIZE: u64 = 1_747_219_584;
pub(crate) const GENERATIVE_MODEL_DOWNLOAD_SHA256: &str =
    "d157ce24483f0c999062da140eacebe8f3ed015e652723e31f6d39119b800c16";
// The pinned artifact above is an experimental GGUF published for a patched
// llama-box/stable-diffusion.cpp build. Varve's diffusion-rs helper does not
// contain that patch, and real-photograph probes under the current runtime
// produced rejected semantic results. Keep the URL and hash for provenance,
// but do not offer an artifact we cannot honestly execute or qualify.
pub(crate) const GENERATIVE_MODEL_DOWNLOAD_AVAILABLE: bool = false;
// The helper currently has one hard-coded SD 1.5 inpainting adapter. A file
// extension cannot identify the model family, tensor layout, auxiliary
// components, runtime patch level, or mask polarity, so arbitrary imports are
// unsafe until a model-specific adapter has been qualified.
pub(crate) const GENERATIVE_MODEL_IMPORT_AVAILABLE: bool = false;
pub(crate) const GENERATIVE_MODEL_INCOMPATIBLE_REASON: &str = "This packaged Q4 artifact is documented for a patched llama-box runtime and is not compatible with Varve's diffusion-rs helper. Prompt-conditioned generation remains unavailable in this build; use Quick Cleanup/LaMa.";
pub(crate) const GENERATIVE_MODEL_IMPORT_UNAVAILABLE_REASON: &str = "Local model import is unavailable because this build has no model-specific adapter for arbitrary checkpoints. Prompt-conditioned generation remains unavailable; use Quick Cleanup/LaMa.";
pub(crate) const GENERATIVE_MODEL_UNAVAILABLE_REASON: &str = "No quality-certified prompt model is packaged. The configured Q4 artifact requires a patched llama-box runtime and is not offered by Varve; arbitrary model import is unavailable until a model-specific adapter is qualified. Use Quick Cleanup/LaMa.";

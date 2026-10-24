//! Native acquisition contracts read from the shipped catalog. A graph, its
//! external weights, and any required graph repair form one installation.

use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

#[derive(Clone, Debug)]
pub(crate) struct Artifact {
    pub filename: String,
    pub url: String,
    pub sha256: String,
    pub download_sha256: String,
    pub repair: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    #[serde(default)]
    filename: String,
    #[serde(default)]
    remote_url: String,
    #[serde(default)]
    bundled: bool,
    local_path: Option<String>,
    sha256: Option<String>,
    checksum: Option<String>,
    upstream_checksum: Option<String>,
    repair: Option<String>,
    remote_data_url: Option<String>,
    remote_data_sha256: Option<String>,
    #[serde(default)]
    components: Vec<Entry>,
}

#[derive(Deserialize)]
struct Catalog {
    models: Vec<Entry>,
}

static CATALOG: LazyLock<Result<Catalog, String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../public/models/manifest.json"))
        .map_err(|error| format!("Native model catalog is invalid: {error}"))
});

fn safe_filename(filename: &str) -> Result<(), String> {
    if filename.is_empty()
        || filename.len() > 160
        || !filename
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        || filename.starts_with('.')
    {
        return Err("Invalid model artifact filename".into());
    }
    Ok(())
}

/// Virtual groups resolve through their components; they never become a fake
/// `<group>.onnx`. Nested-only TrOCR graphs have the same lookup as top-level ones.
fn entry(model_id: &str) -> Result<&'static Entry, String> {
    crate::validate_inference_model_id(model_id)?;
    let catalog = CATALOG.as_ref().map_err(Clone::clone)?;
    catalog
        .models
        .iter()
        .find(|entry| entry.id == model_id)
        .or_else(|| {
            catalog
                .models
                .iter()
                .flat_map(|entry| &entry.components)
                .find(|entry| entry.id == model_id)
        })
        .ok_or_else(|| format!("Unknown native model: {model_id}"))
}

pub(crate) fn bundled_path(model_id: &str) -> Result<Option<&'static str>, String> {
    let entry = entry(model_id)?;
    Ok(entry
        .bundled
        .then_some(entry.local_path.as_deref())
        .flatten())
}

pub(crate) fn artifacts(model_id: &str) -> Result<Vec<Artifact>, String> {
    let entry = entry(model_id)?;
    let checksum = entry
        .checksum
        .as_deref()
        .or(entry.sha256.as_deref())
        .ok_or_else(|| format!("Model {model_id} is a component group, not an artifact"))?;
    crate::validate_inference_sha256(checksum)?;
    let download_checksum = entry
        .upstream_checksum
        .as_deref()
        .or_else(|| entry.repair.as_ref().and(entry.sha256.as_deref()))
        .unwrap_or(checksum);
    crate::validate_inference_sha256(download_checksum)?;
    if entry
        .repair
        .as_deref()
        .is_some_and(|repair| repair != "sam2-empty-value-info")
    {
        return Err(format!("Unsupported graph repair for {model_id}"));
    }
    safe_filename(&entry.filename)?;
    let extension = Path::new(&entry.filename)
        .extension()
        .and_then(|extension| extension.to_str())
        .ok_or("Model artifact has no extension")?;
    let mut result = vec![Artifact {
        filename: format!("{model_id}.{extension}"),
        url: entry.remote_url.clone(),
        sha256: checksum.to_owned(),
        download_sha256: download_checksum.to_owned(),
        repair: entry.repair.clone(),
    }];
    if let Some(url) = &entry.remote_data_url {
        let filename = url
            .rsplit('/')
            .next()
            .ok_or("Missing external weights filename")?;
        safe_filename(filename)?;
        let checksum = entry
            .remote_data_sha256
            .as_deref()
            .ok_or("Missing external weights checksum")?;
        crate::validate_inference_sha256(checksum)?;
        result.push(Artifact {
            filename: filename.to_owned(),
            url: url.clone(),
            sha256: checksum.to_owned(),
            download_sha256: checksum.to_owned(),
            repair: None,
        });
    }
    Ok(result)
}

pub(crate) fn verified_path(directory: &Path, model_id: &str) -> Result<Option<PathBuf>, String> {
    let artifacts = artifacts(model_id)?;
    for artifact in &artifacts {
        let path = directory.join(&artifact.filename);
        if !path.is_file() {
            return Ok(None);
        }
        if crate::sha256_file(&path)?.1 != artifact.sha256 {
            return Ok(None);
        }
    }
    Ok(Some(directory.join(&artifacts[0].filename)))
}

#[derive(serde::Serialize)]
pub(crate) struct ExternalData {
    filename: String,
    path: String,
}

pub(crate) fn external_data(
    directory: &Path,
    model_id: &str,
) -> Result<Option<ExternalData>, String> {
    if verified_path(directory, model_id)?.is_none() {
        return Ok(None);
    }
    Ok(artifacts(model_id)?.get(1).map(|artifact| ExternalData {
        filename: artifact.filename.clone(),
        path: directory
            .join(&artifact.filename)
            .to_string_lossy()
            .into_owned(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_preserves_repairs_sidecars_tokenizers_and_nested_components() {
        let sam = artifacts("sam2-hiera-small-encoder").unwrap();
        assert_ne!(sam[0].download_sha256, sam[0].sha256);
        assert_eq!(sam[0].repair.as_deref(), Some("sam2-empty-value-info"));
        let scunet = artifacts("scunet").unwrap();
        assert_eq!(scunet.len(), 2);
        assert_eq!(scunet[1].filename, "scunet_color_real_psnr.onnx.data");
        assert_eq!(
            artifacts("siglip-tokenizer").unwrap()[0].filename,
            "siglip-tokenizer.json"
        );
        assert_eq!(
            artifacts("grounding-dino-tokenizer").unwrap()[0].filename,
            "grounding-dino-tokenizer.txt"
        );
        assert!(artifacts("trocr-encoder").unwrap()[0]
            .url
            .ends_with("encoder_model.onnx"));
        assert!(artifacts("tr-ocr-base-printed").is_err());
    }

    #[test]
    fn arbitrary_ids_and_unsafe_filenames_are_not_artifacts() {
        assert!(artifacts("../secrets").is_err());
        assert!(artifacts("unknown-model").is_err());
        assert!(safe_filename("../weights.data").is_err());
        assert!(safe_filename("weights\\file").is_err());
        assert!(safe_filename(".hidden").is_err());
    }

    #[test]
    fn readiness_rechecks_bytes_even_when_the_artifact_size_did_not_change() {
        let directory =
            std::env::temp_dir().join(format!("varve-model-integrity-{}", crate::uuid()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("u2netp.onnx");
        let bundled = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/models/u2netp.onnx");
        std::fs::copy(bundled, &path).unwrap();
        let valid = verified_path(&directory, "u2netp").unwrap();
        let mut file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        std::io::Write::write_all(&mut file, b"BAD!").unwrap();
        drop(file);
        let corrupted = verified_path(&directory, "u2netp").unwrap();
        std::fs::remove_dir_all(&directory).unwrap();
        assert_eq!(valid, Some(path));
        assert_eq!(corrupted, None);
    }
}

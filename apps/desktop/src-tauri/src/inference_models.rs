//! Native model acquisition. Catalog identity owns the URLs and hashes; a caller
//! cannot install arbitrary bytes under the identity of an advertised model.

use crate::model_artifacts::{self, Artifact};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use varve_bgremove::InferenceCancellationToken;

const MAX_ARTIFACT_BYTES: u64 = 2_000_000_000;
static MUTATIONS: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

struct Mutation(PathBuf);

impl Mutation {
    fn start(directory: &Path, id: &str) -> Result<Self, String> {
        let key = directory.join(id);
        if !MUTATIONS
            .lock()
            .map_err(|_| "Model mutation state unavailable")?
            .insert(key.clone())
        {
            return Err("This model is already being changed; wait for it to finish".into());
        }
        Ok(Self(key))
    }
}

impl Drop for Mutation {
    fn drop(&mut self) {
        if let Ok(mut active) = MUTATIONS.lock() {
            active.remove(&self.0);
        }
    }
}

struct Staging(PathBuf);

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn check_cancelled(cancellation: &InferenceCancellationToken) -> Result<(), String> {
    if cancellation.is_cancelled() {
        Err("Download cancelled".into())
    } else {
        Ok(())
    }
}

pub(crate) fn delete_at(directory: &Path, model_id: &str) -> Result<bool, String> {
    let artifacts = model_artifacts::artifacts(model_id)?;
    let _mutation = Mutation::start(directory, model_id)?;
    let mut deleted = false;
    // Removing the graph first makes a partial deletion unavailable, never ready.
    for artifact in artifacts {
        match std::fs::remove_file(directory.join(&artifact.filename)) {
            Ok(()) => deleted = true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Failed to remove {}: {error}", artifact.filename)),
        }
    }
    Ok(deleted)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.url().scheme() != "https" || attempt.previous().len() >= 10 {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|error| format!("Failed to create model downloader: {error}"))
}

async fn download_artifact(
    client: &reqwest::Client,
    artifact: &Artifact,
    destination: &Path,
    cancellation: &InferenceCancellationToken,
    progress: &mut impl FnMut(u64, u64),
) -> Result<u64, String> {
    check_cancelled(cancellation)?;
    if !artifact.url.starts_with("https://") {
        return Err(format!(
            "{} has no secure download source",
            artifact.filename
        ));
    }
    let mut response = client
        .get(&artifact.url)
        .send()
        .await
        .map_err(|error| format!("Model download failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Model download failed: {error}"))?;
    if !response.status().is_success() || response.status() == reqwest::StatusCode::PARTIAL_CONTENT
    {
        return Err("Model server did not return a complete artifact".into());
    }
    let total = response.content_length().unwrap_or(0);
    if total > MAX_ARTIFACT_BYTES {
        return Err("Model exceeds native artifact size limit".into());
    }
    check_cancelled(cancellation)?;
    let mut file = std::fs::File::create(destination)
        .map_err(|error| format!("Failed to create model staging file: {error}"))?;
    let mut digest = Sha256::new();
    let mut loaded = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Model download interrupted: {error}"))?
    {
        check_cancelled(cancellation)?;
        loaded = loaded
            .checked_add(chunk.len() as u64)
            .ok_or("Model size overflow")?;
        if loaded > MAX_ARTIFACT_BYTES {
            return Err("Model exceeds native artifact size limit".into());
        }
        file.write_all(&chunk)
            .map_err(|error| format!("Failed to write model: {error}"))?;
        digest.update(&chunk);
        progress(loaded, total);
    }
    file.sync_all()
        .map_err(|error| format!("Failed to flush model: {error}"))?;
    drop(file);
    check_cancelled(cancellation)?;
    let actual = digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if actual != artifact.download_sha256 {
        return Err(format!(
            "{} SHA-256 mismatch: expected {}, received {actual}",
            artifact.filename, artifact.download_sha256
        ));
    }
    if artifact.repair.as_deref() == Some("sam2-empty-value-info") {
        let bytes =
            std::fs::read(destination).map_err(|error| format!("Failed to read graph: {error}"))?;
        let repaired = crate::model_graph_repair::repair_sam2(&bytes)?;
        check_cancelled(cancellation)?;
        let mut file = std::fs::File::create(destination)
            .map_err(|error| format!("Failed to stage repaired graph: {error}"))?;
        file.write_all(&repaired)
            .map_err(|error| format!("Failed to write repaired graph: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Failed to flush repaired graph: {error}"))?;
    }
    if crate::sha256_file(destination)?.1 != artifact.sha256 {
        return Err(format!("{} installed SHA-256 mismatch", artifact.filename));
    }
    check_cancelled(cancellation)?;
    Ok(loaded)
}

fn promote(source: &Path, destination: &Path) -> Result<(), String> {
    // std::fs::rename replaces files on both Unix and Windows. A failure (for
    // example, a Windows sharing violation) must leave the previous artifact
    // intact, not delete it in an attempted permission-error fallback.
    std::fs::rename(source, destination)
        .map_err(|error| format!("Failed to install model artifact: {error}"))
}

pub(crate) fn install_bundled_at(
    directory: &Path,
    model_id: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    if model_artifacts::bundled_path(model_id)?.is_none() {
        return Err("This model is not a bundled artifact".into());
    }
    let artifacts = model_artifacts::artifacts(model_id)?;
    if artifacts.len() != 1 || artifacts[0].repair.is_some() {
        return Err("Bundled model requires an unsupported installation transform".into());
    }
    let _mutation = Mutation::start(directory, model_id)?;
    if let Some(path) = model_artifacts::verified_path(directory, model_id)? {
        return Ok(path);
    }
    if bytes.len() as u64 > MAX_ARTIFACT_BYTES
        || Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
            != artifacts[0].sha256
    {
        return Err("Bundled model failed SHA-256 verification".into());
    }
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("Failed to create model directory: {error}"))?;
    let staging = directory.join(format!(".bundled-{}", crate::uuid()));
    std::fs::create_dir(&staging)
        .map_err(|error| format!("Failed to stage bundled model: {error}"))?;
    let staging = Staging(staging);
    let path = staging.0.join(&artifacts[0].filename);
    let mut file = std::fs::File::create(&path)
        .map_err(|error| format!("Failed to stage bundled model: {error}"))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("Failed to write bundled model: {error}"))?;
    drop(file);
    let destination = directory.join(&artifacts[0].filename);
    promote(&path, &destination)?;
    Ok(destination)
}

/// Packaged frontend assets are embedded in Tauri; native ORT needs a real file.
/// Materialize only catalog-marked bundled bytes, with the same integrity check
/// as downloaded models. Development reads the identical public asset on disk.
pub(crate) fn prepare_path(
    app: &tauri::AppHandle,
    model_id: &str,
) -> Result<Option<PathBuf>, String> {
    let directory = varve_bgremove::model::models_dir();
    if let Some(path) = crate::inference_model_path_at(&directory, model_id)? {
        return Ok(Some(PathBuf::from(path)));
    }
    let Some(asset_path) = model_artifacts::bundled_path(model_id)? else {
        return Ok(None);
    };
    if let Some(asset) = app.asset_resolver().get(asset_path.to_owned()) {
        return install_bundled_at(&directory, model_id, &asset.bytes).map(Some);
    }
    #[cfg(debug_assertions)]
    {
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../public")
            .join(asset_path.trim_start_matches('/'));
        let bytes = std::fs::read(source)
            .map_err(|error| format!("Bundled model is unavailable: {error}"))?;
        return install_bundled_at(&directory, model_id, &bytes).map(Some);
    }
    #[cfg(not(debug_assertions))]
    Err(format!(
        "Bundled model '{model_id}' is missing from this installation"
    ))
}

pub(crate) async fn download_at(
    directory: &Path,
    model_id: &str,
    request_id: &str,
    cancellation: &InferenceCancellationToken,
    mut progress: impl FnMut(u64, u64),
) -> Result<PathBuf, String> {
    if !crate::valid_download_request_id(request_id) {
        return Err("Invalid model download request id".into());
    }
    let artifacts = model_artifacts::artifacts(model_id)?;
    let _mutation = Mutation::start(directory, model_id)?;
    check_cancelled(cancellation)?;
    if let Some(path) = model_artifacts::verified_path(directory, model_id)? {
        return Ok(path);
    }
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("Failed to create model directory: {error}"))?;
    let staging = directory.join(format!(".download-{request_id}"));
    std::fs::create_dir(&staging)
        .map_err(|error| format!("Failed to create model staging directory: {error}"))?;
    let staging = Staging(staging);
    let client = client()?;
    let mut completed = 0;
    for (index, artifact) in artifacts.iter().enumerate() {
        completed += download_artifact(
            &client,
            artifact,
            &staging.0.join(&artifact.filename),
            cancellation,
            &mut |loaded, total| {
                // Until the final artifact starts, the remaining byte count is
                // unknown. Never show 100% while required weights are absent.
                let total = if index + 1 == artifacts.len() && total > 0 {
                    completed + total
                } else {
                    0
                };
                progress(completed + loaded, total);
            },
        )
        .await?;
    }
    check_cancelled(cancellation)?;
    // Stage and verify every file before publishing. Sidecars precede the graph;
    // readers revalidate the entire installation before exposing any path.
    for artifact in artifacts.iter().rev() {
        promote(
            &staging.0.join(&artifact.filename),
            &directory.join(&artifact.filename),
        )?;
    }
    progress(completed, completed);
    model_artifacts::verified_path(directory, model_id)?
        .ok_or("Installed model failed verification".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_materialization_verifies_bytes_and_reuses_valid_installation() {
        let directory = std::env::temp_dir().join(format!("varve-bundled-model-{}", crate::uuid()));
        let bundled = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/models/u2netp.onnx");
        let bytes = std::fs::read(bundled).unwrap();
        assert!(install_bundled_at(&directory, "u2netp", b"corrupt").is_err());
        assert!(!directory.exists());
        let path = install_bundled_at(&directory, "u2netp", &bytes).unwrap();
        assert_eq!(
            model_artifacts::verified_path(&directory, "u2netp").unwrap(),
            Some(path.clone())
        );
        assert_eq!(install_bundled_at(&directory, "u2netp", &[]).unwrap(), path);
        assert!(install_bundled_at(&directory, "birefnet-general", &bytes).is_err());
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn promotion_replaces_a_file_and_preserves_it_when_replacement_fails() {
        let directory = std::env::temp_dir().join(format!("varve-model-promote-{}", crate::uuid()));
        std::fs::create_dir_all(&directory).unwrap();
        let previous = directory.join("installed.onnx");
        let replacement = directory.join("staged.onnx");
        std::fs::write(&previous, b"previous").unwrap();
        std::fs::write(&replacement, b"verified replacement").unwrap();
        promote(&replacement, &previous).unwrap();
        assert_eq!(std::fs::read(&previous).unwrap(), b"verified replacement");
        assert!(promote(&replacement, &previous).is_err());
        assert_eq!(std::fs::read(&previous).unwrap(), b"verified replacement");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn deletion_waits_for_download_and_removes_graph_before_sidecars() {
        let directory = std::env::temp_dir().join(format!("varve-model-delete-{}", crate::uuid()));
        std::fs::create_dir_all(&directory).unwrap();
        let graph = directory.join("scunet.onnx");
        let weights = directory.join("scunet_color_real_psnr.onnx.data");
        std::fs::write(&graph, b"previous graph").unwrap();
        std::fs::write(&weights, b"previous weights").unwrap();
        let mutation = Mutation::start(&directory, "scunet").unwrap();
        assert!(delete_at(&directory, "scunet")
            .unwrap_err()
            .contains("already"));
        assert_eq!(std::fs::read(&graph).unwrap(), b"previous graph");
        drop(mutation);
        assert!(delete_at(&directory, "scunet").unwrap());
        assert!(!graph.exists() && !weights.exists());
        assert!(!delete_at(&directory, "scunet").unwrap());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn deletion_reports_filesystem_failure_instead_of_claiming_success() {
        let directory =
            std::env::temp_dir().join(format!("varve-model-delete-error-{}", crate::uuid()));
        let weights = directory.join("scunet_color_real_psnr.onnx.data");
        std::fs::create_dir_all(&weights).unwrap();
        let graph = directory.join("scunet.onnx");
        std::fs::write(&graph, b"graph").unwrap();
        let result = delete_at(&directory, "scunet");
        assert!(result.unwrap_err().contains("Failed to remove"));
        assert!(
            !graph.exists(),
            "a partially deleted installation must be unavailable"
        );
        assert!(Mutation::start(&directory, "scunet").is_ok());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn valid_installation_is_reused_without_network_or_staging() {
        let directory = std::env::temp_dir().join(format!("varve-model-reuse-{}", crate::uuid()));
        std::fs::create_dir_all(&directory).unwrap();
        let graph = directory.join("u2netp.onnx");
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/models/u2netp.onnx"),
            &graph,
        )
        .unwrap();
        let result = download_at(
            &directory,
            "u2netp",
            "already-installed",
            &InferenceCancellationToken::default(),
            |_, _| panic!("valid existing bytes must not be downloaded again"),
        )
        .await;
        assert_eq!(result.unwrap(), graph);
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn cancelled_acquisition_never_creates_an_installation() {
        let directory = std::env::temp_dir().join(format!("varve-model-cancel-{}", crate::uuid()));
        let cancellation = InferenceCancellationToken::default();
        cancellation.cancel();
        let error = download_at(&directory, "scunet", "cancelled", &cancellation, |_, _| {})
            .await
            .unwrap_err();
        assert!(error.contains("cancelled"));
        assert!(!directory.exists());
    }

    #[tokio::test]
    #[ignore = "downloads the pinned TrOCR tokenizer into an isolated audit directory"]
    async fn real_trocr_tokenizer_acquisition_is_verified_and_reusable() {
        let directory = PathBuf::from(
            std::env::var("VARVE_NATIVE_ACQUISITION_AUDIT_DIR").expect("isolated audit directory"),
        );
        assert_ne!(directory, varve_bgremove::model::models_dir());
        let path = download_at(
            &directory,
            "trocr-tokenizer",
            "audit-trocr-tokenizer",
            &InferenceCancellationToken::default(),
            |_, _| {},
        )
        .await
        .expect("real tokenizer acquisition");
        assert_eq!(
            model_artifacts::verified_path(&directory, "trocr-tokenizer").unwrap(),
            Some(path.clone())
        );
        let json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(json["model"]["vocab"].as_object().unwrap().len(), 50_265);
        let reused = download_at(
            &directory,
            "trocr-tokenizer",
            "audit-trocr-tokenizer-reuse",
            &InferenceCancellationToken::default(),
            |_, _| panic!("valid tokenizer must not redownload"),
        )
        .await
        .unwrap();
        assert_eq!(reused, path);
    }

    #[tokio::test]
    #[ignore = "downloads the pinned PaddleOCR graph and dictionary into an isolated audit directory"]
    async fn real_paddle_recognition_resources_are_verified_and_reusable() {
        let directory = PathBuf::from(
            std::env::var("VARVE_NATIVE_ACQUISITION_AUDIT_DIR").expect("isolated audit directory"),
        );
        assert_ne!(directory, varve_bgremove::model::models_dir());
        for model in ["paddleocr-rec-v4", "paddleocr-keys-v1"] {
            let path = download_at(
                &directory,
                model,
                &format!("audit-{model}"),
                &InferenceCancellationToken::default(),
                |_, _| {},
            )
            .await
            .expect("real PaddleOCR acquisition");
            assert_eq!(
                model_artifacts::verified_path(&directory, model).unwrap(),
                Some(path.clone())
            );
            let reused = download_at(
                &directory,
                model,
                &format!("audit-{model}-reuse"),
                &InferenceCancellationToken::default(),
                |_, _| panic!("verified OCR resource must not redownload"),
            )
            .await
            .unwrap();
            assert_eq!(reused, path);
        }
        let dictionary = std::fs::read_to_string(directory.join("paddleocr-keys-v1.txt")).unwrap();
        assert_eq!(dictionary.lines().count(), 6623);
        assert!(!dictionary.lines().any(|line| line == " "));
    }

    #[tokio::test]
    #[ignore = "downloads real catalog artifacts to an explicitly selected isolated audit directory"]
    async fn real_native_acquisition_repairs_graphs_and_installs_complete_artifact_sets() {
        let directory = PathBuf::from(
            std::env::var("VARVE_NATIVE_ACQUISITION_AUDIT_DIR").expect("isolated audit directory"),
        );
        assert_ne!(directory, varve_bgremove::model::models_dir());
        for model in [
            "grounding-dino-tokenizer",
            "scunet",
            "sam2-hiera-small-encoder",
            "trocr-decoder",
        ] {
            let path = download_at(
                &directory,
                model,
                &format!("audit-{model}"),
                &InferenceCancellationToken::default(),
                |_, _| {},
            )
            .await
            .expect("real production acquisition");
            assert_eq!(
                model_artifacts::verified_path(&directory, model).unwrap(),
                Some(path)
            );
            eprintln!("verified native acquisition: {model}");
        }
        let weights = directory.join("scunet_color_real_psnr.onnx.data");
        let hidden = directory.join("scunet_color_real_psnr.onnx.data.withheld");
        std::fs::rename(&weights, &hidden).unwrap();
        let missing_sidecar = model_artifacts::verified_path(&directory, "scunet");
        std::fs::rename(&hidden, &weights).unwrap();
        assert_eq!(
            missing_sidecar.unwrap(),
            None,
            "a graph alone is never ready"
        );

        // Exercise real HTTP body cancellation through the production installer.
        // Existing (invalid) bytes remain untouched until a replacement verifies.
        let cancelled_dir = directory.join("cancelled-download");
        std::fs::create_dir_all(&cancelled_dir).unwrap();
        let destination = cancelled_dir.join("grounding-dino-tokenizer.txt");
        std::fs::write(&destination, b"previous invalid bytes").unwrap();
        let token = InferenceCancellationToken::default();
        let result = download_at(
            &cancelled_dir,
            "grounding-dino-tokenizer",
            "audit-cancel-body",
            &token,
            |_, _| token.cancel(),
        )
        .await;
        assert!(result.unwrap_err().contains("cancelled"));
        assert_eq!(
            std::fs::read(&destination).unwrap(),
            b"previous invalid bytes"
        );
        assert_eq!(std::fs::read_dir(&cancelled_dir).unwrap().count(), 1);
        std::fs::remove_dir_all(cancelled_dir).unwrap();
    }
}

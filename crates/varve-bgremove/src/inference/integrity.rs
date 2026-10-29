//! Streaming SHA-256 verification for model artifacts.

// ── SHA-256 stream verification ────────────────────────────────────────

/// Compute SHA-256 digest of a file by streaming it in 64 KB chunks.
/// Never loads the entire file into memory.
pub fn stream_sha256(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let file = std::fs::File::open(path)
        .map_err(|e| format!("Cannot open {} for hashing: {e}", path.display()))?;
    let mut reader = std::io::BufReader::with_capacity(64 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = reader
            .read(&mut buffer)
            .map_err(|e| format!("Read error during SHA-256: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    let hash = hasher.finalize();
    Ok(hash.iter().map(|b| format!("{b:02x}")).collect::<String>())
}

/// Verify that a model file matches its expected SHA-256 digest.
///
/// Returns `Ok(())` if the digest matches or if `expected` is `None` (skip).
/// Returns `Err` on mismatch or IO error.
pub fn verify_model_sha256(path: &std::path::Path, expected: Option<&str>) -> Result<(), String> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let expected = expected.trim().to_lowercase();
    if expected.is_empty() {
        return Ok(());
    }
    let actual = stream_sha256(path)?;
    if actual == expected {
        Ok(())
    } else {
        Err(format!(
            "SHA-256 mismatch for {}: expected {expected}, got {actual}",
            path.display()
        ))
    }
}

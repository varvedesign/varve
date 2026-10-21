//! Shared host allowlist for native model downloads.
//!
//! Desktop IPC (`download_inference_model`, `download_background_removal_model`)
//! must refuse arbitrary HTTPS URLs. Only first-party catalog hosts are
//! accepted, including GitHub Releases and Hugging Face resolve/LFS.

pub fn is_allowed_model_download_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    if rest.starts_with("huggingface.co/")
        || rest.starts_with("cdn-lfs.huggingface.co/")
        || rest.starts_with("cdn-lfs-us-1.huggingface.co/")
        || rest.starts_with("cdn-lfs-eu-1.huggingface.co/")
        || rest.starts_with("objects.githubusercontent.com/")
        || rest.starts_with("release-assets.githubusercontent.com/")
        || rest.starts_with("github-releases.githubusercontent.com/")
        || rest.starts_with("media.githubusercontent.com/")
    {
        return true;
    }
    rest.strip_prefix("github.com/")
        .is_some_and(|path| path.contains("/releases/download/"))
}

#[cfg(test)]
mod tests {
    use super::is_allowed_model_download_url;

    #[test]
    fn accepts_catalog_hosts() {
        assert!(is_allowed_model_download_url(
            "https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model.onnx"
        ));
        assert!(is_allowed_model_download_url(
            "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
        ));
        assert!(is_allowed_model_download_url(
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/u2netp.onnx"
        ));
    }

    #[test]
    fn rejects_insecure_and_unknown_hosts() {
        assert!(!is_allowed_model_download_url(
            "http://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model.onnx"
        ));
        assert!(!is_allowed_model_download_url(
            "https://evil.example/models/steal.onnx"
        ));
        assert!(!is_allowed_model_download_url(
            "https://github.com/evil/repo/archive/refs/heads/main.zip"
        ));
    }
}

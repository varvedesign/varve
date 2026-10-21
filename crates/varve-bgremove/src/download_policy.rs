//! Shared host allowlist for native model downloads.
//!
//! Desktop IPC (`download_inference_model`, `download_background_removal_model`,
//! and generative-model downloads) must refuse arbitrary URLs. Only first-party
//! catalog hosts are accepted, including Hugging Face resolve/LFS/Xet redirects
//! and GitHub Releases.

use url::Url;

const EXACT_HOSTS: &[&str] = &[
    "huggingface.co",
    "hf.co",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
];

pub fn is_allowed_model_download_url(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    if parsed.port().is_some() {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    if !is_allowed_model_download_host(host) {
        return false;
    }
    if host.eq_ignore_ascii_case("github.com") {
        return is_github_release_download_path(parsed.path());
    }
    true
}

fn is_allowed_model_download_host(host: &str) -> bool {
    if EXACT_HOSTS
        .iter()
        .any(|allowed| host.eq_ignore_ascii_case(allowed))
    {
        return true;
    }
    if is_true_subdomain(host, "hf.co") {
        return true;
    }
    host.len() > "huggingface.co".len()
        && is_true_subdomain(host, "huggingface.co")
        && host
            .get(..host.len() - ".huggingface.co".len())
            .is_some_and(|label| {
                label.eq_ignore_ascii_case("cdn-lfs")
                    || label
                        .to_ascii_lowercase()
                        .strip_prefix("cdn-lfs")
                        .is_some_and(|rest| {
                            rest.is_empty() || rest.starts_with('-') || rest.starts_with('.')
                        })
            })
}

fn is_true_subdomain(host: &str, parent: &str) -> bool {
    let suffix = format!(".{parent}");
    host.len() > suffix.len()
        && host
            .get(host.len() - suffix.len()..)
            .is_some_and(|tail| tail.eq_ignore_ascii_case(&suffix))
        && host
            .get(..host.len() - suffix.len())
            .is_some_and(|prefix| !prefix.is_empty() && !prefix.ends_with('.'))
}

fn is_github_release_download_path(path: &str) -> bool {
    let mut parts = path.split('/');
    if parts.next() != Some("") {
        return false;
    }
    let owner = parts.next().unwrap_or("");
    let repo = parts.next().unwrap_or("");
    let releases = parts.next();
    let download = parts.next();
    let artifact = parts.next();
    !owner.is_empty()
        && !repo.is_empty()
        && !owner.contains("..")
        && !repo.contains("..")
        && releases == Some("releases")
        && download == Some("download")
        && artifact.is_some_and(|name| !name.is_empty())
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
            "https://cdn-lfs.huggingface.co/repos/aa/bb/model.onnx"
        ));
        assert!(is_allowed_model_download_url(
            "https://cdn-lfs-us-1.huggingface.co/repos/aa/bb/model.onnx"
        ));
        assert!(is_allowed_model_download_url(
            "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
        ));
        assert!(is_allowed_model_download_url(
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/u2netp.onnx"
        ));
        assert!(is_allowed_model_download_url(
            "https://release-assets.githubusercontent.com/github-production-release-asset/u2netp.onnx"
        ));
    }

    #[test]
    fn accepts_hugging_face_redirect_hosts() {
        assert!(is_allowed_model_download_url(
            "https://hf.co/Xenova/dinov2-small/resolve/main/onnx/model.onnx"
        ));
        assert!(is_allowed_model_download_url(
            "https://cdn-lfs.hf.co/repos/aa/bb/model.onnx"
        ));
        assert!(is_allowed_model_download_url(
            "https://cas-bridge.xethub.hf.co/xet-bridge-us/model.onnx"
        ));
        assert!(is_allowed_model_download_url(
            "https://us.aws.cdn.hf.co/xet-bridge-us/model.onnx"
        ));
    }

    #[test]
    fn rejects_lookalikes_userinfo_ports_and_http() {
        assert!(!is_allowed_model_download_url(
            "https://huggingface.co.evil.com/Xenova/dinov2-small/resolve/main/onnx/model.onnx"
        ));
        assert!(!is_allowed_model_download_url(
            "https://evilhf.co/Xenova/dinov2-small/resolve/main/onnx/model.onnx"
        ));
        assert!(!is_allowed_model_download_url(
            "https://hf.co.evil.com/Xenova/dinov2-small/resolve/main/onnx/model.onnx"
        ));
        assert!(!is_allowed_model_download_url(
            "https://notcdn-lfs.huggingface.co/repos/aa/bb/model.onnx"
        ));
        assert!(!is_allowed_model_download_url(
            "https://user@huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model.onnx"
        ));
        assert!(!is_allowed_model_download_url(
            "https://huggingface.co:8443/Xenova/dinov2-small/resolve/main/onnx/model.onnx"
        ));
        assert!(!is_allowed_model_download_url(
            "http://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model.onnx"
        ));
        assert!(!is_allowed_model_download_url(
            "https://evil.example/models/steal.onnx"
        ));
    }

    #[test]
    fn github_path_must_be_a_release_download() {
        assert!(!is_allowed_model_download_url(
            "https://github.com/evil/repo/archive/refs/heads/main.zip"
        ));
        assert!(!is_allowed_model_download_url(
            "https://github.com/evil/repo/archive/main.zip?path=/releases/download/x"
        ));
        assert!(!is_allowed_model_download_url(
            "https://github.com/releases/download/v1/model.onnx"
        ));
    }
}

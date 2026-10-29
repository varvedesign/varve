//! Animated media probe/decode commands extracted from the crate root (Batch B/B-01).

// ── Animated media decode ────────────────────────────────────────────────

/// Raw binary IPC variant for animated media: the encoded file travels as
/// the request body; decode options travel as a small JSON header. Mirrors
/// the trace/upscale binary channels.
#[tauri::command]
pub(crate) async fn media_probe_binary(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("media_probe_binary requires an application/octet-stream body".into())
        }
    };
    let probe = tauri::async_runtime::spawn_blocking(move || {
        varve_media::probe(&bytes, &varve_media::DEFAULT_LIMITS)
    })
    .await
    .map_err(|e| format!("media probe task failed: {e}"))??;
    serde_json::to_string(&probe).map_err(|e| format!("media probe serialize failed: {e}"))
}

#[tauri::command]
pub(crate) async fn media_decode_frames_binary(
    request: tauri::ipc::Request<'_>,
) -> Result<Vec<varve_media::DecodedFrameJson>, String> {
    const OPTIONS_HEADER: &str = "x-varve-media-opts";
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err(
                "media_decode_frames_binary requires an application/octet-stream body".into(),
            )
        }
    };
    let options_json = request
        .headers()
        .get(OPTIONS_HEADER)
        .ok_or_else(|| format!("Missing {OPTIONS_HEADER} header"))?
        .to_str()
        .map_err(|_| format!("Invalid {OPTIONS_HEADER} header"))?
        .to_owned();
    let options: MediaDecodeOptions = serde_json::from_str(&options_json)
        .map_err(|e| format!("Invalid media decode options: {e}"))?;
    if options.start > options.end {
        return Err("media decode range start exceeds end".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        varve_media::decode_frames_base64(
            &bytes,
            options.start,
            options.end,
            &varve_media::DEFAULT_LIMITS,
        )
    })
    .await
    .map_err(|e| format!("media decode task failed: {e}"))??;
    Ok(result)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaDecodeOptions {
    pub(crate) start: u32,
    pub(crate) end: u32,
}

//! Generative model download cancellation, disk and retry machinery (Batch B/B-01).

use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_CANCELLATIONS;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_SIZE;
use crate::inference::generative::config::GENERATIVE_MODEL_DOWNLOAD_URL;
use crate::inference::generative::model_status::GenerativeModelDownloadProgress;
use std::future::Future;
use std::io::Write;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;

pub(crate) fn generative_model_download_cancelled(request_id: &str) -> bool {
    GENERATIVE_MODEL_DOWNLOAD_CANCELLATIONS
        .lock()
        .map(|requests| requests.contains(request_id))
        .unwrap_or(true)
}

pub(crate) fn available_disk_space(path: &std::path::Path) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let path = CString::new(path.as_os_str().as_bytes()).ok()?;
        let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        // SAFETY: `path` is NUL-terminated and `stats` points to writable
        // storage for the platform call to initialize.
        let result = unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) };
        if result != 0 {
            return None;
        }
        // SAFETY: statvfs returned success, so the structure is initialized.
        let stats = unsafe { stats.assume_init() };
        let bytes = u128::from(stats.f_bavail) * u128::from(stats.f_frsize);
        return u64::try_from(bytes).ok();
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        wide.push(0);
        let mut free = 0u64;
        // SAFETY: `wide` is a valid NUL-terminated UTF-16 path and `free`
        // points to writable storage for the OS result.
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        return (ok != 0).then_some(free);
    }
    #[allow(unreachable_code)]
    None
}

/// Race an in-flight reqwest operation against the native cancellation
/// channel. Dropping the reqwest future closes the request body, which keeps
/// a cancelled download from waiting for the next network chunk.
async fn await_generative_download_or_cancel<T, Operation>(
    operation: Operation,
    cancellation: &mut tauri::async_runtime::Receiver<()>,
    error_prefix: &'static str,
) -> Result<T, String>
where
    Operation: Future<Output = Result<T, reqwest::Error>>,
{
    let mut operation = Box::pin(operation);
    let mut cancelled = Box::pin(cancellation.recv());
    std::future::poll_fn(move |cx| {
        if let std::task::Poll::Ready(result) = operation.as_mut().poll(cx) {
            return std::task::Poll::Ready(
                result.map_err(|error| format!("{error_prefix}: {error}")),
            );
        }
        if let std::task::Poll::Ready(Some(())) = cancelled.as_mut().poll(cx) {
            return std::task::Poll::Ready(Err("Download cancelled".into()));
        }
        std::task::Poll::Pending
    })
    .await
}

/// The cancellation command runs independently of the async downloader. A
/// short-lived watcher bridges the command's synchronous tombstone set to the
/// async request without adding another long-lived task or exposing a native
/// cancellation token over IPC.
pub(crate) fn start_generative_download_cancellation_watcher(
    request_id: &str,
) -> (
    Arc<AtomicBool>,
    tauri::async_runtime::Receiver<()>,
    std::thread::JoinHandle<()>,
) {
    let (sender, receiver) = tauri::async_runtime::channel(1);
    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop);
    let request_id = request_id.to_owned();
    let watcher = std::thread::spawn(move || {
        while !stop_for_thread.load(Ordering::Acquire) {
            if generative_model_download_cancelled(&request_id) {
                let _ = sender.blocking_send(());
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    });
    (stop, receiver, watcher)
}

pub(crate) async fn download_generative_model_attempt(
    app: &tauri::AppHandle,
    request_id: &str,
    destination: &std::path::Path,
    client: &reqwest::Client,
) -> Result<(), String> {
    let (stop_watcher, mut cancellation, watcher) =
        start_generative_download_cancellation_watcher(request_id);
    let result = download_generative_model_attempt_inner(
        app,
        request_id,
        destination,
        client,
        &mut cancellation,
    )
    .await;
    stop_watcher.store(true, Ordering::Release);
    let _ = watcher.join();
    result
}

async fn download_generative_model_attempt_inner(
    app: &tauri::AppHandle,
    request_id: &str,
    destination: &std::path::Path,
    client: &reqwest::Client,
    cancellation: &mut tauri::async_runtime::Receiver<()>,
) -> Result<(), String> {
    let partial = destination.with_extension("gguf.part");
    let mut loaded = partial
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if loaded > GENERATIVE_MODEL_DOWNLOAD_SIZE {
        std::fs::remove_file(&partial)
            .map_err(|error| format!("Could not discard oversized model partial: {error}"))?;
        loaded = 0;
    }
    if generative_model_download_cancelled(request_id) {
        return Err("Download cancelled".into());
    }

    let mut request = client.get(GENERATIVE_MODEL_DOWNLOAD_URL);
    if loaded > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={loaded}-"));
    }
    let mut response = await_generative_download_or_cancel(
        request.send(),
        cancellation,
        "Generative model download failed",
    )
    .await?;
    if loaded > 0 && response.status() == reqwest::StatusCode::OK {
        // The server ignored Range. Restart from a clean partial rather than
        // appending the full response to an existing prefix.
        std::fs::remove_file(&partial)
            .map_err(|error| format!("Could not restart model download: {error}"))?;
        loaded = 0;
        response = await_generative_download_or_cancel(
            client.get(GENERATIVE_MODEL_DOWNLOAD_URL).send(),
            cancellation,
            "Generative model download failed",
        )
        .await?;
    }
    if loaded > 0 && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!(
            "The model server did not honor resume (HTTP {})",
            response.status()
        ));
    }
    response = response
        .error_for_status()
        .map_err(|error| format!("Generative model download failed: {error}"))?;
    if generative_model_download_cancelled(request_id) {
        return Err("Download cancelled".into());
    }

    let response_total = response.content_length().unwrap_or(0);
    if response_total > 0 && loaded + response_total != GENERATIVE_MODEL_DOWNLOAD_SIZE {
        return Err(format!(
            "Model download size changed: expected {}, received {}",
            GENERATIVE_MODEL_DOWNLOAD_SIZE,
            loaded + response_total
        ));
    }
    if let Some(parent) = partial.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create model directory: {error}"))?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(loaded > 0)
        .write(true)
        .open(&partial)
        .map_err(|error| format!("Could not open model partial: {error}"))?;
    let total = GENERATIVE_MODEL_DOWNLOAD_SIZE;
    let _ = app.emit(
        "generative-edit-model-progress",
        GenerativeModelDownloadProgress {
            request_id: request_id.into(),
            loaded,
            total,
        },
    );
    while let Some(chunk) = await_generative_download_or_cancel(
        response.chunk(),
        cancellation,
        "Generative model download interrupted",
    )
    .await?
    {
        if generative_model_download_cancelled(request_id) {
            return Err("Download cancelled".into());
        }
        file.write_all(&chunk)
            .map_err(|error| format!("Could not write model partial: {error}"))?;
        loaded += chunk.len() as u64;
        if loaded > total {
            return Err("Generative model download exceeded its pinned size".into());
        }
        let _ = app.emit(
            "generative-edit-model-progress",
            GenerativeModelDownloadProgress {
                request_id: request_id.into(),
                loaded,
                total,
            },
        );
    }
    file.sync_all()
        .map_err(|error| format!("Could not flush model partial: {error}"))?;
    if generative_model_download_cancelled(request_id) {
        return Err("Download cancelled".into());
    }
    if loaded != total {
        return Err(format!(
            "Generative model download ended at {loaded} bytes; expected {total}"
        ));
    }
    Ok(())
}

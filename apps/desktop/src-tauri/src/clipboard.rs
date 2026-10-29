//! Native clipboard commands extracted from the crate root (Batch B/B-01).

pub(crate) mod wayland;

#[cfg(test)]
mod tests;

use crate::clipboard::wayland::read_wayland_clipboard_data;
use crate::clipboard::wayland::write_wayland_clipboard_data;
use crate::files::resolve_user_path_approved;
use crate::uuid;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::LazyLock;
use std::sync::Mutex;
use std::time::Duration;

// ── Native clipboard ────────────────────────────────────────────────────
//
// `navigator.clipboard.read()` (and the DOM `paste` ClipboardEvent's image
// items) are unreliable for image MIME types under WebKitGTK on Wayland —
// see AGENTS.md Session 45 "known limitation". This command reads the OS
// clipboard directly via `arboard`, bypassing the Web Clipboard API, and is
// used as a last-resort fallback by `readClipboardUnifiedWithFallback` in
// `packages/editor/src/clipboard.ts`.

const MAX_NATIVE_CLIPBOARD_ITEMS: usize = 16;
pub(crate) const MAX_NATIVE_CLIPBOARD_BYTES: usize = 64 * 1024 * 1024;
const MAX_NATIVE_IMAGE_DIMENSION: u32 = 32_768;
const MAX_NATIVE_IMAGE_PIXELS: u64 = 64 * 1024 * 1024;
pub(crate) const NATIVE_CLIPBOARD_DEADLINE: Duration = Duration::from_secs(5);

static NATIVE_CLIPBOARD_CANCELLATIONS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

pub(crate) fn validate_bounded_image_dimensions(
    width: u32,
    height: u32,
    label: &str,
) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err(format!("{label} has empty dimensions"));
    }
    if width > MAX_NATIVE_IMAGE_DIMENSION || height > MAX_NATIVE_IMAGE_DIMENSION {
        return Err(format!(
            "{label} dimensions exceed the {MAX_NATIVE_IMAGE_DIMENSION}px limit"
        ));
    }
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| format!("{label} dimensions overflow"))?;
    if pixels > MAX_NATIVE_IMAGE_PIXELS {
        return Err(format!("{label} exceeds the 64 megapixel limit"));
    }
    Ok(())
}

fn validate_native_image_dimensions(width: u32, height: u32) -> Result<(), String> {
    validate_bounded_image_dimensions(width, height, "clipboard image")
}

fn clipboard_operation_id(operation_id: Option<String>) -> Result<String, String> {
    let request_id = operation_id.unwrap_or_else(uuid);
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("Invalid clipboard operation id".into());
    }
    Ok(request_id)
}

fn clipboard_operation_cancelled(operation_id: &str) -> bool {
    #[cfg(target_os = "linux")]
    {
        native_clipboard_cancelled(operation_id)
    }
    #[cfg(not(target_os = "linux"))]
    {
        NATIVE_CLIPBOARD_CANCELLATIONS
            .lock()
            .map(|cancelled| cancelled.contains(operation_id))
            .unwrap_or(true)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeClipboardItemInput {
    pub(crate) mime_type: String,
    pub(crate) data: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeClipboardItemOutput {
    pub(crate) mime_type: String,
    pub(crate) data: Vec<u8>,
}

fn supported_native_clipboard_mime(mime_type: &str) -> bool {
    matches!(
        mime_type,
        "application/vnd.varve+json"
            | "application/vnd.strata+json"
            | "web application/vnd.varve+json"
            | "web application/vnd.strata+json"
            | "image/svg+xml"
            | "text/svg+xml"
            | "image/png"
            | "image/jpeg"
            | "image/webp"
            | "image/gif"
            | "image/bmp"
            | "text/plain"
    )
}

#[cfg(target_os = "linux")]
pub(crate) fn native_clipboard_cancelled(operation_id: &str) -> bool {
    NATIVE_CLIPBOARD_CANCELLATIONS
        .lock()
        .map(|cancelled| cancelled.contains(operation_id))
        .unwrap_or(true)
}
#[cfg(not(target_os = "linux"))]
fn write_wayland_clipboard_data(_items: Vec<NativeClipboardItemInput>) -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub(crate) async fn read_clipboard_data(
    mime_types: Vec<String>,
    operation_id: Option<String>,
) -> Result<Option<NativeClipboardItemOutput>, String> {
    if mime_types.len() > MAX_NATIVE_CLIPBOARD_ITEMS {
        return Err("Too many clipboard MIME types requested".into());
    }
    let request_id = operation_id.unwrap_or_else(uuid);
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("Invalid clipboard operation id".into());
    }
    if let Ok(mut cancelled) = NATIVE_CLIPBOARD_CANCELLATIONS.lock() {
        if cancelled.remove(&request_id) {
            return Err("Clipboard read was cancelled".into());
        }
    }
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let worker_id = request_id.clone();
    std::thread::spawn(move || {
        let result = read_wayland_clipboard_data(&mime_types, &worker_id);
        let _ = sender.send((worker_id, result));
    });
    let waited = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(NATIVE_CLIPBOARD_DEADLINE)
    })
    .await
    .map_err(|_| "Clipboard read worker stopped unexpectedly".to_string())?
    .map_err(|_| "Clipboard read exceeded the 5 second deadline".to_string())?;
    if let Ok(mut cancelled) = NATIVE_CLIPBOARD_CANCELLATIONS.lock() {
        cancelled.remove(&waited.0);
    }
    waited.1
}

#[tauri::command]
pub(crate) async fn write_clipboard_data(
    items: Vec<NativeClipboardItemInput>,
    operation_id: Option<String>,
) -> Result<bool, String> {
    if items.is_empty() || items.len() > MAX_NATIVE_CLIPBOARD_ITEMS {
        return Err("Invalid native clipboard item count".into());
    }
    let total_bytes = items.iter().map(|item| item.data.len()).sum::<usize>();
    if total_bytes > MAX_NATIVE_CLIPBOARD_BYTES
        || items
            .iter()
            .any(|item| !supported_native_clipboard_mime(&item.mime_type))
    {
        return Err("Invalid native clipboard payload".into());
    }
    let request_id = operation_id.unwrap_or_else(uuid);
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("Invalid clipboard operation id".into());
    }
    if let Ok(mut cancelled) = NATIVE_CLIPBOARD_CANCELLATIONS.lock() {
        if cancelled.remove(&request_id) {
            return Err("Clipboard write was cancelled".into());
        }
    }
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let _ = sender.send((request_id, write_wayland_clipboard_data(items)));
    });
    let waited = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(NATIVE_CLIPBOARD_DEADLINE)
    })
    .await
    .map_err(|_| "Clipboard write worker stopped unexpectedly".to_string())?
    .map_err(|_| "Clipboard write exceeded the 5 second deadline".to_string())?;
    if let Ok(mut cancelled) = NATIVE_CLIPBOARD_CANCELLATIONS.lock() {
        cancelled.remove(&waited.0);
    }
    waited.1
}

#[tauri::command]
pub(crate) fn cancel_clipboard_operation(operation_id: String) -> Result<(), String> {
    if operation_id.is_empty() || operation_id.len() > 128 {
        return Err("Invalid clipboard operation id".into());
    }
    NATIVE_CLIPBOARD_CANCELLATIONS
        .lock()
        .map_err(|_| "Native clipboard cancellation state is unavailable".to_string())?
        .insert(operation_id);
    Ok(())
}

// ── Native file drag-and-drop ───────────────────────────────────────────
//
// wry's WebKitGTK backend hooks GTK's own drag-and-drop signals on the
// WebView widget unconditionally (webkitgtk/drag_drop.rs `connect_drag_event`
// is called with no `drag_drop_enabled` check), so the browser's HTML5
// dragover/drop DOM events never reach the page on Linux. The frontend
// listens for Tauri's `tauri://drag-drop` window event instead (which
// carries absolute file paths, not File objects) and reads each file's
// bytes via this command.

#[tauri::command]
pub(crate) fn read_dropped_file(path: String) -> Result<Vec<u8>, String> {
    // Dropping a file onto the window is an explicit user gesture — the path
    // may live anywhere (external drive, network mount). Approved resolver
    // still canonicalizes and rejects traversal.
    let resolved = resolve_user_path_approved(&path)?;
    std::fs::read(&resolved).map_err(|e| e.to_string())
}

fn read_clipboard_image_png_blocking(operation_id: &str) -> Result<Option<Vec<u8>>, String> {
    if clipboard_operation_cancelled(operation_id) {
        return Err("Clipboard image read was cancelled".into());
    }
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let img = match clipboard.get_image() {
        Ok(img) => img,
        Err(arboard::Error::ContentNotAvailable) => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let width = u32::try_from(img.width)
        .map_err(|_| "clipboard image width exceeds the supported range".to_string())?;
    let height = u32::try_from(img.height)
        .map_err(|_| "clipboard image height exceeds the supported range".to_string())?;
    validate_native_image_dimensions(width, height)?;
    let expected_bytes = usize::try_from(width)
        .ok()
        .and_then(|width| {
            usize::try_from(height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "clipboard image buffer size overflowed".to_string())?;
    if img.bytes.len() != expected_bytes {
        return Err("clipboard image buffer size did not match its dimensions".into());
    }
    if clipboard_operation_cancelled(operation_id) {
        return Err("Clipboard image read was cancelled".into());
    }
    let rgba = image::RgbaImage::from_raw(width, height, img.bytes.into_owned())
        .ok_or_else(|| "clipboard image buffer size did not match its dimensions".to_string())?;
    let mut png_bytes: Vec<u8> = Vec::new();
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            image::ImageFormat::Png,
        )
        .map_err(|e| e.to_string())?;
    if clipboard_operation_cancelled(operation_id) {
        return Err("Clipboard image read was cancelled".into());
    }
    Ok(Some(png_bytes))
}

#[tauri::command]
pub(crate) async fn read_clipboard_image_png(
    operation_id: Option<String>,
) -> Result<Option<Vec<u8>>, String> {
    let request_id = clipboard_operation_id(operation_id)?;
    if let Ok(mut cancelled) = NATIVE_CLIPBOARD_CANCELLATIONS.lock() {
        if cancelled.remove(&request_id) {
            return Err("Clipboard image read was cancelled".into());
        }
    }
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let worker_id = request_id.clone();
    std::thread::spawn(move || {
        let result = read_clipboard_image_png_blocking(&worker_id);
        let _ = sender.send((worker_id, result));
    });
    let waited = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(NATIVE_CLIPBOARD_DEADLINE)
    })
    .await
    .map_err(|_| "Clipboard image read worker stopped unexpectedly".to_string())?;
    let (finished_id, result) = match waited {
        Ok(value) => value,
        Err(_) => {
            if let Ok(mut cancelled) = NATIVE_CLIPBOARD_CANCELLATIONS.lock() {
                cancelled.insert(request_id);
            }
            return Err("Clipboard image read exceeded the 5 second deadline".into());
        }
    };
    if let Ok(mut cancelled) = NATIVE_CLIPBOARD_CANCELLATIONS.lock() {
        cancelled.remove(&finished_id);
    }
    result
}

//! Bounded Wayland clipboard pipe helpers; linux and non-linux variants keep their cfg attributes verbatim.

use crate::clipboard::native_clipboard_cancelled;
use crate::clipboard::supported_native_clipboard_mime;
use crate::clipboard::NativeClipboardItemInput;
use crate::clipboard::NativeClipboardItemOutput;
use crate::clipboard::MAX_NATIVE_CLIPBOARD_BYTES;
use crate::clipboard::NATIVE_CLIPBOARD_DEADLINE;
use std::io::Read;
use std::time::Instant;

#[cfg(target_os = "linux")]
pub(crate) fn read_wayland_pipe_bounded(
    mut pipe: impl Read + std::os::fd::AsRawFd,
    operation_id: &str,
) -> Result<Vec<u8>, String> {
    use std::io::ErrorKind;

    let fd = pipe.as_raw_fd();
    // A non-blocking descriptor lets cancellation and the deadline interrupt a
    // transfer even when the clipboard owner stops producing bytes.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Err(format!(
            "Failed to inspect Wayland clipboard pipe: {}",
            std::io::Error::last_os_error()
        ));
    }
    if unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(format!(
            "Failed to bound Wayland clipboard pipe: {}",
            std::io::Error::last_os_error()
        ));
    }

    let started = Instant::now();
    let mut data = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    loop {
        if native_clipboard_cancelled(operation_id) {
            return Err("Clipboard read was cancelled".into());
        }
        let elapsed = started.elapsed();
        if elapsed >= NATIVE_CLIPBOARD_DEADLINE {
            return Err("Clipboard read exceeded the 5 second deadline".into());
        }
        let remaining = NATIVE_CLIPBOARD_DEADLINE.saturating_sub(elapsed);
        let timeout_ms = remaining.as_millis().clamp(1, 100) as i32;
        let mut poll_fd = libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        };
        let ready = unsafe { libc::poll(&mut poll_fd, 1, timeout_ms) };
        if ready < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == ErrorKind::Interrupted {
                continue;
            }
            return Err(format!(
                "Failed waiting for Wayland clipboard data: {error}"
            ));
        }
        if ready == 0 {
            continue;
        }
        match pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                data.extend_from_slice(&chunk[..read]);
                if data.len() > MAX_NATIVE_CLIPBOARD_BYTES {
                    return Err("Wayland clipboard payload exceeds the 64 MiB limit".into());
                }
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => continue,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => return Err(format!("Failed to read Wayland clipboard data: {error}")),
        }
    }
    Ok(data)
}

#[cfg(target_os = "linux")]
pub(crate) fn read_wayland_clipboard_data(
    mime_types: &[String],
    operation_id: &str,
) -> Result<Option<NativeClipboardItemOutput>, String> {
    if std::env::var_os("WAYLAND_DISPLAY").is_none() {
        return Ok(None);
    }

    use wl_clipboard_rs::paste::{get_contents, ClipboardType, MimeType, Seat};

    for mime_type in mime_types {
        if !supported_native_clipboard_mime(mime_type) {
            continue;
        }
        let Ok((pipe, actual_mime_type)) = get_contents(
            ClipboardType::Regular,
            Seat::Unspecified,
            MimeType::Specific(mime_type),
        ) else {
            continue;
        };
        let data = read_wayland_pipe_bounded(pipe, operation_id)?;
        return Ok(Some(NativeClipboardItemOutput {
            mime_type: actual_mime_type,
            data,
        }));
    }
    Ok(None)
}

#[cfg(not(target_os = "linux"))]
fn read_wayland_clipboard_data(
    _mime_types: &[String],
    _operation_id: &str,
) -> Result<Option<NativeClipboardItemOutput>, String> {
    Ok(None)
}

#[cfg(target_os = "linux")]
pub(crate) fn write_wayland_clipboard_data(
    items: Vec<NativeClipboardItemInput>,
) -> Result<bool, String> {
    if std::env::var_os("WAYLAND_DISPLAY").is_none() {
        return Ok(false);
    }

    use wl_clipboard_rs::copy::{ClipboardType, MimeSource, MimeType, Options, Source};

    let sources = items
        .into_iter()
        .map(|item| MimeSource {
            source: Source::Bytes(item.data.into_boxed_slice()),
            mime_type: MimeType::Specific(item.mime_type),
        })
        .collect();
    let mut options = Options::new();
    options.clipboard(ClipboardType::Regular);
    options
        .copy_multi(sources)
        .map(|()| true)
        .map_err(|error| format!("Failed to write Wayland clipboard data: {error}"))
}

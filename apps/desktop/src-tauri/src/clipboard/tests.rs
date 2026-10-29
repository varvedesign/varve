//! Unit tests for clipboard (moved verbatim from lib.rs #[cfg(test)] mod tests; Batch B/B-01).

use super::*;
use crate::clipboard::wayland::read_wayland_pipe_bounded;
use crate::uuid;
use std::io::Write;

#[test]
fn native_clipboard_image_dimensions_are_bounded_before_conversion() {
    assert!(validate_native_image_dimensions(1, 1).is_ok());
    assert!(validate_native_image_dimensions(32_769, 1).is_err());
    assert!(validate_native_image_dimensions(8_193, 8_193).is_err());
    assert!(validate_native_image_dimensions(0, 10).is_err());
}

#[cfg(target_os = "linux")]
#[test]
fn native_clipboard_pipe_reads_with_a_bounded_buffer() {
    use std::os::fd::FromRawFd;

    let mut fds = [0; 2];
    assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
    let reader = unsafe { std::fs::File::from_raw_fd(fds[0]) };
    let mut writer = unsafe { std::fs::File::from_raw_fd(fds[1]) };
    writer.write_all(b"clipboard").expect("write fixture");
    drop(writer);

    let result =
        read_wayland_pipe_bounded(reader, "native-clipboard-test").expect("bounded pipe read");
    assert_eq!(result, b"clipboard");
}

#[cfg(target_os = "linux")]
#[test]
fn native_clipboard_pipe_honours_cancellation() {
    use std::os::fd::FromRawFd;

    let operation_id = "native-clipboard-cancel-test".to_string();
    NATIVE_CLIPBOARD_CANCELLATIONS
        .lock()
        .expect("cancellation state")
        .insert(operation_id.clone());
    let mut fds = [0; 2];
    assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
    let reader = unsafe { std::fs::File::from_raw_fd(fds[0]) };
    let writer = unsafe { std::fs::File::from_raw_fd(fds[1]) };
    drop(writer);

    let result = read_wayland_pipe_bounded(reader, &operation_id);
    assert_eq!(result, Err("Clipboard read was cancelled".to_string()));
    NATIVE_CLIPBOARD_CANCELLATIONS
        .lock()
        .expect("cancellation state")
        .remove(&operation_id);
}

#[test]
fn clipboard_cancellation_tracks_only_the_registered_operation() {
    let operation_id = format!("clipboard-state-check-{}", uuid());
    assert!(!clipboard_operation_cancelled(&operation_id));
    NATIVE_CLIPBOARD_CANCELLATIONS
        .lock()
        .expect("cancellation state")
        .insert(operation_id.clone());
    assert!(clipboard_operation_cancelled(&operation_id));
    NATIVE_CLIPBOARD_CANCELLATIONS
        .lock()
        .expect("cancellation state")
        .remove(&operation_id);
    assert!(!clipboard_operation_cancelled(&operation_id));
}

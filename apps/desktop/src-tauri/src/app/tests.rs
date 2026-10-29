//! Unit tests for app (moved verbatim from lib.rs #[cfg(test)] mod tests; Batch B/B-01).

use crate::app::pinch_linux::touchpad_pinch_phase;
use crate::appimage_dmabuf_default;

#[test]
fn appimage_dmabuf_workaround_preserves_explicit_user_overrides() {
    assert_eq!(appimage_dmabuf_default(true, false), Some("1"));
    assert_eq!(appimage_dmabuf_default(true, true), None);
    assert_eq!(appimage_dmabuf_default(false, false), None);
}

#[test]
fn native_touchpad_phases_keep_updates_active_and_cancel_distinct() {
    assert_eq!(touchpad_pinch_phase(0), ("begin", true));
    assert_eq!(touchpad_pinch_phase(1), ("update", true));
    assert_eq!(touchpad_pinch_phase(2), ("end", false));
    assert_eq!(touchpad_pinch_phase(3), ("cancel", false));
    assert_eq!(touchpad_pinch_phase(i32::MAX), ("cancel", false));
}

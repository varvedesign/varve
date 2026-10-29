//! Unit tests for inference/content_fill (moved verbatim from lib.rs #[cfg(test)] mod tests; Batch B/B-01).

use super::*;

#[test]
fn lama_cancellation_is_request_scoped_and_stale_finish_is_ignored() {
    let state = LamaCancelState::new();
    let first = state.register("lama-first");
    let second = state.register("lama-second");

    assert!(
        first.is_cancelled(),
        "a newer request supersedes the older one"
    );
    assert!(!second.is_cancelled());

    state.finish("lama-first");
    state.cancel("lama-second");
    assert!(
        second.is_cancelled(),
        "the active request can be cancelled by id"
    );
    state.finish("lama-second");

    let third = state.register("lama-third");
    assert!(!third.is_cancelled());
}

#[test]
fn content_aware_fill_rejects_mismatched_buffers_before_model_access() {
    let options = ContentAwareFillOptions {
        request_id: Some("preflight-test".into()),
        image_data: vec![0; 3],
        image_w: 1,
        image_h: 1,
        mask: vec![0],
        mask_w: 1,
        mask_h: 1,
        preview_max_dimension: Some(512),
    };
    assert_eq!(
        validate_content_aware_fill_options(&options),
        Err("content-aware fill image buffer does not match its dimensions".into())
    );
}

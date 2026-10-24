#![cfg(feature = "ai")]
//! Checks the options consumed by the real runtime, not just builder strings.
//!
//! Run with the shipped runtime and bundled U2-NetP graph:
//! `ORT_DYLIB_PATH=... cargo test -p varve-bgremove --features ai
//! --test native_memory_policy -- --ignored --nocapture`

use std::path::Path;
use std::sync::{Arc, Mutex};
use varve_bgremove::inference::{InferenceRuntime, OrtInferenceRuntime};

#[test]
#[ignore = "requires the shipped ONNX Runtime dynamic library"]
fn native_cpu_sessions_disable_the_actual_arena_allocator() {
    let library = std::env::var("ORT_DYLIB_PATH").expect("ORT_DYLIB_PATH is required");
    let messages = Arc::new(Mutex::new(Vec::<String>::new()));
    let captured = Arc::clone(&messages);
    ort::init_from(library)
        .expect("load shipped runtime")
        .with_logger(Arc::new(move |_, _, _, _, message| {
            if message.contains("enable_cpu_mem_arena") || message.contains("BFCArena") {
                captured.lock().expect("log lock").push(message.to_owned());
            }
        }))
        .commit();
    ort::environment::Environment::current()
        .expect("runtime environment")
        .set_log_level(ort::logging::LogLevel::Verbose);

    let model =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/public/models/u2netp.onnx");
    let _session = OrtInferenceRuntime
        .create_cpu_session(&model)
        .expect("load bundled model through production session policy");
    let logs = messages.lock().expect("log lock").join("\n");
    eprintln!("{logs}");
    assert!(
        logs.contains("enable_cpu_mem_arena:0"),
        "the actual session must disable the CPU arena, not just store an unused config entry"
    );
    assert!(!logs.contains("Creating BFCArena"));
}

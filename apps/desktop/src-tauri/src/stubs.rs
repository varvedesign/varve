//! Legacy render-IR, sync, AI/collab/plugin stub commands extracted from the crate root (Batch B/B-01).

#[cfg(test)]
mod tests;

use crate::renderer::generate_ir;
use crate::renderer::generate_pixels;
use crate::renderer::ShapeIr;
use crate::uuid;
use serde::Deserialize;
use serde::Serialize;
use tauri::ipc::Response;
use tauri::Manager;
use varve_bridge::convert_engine_nodes;
use varve_bridge::IpcSceneNode;
use varve_core::Point;

/// Ceiling on the number of scene nodes accepted from the frontend in a
/// single IPC call. Without this, a `Vec<IpcSceneNode>` of unbounded size
/// flows straight into IR generation, hit-testing, and PDF export. This is
/// a floor against the worst-case "attacker/bug-controlled size" version of
/// that, not a considered product maximum for how large a real document's
/// flattened node list may legitimately get — see
/// docs/quality/tauri-command-audit.md §5.
pub(crate) const MAX_SCENE_NODES: usize = 50_000;

pub(crate) fn check_scene_node_bounds(nodes: &[IpcSceneNode]) -> Result<(), String> {
    if nodes.len() > MAX_SCENE_NODES {
        return Err(format!(
            "Scene has {} nodes; the limit is {MAX_SCENE_NODES}",
            nodes.len()
        ));
    }
    Ok(())
}
pub(crate) fn convert_scene(nodes: Vec<IpcSceneNode>) -> Vec<varve_core::SceneNode> {
    convert_engine_nodes(nodes)
}

#[tauri::command]
pub(crate) fn build_render_ir(
    nodes: Vec<IpcSceneNode>,
) -> Result<Vec<varve_engine::RenderItem>, String> {
    check_scene_node_bounds(&nodes)?;
    let scene = convert_scene(nodes);
    Ok(varve_engine::build_render_ir(&scene))
}

#[tauri::command]
pub(crate) fn hit_test(nodes: Vec<IpcSceneNode>, x: f64, y: f64) -> Result<Option<usize>, String> {
    check_scene_node_bounds(&nodes)?;
    let scene = convert_scene(nodes);
    Ok(varve_core::hit_test(&scene, Point::new(x, y)))
}

#[derive(Debug, Serialize)]
pub struct SceneIr {
    pub width: u32,
    pub height: u32,
    pub frame: u32,
    pub shapes: Vec<ShapeIr>,
}

#[tauri::command]
pub(crate) fn render_frame_ir(width: u32, height: u32, frame: u32) -> SceneIr {
    let shapes = generate_ir(frame);
    SceneIr {
        width,
        height,
        frame,
        shapes,
    }
}

/// Ceiling on the pixel count `render_frame_pixels` will allocate for.
/// Matches the order of magnitude `MAX_UPSCALE_OUTPUT_PIXELS` already uses
/// for the same reason: a caller-supplied `width * height` with no bound
/// is a one-call OOM/DoS (100,000 x 100,000 requests a buffer sized for
/// ~40 GB, and the naive `u32` multiplication that used to compute this
/// buffer's capacity can also wrap in a release build before the bound
/// check would even run).
const MAX_RENDER_FRAME_PIXELS: u64 = 64 * 1024 * 1024;

#[tauri::command]
pub(crate) fn render_frame_pixels(width: u32, height: u32, frame: u32) -> Result<Response, String> {
    let pixel_count = u64::from(width) * u64::from(height);
    if pixel_count > MAX_RENDER_FRAME_PIXELS {
        return Err(format!(
            "Requested {width}x{height} ({pixel_count} pixels); the limit is {MAX_RENDER_FRAME_PIXELS} pixels"
        ));
    }
    let bytes = generate_pixels(width, height, frame);
    Ok(Response::new(bytes))
}

#[derive(Debug, Deserialize)]
pub(crate) struct Report {
    pub(crate) mode: String,
    pub(crate) fps: f64,
    pub(crate) frames: u64,
    pub(crate) elapsed: f64,
    pub(crate) bytes_per_frame: f64,
}

#[tauri::command]
pub(crate) fn report(report: Report) {
    println!("[spike] mode={:<6} fps={:>6.1}  frames={:>5}  elapsed={:>5.2}s  bytes/frame={:>10.0}  bandwidth={:>8.1} MB/s",
        report.mode, report.fps, report.frames, report.elapsed, report.bytes_per_frame, report.bytes_per_frame * report.fps / 1_000_000.0);
}

#[tauri::command]
pub(crate) fn done(app: tauri::AppHandle) {
    println!("[spike] all modes measured, exiting.");
    app.exit(0);
}
// ── Legacy Sync ──────────────────────────────────────────────────────────

/// Persist a document. Receives the full document JSON from the TS editor.
#[tauri::command]
pub(crate) fn sync_save(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    doc_id: String,
    json: String,
) -> Result<(), String> {
    store
        .save_document(&doc_id, &json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn sync_load(
    store: tauri::State<'_, varve_sync::DocumentStore>,
    doc_id: String,
) -> Result<Option<String>, String> {
    store.load_document(&doc_id).map_err(|e| e.to_string())
}
// ── AI chat stub ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct AiResponse {
    pub(crate) id: String,
    pub(crate) role: String,
    pub(crate) content: String,
    pub(crate) timestamp: i64,
}

#[tauri::command]
pub(crate) fn ai_chat(_session_id: String, message: String) -> Result<AiResponse, String> {
    let reply = format!("(AI stub) You said: {}", message);
    Ok(AiResponse {
        id: uuid(),
        role: "assistant".into(),
        content: reply,
        timestamp: chrono::Utc::now().timestamp_millis(),
    })
}

// ── Collab stub commands ──────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct CollabUser {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) color: String,
}

#[tauri::command]
pub(crate) fn get_collab_users(document_id: String) -> Result<Vec<CollabUser>, String> {
    let _ = document_id;
    Ok(vec![])
}

#[tauri::command]
pub(crate) fn update_cursor(document_id: String, x: f64, y: f64) -> Result<(), String> {
    let _ = (document_id, x, y);
    Ok(())
}

// ── Plugin sandbox stub commands ──────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct PluginInfo {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) description: String,
}

#[tauri::command]
pub(crate) fn list_plugins() -> Result<Vec<PluginInfo>, String> {
    Ok(vec![])
}

/// Show and focus the main window.
///
/// The native splash window was removed: it created a second window and left
/// `main` hidden until the frontend asked for it, so any startup failure — a
/// bundle that never evaluated, a hung data load — left the user on an
/// unclosable splash with no error and nothing to report. Observed in the
/// 0.0.0 and 0.1.0 AppImages.
///
/// `main` is now `visible: true` from the start, so the branded boot screen in
/// index.html is what the user sees, and it replaces itself with a readable
/// error if startup fails. The in-app `StartupLoader` then takes over with
/// progress, a timeout, and a retry button.
///
/// This command is kept because the frontend still calls it once mounted;
/// showing an already-visible window is a harmless no-op, and it keeps the
/// window focused when launched from a file association.
#[tauri::command]
pub(crate) fn close_splashscreen(app: tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

# SEAM_SPEC - Batch B / B-01 Tauri command surface (lib.rs)

**Status:** seam plan accepted 2026-10-28 (single seam, one worktree, one
commit). Implementation runs only in `.worktrees/B-01` on
`seam/B/B-01-librs-commands`, after this document,
[RESEARCH.md](RESEARCH.md) and [GAP_ANALYSIS.md](GAP_ANALYSIS.md) exist.

## Seam hypothesis

- **Entry:** Batch B / B-01 (remediation rank #2; campaign Batch B first).
- **Target:** `apps/desktop/src-tauri/src/lib.rs` - 7,376 lines, frozen at
  7376 in `.file-size-baseline.json` (line 9).
- **Single concern:** the Tauri command surface still declared in the crate
  root. 70 `#[tauri::command]` fns, their wire structs, helpers, state types,
  the 87-fn unit-test block and the app-builder setup body move into domain
  modules; `lib.rs` becomes the thin crate root: `mod` declarations,
  `uuid`, the preserved `crate::` re-exports, the app builder entry
  (`run()`: Wayland env block, plugin chain, setup hook, 154-command
  `generate_handler!`, build/run event hook), and the appimage helper.
- **Single extraction destination:** the crate `src/` root - a destination
  directory = one seam (precedents: `menu/defs.ts` -> `menu/defs/`,
  A-04 `panels/intelligence/`, A-05 `types/`, A-06 `product/`, A-07
  `wgsl_validation/`, A-09 `workload/`, and the existing
  `home_store/` extraction in this crate).
- **Public API:** unchanged. Every command name, payload field, serde rename
  and registration entry is preserved; `audit:ipc` sees the same 154
  commands. `varve_desktop_lib::run()` stays the crate entry point called by
  `main.rs`. No binary, config, capability or TypeScript file changes.
- **Scope note (declared):** the campaign row says "lib.rs keeps the app
  builder and wire structs". Keeping all 40 wire structs in `lib.rs` makes
  the 400-line cap mathematically impossible (they are ~600 lines before the
  builder), and the IPC policy in `docs/architecture/ipc-type-contract.md`
  places payload structs with their command module. This seam therefore keeps
  the **app builder entry** (`run()` with plugin chain, setup hook,
  registration list and run-event hook) in `lib.rs`, moves the **setup
  closure body** to `app::setup` (same statements, same order) and moves the
  **wire structs** with their command modules. This is the only interpretation
  under which the target can leave the baseline this session.

## Destination map (expected sizes)

| module | concern | expected lines |
|---|---|---|
| `lib.rs` | crate root: module declarations, `uuid`, `crate::` re-exports, appimage helper, `run()` builder entry + 154-command registration | ~295 |
| `stubs.rs` | legacy render-IR commands (`build_render_ir`, `hit_test`, `render_frame_ir/pixels`), sync stubs, ai/collab/plugin/splash stubs, `report`/`done` | ~225 |
| `files.rs` | user-path approval + binary file writes (`resolve_user_path`, `write_binary_file`, ...) | ~280 |
| `clipboard.rs` | native clipboard commands, bounds, cancellation, drag-and-drop file, image PNG | ~330 |
| `clipboard/wayland.rs` | bounded Wayland pipe read/write helpers (linux + non-linux variants, `#[cfg]` verbatim) | ~145 |
| `models.rs` | inference model download/path/delete commands + model file storage + shared sha/id validation helpers | ~215 |
| `inference/background.rs` | background-removal commands + cancellable core | ~215 |
| `inference/background/models.rs` | bg model status/download/progress, host memory, preflight | ~320 |
| `inference/denoise.rs` | SCUNet denoise command + options/results | ~95 |
| `inference/content_fill.rs` | LaMa inpainting commands + cancellation state | ~235 |
| `inference/generative/config.rs` | generative options/constants/validation | ~215 |
| `inference/generative/model_status.rs` | model quality/status/metadata helpers + status command | ~310 |
| `inference/generative/download.rs` | download cancellation/disk/attempt machinery | ~270 |
| `inference/generative/download_commands.rs` | download/cancel commands | ~170 |
| `inference/generative/import.rs` | model import/qualification commands + cancellation guards | ~285 |
| `inference/generative/run.rs` | helper process invocation, request/response types, run/cancel commands | ~355 |
| `inference/native_ai.rs` | `native_ai_status`, `ensure_native_ai`, onnxruntime resolution | ~180 |
| `upscale.rs` | upscale commands, cancellation state, GPU admission, core impl | ~330 |
| `upscale/ops.rs` | shared upscale/live-effect command cores | ~230 |
| `trace.rs` | trace commands, options sanitation, cancellation, core | ~315 |
| `media.rs` | animated-media probe/decode commands | ~90 |
| `printing.rs` | PDF/PDF-X export, text outlining/shaping, native print commands | ~380 |
| `app.rs` | app builder setup body (`app::setup`), in original order | ~135 |
| `app/pinch_linux.rs` | WebKitGTK touchpad pinch bridge + `touchpad_pinch_phase` | ~300 |
| `app/legacy_data.rs` | legacy Strata data-directory migration helpers | ~125 |
| `test_support.rs` | shared test helpers (`ts_wire_json`, `make_test_png`, oversized-node fixtures) | ~110 |

Test modules (`#[cfg(test)] mod tests;` children): `stubs/tests.rs` ~285,
`files/tests.rs` ~165, `clipboard/tests.rs` ~85, `models/tests.rs` ~60,
`inference/background/tests.rs` ~255, `inference/denoise/tests.rs` ~50,
`inference/content_fill/tests.rs` ~65, `inference/generative/tests.rs` ~265,
`upscale/tests.rs` ~165, `trace/tests.rs` ~155, `printing/tests.rs` ~265,
`app/tests.rs` ~35, `app/legacy_data/tests.rs` ~190. Every file is at or
under the 400-line cap; the largest is `printing.rs` (~380).

## Declaration inventory

The TypeScript planner cannot parse Rust (`godsplit-plan` exit 2, measured), so
this inventory was built by a raw-string/brace-aware top-level scan of the
checkpoint blob and hand-confirmed by reading every block range. Counts: 70
commands, 86 other fns, 40 structs, 7 statics, 35 consts, 7 impls, 1 type, 1
enum, 24 `mod`, 18 `use` items, plus 87 `#[test]` fns and 7 test helpers in the
`#[cfg(test)] mod tests` block. Every base line 1-7,376 is classified exactly
once: moved into one destination, kept in `lib.rs`, dedented wrapper
(`mod tests`/setup closure), or dropped blank boundary. Base `lib.rs` SHA-256:
`4b47bac82fa05bbab93d8211961c1b816af207fba6c9153ca0336a9bf13213c0`.

# Declaration inventory

| destination | base lines (fragment hash) | declarations |
|---|---|---|
| `lib.rs` | 1-45, 4502-4508, 4657-4697, 5083-5258, 5260-5262 (fragment `c619fe3022f0f1ea`) | 3 |
| `stubs` | 47-64, 92-169, 864-884, 4510-4589, 5902-6138, 7025-7043, 7056-7067 (fragment `5985c4dea3e00def`) | 22 |
| `models` | 66-90, 1018-1024, 1181-1296, 4451-4500, 5377-5413 (fragment `42a07d30db926963`) | 17 |
| `files` | 171-424, 6871-7024 (fragment `5bfe71babd4c6683`) | 6 |
| `clipboard` | 426-487, 499-538, 673-862, 5763-5770, 5795-5850 (fragment `900ef76b48e7a98c`) | 21 |
| `app/pinch_linux` | 488-498, 4778-5038 (fragment `aa6e5b33b773babf`) | 1 |
| `clipboard/wayland` | 540-671 (fragment `50c294e4523c1f92`) | 4 |
| `inference/background/models` | 886-1017, 1025-1179 (fragment `82dfdf3193e1935b`) | 18 |
| `inference/background` | 1298-1487, 5559-5633, 5789-5794, 6394-6507, 6537-6584 (fragment `c574803942d5d3dc`) | 7 |
| `inference/denoise` | 1489-1561, 6508-6536 (fragment `c776bd6e9cd1f403`) | 4 |
| `inference/content_fill` | 1563-1775, 5414-5437, 5771-5788 (fragment `3f690038227a4f4e`) | 8 |
| `inference/generative/config` | 1777-1963 (fragment `b7c2224620b46a66`) | 28 |
| `inference/generative/model_status` | 1965-2246 (fragment `b4b3ac0a77ad6292`) | 16 |
| `inference/generative/download` | 2248-2491 (fragment `fc8c82e4f508d9a0`) | 6 |
| `inference/generative/download_commands` | 2493-2636 (fragment `043bcd2dcc016a6a`) | 3 |
| `inference/generative/import` | 2638-2895 (fragment `a5e4c8add8b2a5e8`) | 10 |
| `inference/generative/run` | 2897-3226 (fragment `df79cb9bf14ea461`) | 10 |
| `inference/native_ai` | 3228-3257, 3259-3321, 4591-4655 (fragment `156a4d78471841e1`) | 4 |
| `upscale` | 3323-3492, 3699-3831, 6585-6733 (fragment `f86d508390aef5f8`) | 15 |
| `upscale/ops` | 3494-3697 (fragment `3e9976f0e5b3d07f`) | 2 |
| `trace` | 3833-3987, 4055-4186, 6734-6870 (fragment `96b67bd7fec4c318`) | 15 |
| `media` | 3989-4053 (fragment `af3fdf3dd9bcd092`) | 3 |
| `printing` | 4188-4449, 5264-5355, 6139-6374, 7068-7080 (fragment `7fb3a183d4506fd8`) | 18 |
| `app` | 4698-4775, 5040-5082, 5361-5376 (fragment `7b1484c4b3f57b79`) | 0 |
| `inference/generative` | 5438-5558, 5634-5762 (fragment `4f15843cef44c82f`) | 0 |
| `test_support` | 5853-5901, 6375-6393, 7044-7055, 7081-7091 (fragment `5e4d53e8cb38415f`) | 0 |
| `app/legacy_data` | 7092-7274, 7277-7376 (fragment `b1c0f70be1d0e78b`) | 6 |

### lib.rs

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 4502-4508 | fn | `uuid` | pub |  | `pub(crate) fn uuid() -> String {` |
| 4657-5258 | fn | `run` | pub |  | `pub fn run() {` |
| 5260-5262 | fn | `appimage_dmabuf_default` | private |  | `fn appimage_dmabuf_default(is_appimage: bool, has_user_overr` |

Non-declaration blocks moved with `lib.rs`: 1 `mod item`; 2 `mod item`; 3 `mod item`; 4 `mod item`; 5 `mod item`; 6 `mod item`; 7 `mod item`; 8 `mod item`; 9 `mod item`; 10 `mod item`; 11 `mod item`; 12 `mod item`; 13 `mod item`; 14 `mod item`; 15 `mod item`; 16 `mod item`; 17 `mod item`; 18-19 `mod item`; 20 `mod item`; 21 `mod item`; 22 `mod item`; 23 `mod item`; 24 `mod item`; 26 `use item`; 27 `use item`; 28 `use item`; 29 `use item`; 30 `use item`; 31 `use item`; 32 `use item`; 33 `use item`; 34 `use item`; 35 `use item`; 36 `use item`; 37 `use item`; 38 `use item`; 39 `use item`; 40 `use item`; 41 `use item`; 43 `use item`; 45 `use item`.

### stubs

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 47-54 | const | `MAX_SCENE_NODES` | private |  | `const MAX_SCENE_NODES: usize = 50_000;` |
| 56-64 | fn | `check_scene_node_bounds` | private |  | `fn check_scene_node_bounds(nodes: &[IpcSceneNode]) -> Result` |
| 92-94 | fn | `convert_scene` | private |  | `fn convert_scene(nodes: Vec<IpcSceneNode>) -> Vec<varve_core` |
| 96-101 | fn | `build_render_ir` | private | yes | `fn build_render_ir(nodes: Vec<IpcSceneNode>) -> Result<Vec<v` |
| 103-108 | fn | `hit_test` | private | yes | `fn hit_test(nodes: Vec<IpcSceneNode>, x: f64, y: f64) -> Res` |
| 110-116 | struct | `SceneIr` | pub |  | `pub struct SceneIr {` |
| 118-127 | fn | `render_frame_ir` | private | yes | `fn render_frame_ir(width: u32, height: u32, frame: u32) -> S` |
| 129-136 | const | `MAX_RENDER_FRAME_PIXELS` | private |  | `const MAX_RENDER_FRAME_PIXELS: u64 = 64 * 1024 * 1024;` |
| 138-148 | fn | `render_frame_pixels` | private | yes | `fn render_frame_pixels(width: u32, height: u32, frame: u32) ` |
| 150-157 | struct | `Report` | private |  | `struct Report {` |
| 159-163 | fn | `report` | private | yes | `fn report(report: Report) {` |
| 165-169 | fn | `done` | private | yes | `fn done(app: tauri::AppHandle) {` |
| 866-876 | fn | `sync_save` | private | yes | `fn sync_save(` |
| 878-884 | fn | `sync_load` | private | yes | `fn sync_load(` |
| 4512-4518 | struct | `AiResponse` | private |  | `struct AiResponse {` |
| 4520-4529 | fn | `ai_chat` | private | yes | `fn ai_chat(_session_id: String, message: String) -> Result<A` |
| 4533-4538 | struct | `CollabUser` | private |  | `struct CollabUser {` |
| 4540-4544 | fn | `get_collab_users` | private | yes | `fn get_collab_users(document_id: String) -> Result<Vec<Colla` |
| 4546-4550 | fn | `update_cursor` | private | yes | `fn update_cursor(document_id: String, x: f64, y: f64) -> Res` |
| 4554-4560 | struct | `PluginInfo` | private |  | `struct PluginInfo {` |
| 4562-4565 | fn | `list_plugins` | private | yes | `fn list_plugins() -> Result<Vec<PluginInfo>, String> {` |
| 4567-4589 | fn | `close_splashscreen` | private | yes | `fn close_splashscreen(app: tauri::AppHandle) {` |

Non-declaration blocks moved with `stubs`: 864 `// ── Legacy Sync ────────────────────────────────────────────────────`; 4510 `// ── AI chat stub ──────────────────────────────────────────────`; 4531 `// ── Collab stub commands ──────────────────────────────────────`; 4552 `// ── Plugin sandbox stub commands ──────────────────────────────`.

### models

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 66-90 | fn | `sha256_file` | private |  | `fn sha256_file(path: &std::path::Path) -> Result<(u64, Strin` |
| 1018-1024 | fn | `valid_download_request_id` | private |  | `fn valid_download_request_id(request_id: &str) -> bool {` |
| 1185-1186 | static | `INFERENCE_MODEL_DOWNLOADS` | private |  | `static INFERENCE_MODEL_DOWNLOADS: LazyLock<native_jobs::Nati` |
| 1188-1195 | struct | `InferenceModelProgress` | private |  | `struct InferenceModelProgress {` |
| 1197-1210 | fn | `validate_inference_model_id` | private |  | `fn validate_inference_model_id(model_id: &str) -> Result<(),` |
| 1212-1221 | fn | `validate_inference_sha256` | private |  | `fn validate_inference_sha256(sha256: &str) -> Result<(), Str` |
| 1223-1235 | fn | `inference_model_path` | private | yes | `async fn inference_model_path(` |
| 1237-1243 | fn | `inference_model_path_at` | private |  | `fn inference_model_path_at(` |
| 1245-1254 | fn | `inference_model_external_data` | private | yes | `async fn inference_model_external_data(` |
| 1256-1259 | fn | `delete_inference_model` | private | yes | `fn delete_inference_model(model_id: String) -> Result<bool, ` |
| 1261-1264 | fn | `cancel_inference_model_download` | private | yes | `fn cancel_inference_model_download(request_id: String) -> Re` |
| 1266-1296 | fn | `download_inference_model` | private | yes | `async fn download_inference_model(` |
| 4451-4457 | fn | `model_dir` | private |  | `fn model_dir(app: &tauri::AppHandle) -> Result<std::path::Pa` |
| 4459-4464 | fn | `read_model_file` | private | yes | `fn read_model_file(app: tauri::AppHandle, model_id: String) ` |
| 4466-4471 | fn | `write_model_file` | private | yes | `fn write_model_file(app: tauri::AppHandle, model_id: String,` |
| 4473-4483 | fn | `delete_model_file` | private | yes | `fn delete_model_file(app: tauri::AppHandle, model_id: String` |
| 4485-4500 | fn | `list_model_files` | private | yes | `fn list_model_files(app: tauri::AppHandle) -> Result<Vec<Str` |

Non-declaration blocks moved with `models`: 1181-1183 `// -------------------------------------------------------------------`.

### files

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 171-178 | fn | `user_home_dir` | private |  | `fn user_home_dir() -> Option<std::path::PathBuf> {` |
| 180-273 | fn | `resolve_user_path` | pub | yes | `pub(crate) fn resolve_user_path(raw: &str) -> Result<std::pa` |
| 275-321 | fn | `write_file_atomic` | pub |  | `pub(crate) fn write_file_atomic(path: &std::path::Path, data` |
| 323-388 | fn | `resolve_user_path_approved` | pub |  | `pub(crate) fn resolve_user_path_approved(raw: &str) -> Resul` |
| 390-394 | fn | `write_binary_file` | private | yes | `fn write_binary_file(path: String, data: Vec<u8>) -> Result<` |
| 396-424 | fn | `write_binary_file_to_folder` | private | yes | `fn write_binary_file_to_folder(` |

### clipboard

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 435 | const | `MAX_NATIVE_CLIPBOARD_ITEMS` | private |  | `const MAX_NATIVE_CLIPBOARD_ITEMS: usize = 16;` |
| 436 | const | `MAX_NATIVE_CLIPBOARD_BYTES` | private |  | `const MAX_NATIVE_CLIPBOARD_BYTES: usize = 64 * 1024 * 1024;` |
| 437 | const | `MAX_NATIVE_IMAGE_DIMENSION` | private |  | `const MAX_NATIVE_IMAGE_DIMENSION: u32 = 32_768;` |
| 438 | const | `MAX_NATIVE_IMAGE_PIXELS` | private |  | `const MAX_NATIVE_IMAGE_PIXELS: u64 = 64 * 1024 * 1024;` |
| 439 | const | `NATIVE_CLIPBOARD_DEADLINE` | private |  | `const NATIVE_CLIPBOARD_DEADLINE: Duration = Duration::from_s` |
| 441-442 | static | `NATIVE_CLIPBOARD_CANCELLATIONS` | private |  | `static NATIVE_CLIPBOARD_CANCELLATIONS: LazyLock<Mutex<HashSe` |
| 444-460 | fn | `validate_bounded_image_dimensions` | private |  | `fn validate_bounded_image_dimensions(width: u32, height: u32` |
| 462-464 | fn | `validate_native_image_dimensions` | private |  | `fn validate_native_image_dimensions(width: u32, height: u32)` |
| 466-472 | fn | `clipboard_operation_id` | private |  | `fn clipboard_operation_id(operation_id: Option<String>) -> R` |
| 474-486 | fn | `clipboard_operation_cancelled` | private |  | `fn clipboard_operation_cancelled(operation_id: &str) -> bool` |
| 500-505 | struct | `NativeClipboardItemInput` | private |  | `struct NativeClipboardItemInput {` |
| 507-512 | struct | `NativeClipboardItemOutput` | private |  | `struct NativeClipboardItemOutput {` |
| 514-530 | fn | `supported_native_clipboard_mime` | private |  | `fn supported_native_clipboard_mime(mime_type: &str) -> bool ` |
| 532-538 | fn | `native_clipboard_cancelled` | private |  | `fn native_clipboard_cancelled(operation_id: &str) -> bool {` |
| 673-676 | fn | `write_wayland_clipboard_data` | private |  | `fn write_wayland_clipboard_data(_items: Vec<NativeClipboardI` |
| 678-711 | fn | `read_clipboard_data` | private | yes | `async fn read_clipboard_data(` |
| 713-752 | fn | `write_clipboard_data` | private | yes | `async fn write_clipboard_data(` |
| 754-764 | fn | `cancel_clipboard_operation` | private | yes | `fn cancel_clipboard_operation(operation_id: String) -> Resul` |
| 776-783 | fn | `read_dropped_file` | private | yes | `fn read_dropped_file(path: String) -> Result<Vec<u8>, String` |
| 785-828 | fn | `read_clipboard_image_png_blocking` | private |  | `fn read_clipboard_image_png_blocking(operation_id: &str) -> ` |
| 830-862 | fn | `read_clipboard_image_png` | private | yes | `async fn read_clipboard_image_png(operation_id: Option<Strin` |

Non-declaration blocks moved with `clipboard`: 426-433 `// ── Native clipboard ───────────────────────────────────────────────`; 766-774 `// ── Native file drag-and-drop ──────────────────────────────────────`.

### app/pinch_linux

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 488-498 | fn | `touchpad_pinch_phase` | private |  | `fn touchpad_pinch_phase(phase: i32) -> (&'static str, bool) ` |

### clipboard/wayland

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 540-609 | fn | `read_wayland_pipe_bounded` | private |  | `fn read_wayland_pipe_bounded(` |
| 611-640 | fn | `read_wayland_clipboard_data` | private |  | `fn read_wayland_clipboard_data(` |
| 642-648 | fn | `read_wayland_clipboard_data` | private |  | `fn read_wayland_clipboard_data(` |
| 650-671 | fn | `write_wayland_clipboard_data` | private |  | `fn write_wayland_clipboard_data(items: Vec<NativeClipboardIt` |

### inference/background/models

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 888-904 | struct | `BgRemoveOptions` | private |  | `struct BgRemoveOptions {` |
| 906-921 | struct | `BgRemoveResult` | private |  | `struct BgRemoveResult {` |
| 923-934 | struct | `BgRemoveBinaryMetadata` | private |  | `struct BgRemoveBinaryMetadata {` |
| 936 | const | `BG_REMOVE_BINARY_MAGIC` | private |  | `const BG_REMOVE_BINARY_MAGIC: &[u8; 4] = b"VBG1";` |
| 938-973 | fn | `encode_bg_remove_binary` | private |  | `fn encode_bg_remove_binary(result: BgRemoveResult) -> Result` |
| 975-982 | struct | `NativeBgModelStatus` | private |  | `struct NativeBgModelStatus {` |
| 984-991 | struct | `HostMemoryStatus` | private |  | `struct HostMemoryStatus {` |
| 993-1007 | fn | `host_memory_status` | private | yes | `fn host_memory_status() -> HostMemoryStatus {` |
| 1009-1016 | struct | `NativeBgModelProgress` | private |  | `struct NativeBgModelProgress {` |
| 1026-1031 | fn | `background_removal_model_info` | private |  | `fn background_removal_model_info(` |
| 1033-1050 | fn | `native_background_model_id` | private |  | `fn native_background_model_id(options: &BgRemoveOptions) -> ` |
| 1052-1058 | fn | `encoded_image_dimensions` | private |  | `fn encoded_image_dimensions(image_data: &[u8]) -> Result<(u3` |
| 1060-1074 | fn | `preflight_native_model` | private |  | `fn preflight_native_model(` |
| 1076-1104 | fn | `native_background_removal_model_status` | private | yes | `async fn native_background_removal_model_status(` |
| 1106-1127 | fn | `preflight_native_background_removal` | private | yes | `fn preflight_native_background_removal(` |
| 1129-1132 | fn | `cancel_background_removal_model_download` | private | yes | `fn cancel_background_removal_model_download(request_id: Stri` |
| 1134-1139 | fn | `delete_background_removal_model` | private | yes | `fn delete_background_removal_model(model_id: String) -> Resu` |
| 1141-1179 | fn | `download_background_removal_model` | private | yes | `async fn download_background_removal_model(` |

Non-declaration blocks moved with `inference/background/models`: 886 `// ── Background Removal ──────────────────────────────────`.

### inference/background

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 1298-1330 | fn | `remove_background` | private | yes | `async fn remove_background(` |
| 1332-1361 | fn | `remove_background_binary` | private | yes | `async fn remove_background_binary(` |
| 1363-1364 | static | `BACKGROUND_REMOVAL_JOBS` | private |  | `static BACKGROUND_REMOVAL_JOBS: LazyLock<native_jobs::Native` |
| 1366-1369 | fn | `cancel_background_removal` | private | yes | `fn cancel_background_removal(request_id: String) -> Result<(` |
| 1371-1412 | fn | `remove_background_command` | private |  | `async fn remove_background_command(` |
| 1414-1424 | fn | `remove_background_impl` | private |  | `fn remove_background_impl(` |
| 1426-1487 | fn | `remove_background_cancellable` | private |  | `fn remove_background_cancellable(` |

### inference/denoise

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 1490-1496 | static | `GENERATIVE_CANCELLATIONS` | private |  | `static GENERATIVE_CANCELLATIONS: LazyLock<Mutex<HashSet<Stri` |
| 1498-1506 | struct | `NativeDenoiseOptions` | pub |  | `pub struct NativeDenoiseOptions {` |
| 1508-1517 | struct | `NativeDenoiseResult` | pub |  | `pub struct NativeDenoiseResult {` |
| 1519-1561 | fn | `denoise_image` | private | yes | `async fn denoise_image(` |

Non-declaration blocks moved with `inference/denoise`: 1489 `// ── Native image denoise (SCUNet) ──────────────────────────────────`.

### inference/content_fill

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 1565-1577 | struct | `ContentAwareFillOptions` | pub |  | `pub struct ContentAwareFillOptions {` |
| 1579-1607 | fn | `validate_content_aware_fill_options` | private |  | `fn validate_content_aware_fill_options(options: &ContentAwar` |
| 1609-1619 | struct | `ContentAwareFillResult` | pub |  | `pub struct ContentAwareFillResult {` |
| 1621-1628 | struct | `LamaCancelState` | private |  | `struct LamaCancelState {` |
| 1630-1633 | struct | `LamaCancelEntry` | private |  | `struct LamaCancelEntry {` |
| 1635-1686 | impl | `impl` | private |  | `impl LamaCancelState {` |
| 1688-1693 | fn | `cancel_content_aware_fill` | private | yes | `fn cancel_content_aware_fill(app: tauri::AppHandle, request_` |
| 1695-1775 | fn | `content_aware_fill` | private | yes | `async fn content_aware_fill(` |

Non-declaration blocks moved with `inference/content_fill`: 1563 `// ── Native content-aware fill (LaMa inpainting) ────────────────────`.

### inference/generative/config

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 1779-1780 | static | `GENERATIVE_CHILDREN` | private |  | `static GENERATIVE_CHILDREN: LazyLock<Mutex<HashMap<String, C` |
| 1781-1782 | static | `GENERATIVE_MODEL_DOWNLOADS` | private |  | `static GENERATIVE_MODEL_DOWNLOADS: LazyLock<Mutex<HashSet<St` |
| 1783-1784 | static | `GENERATIVE_MODEL_DOWNLOAD_CANCELLATIONS` | private |  | `static GENERATIVE_MODEL_DOWNLOAD_CANCELLATIONS: LazyLock<Mut` |
| 1786-1811 | struct | `GenerativeEditOptions` | pub |  | `pub struct GenerativeEditOptions {` |
| 1813 | const | `MAX_GENERATIVE_OUTPUT_DIMENSION` | private |  | `const MAX_GENERATIVE_OUTPUT_DIMENSION: u32 = 2_048;` |
| 1814 | const | `MAX_GENERATIVE_STEPS` | private |  | `const MAX_GENERATIVE_STEPS: u32 = 100;` |
| 1815 | const | `MAX_GENERATIVE_PROMPT_CHARS` | private |  | `const MAX_GENERATIVE_PROMPT_CHARS: usize = 16_384;` |
| 1817-1819 | fn | `default_image_guidance_scale` | private |  | `fn default_image_guidance_scale() -> f32 {` |
| 1821-1823 | fn | `default_generative_mask_input` | private |  | `fn default_generative_mask_input() -> String {` |
| 1825-1827 | fn | `default_generative_mask_convention` | private |  | `fn default_generative_mask_convention() -> String {` |
| 1829-1849 | fn | `validate_generation_buffer` | private |  | `fn validate_generation_buffer(` |
| 1851-1928 | fn | `validate_generative_edit_options` | private |  | `fn validate_generative_edit_options(options: &GenerativeEdit` |
| 1930 | const | `GENERATIVE_MODEL_STEM` | private |  | `const GENERATIVE_MODEL_STEM: &str = "varve-diffusion-inpaint` |
| 1931 | const | `GENERATIVE_MODEL_HANDLE` | private |  | `const GENERATIVE_MODEL_HANDLE: &str = "varve-diffusion-inpai` |
| 1932 | const | `GENERATIVE_MODEL_PROFILE` | private |  | `const GENERATIVE_MODEL_PROFILE: &str = "sd15-inpainting-q4_0` |
| 1933 | const | `GENERATIVE_MODEL_CUSTOM_PROFILE` | private |  | `const GENERATIVE_MODEL_CUSTOM_PROFILE: &str = "custom-safe-i` |
| 1934 | const | `GENERATIVE_MODEL_METADATA_SUFFIX` | private |  | `const GENERATIVE_MODEL_METADATA_SUFFIX: &str = ".metadata.js` |
| 1940 | const | `GENERATIVE_MODEL_METADATA_SCHEMA_VERSION` | private |  | `const GENERATIVE_MODEL_METADATA_SCHEMA_VERSION: u32 = 4;` |
| 1944 | const | `GENERATIVE_MODEL_RUNTIME_ID` | private |  | `const GENERATIVE_MODEL_RUNTIME_ID: &str = "diffusion-rs-0.1.` |
| 1945 | const | `GENERATIVE_MODEL_FILENAME` | private |  | `const GENERATIVE_MODEL_FILENAME: &str = "varve-diffusion-inp` |
| 1946 | const | `GENERATIVE_MODEL_DOWNLOAD_URL` | private |  | `const GENERATIVE_MODEL_DOWNLOAD_URL: &str = "https://hugging` |
| 1947 | const | `GENERATIVE_MODEL_DOWNLOAD_SIZE` | private |  | `const GENERATIVE_MODEL_DOWNLOAD_SIZE: u64 = 1_747_219_584;` |
| 1948-1949 | const | `GENERATIVE_MODEL_DOWNLOAD_SHA256` | private |  | `const GENERATIVE_MODEL_DOWNLOAD_SHA256: &str =` |
| 1955 | const | `GENERATIVE_MODEL_DOWNLOAD_AVAILABLE` | private |  | `const GENERATIVE_MODEL_DOWNLOAD_AVAILABLE: bool = false;` |
| 1960 | const | `GENERATIVE_MODEL_IMPORT_AVAILABLE` | private |  | `const GENERATIVE_MODEL_IMPORT_AVAILABLE: bool = false;` |
| 1961 | const | `GENERATIVE_MODEL_INCOMPATIBLE_REASON` | private |  | `const GENERATIVE_MODEL_INCOMPATIBLE_REASON: &str = "This pac` |
| 1962 | const | `GENERATIVE_MODEL_IMPORT_UNAVAILABLE_REASON` | private |  | `const GENERATIVE_MODEL_IMPORT_UNAVAILABLE_REASON: &str = "Lo` |
| 1963 | const | `GENERATIVE_MODEL_UNAVAILABLE_REASON` | private |  | `const GENERATIVE_MODEL_UNAVAILABLE_REASON: &str = "No qualit` |

Non-declaration blocks moved with `inference/generative/config`: 1777 `// ── Isolated prompt-capable generative editing ─────────────────────`; 1935-1939 `// The inexpensive masked fixture below is a compatibility/preflight p`; 1941-1943 `// This identifier includes Varve's safe image-guidance extension. Cha`; 1950-1954 `// The pinned artifact above is an experimental GGUF published for a p`; 1956-1959 `// The helper currently has one hard-coded SD 1.5 inpainting adapter. `.

### inference/generative/model_status

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 1970 | const | `GENERATIVE_MODEL_QUALITY_CERTIFIED_CHECKSUMS` | private |  | `const GENERATIVE_MODEL_QUALITY_CERTIFIED_CHECKSUMS: &[&str] ` |
| 1972-1978 | struct | `GenerativeModelDownloadProgress` | private |  | `struct GenerativeModelDownloadProgress {` |
| 1980-1996 | struct | `GenerativeModelMetadata` | private |  | `struct GenerativeModelMetadata {` |
| 1998-2018 | struct | `GenerativeModelStatus` | private |  | `struct GenerativeModelStatus {` |
| 2020-2022 | fn | `generative_model_artifact_is_known_incompatible` | private |  | `fn generative_model_artifact_is_known_incompatible(checksum_` |
| 2024-2027 | fn | `generative_model_profile_is_supported` | private |  | `fn generative_model_profile_is_supported(profile_id: &str) -` |
| 2029-2035 | fn | `ensure_generative_model_import_supported` | private |  | `fn ensure_generative_model_import_supported() -> Result<(), ` |
| 2037-2049 | fn | `generative_model_record_is_ready` | private |  | `fn generative_model_record_is_ready(` |
| 2051-2066 | fn | `generative_model_record_matches_runtime` | private |  | `fn generative_model_record_matches_runtime(` |
| 2068-2078 | fn | `generative_model_is_ready` | private |  | `fn generative_model_is_ready(` |
| 2080-2088 | fn | `managed_generative_model_paths` | private |  | `fn managed_generative_model_paths(` |
| 2090-2096 | fn | `generative_model_metadata_path` | private |  | `fn generative_model_metadata_path(model_path: &std::path::Pa` |
| 2098-2101 | fn | `read_generative_model_metadata` | private |  | `fn read_generative_model_metadata(model_path: &std::path::Pa` |
| 2103-2108 | fn | `unix_timestamp_seconds` | private |  | `fn unix_timestamp_seconds() -> u64 {` |
| 2110-2237 | fn | `model_status_blocking` | private |  | `fn model_status_blocking(app: &tauri::AppHandle) -> Result<G` |
| 2239-2246 | fn | `generative_edit_model_status` | private | yes | `async fn generative_edit_model_status(` |

Non-declaration blocks moved with `inference/generative/model_status`: 1965-1969 `// A model may only become usable after the frozen real-photograph cor`.

### inference/generative/download

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 2248-2253 | fn | `generative_model_download_cancelled` | private |  | `fn generative_model_download_cancelled(request_id: &str) -> ` |
| 2255-2294 | fn | `available_disk_space` | private |  | `fn available_disk_space(path: &std::path::Path) -> Option<u6` |
| 2296-2321 | fn | `await_generative_download_or_cancel` | private |  | `async fn await_generative_download_or_cancel<T, Operation>(` |
| 2323-2348 | fn | `start_generative_download_cancellation_watcher` | private |  | `fn start_generative_download_cancellation_watcher(` |
| 2350-2369 | fn | `download_generative_model_attempt` | private |  | `async fn download_generative_model_attempt(` |
| 2371-2491 | fn | `download_generative_model_attempt_inner` | private |  | `async fn download_generative_model_attempt_inner(` |

### inference/generative/download_commands

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 2493-2514 | fn | `begin_generative_model_download` | private |  | `fn begin_generative_model_download(request_id: &str) -> Resu` |
| 2516-2624 | fn | `download_generative_edit_model` | private | yes | `async fn download_generative_edit_model(` |
| 2626-2636 | fn | `cancel_generative_edit_model_download` | private | yes | `fn cancel_generative_edit_model_download(request_id: String)` |

### inference/generative/import

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 2638-2693 | fn | `import_generative_edit_model` | private | yes | `fn import_generative_edit_model(` |
| 2695-2737 | fn | `qualification_request` | private |  | `fn qualification_request(model_handle: &str, request_id: Str` |
| 2739-2770 | fn | `resolve_generative_model_for_run` | private |  | `fn resolve_generative_model_for_run(` |
| 2772-2777 | fn | `generation_cancel_requested` | private |  | `fn generation_cancel_requested(request_id: &str) -> bool {` |
| 2779-2783 | fn | `clear_generation_cancellation` | private |  | `fn clear_generation_cancellation(request_id: &str) {` |
| 2785-2790 | fn | `take_generation_cancellation` | private |  | `fn take_generation_cancellation(request_id: &str) -> bool {` |
| 2792-2798 | struct | `GenerationCancellationGuard` | private |  | `struct GenerationCancellationGuard {` |
| 2800-2804 | impl | `impl` | private |  | `impl Drop for GenerationCancellationGuard {` |
| 2806-2835 | fn | `write_generative_model_metadata` | private |  | `fn write_generative_model_metadata(` |
| 2837-2895 | fn | `qualify_generative_edit_model` | private | yes | `async fn qualify_generative_edit_model(` |

### inference/generative/run

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 2897-2905 | struct | `GenerativeEditResult` | pub |  | `pub struct GenerativeEditResult {` |
| 2907-2929 | struct | `GenerativeHelperRequest` | private |  | `struct GenerativeHelperRequest {` |
| 2931-2937 | struct | `GenerativeHelperResponse` | private |  | `struct GenerativeHelperResponse {` |
| 2939-2945 | fn | `valid_generation_request_id` | private |  | `fn valid_generation_request_id(request_id: &str) -> bool {` |
| 2947-2978 | fn | `resolve_generative_helper` | private |  | `fn resolve_generative_helper(app: &tauri::AppHandle) -> Resu` |
| 2980-3012 | fn | `write_generation_inputs` | private |  | `fn write_generation_inputs(` |
| 3014-3019 | fn | `generative_edit_blocking` | private |  | `fn generative_edit_blocking(` |
| 3021-3190 | fn | `generative_edit_blocking_with_requirement` | private |  | `fn generative_edit_blocking_with_requirement(` |
| 3192-3200 | fn | `generative_edit` | private | yes | `async fn generative_edit(` |
| 3202-3226 | fn | `cancel_generative_edit` | private | yes | `fn cancel_generative_edit(request_id: String) -> Result<(), ` |

### inference/native_ai

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 3228-3257 | fn | `native_ai_status` | private | yes | `async fn native_ai_status(_app: tauri::AppHandle) -> bool {` |
| 3259-3321 | fn | `ensure_native_ai` | private |  | `fn ensure_native_ai(app: &tauri::AppHandle) -> bool {` |
| 4591-4627 | fn | `resolve_onnxruntime_dylib` | private |  | `fn resolve_onnxruntime_dylib(app: &tauri::AppHandle) -> Opti` |
| 4629-4655 | fn | `resolve_onnxruntime_plugin` | private |  | `fn resolve_onnxruntime_plugin(app: &tauri::AppHandle) -> Opt` |

### upscale

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 3323-3329 | struct | `UpscaleCancelState` | private |  | `struct UpscaleCancelState {` |
| 3331-3334 | struct | `CancelEntry` | private |  | `struct CancelEntry {` |
| 3336-3391 | impl | `impl` | private |  | `impl UpscaleCancelState {` |
| 3393-3399 | fn | `begin_upscale_job` | private | yes | `fn begin_upscale_job(app: tauri::AppHandle, job_id: u64) {` |
| 3401-3407 | fn | `cancel_upscale` | private | yes | `fn cancel_upscale(app: tauri::AppHandle, job_id: u64) {` |
| 3409 | const | `MAX_UPSCALE_INPUT_BYTES` | private |  | `const MAX_UPSCALE_INPUT_BYTES: usize = 128 * 1024 * 1024;` |
| 3410 | const | `MAX_UPSCALE_OUTPUT_PIXELS` | private |  | `const MAX_UPSCALE_OUTPUT_PIXELS: u64 = 64 * 1024 * 1024;` |
| 3415 | const | `MIN_GPU_RESAMPLE_PIXELS` | private |  | `const MIN_GPU_RESAMPLE_PIXELS: u64 = 1_000_000;` |
| 3417-3426 | fn | `should_try_gpu_resample` | private |  | `fn should_try_gpu_resample(` |
| 3428-3444 | struct | `UpscaleImageOptions` | private |  | `struct UpscaleImageOptions {` |
| 3446-3453 | struct | `UpscaleImageResult` | private |  | `struct UpscaleImageResult {` |
| 3455-3457 | fn | `default_upscale_method` | private |  | `fn default_upscale_method() -> String {` |
| 3459-3466 | fn | `upscale_image` | private | yes | `async fn upscale_image(` |
| 3468-3492 | fn | `upscale_image_binary` | private | yes | `async fn upscale_image_binary(` |
| 3699-3831 | fn | `upscale_image_impl` | private |  | `fn upscale_image_impl(` |

Non-declaration blocks moved with `upscale`: 3411-3414 `// The native GPU route includes a source upload, destination storage `.

### upscale/ops

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 3494-3632 | fn | `upscale_image_command` | private |  | `async fn upscale_image_command(` |
| 3634-3697 | fn | `apply_live_effect_binary` | private | yes | `async fn apply_live_effect_binary(` |

### trace

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 3835 | const | `MAX_TRACE_INPUT_BYTES` | private |  | `const MAX_TRACE_INPUT_BYTES: usize = 128 * 1024 * 1024;` |
| 3836 | const | `MAX_TRACE_PIXELS` | private |  | `const MAX_TRACE_PIXELS: u64 = 64 * 1024 * 1024;` |
| 3837-3839 | const | `MAX_TRACE_PATHS` | private |  | `const MAX_TRACE_PATHS: usize = 100_000;` |
| 3841-3842 | type | `TraceProgressSink` | private |  | `type TraceProgressSink = Box<dyn Fn(&str, f64) + Sync>;` |
| 3844-3850 | struct | `TraceCancelState` | private |  | `struct TraceCancelState {` |
| 3852-3892 | impl | `impl` | private |  | `impl TraceCancelState {` |
| 3894-3900 | fn | `begin_trace_job` | private | yes | `fn begin_trace_job(app: tauri::AppHandle, job_id: u64) {` |
| 3902-3908 | fn | `cancel_trace` | private | yes | `fn cancel_trace(app: tauri::AppHandle, job_id: u64) {` |
| 3910-3929 | struct | `TraceImageOptions` | private |  | `struct TraceImageOptions {` |
| 3931-3933 | fn | `default_corner_angle` | private |  | `fn default_corner_angle() -> f64 {` |
| 3934-3936 | fn | `default_max_error` | private |  | `fn default_max_error() -> f64 {` |
| 3938-3987 | fn | `sanitize_trace_options` | private |  | `fn sanitize_trace_options(raw: TraceImageOptions) -> varve_t` |
| 4055-4062 | fn | `trace_image` | private | yes | `async fn trace_image(` |
| 4064-4089 | fn | `trace_image_binary` | private | yes | `async fn trace_image_binary(` |
| 4091-4186 | fn | `trace_image_command` | private |  | `async fn trace_image_command(` |

Non-declaration blocks moved with `trace`: 3833 `// ── Image trace (native raster-to-vector) ──────────────`.

### media

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 3991-4008 | fn | `media_probe_binary` | private | yes | `async fn media_probe_binary(request: tauri::ipc::Request<'_>` |
| 4010-4046 | fn | `media_decode_frames_binary` | private | yes | `async fn media_decode_frames_binary(` |
| 4048-4053 | struct | `MediaDecodeOptions` | private |  | `struct MediaDecodeOptions {` |

Non-declaration blocks moved with `media`: 3989 `// ── Animated media decode ──────────────────────────────────────────`.

### printing

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 4190-4202 | struct | `ExportPdfOptions` | private |  | `struct ExportPdfOptions {` |
| 4204-4217 | impl | `impl` | private |  | `impl Default for ExportPdfOptions {` |
| 4219-4241 | fn | `export_node_pdf` | private | yes | `fn export_node_pdf(` |
| 4245-4266 | struct | `PdfXOptions` | private |  | `struct PdfXOptions {` |
| 4268-4288 | impl | `impl` | private |  | `impl Default for PdfXOptions {` |
| 4290-4346 | impl | `impl` | private |  | `impl PdfXOptions {` |
| 4348-4353 | fn | `parse_nodes_from_json` | private |  | `fn parse_nodes_from_json(nodes_json: &str) -> Result<Vec<var` |
| 4355-4373 | fn | `export_pdfx1a` | private | yes | `fn export_pdfx1a(` |
| 4375-4393 | fn | `export_pdfx4` | private | yes | `fn export_pdfx4(` |
| 4395-4415 | fn | `outline_text` | private | yes | `fn outline_text(` |
| 4417-4426 | fn | `shape_text_command` | private | yes | `fn shape_text_command(` |
| 4428-4449 | fn | `export_pdf_with_options` | private | yes | `fn export_pdf_with_options(` |
| 5266-5274 | struct | `PrinterInfo` | private |  | `struct PrinterInfo {` |
| 5276-5283 | struct | `PrintOptions` | private |  | `struct PrintOptions {` |
| 5285-5290 | struct | `PrintResult` | private |  | `struct PrintResult {` |
| 5292-5305 | fn | `list_printers` | private | yes | `fn list_printers() -> Vec<PrinterInfo> {` |
| 5307-5348 | fn | `print_pdf` | private | yes | `fn print_pdf(` |
| 5350-5353 | fn | `cancel_print_job` | private | yes | `fn cancel_print_job(printer_name: String, job_id: u32) -> Re` |

Non-declaration blocks moved with `printing`: 4188 `// ── PDF export ─────────────────────────────────────────`; 4243 `// ── PDF/X and text outlining commands ────────────────────`; 5264 `// ── Native Print ───────────────────────────────────────────────────`; 5355 `// ── End Native Print ───────────────────────────────────────────────`.

### app/legacy_data

| base lines | kind | declaration | export | command | first line |
|---|---|---|---|---|---|
| 7277-7278 | const | `LEGACY_APP_DIR` | private |  | `const LEGACY_APP_DIR: &str = "dev.strata.desktop";` |
| 7280-7293 | enum | `LegacyMigration` | private |  | `enum LegacyMigration {` |
| 7295-7300 | fn | `migrate_legacy_data_dir` | private |  | `fn migrate_legacy_data_dir(data_dir: &std::path::Path) -> Le` |
| 7302-7344 | fn | `migrate_legacy_data_dir_from` | private |  | `fn migrate_legacy_data_dir_from(` |
| 7346-7361 | fn | `legacy_data_base` | private |  | `fn legacy_data_base() -> Option<std::path::PathBuf> {` |
| 7363-7376 | fn | `copy_dir_all` | private |  | `fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path` |

# Tests

| test destination | base lines | tests | helpers |
|---|---|---|---|
| `app` | 5361-5366, 5368-5375 | 2 |  |
| `app/legacy_data` | 7099-7107, 7109-7115, 7117-7135, 7137-7152, 7154-7171, 7173-7186, 7188-7199, 7201-7234, 7236-7257, 7259-7274 | 8 | `migration_fixture`, `seed_legacy_dir` |
| `clipboard` | 5763-5769, 5795-5810, 5812-5834, 5836-5850 | 4 |  |
| `files` | 6873-6876, 6878-6903, 6905-6908, 6910-6925, 6927-6941, 6943-6957, 6959-6972, 6974-6984, 6986-7000, 7002-7023 | 10 |  |
| `inference/background` | 5559-5574, 5576-5619, 5621-5632, 5789-5793, 6394-6410, 6412-6434, 6436-6452, 6454-6475, 6477-6506, 6537-6552, 6554-6565, 6567-6583 | 12 |  |
| `inference/content_fill` | 5414-5436, 5771-5787 | 2 |  |
| `inference/denoise` | 6508-6518, 6520-6535 | 2 |  |
| `inference/generative` | 5438-5445, 5447-5475, 5477-5503, 5505-5520, 5522-5538, 5540-5557, 5634-5704, 5706-5746, 5748-5761 | 9 |  |
| `models` | 5377-5386, 5388-5398, 5400-5412 | 3 |  |
| `printing` | 6141-6143, 6145-6170, 6172-6189, 6191-6223, 6225-6250, 6252-6265, 6267-6272, 6274-6286, 6288-6308, 6310-6330, 6332-6351, 6353-6357, 6359-6363, 6365-6373, 7068-7072, 7074-7079 | 15 | `test_font_data` |
| `stubs` | 5902-6015, 6017-6059, 6061-6085, 6087-6137, 7027-7037, 7039-7042, 7056-7060, 7062-7066 | 8 |  |
| `test_support` | 5853-5900, 6375-6392, 7044-7054, 7081-7090 | 0 | `ts_wire_json`, `make_test_png`, `oversized_node_list`, `oversized_node_list_json` |
| `test_support (import line)` | 5359-5359, 5851-5851 | 0 | `use super::*;`, `use varve_core::EngineColor;` |
| `trace` | 6734-6781, 6783-6801, 6803-6840, 6842-6849, 6851-6869 | 5 |  |
| `upscale` | 6585-6630, 6632-6637, 6639-6651, 6653-6664, 6666-6688, 6690-6711, 6713-6732 | 7 |  |

# Base file

lib.rs sha256: `4b47bac82fa05bbab93d8211961c1b816af207fba6c9153ca0336a9bf13213c0`

## Planned edit classes (pure code motion)

1. **Module declarations** (`lib.rs` header): add
   `mod app; mod clipboard; mod files; mod inference; mod media; mod models;
   mod printing; mod stubs; mod trace; mod upscale;` and
   `#[cfg(test)] mod test_support;`. No existing `mod` line is removed or
   renamed.
2. **Visibility additions** (`pub(crate)` only): every moved command fn, every
   wire struct/type/const/static that a `pub(crate)` signature exposes or that
   another destination file references. No name changes, no new `pub` item.
   The full per-declaration list is produced by the extraction script and
   recorded in the closeout section below.
3. **Import redistribution**: the 18 crate-root `use` lines are re-emitted in
   the destination files that reference the imported names; `lib.rs` keeps only
   the crate-root re-exports. No import changes a resolved symbol.
4. **Registration paths**: the 70 moved command lines in
   `generate_handler!` gain their module path prefix (e.g.
   `build_render_ir` -> `stubs::build_render_ir`,
   `remove_background` -> `inference::background::remove_background`). The
   existing 84 entries (home_store and the already-extracted modules) are
   untouched.
5. **App-builder setup extraction**: `run()` keeps the env block + plugin
   chain; `.setup(|app| { ... })` becomes `.setup(app::setup)`; the closure
   body (base 4,698-5,082) is dedented by 8 columns into
   `app::setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>>`
   with the same statement order; the pure-Linux pinch block (base
   4,778-5,038 plus its explanatory comments 4,760-4,775 kept at the call
   site) becomes `app::pinch_linux::attach_pinch_zoom(app)`; the existing
   `#[cfg(target_os = "linux")]` guards stay verbatim.
6. **Test distribution**: the single `#[cfg(test)] mod tests` wrapper
   (base 5,357-5,359 and 7,275) is removed and each test/helper block is
   dedented by 4 columns into per-domain `#[cfg(test)] mod tests;` child
   files. Each test keeps its name, body, doc comments and every
   `#[cfg(...)]`/`#[test]` attribute.
7. **Boundary blank lines**: 37 base blank lines that separate top-level
   blocks are dropped (A-07/A-09 precedent); no comment or code line is
   dropped.
8. **`crate::` re-exports** in `lib.rs`: `uuid` stays defined at the crate
   root (existing modules reference `crate::uuid`); the model helpers
   (`sha256_file`, `valid_download_request_id`,
   `inference_model_path_at`, `validate_inference_model_id`,
   `validate_inference_sha256`) and `ensure_native_ai` stay reachable as
   `crate::<name>` through `pub(crate) use`; the file helpers
   (`resolve_user_path`, `resolve_user_path_approved`, `write_file_atomic`)
   are re-exported for `home_store/library.rs`. Existing modules are not
   edited.

## Edge-case answers (from GAP_ANALYSIS)

- Startup order is preserved statement-for-statement in `app::setup`
  (directories -> migration -> logs -> crash -> store -> managed state ->
  presenter/pinch -> menu -> watcher) and `pinch_linux::attach_pinch_zoom`
  runs at the same point. No side-effecting statement is hoisted.
- The GTK/WebKitGTK imports, `#[cfg(target_os = "linux")]` blocks, and the
  non-Linux clipboard/wayland stubs move verbatim with their declarations.
- Each payload struct keeps its fields, derives and
  `#[serde(rename_all = "camelCase")]` attributes byte-for-byte; only the
  `pub(crate)` visibility token can change.
- Test source count stays 87; compiled count stays 86 (one default-feature
  gated test); `#[cfg(unix)]` tests stay unix-gated.
- `generate_handler!` keeps its shape: one entry per command, same names, same
  order; nested module paths are accepted by the audit's last-segment parser.
- `lib.rs` ends under 400 lines; every destination ends under 400 lines; no
  frozen file grows.

## Proof plan

1. **Partition**: pre-written extraction script classifies every base line
   1-7,376 exactly once (destination / kept / dedented wrapper / dropped
   blank); the plan validator reports 0 unassigned and 0 overlaps.
2. **Byte identity**: for every moved destination, the sequence of source lines
   assigned to it (in base order, wrapper lines removed, dedented only where
   declared) must reproduce the destination body exactly; fragment SHA-256 is
   compared against `git show master:apps/desktop/src-tauri/src/lib.rs`.
   Visibility tokens and generated imports/module headers are the only
   allowlisted edits, and each is enumerated.
3. **Compile + tests**: `cargo test -p varve-desktop --lib` must reproduce the
   baseline full-suite result (161 collected: 156 passed, 1 pre-existing
   failure, 4 ignored) and the lib block (86 compiled / 85 passed / 1 failed
   from 87 source `#[test]` fns).
4. **Registration**: `pnpm audit:ipc` exit 0 with 154 commands and the same 48
   known gaps; `node --test scripts/quality/audit-ipc-contract.test.mjs`
   10/10.
5. **Static**: direct recursive tsc program (queued `check:agent` substitute)
   exits 0 with the same packages-checked count; `cargo fmt` sanity on the
   touched crate (formatting-only check, no semantic rewrite).
6. **Ratchet**: `node scripts/quality/audit-file-size.mjs --update` removes
   exactly `apps/desktop/src-tauri/src/lib.rs` (955 -> 954), 0 added,
   0 grown; `pnpm audit:filesize` exit 0; `--staged` in
   `pnpm verify:commit`.
7. **Staged checkpoint**: stage seam + baseline + map + ledger + these docs;
   `pnpm agent:map` from the staged tree; `pnpm verify:commit` exit 0; one
   commit, no trailers.

## STOP conditions

- Any base line unclassified, duplicated or missing from the partition.
- Any destination over 400 lines, or `lib.rs` at/over 400 lines.
- A test or its `#[cfg]` attribute lost; compiled test count below 86; the
  full-suite result worse than the recorded baseline.
- `pnpm audit:ipc` red (unregistered command, missing command, stale gap) or
  the contract spec below 10/10.
- Baseline `--update` adds/grows an entry, keeps `lib.rs`, or any other
  baseline entry changes.
- Directory >400 due to an unforeseen sub-split; stop and report rather than
  force the baseline.

## Closeout measurements (appended after implementation, before commit)

Measured 2026-10-28 in `apps/desktop/src-tauri` on
`seam/B/B-01-librs-commands`.

### Partition and byte identity

- Base file: 7,376 lines, SHA-256
  `4b47bac82fa05bbab93d8211961c1b816af207fba6c9153ca0336a9bf13213c0`.
- Every base line 1-7,376 is classified exactly once (independent coverage
  script re-reads `git show master:...`): 272 kept in `lib.rs`, 37 boundary
  blank lines dropped, 7 wrapper lines removed (the single
  `#[cfg(test)] mod tests` wrapper and setup-closure wrapper edits), 3
  pinch-brace/marker lines replaced by the extracted function wrapper, and
  **6,573 non-blank content lines moved** into the destinations (the remaining
  base lines are blank separators inside moved ranges; 0 base code lines
  unclassified, 0 overlaps).
- Exact-line identity proof (pre-format tree): 26 destinations / 38 files;
  all 6,573 moved lines appear byte-for-byte after the declared wrapper edits
  (tests dedent 4 columns, setup/pinch dedent 8 columns, visibility token
  insertions, module wrappers). **0 missing lines, 0 problems.**
- `rustfmt` then normalized 25 moved lines whose line wrapping changed in the
  dedented destination context (multi-line signatures and string-continuation
  call wrapping; identifiers and string contents unchanged); `rustfmt --check`
  is clean on every changed file.
- Per-destination base-fragment SHA-256 hashes are in the inventory tables
  above; tests are distributed across 13 `tests.rs` child modules carrying the
  87 source `#[test]` fns and 7 helper fns.

### Sizes (after extraction; all at or under the 400-line cap)

| file | lines | file | lines |
|---|---|---|---|
| `lib.rs` | 272 | `printing.rs` | 366 |
| `inference/generative/run.rs` | 350 | `upscale.rs` | 319 |
| `clipboard.rs` | 315 | `inference/generative/model_status.rs` | 307 |
| `trace.rs` | 301 | `inference/background/models.rs` | 301 |
| `inference/generative/import.rs` | 294 | `inference/generative/tests.rs` | 284 |
| `app/pinch_linux.rs` | 279 | `stubs/tests.rs` | 275 |
| `files.rs` | 263 | `inference/generative/download.rs` | 258 |
| `printing/tests.rs` | 255 | `inference/background/tests.rs` | 254 |
| `inference/content_fill.rs` | 224 | `upscale/ops.rs` | 221 |
| `models.rs` | 218 | `stubs.rs` | 216 |
| `inference/background.rs` | 210 | `inference/generative/config.rs` | 199 |
| `app/legacy_data/tests.rs` | 188 | `inference/generative/download_commands.rs` | 164 |
| `inference/native_ai.rs` | 162 | `files/tests.rs` | 157 |
| `upscale/tests.rs` | 156 | `app.rs` | 149 |
| `clipboard/wayland.rs` | 145 | `trace/tests.rs` | 139 |
| `app/legacy_data.rs` | 107 | `test_support.rs` | 95 |
| `inference/denoise.rs` | 87 | `clipboard/tests.rs` | 71 |
| `media.rs` | 67 | `inference/content_fill/tests.rs` | 45 |
| `models/tests.rs` | 41 | `inference/denoise/tests.rs` | 32 |
| `app/tests.rs` | 20 | `inference/generative.rs` | 11 |
| `inference.rs` | 7 | | |

Small glue modules (`inference/generative.rs`, `inference.rs`) only
declare submodules and test children and contain no moved logic.

### Planned-edit counts (all declared classes only)

- 70 command registrations gained a module-path prefix in `generate_handler!`.
- 185 top-level visibility additions (`pub(crate)` only): all 70 commands, all
  moved structs/enums/type aliases, and helpers/types referenced across
  destination files; 0 renames, 0 new `pub` items.
- Serialized payload fields: `pub(crate)` added on the moved struct fields that
  other destination files construct or read (no field rename, no serde
  attribute change).
- 3 cancellation-state constructors (`UpscaleCancelState::new`,
  `LamaCancelState::new`, `TraceCancelState::new`) became `pub(crate)` for the
  app builder.
- 18 crate-root `use` lines redistributed to the files that use them; 0
  resolved symbol changed.
- `lib.rs` `crate::` paths preserved: `uuid` stays at the crate root; the six
  model/AI helpers and three file helpers are re-exported with `pub(crate) use`
  so existing modules (`home_store/library.rs`, `inference_models.rs`,
  `model_artifacts.rs`, `native_jobs.rs`, `native_tensors.rs`) are unedited.
- Fonts: no font declaration remained in `lib.rs` (font commands already live
  in `font.rs` / `font_storage.rs`), so no `fonts` module was created; the
  ranked-row target list is satisfied by the existing modules.
- App note: the app builder entry (`run()` env block, plugin chain, setup
  hook, 154-command registration, build/run event hook) stays in `lib.rs`;
  only the setup closure body and its GTK pinch closure moved, in order.

### Covering gates (measured after the move)

- `cargo test -p varve-desktop --lib`: 161 collected, **156 passed, 1 failed,
  4 ignored** - identical to the recorded baseline. The one failure is the
  pre-existing environment failure
  `bg_remove_rejects_incompatible_graphs_before_decoding_or_inference`, now
  `inference::background::tests::...`; no new failure and no count decrease.
  Source `#[test]` fns: **87 before and after** (86 compiled with default
  features; the `#[cfg(not(feature = "ai"))]` test still compiles out).
- `pnpm audit:ipc`: exit 0, **154 Rust commands**, 172 literal TS invokes, 124
  matched, 48 known pre-existing gaps, 0 unregistered, 0 stale;
  `node --test scripts/quality/audit-ipc-contract.test.mjs` **10/10 pass**.
- File-size gate: `lib.rs` 7,376 -> 272; exactly one baseline entry to
  remove (955 -> 954), 0 added, 0 grown.

### Environment substitutions (recorded, not seam evidence)

- `pnpm install --frozen-lockfile`: read-only store
  (`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`); substituted with the main
  checkout's 22 node_modules symlinks (A-07/A-09 workflow).
- `pnpm check:agent`: queued gate unavailable
  (`EROFS .../varve-validation-queue/exclusive.lock`); substituted with the
  same recursive tsc program run directly on the final tree: 20 packages checked,
  0 package failures, desktop exit 0, e2e exit 0 (packages-checked=20,
  packages-fail=0, desktop-exit=0, e2e-exit=0).
- TypeScript seam tools both exit 2 on the Rust target (measured in RESEARCH);
  the A-07 substitution above is the declared replacement.

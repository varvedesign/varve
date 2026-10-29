mod acceleration;
mod app;
mod clipboard;
mod collab_host;
mod crash;
mod file_open;
mod files;
mod filesystem;
mod font;
mod font_storage;
mod generative_qualification;
mod generative_resources;
mod home_store;
mod inference;
mod inference_models;
mod lifecycle;
mod logs;
mod media;
mod menu;
mod model_artifacts;
mod model_graph_repair;
mod models;
mod native_jobs;
#[cfg(target_os = "linux")]
mod native_presenter;
mod native_raster;
mod native_tensors;
mod print;
mod printing;
mod renderer;
mod stubs;
#[cfg(test)]
mod test_support;
mod trace;
mod updates;
mod upscale;

pub(crate) use files::{resolve_user_path, resolve_user_path_approved, write_file_atomic};
pub(crate) use inference::native_ai::ensure_native_ai;
pub(crate) use models::{
    inference_model_path_at, sha256_file, valid_download_request_id, validate_inference_model_id,
    validate_inference_sha256,
};

pub(crate) fn uuid() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:x}-{:x}", t.as_nanos(), t.as_micros())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // On Wayland (especially KDE Plasma), the window icon is resolved via the
    // FreeDesktop desktop file whose *filename stem* matches the process
    // program name / Wayland app_id. Force that id to our Tauri identifier so
    // `dev.varve.desktop.desktop` + hicolor icons resolve instead of the
    // generic Wayland logo. Must run before GTK init inside `Builder::run`.
    #[cfg(target_os = "linux")]
    {
        // AppImage packaging bundles WebKitGTK and uses the host Mesa/EGL
        // stack. DMA-BUF is a common compositor failure mode on that mix;
        // default it off, and preserve an explicit user override.
        if let Some(value) = appimage_dmabuf_default(
            std::env::var_os("APPIMAGE").is_some(),
            std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some(),
        ) {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", value);
        }

        glib::set_prgname(Some("dev.varve.desktop"));
        glib::set_application_name("Varve");
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    // WDIO testing plugins (debug-only, excluded from release builds)
    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        // Native termination interception (ADR-0216 D5): close/exit is
        // prevented until the frontend coordinator approves it.
        .on_window_event(lifecycle::handle_window_event)
        .setup(app::setup)
        .invoke_handler(tauri::generate_handler![
            collab_host::collab_host_start,
            collab_host::collab_host_status,
            collab_host::collab_room_create,
            collab_host::collab_room_invite,
            collab_host::collab_room_revoke,
            collab_host::collab_room_end,
            collab_host::collab_host_stop,
            acceleration::native_acceleration_status,
            acceleration::native_gpu_self_test,
            acceleration::native_set_inference_provider,
            native_raster::native_raster_frame,
            native_raster::native_raster_status,
            native_raster::native_raster_retry,
            crash::crash_write_report,
            crash::crash_list_reports,
            crash::crash_read_report,
            crash::crash_delete_report,
            lifecycle::approve_window_close,
            lifecycle::approve_exit,
            lifecycle::native_previous_clean_shutdown,
            lifecycle::set_native_shutdown_clean,
            menu::build_native_menu,
            menu::update_native_menu_state,
            stubs::build_render_ir,
            stubs::hit_test,
            stubs::sync_save,
            stubs::sync_load,
            stubs::render_frame_ir,
            stubs::render_frame_pixels,
            stubs::report,
            stubs::done,
            updates::update_packaging_context,
            // Home commands
            home_store::home_list_files,
            home_store::home_list_trashed,
            home_store::home_get_file,
            home_store::home_read_file,
            home_store::home_file_exists,
            home_store::home_check_files_exist,
            home_store::home_upsert_file,
            home_store::home_touch_file,
            home_store::home_rename_file,
            home_store::home_set_pinned,
            home_store::home_set_favorited,
            home_store::home_move_project,
            home_store::home_trash,
            home_store::home_restore,
            home_store::home_purge,
            home_store::home_list_projects,
            home_store::home_create_project,
            home_store::home_rename_project,
            home_store::home_delete_project,
            home_store::home_set_project_pinned,
            home_store::home_get_view_state,
            home_store::home_set_view_state,
            home_store::app_get_setting,
            home_store::app_set_setting,
            home_store::app_compare_and_set_setting,
            home_store::home_get_thumbnail,
            home_store::home_put_thumbnail,
            home_store::home_evict_thumbnails,
            home_store::home_delete_thumbnail,
            home_store::home_search_files,
            home_store::home_reorder_file,
            home_store::home_list_recent_files,
            home_store::home_touch_recent_file,
            home_store::home_patch_recent_file,
            home_store::home_remove_recent_file,
            home_store::home_clear_recent_history,
            home_store::home_read_text_file,
            home_store::home_write_text_file,
            home_store::home_read_text_file_approved,
            home_store::home_write_text_file_approved,
            // Home tags (varve-sync schema v3)
            home_store::home_list_tags,
            home_store::home_create_tag,
            home_store::home_rename_tag,
            home_store::home_delete_tag,
            home_store::home_list_file_tags,
            home_store::home_add_file_tag,
            home_store::home_remove_file_tag,
            home_store::home_list_files_by_tag,
            files::write_binary_file,
            files::write_binary_file_to_folder,
            clipboard::read_dropped_file,
            clipboard::read_clipboard_image_png,
            clipboard::read_clipboard_data,
            clipboard::write_clipboard_data,
            clipboard::cancel_clipboard_operation,
            inference::background::remove_background,
            inference::background::remove_background_binary,
            inference::background::cancel_background_removal,
            inference::native_ai::native_ai_status,
            inference::background::models::native_background_removal_model_status,
            inference::background::models::host_memory_status,
            inference::background::models::preflight_native_background_removal,
            inference::background::models::download_background_removal_model,
            inference::background::models::cancel_background_removal_model_download,
            inference::background::models::delete_background_removal_model,
            models::download_inference_model,
            models::cancel_inference_model_download,
            models::delete_inference_model,
            models::inference_model_path,
            native_tensors::open_native_tensor_session,
            native_tensors::run_native_tensor_session,
            native_tensors::release_native_tensor_session,
            native_tensors::cancel_native_tensor_inference,
            models::inference_model_external_data,
            inference::denoise::denoise_image,
            inference::content_fill::content_aware_fill,
            inference::content_fill::cancel_content_aware_fill,
            inference::generative::run::generative_edit,
            inference::generative::run::cancel_generative_edit,
            inference::generative::model_status::generative_edit_model_status,
            inference::generative::download_commands::download_generative_edit_model,
            inference::generative::download_commands::cancel_generative_edit_model_download,
            inference::generative::import::import_generative_edit_model,
            inference::generative::import::qualify_generative_edit_model,
            trace::trace_image,
            trace::trace_image_binary,
            media::media_probe_binary,
            media::media_decode_frames_binary,
            trace::begin_trace_job,
            trace::cancel_trace,
            upscale::upscale_image,
            upscale::upscale_image_binary,
            upscale::ops::apply_live_effect_binary,
            upscale::begin_upscale_job,
            upscale::cancel_upscale,
            printing::export_node_pdf,
            printing::export_pdfx1a,
            printing::export_pdfx4,
            printing::outline_text,
            printing::export_pdf_with_options,
            // Native font enumeration
            font::enumerate_system_fonts,
            font::load_system_font,
            // Native text shaping
            printing::shape_text_command,
            // Native font filesystem storage
            font_storage::store_font_on_filesystem,
            font_storage::load_font_from_filesystem,
            font_storage::list_filesystem_fonts,
            font_storage::remove_font_from_filesystem,
            font_storage::release_document_fonts,
            font_storage::get_filesystem_font_storage_usage,
            // Native model file storage
            models::read_model_file,
            models::write_model_file,
            models::delete_model_file,
            models::list_model_files,
            // Native OS print
            printing::list_printers,
            printing::print_pdf,
            printing::cancel_print_job,
            // W6: backend-dependent UI stubs
            stubs::ai_chat,
            stubs::get_collab_users,
            stubs::update_cursor,
            stubs::list_plugins,
            stubs::close_splashscreen,
            // OS file-association intake
            file_open::take_pending_open_files,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // macOS LaunchServices "Open With" → pending-open queue
            file_open::handle_run_event(app_handle, &event);
            // Run-event interception (ExitRequested → coordinator) — the
            // only place Tauri 2 exposes the exit veto (ADR-0216 D5).
            lifecycle::handle_run_event(app_handle, event);
        });
}

fn appimage_dmabuf_default(is_appimage: bool, has_user_override: bool) -> Option<&'static str> {
    (is_appimage && !has_user_override).then_some("1")
}

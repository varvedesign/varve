//! Debug-only integration probe for a native GTK presentation layer in the
//! actual Tauri/Wry window. This deliberately draws a diagnostic marker rather
//! than document pixels; it proves host embedding and alpha composition only.
//! The feature is opt-in with `VARVE_NATIVE_PRESENTATION_SPIKE=1` and is never
//! enabled by a normal launch.

use gtk::prelude::*;
use tauri::WebviewWindow;
use webkit2gtk::{SettingsExt, WebViewExt};

const ENABLE_ENV: &str = "VARVE_NATIVE_PRESENTATION_SPIKE";

/// Attach a transparent native layer beneath the real Wry WebView when explicitly
/// requested for a local integration run. The GLArea is the native base child
/// and the real Wry WebView sits above it, preserving the normal UI/input stack.
pub fn attach_if_requested(window: &WebviewWindow) {
    if std::env::var(ENABLE_ENV).as_deref() != Ok("1") {
        return;
    }

    let result = window.with_webview(|platform| {
        let webview = platform.inner();
        if let Some(settings) = WebViewExt::settings(&webview) {
            // Pair with WEBKIT_INSPECTOR_HTTP_SERVER during local diagnosis.
            settings.set_enable_developer_extras(true);
        }
        match unsafe { attach(&webview) } {
            Ok(()) => crate::logs::log_line(
                "native-presenter",
                "Tauri/Wry GTK overlay attached; native diagnostic layer is beneath the WebView",
            ),
            Err(error) => crate::logs::log_line(
                "native-presenter",
                &format!("Tauri/Wry GTK overlay refused: {error}"),
            ),
        }
    });

    if let Err(error) = result {
        crate::logs::log_line(
            "native-presenter",
            &format!("Tauri/Wry GTK overlay callback failed: {error}"),
        );
    }
}

unsafe fn attach(webview: &webkit2gtk::WebView) -> Result<(), String> {
    let webview_widget: gtk::Widget = webview.clone().upcast();
    let parent = webview_widget
        .parent()
        .ok_or_else(|| "WebView has no GTK parent".to_string())?;
    let parent_box = parent
        .dynamic_cast::<gtk::Box>()
        .map_err(|_| "WebView parent is not the expected GtkBox".to_string())?;
    let children = parent_box.children();
    if children.len() != 1 || children.first() != Some(&webview_widget) {
        return Err(format!(
            "expected a single WebView child in GtkBox, found {} child widgets",
            children.len()
        ));
    }

    let window = parent_box
        .toplevel()
        .ok_or_else(|| "WebView GtkBox has no toplevel".to_string())?
        .dynamic_cast::<gtk::Window>()
        .map_err(|_| "WebView GtkBox is not directly below a GtkWindow".to_string())?;

    let overlay = gtk::Overlay::new();
    let gl_area = gtk::GLArea::new();
    gl_area.set_has_alpha(true);
    // The diagnostic frame is static. A frame sender must call `queue_render`
    // after replacing its stored pixels; never repaint continuously while idle.
    gl_area.set_auto_render(false);
    gl_area.set_hexpand(true);
    gl_area.set_vexpand(true);
    gl_area.set_size_request(1, 1);

    // Reparent on GTK's main thread only after validating the exact Wry tree.
    // Adding a widget before removing its old parent leaves the overlay empty.
    parent_box.remove(&webview_widget);
    window.remove(&parent_box);
    overlay.add(&gl_area);
    overlay.add_overlay(&webview_widget);

    gl_area.connect_realize(|area| {
        area.make_current();
        if let Some(error) = area.error() {
            crate::logs::log_line(
                "native-presenter",
                &format!("GLArea context creation failed: {error}"),
            );
            return;
        }
        crate::logs::log_line(
            "native-presenter",
            "GLArea context realized in Tauri window",
        );
    });
    gl_area.connect_render(|area, _| {
        let allocation = area.allocation();
        render_diagnostic_marker(allocation.width(), allocation.height());
        gtk::glib::Propagation::Proceed
    });
    gl_area.connect_unrealize(|_| {
        crate::logs::log_line("native-presenter", "GLArea unrealized in Tauri window");
    });

    if std::env::var_os("VARVE_TRACE_INPUT").is_some() {
        webview_widget.add_events(gtk::gdk::EventMask::BUTTON_PRESS_MASK);
        gl_area.add_events(gtk::gdk::EventMask::BUTTON_PRESS_MASK);
        webview.connect_button_press_event(|_, event| {
            let (x, y) = event.position();
            crate::logs::log_line(
                "native-presenter-input",
                &format!(
                    "WebView received button {} at ({x:.0},{y:.0})",
                    event.button()
                ),
            );
            gtk::glib::Propagation::Proceed
        });
        gl_area.connect_button_press_event(|_, event| {
            let (x, y) = event.position();
            crate::logs::log_line(
                "native-presenter-input",
                &format!(
                    "GLArea received button {} at ({x:.0},{y:.0})",
                    event.button()
                ),
            );
            gtk::glib::Propagation::Proceed
        });
    }

    // Keep Wry's expected two-parent lookup: WebView -> GtkOverlay -> GtkWindow.
    // The WebView is the overlay child so DOM UI and pointer input stay above
    // the native base surface.
    window.add(&overlay);
    overlay.show_all();
    window.present();
    gl_area.queue_render();
    crate::logs::log_line(
        "native-presenter",
        "native GLArea is the GtkOverlay base child; WebView is the foreground child",
    );
    Ok(())
}

fn render_diagnostic_marker(width: i32, height: i32) {
    if width <= 0 || height <= 0 {
        return;
    }

    // The host compositor combines this transparent GLArea underneath the real
    // editor WebView. Scissored clears make a fully native marker without
    // introducing a shader, texture, or fake WebView-side pixels.
    unsafe {
        glViewport(0, 0, width, height);
        glEnable(GL_SCISSOR_TEST);
        glScissor(0, 0, width, height);
        glClearColor(0.0, 0.0, 0.0, 0.0);
        glClear(GL_COLOR_BUFFER_BIT);

        let marker_w = (width / 5).max(1);
        let marker_h = (height / 5).max(1);
        glScissor(
            (width - marker_w) / 2,
            (height - marker_h) / 2,
            marker_w,
            marker_h,
        );
        glClearColor(0.02, 0.88, 0.72, 0.86);
        glClear(GL_COLOR_BUFFER_BIT);
        glDisable(GL_SCISSOR_TEST);
    }
}

const GL_SCISSOR_TEST: u32 = 0x0C11;
const GL_COLOR_BUFFER_BIT: u32 = 0x0000_4000;

#[link(name = "GL")]
unsafe extern "C" {
    fn glViewport(x: i32, y: i32, width: i32, height: i32);
    fn glEnable(cap: u32);
    fn glDisable(cap: u32);
    fn glScissor(x: i32, y: i32, width: i32, height: i32);
    fn glClearColor(red: f32, green: f32, blue: f32, alpha: f32);
    fn glClear(mask: u32);
}

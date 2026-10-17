//! ADR-0244 spike A (Linux/Wayland): `gtk::Overlay` + `gtk::GLArea`.
//!
//! Question (from ADR-0244, "Why not the alternatives"): can a native GL
//! surface composite *below* a `WebKitWebView` on Wayland — GL pixels visible
//! through transparent webview regions, HTML controls visible above — and does
//! input routing survive that widget stack?
//!
//! Layout mirrors wry's `examples/gtk_opengl.rs`, the recipe ADR-0244 names:
//!
//! ```text
//! gtk::Window
//! └── gtk::Overlay
//!     ├── (main child, bottom) gtk::GLArea   has_alpha(true), auto_render
//!     └── (overlay child, top) gtk::Fixed
//!         └── WebKitWebView (transparent background)
//! ```
//!
//! Evidence the program itself produces (see README for the harness):
//! - stdout: GL context creation, every render with a frame counter, GTK-level
//!   button events split by which widget received them, webview lifecycle.
//! - DOM: the page keeps its own click/motion counters; at the end of the auto
//!   sequence the program reads them back with `run_javascript` so the summary
//!   proves events reached the web process, not just GDK.
//! - `--auto`: a timed script clicks the webview and the GLArea with
//!   `gtk_test_simulate_button` (GDK-level, widget routing), resizes the
//!   window, writes a JSON summary, and exits.
//!
//! What this spike deliberately does NOT claim: it proves GL-rasterizer
//! pixels compositing, not wgpu-Vulkan frames inside a GLArea, and the
//! simulated clicks are GDK-level routing, not compositor-level input regions.
//! Both boundaries are recorded in the spike report.

use std::cell::RefCell;
use std::f32::consts::TAU;
use std::rc::Rc;
use std::time::{Duration, Instant};

use glow::HasContext as _;
use gtk::gdk;
use gtk::glib;
use gtk::prelude::*;
use webkit2gtk::WebViewExt;

// gtk-rs 0.18 does not bind the gtk+/gdk test utils; libgdk-3 exports
// `gdk_test_simulate_button` directly and is always linked by the gtk crate.
// This synthesizes a real GdkEvent into the widget's GdkWindow: GDK-level
// routing, one layer above GTK widget handlers, below the compositor.
extern "C" {
    fn gdk_test_simulate_button(
        window: *mut gdk::ffi::GdkWindow,
        x: i32,
        y: i32,
        button: u32,
        modifiers: gdk::ffi::GdkModifierType,
        button_type: gdk::ffi::GdkEventType,
    ) -> i32;
}

/// Returns true when GDK accepted both the press and the release; a DOM
/// `click` needs the pair.
fn simulate_click(widget: &impl IsA<gtk::Widget>, x: i32, y: i32) -> bool {
    let Some(window) = widget.window() else {
        eprintln!("[auto] {widget:?} has no GdkWindow yet; click not sent");
        return false;
    };
    let send = |event_type: gdk::ffi::GdkEventType| unsafe {
        gdk_test_simulate_button(
            window.as_ptr() as *mut gdk::ffi::GdkWindow,
            x,
            y,
            1,
            0 as gdk::ffi::GdkModifierType, // no modifiers held
            event_type,
        ) != 0
    };
    let pressed = send(gdk::ffi::GDK_BUTTON_PRESS);
    let released = send(gdk::ffi::GDK_BUTTON_RELEASE);
    pressed && released
}

/// HTML for the webview layer. The body is transparent so the GLArea below
/// must show through the centre; the header and footer are opaque to prove
/// the webview sits above the native surface; the counters make input receipt
/// visible in screenshots.
const PAGE: &str = r#"<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  html, body { background: transparent; margin: 0; height: 100%;
               font-family: sans-serif; overflow: hidden; }
  #bar { background: rgba(20, 20, 28, 0.92); color: #fff; padding: 10px 14px;
         font-size: 18px; }
  #centre { height: 62%; }
  #foot { background: rgba(20, 20, 28, 0.92); color: #9fe; padding: 8px 14px;
          font-size: 14px; position: absolute; bottom: 0; width: 100%;
          box-sizing: border-box; }
</style></head>
<body>
  <div id="bar">WEBVIEW SURFACE &mdash; HTML is above native GL</div>
  <div id="centre"></div>
  <div id="foot">clicks <span id="clicks">0</span> &middot;
    moves <span id="moves">0</span> &middot; last
    <span id="last">&mdash;</span></div>
<script>
  const clicks = document.getElementById('clicks');
  const moves = document.getElementById('moves');
  const last = document.getElementById('last');
  let c = 0, m = 0;
  document.addEventListener('click', (e) => {
    c += 1; clicks.textContent = String(c);
    last.textContent = 'click @ ' + Math.round(e.clientX) + ',' + Math.round(e.clientY);
    window.__spike = { clicks: c, moves: m };
  });
  document.addEventListener('pointermove', (e) => {
    m += 1; moves.textContent = String(m);
    window.__spike = { clicks: c, moves: m };
  });
  window.__spike = { clicks: 0, moves: 0 };
</script>
</body>
</html>"#;

#[derive(Default)]
struct Evidence {
    webview_gdk_clicks: u32,
    gl_area_gdk_clicks: u32,
}

struct GlState {
    gl: glow::Context,
    program: glow::Program,
    vao: glow::VertexArray,
}

fn main() {
    let auto = std::env::args().any(|a| a == "--auto");
    let interactive = std::env::args().any(|a| a == "--interactive");
    let application = gtk::Application::new(
        Some("dev.varve.spike.wayland_overlay_glayer"),
        gio::ApplicationFlags::NON_UNIQUE,
    );
    application.connect_activate(move |app| activate(app, auto, interactive));
    // Empty argv: GTK's GOption parsing must not see our own flags.
    // Empty argv: GTK's GOption parsing must not see our own flags.
    application.run_with_args(&Vec::<&str>::new());
}

fn activate(app: &gtk::Application, auto: bool, interactive: bool) {
    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title("varve spike A: gtk::Overlay + GLArea");
    window.set_default_size(900, 640);

    let overlay = gtk::Overlay::new();
    window.add(&overlay);

    // Bottom layer: the native GL surface.
    let gl_area = gtk::GLArea::new();
    gl_area.set_has_alpha(true);
    gl_area.set_auto_render(true);
    gl_area.set_size_request(900, 640);

    let gl_state: Rc<RefCell<Option<GlState>>> = Rc::new(RefCell::new(None));
    let frames: Rc<std::cell::Cell<u64>> = Rc::new(std::cell::Cell::new(0));
    let started = Instant::now();
    {
        let gl_state = gl_state.clone();
        gl_area.connect_realize(move |area| {
            area.make_current();
            if let Some(error) = area.error() {
                eprintln!("[gl] context creation FAILED: {error}");
                return;
            }
            let gl = unsafe { glow::Context::from_loader_function(load_gl_symbol) };
            let version = gl.version();
            eprintln!("[gl] context ready: GL {}.{}", version.major, version.minor);
            let program = compile_program(&gl);
            let vao = unsafe { gl.create_vertex_array().expect("create VAO") };
            *gl_state.borrow_mut() = Some(GlState { gl, program, vao });
        });
    }
    {
        let gl_state = gl_state.clone();
        let frames = frames.clone();
        gl_area.connect_render(move |_area, _context| {
            let t = started.elapsed().as_secs_f32();
            if let Some(state) = gl_state.borrow().as_ref() {
                let gl = &state.gl;
                // Animated colour sweep + a fixed orange triangle: any frame
                // of a screenshot identifies the GL layer unambiguously (the
                // webview chrome is dark grey, never these hues).
                let (r, g, b) = sweep(t);
                unsafe {
                    gl.clear_color(r, g, b, 1.0);
                    gl.clear(glow::COLOR_BUFFER_BIT);
                    gl.use_program(Some(glow::NativeProgram(state.program.0)));
                    gl.bind_vertex_array(Some(glow::NativeVertexArray(state.vao.0)));
                    gl.draw_arrays(glow::TRIANGLES, 0, 3);
                }
                let n = frames.get() + 1;
                frames.set(n);
                if n % 300 == 1 {
                    eprintln!("[gl] frame {n} rendered");
                }
            }
            glib::Propagation::Proceed
        });
    }
    {
        let gl_state = gl_state.clone();
        gl_area.connect_unrealize(move |area| {
            area.make_current();
            if let Some(state) = gl_state.borrow_mut().take() {
                unsafe {
                    state.gl.delete_program(state.program);
                    state.gl.delete_vertex_array(state.vao);
                }
                eprintln!("[gl] unrealized; GL resources deleted");
            }
        });
    }
    gl_area.add_events(gdk::EventMask::BUTTON_PRESS_MASK);
    gl_area.connect_button_press_event(|_area, event| {
        let (x, y) = event.position();
        eprintln!(
            "[input] GLArea received GDK button {} at ({x:.0},{y:.0})",
            event.button()
        );
        glib::Propagation::Proceed
    });
    overlay.add(&gl_area);

    // Top layer: the webview inside a gtk::Fixed, the container wry's
    // Wayland-recommended `build_gtk` path uses.
    let fixed = gtk::Fixed::new();
    let webview = webkit2gtk::WebView::new();
    webview.set_background_color(&gdk::RGBA::new(0.0, 0.0, 0.0, 0.0));
    webview.set_size_request(560, 420);
    webview.load_html(PAGE, Some("spike://overlay"));
    webview.add_events(gdk::EventMask::BUTTON_PRESS_MASK);
    webview.connect_button_press_event(|_webview, event| {
        let (x, y) = event.position();
        eprintln!(
            "[input] WebView received GDK button {} at ({x:.0},{y:.0})",
            event.button()
        );
        // Let WebKit process the click too (do not consume).
        glib::Propagation::Proceed
    });
    fixed.put(&webview, 170, 110);
    overlay.add_overlay(&fixed);

    // Keep the webview centred on resize, the same manual bounds dance wry's
    // example performs for a GtkFixed-hosted webview.
    window.connect_configure_event({
        let fixed = fixed.clone();
        let webview = webview.clone();
        move |_window, event| {
            let (w, h) = event.size();
            let x = ((w as i32 - 560) / 2).max(0);
            let y = ((h as i32 - 420) / 2).max(0);
            fixed.move_(&webview, x, y);
            false
        }
    });

    // A plain GtkWindow must be registered with the application or nothing
    // holds the main loop and the process exits right after activate.
    app.add_window(&window);
    window.show_all();
    eprintln!(
        "[env] WAYLAND_DISPLAY={:?} DISPLAY={:?} GDK_BACKEND={:?}",
        std::env::var("WAYLAND_DISPLAY").ok(),
        std::env::var("DISPLAY").ok(),
        std::env::var("GDK_BACKEND").ok(),
    );
    window.present();

    if auto {
        run_auto_sequence(&window, &webview, &gl_area);
    } else if interactive {
        eprintln!("[interactive] use the real pointer; DOM counters show delivered clicks");
    } else {
        eprintln!("[idle] rendering only (use --auto for synthesized input or --interactive for manual input)");
    }
}

// --- GL bootstrap -----------------------------------------------------------

const VERTEX: &str = r#"#version 330 core
const vec2 verts[3] = vec2[3](vec2(-0.55, -0.5), vec2(0.55, -0.5), vec2(0.0, 0.55));
void main() { gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0); }"#;

const FRAGMENT: &str = r#"#version 330 core
out vec4 color;
void main() { color = vec4(1.0, 0.45, 0.05, 1.0); }"#;

fn compile_program(gl: &glow::Context) -> glow::Program {
    unsafe {
        let program = gl.create_program().expect("create program");
        let vs = gl.create_shader(glow::VERTEX_SHADER).expect("create vs");
        gl.shader_source(vs, VERTEX);
        gl.compile_shader(vs);
        let fs = gl.create_shader(glow::FRAGMENT_SHADER).expect("create fs");
        gl.shader_source(fs, FRAGMENT);
        gl.compile_shader(fs);
        gl.attach_shader(program, vs);
        gl.attach_shader(program, fs);
        gl.link_program(program);
        assert!(gl.get_program_link_status(program), "link failed");
        gl.detach_shader(program, vs);
        gl.detach_shader(program, fs);
        gl.delete_shader(vs);
        gl.delete_shader(fs);
        program
    }
}

/// Loads GL entry points the same way wry's gtk_opengl example does: system
/// libGL first, libEGL as the fallback, both through libloading.
fn load_gl_symbol(name: &str) -> *const std::os::raw::c_void {
    use std::ffi::CString;
    use std::sync::OnceLock;
    // The dlopen handles must outlive every GL call: dropping the Library
    // unmaps the code the returned pointers point into. That was the spike's
    // first crash (frame 1 rendered, frame 2 faulted); the handles are now
    // pinned for the process lifetime, matching wry's example.
    static LIBRARIES: OnceLock<Vec<libloading::Library>> = OnceLock::new();
    let libraries = LIBRARIES.get_or_init(|| {
        ["libGL.so.1", "libEGL.so.1"]
            .iter()
            .filter_map(|name| unsafe { libloading::Library::new(name) }.ok())
            .collect()
    });
    let cstr = CString::new(name).expect("symbol name");
    for library in libraries {
        if let Ok(symbol) = unsafe { library.get::<*const std::os::raw::c_void>(cstr.as_bytes()) } {
            return *symbol;
        }
    }
    std::ptr::null()
}

/// Full-saturation sweep so any frame of a screenshot identifies the GL layer
/// unambiguously.
fn sweep(t: f32) -> (f32, f32, f32) {
    let phase = t % 3.0;
    (
        (phase / 3.0 * TAU).sin().abs().clamp(0.35, 1.0),
        ((phase + 1.0) / 3.0 * TAU).sin().abs().clamp(0.2, 0.8),
        ((phase + 2.0) / 3.0 * TAU).sin().abs().clamp(0.1, 0.6),
    )
}

// --- Automated evidence sequence --------------------------------------------

#[derive(Clone)]
enum Step {
    ClickWebview(f64, f64, &'static str),
    ClickGlArea(f64, f64),
    Resize,
    Finish,
}

fn run_auto_sequence(window: &gtk::Window, webview: &webkit2gtk::WebView, gl_area: &gtk::GLArea) {
    let evidence = Rc::new(RefCell::new(Evidence::default()));
    let steps: Vec<(u64, Step)> = vec![
        (1500, Step::ClickWebview(450.0, 320.0, "webview-centre")),
        (2500, Step::ClickWebview(450.0, 130.0, "webview-header")),
        (3500, Step::ClickGlArea(40.0, 600.0)),
        (4500, Step::Resize),
        (
            5500,
            Step::ClickWebview(450.0, 320.0, "webview-after-resize"),
        ),
        (6500, Step::Finish),
    ];
    for (delay_ms, step) in steps {
        let webview = webview.clone();
        let gl_area = gl_area.clone();
        let window = window.clone();
        let evidence = evidence.clone();
        glib::timeout_add_local(Duration::from_millis(delay_ms), move || {
            run_step(step.clone(), &window, &webview, &gl_area, &evidence);
            glib::ControlFlow::Break
        });
    }
}

fn run_step(
    step: Step,
    window: &gtk::Window,
    webview: &webkit2gtk::WebView,
    gl_area: &gtk::GLArea,
    evidence: &Rc<RefCell<Evidence>>,
) {
    match step {
        Step::ClickWebview(x, y, label) => {
            eprintln!("[auto] GDK click on {label} at ({x:.0},{y:.0})");
            let sent = simulate_click(webview, x as i32, y as i32);
            eprintln!("[auto] simulate_click({label}) -> {sent}");
            evidence.borrow_mut().webview_gdk_clicks += u32::from(sent);
        }
        Step::ClickGlArea(x, y) => {
            eprintln!("[auto] GDK click on glarea-outside-webview at ({x:.0},{y:.0})");
            let sent = simulate_click(gl_area, x as i32, y as i32);
            eprintln!("[auto] simulate_click(glarea) -> {sent}");
            evidence.borrow_mut().gl_area_gdk_clicks += u32::from(sent);
        }
        Step::Resize => {
            let (w, h) = window.size();
            eprintln!("[auto] resizing window to ({},{})", w + 220, h + 120);
            window.resize(w + 220, h + 120);
        }
        Step::Finish => {
            // The DOM counters are the web process's own receipt of the
            // clicks; read them back so the summary is independent of the GDK
            // signal handlers.
            webview.run_javascript(
                "JSON.stringify(window.__spike || {error: 'no spike state'})",
                None::<&gio::Cancellable>,
                move |result| match result {
                    Ok(value) => {
                        let dom = value
                            .js_value()
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "<unreadable>".into());
                        eprintln!("[summary] webviewDom={dom}");
                        write_summary(&dom);
                        std::process::exit(0);
                    }
                    Err(error) => {
                        eprintln!("[summary] JS readback failed: {error}");
                        write_summary("{\"jsReadback\":\"failed\"}");
                        std::process::exit(0);
                    }
                },
            );
        }
    }
}

fn write_summary(dom_json: &str) {
    let summary = format!("{{\"status\":\"completed\",\"dom\":{dom_json}}}");
    let path =
        std::env::var("SPIKE_SUMMARY_PATH").unwrap_or_else(|_| "/tmp/spike-summary.json".into());
    if let Err(error) = std::fs::write(&path, summary) {
        eprintln!("[summary] write to {path} failed: {error}");
    }
}

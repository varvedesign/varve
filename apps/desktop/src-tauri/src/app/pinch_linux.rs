//! WebKitGTK touchpad pinch bridge extracted from the crate root (Batch B/B-01).

use tauri::Emitter;
use tauri::Manager;

#[cfg(any(target_os = "linux", test))]
pub(crate) fn touchpad_pinch_phase(phase: i32) -> (&'static str, bool) {
    // Values follow GdkTouchpadGesturePhase: begin=0, update=1, end=2,
    // cancel=3. Unknown future values fail closed as cancellation.
    match phase {
        0 => ("begin", true),
        1 => ("update", true),
        2 => ("end", false),
        _ => ("cancel", false),
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn attach_pinch_zoom(app: &tauri::App) {
    use std::cell::Cell;
    use std::rc::Rc;
    use std::time::{Duration, Instant};

    use gtk::glib::object::ObjectExt;
    use gtk::prelude::Cast;
    use gtk::prelude::ContainerExt;
    use gtk::prelude::WidgetExt;
    use gtk::prelude::WidgetExtManual;
    use webkit2gtk::WebViewExt;

    let zoom_handle = app.handle().clone();
    let trace_input = std::env::var_os("VARVE_TRACE_INPUT").is_some();
    if let Some(window) = app.get_webview_window("main") {
        let attach_result = window.with_webview(move |platform| {
            let webview = platform.inner();

            // GTK3 only delivers touchpad pinch events to the GDK
            // window under the pointer when that window's event
            // mask includes TOUCHPAD_GESTURE_MASK. Nothing in the
            // wry/WebKitGTK stack sets it — which is why the pinch
            // stream never reached ANY handler (no WebKit page
            // zoom before, no gesture recognition now).
            //
            // The mask must be applied recursively: with DMABUF
            // rendering the webview nests child widgets whose
            // windows own the pointer surface, and add_events on
            // the parent does not cover a child widget's windows.
            // A plain-GTK probe window with the mask receives the
            // gesture fine on this desktop, so delivery dies
            // exactly here when any surface is left unmasked.
            fn opt_widget_into_pinch(widget: &gtk::Widget) {
                widget.add_events(gtk::gdk::EventMask::TOUCHPAD_GESTURE_MASK);
                if let Some(container) = widget.dynamic_cast_ref::<gtk::Container>() {
                    container.forall(&opt_widget_into_pinch);
                }
            }
            let webview_widget: gtk::Widget = webview.clone().upcast();
            opt_widget_into_pinch(&webview_widget);
            // The top-level window too: when the pointer hovers
            // chrome/decorations the surface belongs to it.
            if let Some(toplevel) = webview_widget.toplevel() {
                opt_widget_into_pinch(&toplevel);
            }

            let pinch_handle = zoom_handle.clone();
            let pinch_active = Rc::new(Cell::new(false));
            let first_direct_logged = Rc::new(Cell::new(false));

            if trace_input {
                // Optional diagnostics only: a one-time hierarchy
                // dump and non-motion events help locate GDK
                // delivery issues without adding event handlers or
                // log traffic to normal sessions.
                let mut hierarchy = String::new();
                fn walk_hierarchy(
                    widget: &gtk::Widget,
                    depth: usize,
                    out: &mut String,
                ) {
                    use std::cell::RefCell;
                    use std::fmt::Write as _;
                    let _ = writeln!(
                        out,
                        "{}{}",
                        " ".repeat(depth),
                        widget.type_().name()
                    );
                    if let Some(container) =
                        widget.dynamic_cast_ref::<gtk::Container>()
                    {
                        let children: RefCell<Vec<gtk::Widget>> =
                            RefCell::new(Vec::new());
                        container.forall(&|child: &gtk::Widget| {
                            children.borrow_mut().push(child.clone());
                        });
                        for child in children.into_inner() {
                            walk_hierarchy(&child, depth + 2, out);
                        }
                    }
                }
                walk_hierarchy(&webview_widget, 0, &mut hierarchy);
                crate::logs::log_line(
                    "input",
                    &format!(
                        "webview widget hierarchy under pointer surface:\n{hierarchy}"
                    ),
                );

                fn attach_event_tracer(widget: &gtk::Widget, label: &str) {
                    let label_owned = label.to_owned();
                    widget.connect_event(move |_w, event| {
                        let kind = format!("{:?}", event.event_type());
                        if kind.contains("Motion")
                            || kind.contains("Enter")
                            || kind.contains("Leave")
                            || kind.contains("Expose")
                        {
                            return gtk::glib::Propagation::Proceed;
                        }
                        crate::logs::log_line(
                            "input-trace",
                            &format!("{label_owned}: {kind}"),
                        );
                        gtk::glib::Propagation::Proceed
                    });
                    if let Some(container) =
                        widget.dynamic_cast_ref::<gtk::Container>()
                    {
                        let children: std::cell::RefCell<Vec<gtk::Widget>> =
                            std::cell::RefCell::new(Vec::new());
                        container.forall(&|child: &gtk::Widget| {
                            children.borrow_mut().push(child.clone());
                        });
                        let child_list = children.into_inner();
                        for child in &child_list {
                            let type_name = child.type_().name();
                            let child_label = format!("{label}/{type_name}");
                            attach_event_tracer(child, &child_label);
                        }
                    }
                }
                if let Some(toplevel_for_trace) = webview_widget.toplevel() {
                    attach_event_tracer(&toplevel_for_trace, "TOP");
                }
                attach_event_tracer(&webview_widget, "WEBVIEW");
                crate::logs::log_line("input", "event tracers attached");
            }

            // Direct TouchpadPinch handling — the primary arm.
            //
            // GdkEventTouchpadPinch carries phase plus a scale
            // that is cumulative since begin — exactly the
            // contract the frontend bridge listener already
            // implements (the macOS WebKit gesture-event shape).
            //
            // Returning Stop also keeps the stream away from
            // WebKit, whose own response to a pinch (zooming the
            // whole page/UI) was the original bug report.
            //
            // pinch_active also suppresses the zoom_level fallback
            // arm below so the two can never double-apply.
            let direct_handle = pinch_handle.clone();
            let direct_pinch_active = pinch_active.clone();
            let pinch_target = webview_widget.clone();
            webview.connect_event(move |_w, event| {
                if event.event_type() != gtk::gdk::EventType::TouchpadPinch {
                    return gtk::glib::Propagation::Proceed;
                }
                let Some(pinch) = event.downcast_ref::<gtk::gdk::EventTouchpadPinch>()
                else {
                    return gtk::glib::Propagation::Proceed;
                };
                let phase_raw = i32::from(pinch.as_ref().phase);
                let (phase, active) = touchpad_pinch_phase(phase_raw);
                direct_pinch_active.set(active);
                if phase == "begin" && !first_direct_logged.get() {
                    first_direct_logged.set(true);
                    crate::logs::log_line(
                        "input",
                        "touchpad pinch handled directly from TouchpadPinch events — forwarding to canvas",
                    );
                }
                let scale = pinch.scale();
                if !scale.is_finite() || scale <= 0.0 {
                    return gtk::glib::Propagation::Stop;
                }
                // GDK's event x/y are relative to the GdkWindow
                // that received the event. Descendant WebKit
                // surfaces can have their own windows, so map the
                // root pointer coordinates back to the webview's
                // CSS-pixel origin before sending them to canvas.
                let point = event
                    .root_coords()
                    .and_then(|(root_x, root_y)| {
                        let toplevel = pinch_target.toplevel()?;
                        let (webview_x, webview_y) =
                            pinch_target.translate_coordinates(&toplevel, 0, 0)?;
                        let (toplevel_x, toplevel_y) =
                            toplevel.window()?.root_coords(0, 0);
                        Some((
                            root_x - f64::from(toplevel_x + webview_x),
                            root_y - f64::from(toplevel_y + webview_y),
                        ))
                    })
                    .unwrap_or_else(|| pinch.position());
                let (x, y) = point;
                let _ = direct_handle.emit(
                    "canvas://pinch-zoom",
                    serde_json::json!({
                        "phase": phase,
                        "scale": scale,
                        "x": x,
                        "y": y,
                    }),
                );
                gtk::glib::Propagation::Stop
            });

            let fallback_baseline = Rc::new(Cell::new(1.0_f64));
            let fallback_last = Rc::new(Cell::new(Instant::now()));
            let first_fallback_logged = Rc::new(Cell::new(false));
            webview.connect_zoom_level_notify(move |view| {
                let level = view.zoom_level();
                // Guard against re-entering on our own reset.
                if (level - 1.0).abs() < f64::EPSILON {
                    return;
                }
                if !first_fallback_logged.get() {
                    first_fallback_logged.set(true);
                    crate::logs::log_line(
                        "input",
                        "webkit page-zoom fallback: zoom_level moved by the platform; forwarding delta factors",
                    );
                }
                // Our own gesture arm owns the pinch; never let a
                // page-zoom notify double-apply the same fingers.
                if pinch_active.get() {
                    view.set_zoom_level(1.0);
                    return;
                }
                let now = Instant::now();
                if now.duration_since(fallback_last.get())
                    > Duration::from_millis(250)
                {
                    fallback_baseline.set(1.0);
                }
                fallback_last.set(now);
                let base = fallback_baseline.get();
                let factor = if base > f64::EPSILON {
                    level / base
                } else {
                    level
                };
                fallback_baseline.set(level);
                let _ = zoom_handle.emit(
                    "canvas://pinch-zoom",
                    serde_json::json!({ "factor": factor }),
                );
                view.set_zoom_level(1.0);
            });

            crate::logs::log_line(
                "input",
                "pinch bridge attached: recursive gesture mask + GDK event handler + zoom_level fallback installed",
            );
        });
        if let Err(attach_error) = attach_result {
            crate::logs::log_line(
                "input",
                &format!("pinch bridge attach FAILED inside with_webview: {attach_error}"),
            );
        }
    } else {
        crate::logs::log_line(
            "input",
            "pinch bridge attach FAILED: no webview window named 'main' at setup",
        );
    }
}

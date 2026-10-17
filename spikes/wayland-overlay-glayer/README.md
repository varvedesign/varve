# Spike A: `gtk::Overlay` + `gtk::GLArea` under WebKitGTK (ADR-0244)

A standalone, non-workspace spike answering the Linux presentation question
ADR-0244 records as "the single cheapest experiment that would move the Linux
presentation question, and it is unrun":

> establish whether a native surface composites above or below a
> `WebKitWebView` on Wayland, and whether input routing survives.

Full evidence and the verdict: `docs/audits/wayland-glayer-spike-2026-10-16.md`.

## Running it

```bash
cd spikes/wayland-overlay-glayer
cargo build

# Native Wayland (the primary development platform case)
SPIKE_SUMMARY_PATH=/tmp/spikeA.json ./target/debug/wayland-overlay-glayer --auto

# XWayland (the only backend where gdk_test_simulate_button works, via XTest)
GDK_BACKEND=x11 SPIKE_SUMMARY_PATH=/tmp/spikeA.json ./target/debug/wayland-overlay-glayer --auto

# Manual input verification (the step automation cannot do on Wayland):
./target/debug/wayland-overlay-glayer --interactive
# click the dark header/footer and the transparent centre; the DOM counters in
# the footer must increment, and the GL background must stay alive underneath.
```

The crate is deliberately **not** a workspace member and must never become one:
it exists to answer a platform question and to be re-runnable when WebKitGTK,
GTK, or wry versions move.

## What the layout is

Exactly the wry `examples/gtk_opengl.rs` recipe ADR-0244 names:

```text
gtk::Window
└── gtk::Overlay
    ├── (main child, bottom) gtk::GLArea    has_alpha(true), auto_render
    │     glow context via libGL/libEGL, animated sweep + triangle
    └── (overlay child, top) gtk::Fixed
          └── WebKitWebView  background rgba(0,0,0,0)
                header + footer bars opaque, centre transparent
```

## Crash found and fixed during the spike (worth keeping)

`gdk_test_simulate_button`-adjacent: the first build dropped each
`libloading::Library` right after symbol lookup, unmapping `libGL` while GL
used its function pointers — frame 1 rendered, frame 2 faulted, silently. The
dlopen handles are now pinned for the process lifetime (`OnceLock`). Any future
GLArea loader must keep this property.

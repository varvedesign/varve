# Spike A — Wayland `gtk::Overlay` + `gtk::GLArea` (2026-10-16)

Evidence for ADR-0244's Linux presentation spike. Spike source:
[`spikes/wayland-overlay-glayer/`](../../spikes/wayland-overlay-glayer/)
(non-workspace crate). Verdict lines are at the bottom and are the only part
ADR-0244 cites.

## Question

ADR-0244, "Why not the alternatives":

> a `gtk::Overlay` + `gtk::GLArea` spike (wry ships `examples/gtk_opengl.rs` …)
> to establish whether a native surface composites above or below a
> `WebKitWebView` on Wayland, and whether input routing survives.

## Environment (all measured, none assumed)

| Component | Version |
|---|---|
| OS / session | CachyOS, KDE Plasma, native Wayland (`WAYLAND_DISPLAY=wayland-0`) |
| GPU / driver | AMD Ryzen 3 5300U iGPU (Lucienne), Mesa RADV |
| GTK | 3.24.52 |
| WebKitGTK | 2.54.1 (`webkit2gtk-4.1` via pkg-config) |
| Crates | `gtk 0.18`, `webkit2gtk 2.0.2` (the exact pair wry 0.57 pins), `glow 0.16`, `libloading 0.8` |
| GL context | `gtk::GLArea` created a **GL 4.6** context on the first try |
| Spike commits | layout mirrors wry `examples/gtk_opengl.rs`: GLArea as Overlay main child, webview in a `gtk::Fixed` overlay child, `set_background_color(rgba(0,0,0,0))`, `has_alpha(true)` |

## Result 1 — compositing: PASS (native Wayland, OS-level capture)

Captures were made by KDE `spectacle` while the spike ran, not in-process
screenshots — browser-internal capture cannot see native layers. The committed
PNG files are crops of the spike window from those OS-level captures; their
pixels were not retouched.

![initial](../screenshots/wayland-spike/wayland-native-initial-window.png)

- The **native GLArea** fills the window with its animated colour sweep and the
  fixed orange triangle (`wayland-native-initial-window.png`,
  `wayland-native-later-frame-window.png`).
- The **webview's opaque header** ("WEBVIEW SURFACE — HTML is above native GL")
  and **footer** (DOM counters) render **above** the GL pixels.
- The webview's **transparent centre** shows the GL content **through it** — the
  triangle continues seamlessly across the webview boundary. Alpha blending of
  the WebKitGTK surface over the native GL surface works on native Wayland.

**Caveat found by the captures, not by reading code:** in the first capture the
webview's transparent region shows a *different GL frame* (magenta sweep phase)
than the surrounding area (the first, teal frame). GTK's damage handling
redrew only the webview's rectangle at a later frame-clock tick, and the GLArea
redrew inside that clip. For the spike's animated hue this is a visible
mismatch; for Varve's actual use (a stable document frame under an overlay UI)
the equivalent requirement is a discipline: when the webview recomposites, the
native layer must be invalidated through the same frame clock so the two
surfaces cannot disagree. This is a scheduling rule for an integration, not a
blocker — recorded so it cannot be rediscovered as a bug later.

## Result 2 — input: no abort (three runs), delivery partially verified

The wry/tauri failure class this question exists for is wry #1808: a
`tauri-runtime-wry` handler assumes `webview → GtkBox → GtkWindow` and
`.unwrap()`s the ancestor downcast inside a button-press handler, aborting the
process on the first real click when an overlay reparents the webview. The
spike deliberately excludes `tauri-runtime-wry`, so the test is whether the
GTK-level mechanism itself survives.

| Evidence | Result |
|---|---|
| Full auto sequence (3 webview clicks, 1 GLArea click, resize, 4th click) on native Wayland | **Completed, exit 0, no abort, three consecutive runs** (`wayland-native-run.txt`) |
| Same on XWayland (`GDK_BACKEND=x11`, where `gdk_test_simulate_button` works via XTest) | **Completed, exit 0, no abort** (`xwayland-run.txt`) |
| Synthesized events accepted by GDK | `true` for every click on both backends |
| Events reaching the web page | `pointermove` counters increment through the full stack (`moves: 7` on XWayland) — WebKit's input pipeline runs under the overlay stack |
| DOM `click` counters | **Never incremented** from synthesized events, on any run |
| GTK widget-level `button-press-event` handlers | Never fired from synthesized events, on any run |
| Resize | Window resized to 1120×760; GLArea reallocated; webview recentred via the wry-style `move_` dance (`xwayland-post-resize-window.png`) |

**Reading:** the crash class is absent — no click path aborts or corrupts
anything. But `gdk_test_simulate_button`-driven clicks are **not** sufficient
evidence of real-click routing into DOM `click` handlers: WebKit did not
synthesize a DOM click from any faked event stream, and the widget-signal
handlers did not observe the faked presses. On native Wayland the GDK test
utility refuses outright (it is XTest-backed). **Synthetic input evidence is
therefore classified inconclusive**, and the honest statement is narrower:

- Verified: the widget stack (Overlay → Fixed → WebKitWebView) does not break
  GDK event delivery to the web process, and nothing aborts.
- Not verified by automation: that a **real** pointer click produces a DOM
  click through this stack on native Wayland.
- Remaining step: `./wayland-overlay-glayer --interactive` on a real session —
  the DOM counters in the footer are the acceptance signal — plus a
  wry-integrated spike (`build_gtk` path) before any Tauri-level claim, because
  #1808 lives in `tauri-runtime-wry`, which this spike excludes by design.

## Result 3 — what this spike does not claim

- It proves **GL-rasterizer pixels compositing under WebKitGTK**. It does not
  prove wgpu-Vulkan frames inside a GLArea (that is a texture-sharing question
  adjacent to spike B) — the GL here is a plain desktop-GL context via
  `libGL`/`libEGL` entry points, the same loader strategy as wry's example.
- It does not validate the Tauri runtime path (`tauri-runtime-wry` handlers,
  decorated/undecorated resize logic). A positive integration decision still
  requires that spike; #1808 (open against tauri-runtime-wry 2.11.2) is the
  named failure to reproduce before claiming Tauri compatibility.
- Screenshots were taken with KDE `spectacle` (compositor capture); WebKitGTK
  content in them is the real web process output, GL content is the real GL
  context — neither layer is simulated. The checked-in crops retain the whole
  spike window and omit unrelated desktop content.

## Product and website claim check

The current product and docs pages were checked against this spike and the
threading audit. They already say that desktop GPU raster/effect work is
offscreen, Canvas2D remains the display path, the public GitHub Pages demo
cannot use shared-memory WASM, and preview resolution can be reduced under
frame pressure. No marketing claim currently treats this GLArea compositing
test as a delivered Varve feature, so changing marketing copy would overstate
the evidence rather than improve its accuracy.

## Verdict

| ADR-0244 spike question | Verdict |
|---|---|
| Does a native surface composite below a `WebKitWebView` on Wayland? | **PASS** — GL below, HTML above, transparency verified on native Wayland (and XWayland), OS-level captures committed |
| Does input routing survive? | **Partially verified** — no abort on any click path (the #1808 class is absent at the GTK level); DOM-level click delivery from synthesized events inconclusive; real-pointer and wry-integrated verification remain open |
| Frame-clock consistency under partial damage | New caveat, documented above — an integration must keep the native layer and webview recomposites on one frame clock |

Verdict for ADR-0244: the Linux "unproven mechanism" is now **proven at the
compositing level**; the open work for native presentation on Linux is an
integration spike (wry/`tauri-runtime-wry`), a frame-clock discipline, and
manual input verification — not a search for a mechanism.

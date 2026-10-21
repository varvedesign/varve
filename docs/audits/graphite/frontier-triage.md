# Link frontier triage

The frontier (`link-frontier.jsonl`, 1,054 deduplicated edges) was extracted
from every issue body and comment in the frozen corpus. Each edge carries the
originating issue numbers and its occurrence count.

## Classification

| Class | Count | Treatment |
|---|---|---|
| `#N` number references | 744 | Resolved against the frozen issue and PR sets. Issue references are covered by the per-issue review itself; PR references are retained as linked fix evidence rather than as separate review targets. |
| Graphite source evidence (`GraphiteEditor/Graphite/blob|tree|commit`) | 143 | Used as implementation evidence for findings that are in scope; not crawled as independent sources. Where a finding depends on Graphite's own code, the *decision* recorded in the issue thread is what Varve needs, not Graphite's implementation. |
| Graphite issue/PR/discussion full URLs | 101 | Same treatment as `#N` references. |
| Same-repository forks and mirrors (`Keavon/Graphite`, `felipetesc/graphite-desktop`) | 9 | Third-party wrappers or historical forks; no bearing on Varve. |
| External dependency and standards links | 57 | Triaged individually below. |

Nine `unresolved-number-reference` edges point at numbers that exist in neither
the issue nor the PR set. They are retained so the gap is visible rather than
silently dropped; they cannot be resolved from this repository's public
history.

## External dependency edges worth a decision

| Target | Origin | Decision |
|---|---|---|
| `chromiumembedded/cef` issues and redistribution notes | #3583, #3888 | Out of scope: Graphite's CEF/Electron wrapper discussions. Varve ships Tauri, not CEF. |
| `linebender/vello` (5 links) | renderer crashes | Out of scope: Vello is Graphite's GPU renderer. Varve renders through Canvas2D with an opt-in WebGPU compositor and does not link Vello. The *lesson* (a renderer-specific crash must not be the only path to output) is already Varve's documented fallback invariant. |
| `rustwasm/wasm-pack`, `rustwasm/wasm-bindgen` | #1103 (WASM memory exhaustion) | Partially applicable: Varve builds WASM bindings too, so the class "bounded allocation at the JS/WASM boundary" is relevant. Varve already bounds image decode, mask-surface pooling and replay caches; #1103 itself is recorded as `already-handled` with those mechanisms named. |
| `tauri-apps/tauri#9220`, `tauri-apps/tauri#7335`, Tauri GTK3 dependency | #584, #1745 | Applicable to the desktop shell; see the open finding below. |
| `rust-windowing/winit`, `glfw/glfw` | windowing | Out of scope: Graphite's windowing experiments. |
| `paperjs/paper.js` | path algorithms | Out of scope: Varve has its own path geometry. |
| `rust-gpu`, `rust-gamedev` newsletter | GPU/Rust ecosystem | Out of scope: no Varve counterpart. |
| `electron/electron`, `eclipse-theia/theia`, `brave/brave-browser` | desktop/browser wrapper discussions | Out of scope: not Varve's shell or supported browser matrix. |

## Open finding from the frontier

**Decorations-off Tauri windows on KDE/Wayland.** Graphite #584's thread reports
that a Tauri window with `decorations = false` "is not draggable or resizable"
on KDE. Varve's main window uses `decorations: false`
(`apps/desktop/src-tauri/tauri.conf.json`) and renders its own title bar with a
`data-tauri-drag-region`, which covers dragging. No custom resize handles or
`startResizeDragging` usage exists anywhere in the desktop app, so resizing a
maximised-to-normal window depends on the compositor providing resize edges for
a decorationless GTK window.

Status: **unverified, needs a native Linux session.** The shell used for this
review is a KDE Wayland session, so the environment is representative, but the
desktop app was not built and driven: a cargo build plus an interactive GUI run
was neither affordable under the shared-machine lease nor appropriate while
another session held it. Verification plan: build the desktop app, unmaximise
the window, attempt an edge-drag resize and a title-bar drag under KDE Wayland,
then repeat under X11; if resize fails, add explicit resize handles (or switch
to client-side decorations where the compositor requires them) behind the
existing `useWindowChrome` strategy rather than changing every platform.

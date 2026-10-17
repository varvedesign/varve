# Threaded WASM and native presentation — task plan (2026-10-17)

This task follows the implementation prompt attached to the Codex request. It
records the checked-out starting point and keeps capability claims tied to
evidence. The prompt's acceptance criteria remain the source of truth; this
note is an execution map, not a reduction of scope.

## Starting state

- Starting `HEAD`: `0024e633bfdf040af4e190e1aa5df0dd86f36fa3` on local `master`.
- Branch state at inspection: local `master` is 118 commits ahead and 6 behind
  `origin/master`. The root worktree has 77 planner-selected changed files
  (83 status entries including generated/ignored-adjacent work); unrelated
  edits are being preserved.
- ADR-0244 is present in this checkout, despite the prompt's public-master
  snapshot not containing it. It records the native raster stage as offscreen
  and the presenter as unresolved.
- The compound-contour IR repair is already committed at the starting SHA
  (`0024e633`). It carries the field into the Rust engine and native admission;
  this does not establish every topology/fill-rule case in the prompt.
- The WASM audit `docs/perf/2026-10-16-wasm-simd-capability.md` establishes
  that the scene engine is single-threaded on the current stable Rust/WASM
  build. SIMD artifact validity is proven; no exported-path speedup was
  measured. Native row-band effect threading is a separate capability.
- A GTK `Overlay` + `GLArea` test binary and OS-level Wayland/XWayland captures
  are present as untracked task artifacts. The Wayland audit records a
  compositing pass, but synthetic click evidence is inconclusive and the test
  excludes Tauri/Wry. This is not an integrated native presenter.
- Native text and strokes are still refused by the native raster admission
  layer. The native render guide also records MSAA cost and the absent matched
  Canvas2D baseline.

## Research updates and selected failure reports

The consolidated source ledger is
[`native-gpu-canvas-research-2026-10-16.md`](../research/native-gpu-canvas-research-2026-10-16.md).
Focused checks on 2026-10-17 confirmed:

| Report / source | Current status and Varve applicability | Response and acceptance evidence |
|---|---|---|
| wasm-bindgen [#5223](https://github.com/wasm-bindgen/wasm-bindgen/issues/5223) / [#5225](https://github.com/wasm-bindgen/wasm-bindgen/pull/5225) | The allocator/thread-bootstrap overlap was fixed in a merged PR and shipped in 0.2.127. Treat it as a regression scenario, not a present Varve defect. | If threaded WASM is built, pin/test the compatible glue and include a large imported shared-memory startup case. |
| ONNX Runtime Web [#26858](https://github.com/microsoft/onnxruntime/issues/26858) | A multithreaded external-data session hang was reported on 1.23.2 and closed stale; no fix was verified. It is an inference-runtime issue and does not prove Rust scene threading is broken. | Reproduce against Varve's locked ORT and worker arrangement before enabling inference threads; keep scene-engine and inference claims separate. |
| Wry [#1808](https://github.com/tauri-apps/wry/issues/1808) | The issue reports an abort in `tauri-runtime-wry` 2.11.2. Varve locks 2.12.1; inspected source uses the same fixed-depth ancestor lookup but converts a failed downcast to `None`, avoiding the reported unwrap abort. A reparented undecorated window may still lose edge-resize handling. | Keep real input and undecorated-resize checks in the Wry-integrated spike; do not claim the 2.11.2 process-abort reproduces on Varve's lockfile. |
| Lightcraft [#2064](https://github.com/storytold/lightcraft/issues/2064) | An open 0.8.0 Linux report describes sharp detail appearing briefly after zoom, then being replaced by a blurry preview; changing preview size did not help. This is not evidence of a Varve defect. | Varve should test settled preview resolution, quality restoration, and whether any quality setting changes the pixels it controls. Existing product copy already discloses reduced-resolution and reprojected previews. |

**Tauri header follow-up (2026-10-17):** the current [Tauri v2 HTTP headers
guide](https://v2.tauri.app/security/http-headers/) documents
`app.security.headers` support for COOP and COEP on packaged protocol
responses, while noting that framework dev servers need their own headers.
Thus packaged Tauri isolation is configurable; it is not established by the
browser probe or by Vite dev settings. This threaded provider remains after
native tracing in the Tauri chain, so enabling COOP/COEP globally is not
required for the desktop trace fallback and would need a separate review of
external-resource behavior plus a real WebKitGTK capability check.

## Execution slices and status

1. **Establish evidence and close the IR contract.** Starting tree contains the
   contour field repair; still check serialization directions, fill rules,
   nested islands, self-intersections, save/reopen, and real compound SVG
   visuals against the prompt's matrix.
2. **Threaded WASM.** The optional nightly `threads` artifact now has a
   dedicated worker host and a separate trace provider in the web provider
   chain. The host gates on shared-memory/cross-origin-isolation capability,
   checks ABI and engine/trace versions, copies input before transfer, bounds
   queued traces, and retires/rebuilds after cancellation or worker failure.
   Its diagnostic performs the real contour tracer on a deterministic fixture
   and records Rayon worker IDs. The first isolated Chromium run exposed a
   generated Rayon helper's package-directory import, which raw `public/`
   assets cannot resolve. Commit `b9894519d` adds a build-time rewrite to the
   explicit generated module URL and retries failed initialization on later
   requests. A fresh `just wasm-build-threads` and opt-in
   `threaded-trace-runtime.spec.ts` run then passed: two workers were observed,
   and the complete result matched scalar WASM. This verifies the isolated
   browser trace path on this host. The artifact remains an optional ignored
   build output; public Pages and packaged Tauri/WebKitGTK have not passed the
   isolation and packaging gates. The existing unshared and inference paths
   remain separate.
3. **Native presentation.** Spike A is compositing-level evidence only. Next
   gate is real-pointer input plus the actual Wry/Tauri path. Spike B
   (`wl_subsurface` to Vulkan) and Spike C (macOS `CAMetalLayer`) remain
   unrun. Windows child-HWND presentation is also not implemented.
4. **Native fidelity and handover.** Text/stroke admission, asynchronous frame
   identity/recovery, overlays, color/alpha fidelity and export agreement
   remain open. Do not expose a partial native frame as authoritative.
5. **Performance.** Build the matched Canvas2D/offscreen/native comparison,
   then evaluate supported sample counts and settled quality on the available
   integrated GPU. Current raster microbenchmarks are not a product speedup.
6. **Website, review, and integration.** The canvas feature page's recent
   technical-copy update describes retained replay boundaries and the
   authoritative fallback; it does not claim threaded WASM or native on-screen
   presentation. The public Pages demo still lacks the isolation headers this
   threaded provider requires, so no threaded/native marketing claim is
   justified. Continue reviewing website copy after a shipped browser or
   native presenter passes its own acceptance gate.

## Validation and integration constraints

- `pnpm verify:plan` was run against the already-dirty root tree. It selected
  75 lanes and reported `FULL-SUITE ESCALATION: YES` because the tree includes
  workspace/toolchain and validation-infrastructure changes. Other test and
  typecheck processes were already running in this worktree, so do not launch
  duplicate heavy jobs; refresh process state before validation.
- Host evidence is CachyOS x86_64, KDE Wayland, AMD Ryzen 3 5300U/RADV, GTK
  3.24.52 and WebKitGTK 2.54.1 from the spike record. macOS and Windows
  presentation remain untestable on this host.
- The current branch is already named `master`; its dirty tree and unrelated
  commits mean no reset, branch rewrite, push, or blanket staging is safe.
  Any integration beyond local `master` requires a separately reviewed,
  scoped change set and exact remote-base reconciliation.

## Progress from the 2026-10-17 review

- The threaded tracing runtime was completed and committed in
  `20695bd53`; the raw-asset worker bootstrap fix, init-retry regression,
  isolated browser acceptance spec, and architecture update were committed in
  `b9894519d`. The first browser run timed out during Rayon startup. After the
  helper URL rewrite, a fresh artifact build and browser run passed, including
  scalar-output parity and observation of both configured workers.
- An earlier three-check `threaded-trace-pool.spec.ts` run passed on
  2026-10-17: real two-worker tracer execution, byte-identical output
  (3,692 JSON bytes) against scalar WASM, and correct refusal without
  cross-origin isolation. Its current committed form retains the positive
  isolated pool and scalar-parity cases; eligibility/fallback is also covered
  by host unit tests. The browser reported hardwareConcurrency 8; a
  four-worker default attempt failed during worker initialization, while the
  two-worker configuration passed. `ThreadedTraceHost` now defaults to two
  rather than inferring a larger pool from the hardwareConcurrency hint. Four
  workers remain unqualified, not an advertised capability.
- A separate post-cap `threaded-trace-runtime.spec.ts` run passed with the
  production default (two workers observed and output equal to scalar WASM).
  Review then found the host copied RGBA data before validating its dimensions
  and had only a request-count queue bound. The host now rejects malformed or
  over-64-MP input before copying, caps aggregate queued pixel buffers at
  128 MiB, and removes abort listeners when a pool is retired. The focused
  host suite passes 10 tests; engine typecheck, E2E typecheck, and Biome on the
  scoped files pass. The wider planner remains escalated because of unrelated
  shared-worktree changes.
- Tauri's documented custom-protocol COOP/COEP headers remove the earlier
  assumption that packaged isolation is structurally unavailable. No header
  was enabled: the browser acceptance result does not cover WebKitGTK, and the
  Tauri chain already prefers native tracing before the optional WASM fallback.
- Focused host/provider tests passed (16 tests before the retry addition; the
  commit checkpoint passed 15 host/dispatch tests including the retry). Engine
  typecheck, E2E typecheck, Biome, `audit:docs`, staged audit hooks, and the
  threaded artifact build passed. The final browser run attaches its measured
  result to the Playwright test artifact. The latest wide worktree planner
  selects 71 files (72 lanes) and reports `FULL-SUITE ESCALATION: YES`; its
  broad affected suite has not run because the same worktree contains unrelated
  pending workspace and platform edits.
- Local `master` is now 128 commits ahead and 7 behind `origin/master`, with
  unrelated dirty status entries from other in-progress work. Do not push or merge the
  remote tip until those changes are reconciled and the exact outgoing commit
  set has been reviewed.

- `311791fed` adds the standalone Wayland GLArea spike, OS-level captures, and
  its initial qualified audit.
- `9bd42310c` adds window-only crops and text copies of the run logs, updates
  ADR-0244 and the native-render guide with the measured outcome, and records
  the implementation checkpoints here.
- `233b98964` fixes the spike's `--interactive` status message. The isolated
  crate passes `cargo fmt --check`, `cargo check --locked`, and
  `cargo build --locked`; a launch prints the real-pointer instruction and
  creates a GL 4.6 context. The running desktop automation surface did not
  expose a native window target, so no manual pointer click was performed.
- The committed Wayland/XWayland captures were inspected at window scale. They
  show native pixels through transparent WebView regions and HTML chrome above
  the GL area. One capture also shows the documented color-phase mismatch
  under partial damage. This is compositing evidence for the standalone spike,
  not an editor-frame or Tauri integration result.
- `pnpm verify:affected --since 0024e633b` passes its scoped plan: touched-file
  format/lint were skipped because no Biome-compatible files changed;
  `audit:emoji` and `audit:docs` passed (1168 docs, 854 links, 182 ADRs).
  `pnpm verify:commit` also passed for both scoped commits. The broader dirty
  worktree planner still reports a full-suite escalation from other staged or
  uncommitted workspace/toolchain and validation-infrastructure changes; those
  were kept out of these commits.
- The marketing copy cross-check found no false native-presenter or threaded
  WASM claim, so the website was not changed. Recheck if a product capability
  later passes its runtime and visual acceptance gate.
- `just wasm-build-threads` completed against the current uncommitted threaded
  scaffold on 2026-10-17. It emitted separate JS glue, a Rayon worker helper,
  and a shared-memory WASM binary; no browser worker was started and no trace
  call was run. The generated files are ignored build output, not committed
  product assets. Review of the generated worker helper found its relative
  module URL is incompatible with the current `wasmLoader.ts` blob import,
  which fetches generated glue text and imports it from a `blob:` URL.
- A scoped review of the pinned `tauri-runtime-wry` 2.12.1 source found the
  #1808 failed-downcast abort is gone (`downcast(...).ok()?`), while the fixed
  parent depth can still disable undecorated resize handling after
  reparenting. The spike ledger was corrected in commit `8b8afd33f`.

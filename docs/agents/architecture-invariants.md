# Architecture Invariants

Durable architecture constraints, hard rules, trust boundaries, lifecycle, and
decision pointers split out of the root `AGENTS.md` on 2026-10-28. Load this
file before changing architecture, lifecycle, or cross-package boundaries.

## Architecture constraints (do not violate)

Every rule below was discovered through root-cause investigation of real regressions.
Adding new violations will silently break tests and block CI.

### No circular `workspace:*` dependency chains

A package must never import from another package that transitively imports back to it.
TypeScript + Vite module resolution will either fail outright or produce non-deterministic
builds depending on evaluation order. To break a cycle, move the shared code into the
dependent package itself (or into `@varve/shared` if it belongs to no single owner).

### Sub-context `onReady` pattern (Session 44+)

`EditorProvider` in `context.tsx` composes sub-contexts (`MotionProvider`, `PrototypeProvider`,
`ViewportProvider`) as nested JSX children. A sub-context's hooks MUST NOT be called at the
`EditorProvider` function body level because the provider wrappers haven't mounted yet.
Instead, the sub-context accepts an `onReady` callback prop that reports its value back to
`EditorProvider` via `useState`. **New sub-contexts MUST follow this pattern** — see
`MotionProvider.onReady` in `MotionContext.tsx` and its usage inside `EditorProvider`
in `context.tsx`.

### ActionRegistry overwrite order

`Shell.tsx` calls `registerEditorActions(editor, callbacks)` BEFORE
`registerAllShortcuts(() => null)`. This ordering is required because `registerAllShortcuts`
pre-populates the registry with no-op stubs — if it runs first, the `r.has(id)` guard in
`registerEditorActions` silently skips registering real handlers. Any new registration path
must respect this priority: real handlers first, no-op stubs second.

### Module instability ceiling (Session 48+)

Hub files (Shell, CanvasArea) are inherently unstable. Every new import added to
them drags the whole module graph. Follow these rules:

1. **Hub files must not import leaf modules directly.** Before adding another import,
   ask: can the integration live in a thin adapter module?
2. **Prefer dependency injection over direct imports in hub files.**
3. **New hub files must target I < 0.85.**

| File | Imports (baseline / live 2026-08-22) | Instability (I) | Status |
|------|--------------------------------------|-----------------|--------|
| `CanvasArea.tsx` | 34 / 35 | ~0.90 | **Improved (was 82)** — drawContent/buildToolCtx/tool-sync extracted; must not increase |
| `Shell.tsx` | 56 / 56 | ~0.89 | **Over budget** — must not increase |
| `Menubar.tsx` | 17 / 18 | ~1.0 | At risk |
| `context.tsx` | 73 / 76 | ~0.48 | Healthy instability, but live count is exactly at `max_imports` (76) — one more import fails the pre-commit health gate |

Import counts are measured by `scripts/audit-health.mjs` against
`.health-baseline.json` (snapshot 2026-07-27; the "baseline" column above
mirrors it). Instability values come from madge via
`scripts/audit-architecture.mjs` at run time and are never persisted
(refresh with `--update` after intentional changes). Live import counts move
with everyday merges — when this table and the baseline disagree with a fresh
`node scripts/audit-health.mjs` run, believe the audit.

**No new import may be added to CanvasArea.tsx or Shell.tsx without first removing
an existing import of equal or greater weight.** Enforced by `scripts/audit-health.mjs`.

### Cyclomatic complexity ceiling — ENFORCED

| Context | Ceiling | Warning at | Block at |
|---------|---------|------------|----------|
| React component body | **200** | 160 (80%) | 200 |
| Non-component function | **50** | 40 (80%) | 50 |
| Tool handler (onPointerDown, etc.) | **30** | 24 (80%) | 30 |
| Test assertion body | **15** | 12 (80%) | 15 |

**70% rule:** When a function reaches 70% of its ceiling, any new
functionality MUST be extracted into a new function/module — not added
to the existing function. This is checked in pre-commit.

**Ceiling is a hard block, not a suggestion.** Pre-commit rejects
commits that increase complexity of any function already at or over its
ceiling. The only allowed operation on over-ceiling functions is
extraction (reducing their complexity).

**Over-ceiling files must have a `// COMPLEXITY:` comment** at the top
of the file with current complexity and a plan to reduce it. Without it,
pre-commit blocks any change to that file.

### Hook ordering invariance

React hooks must be called in the same order on every render. When extracting code
from `EditorProvider`:
1. Identify all hook dependencies
2. Create the hook function in `context/useX.ts`
3. Place the hook call AFTER all hooks it depends on and BEFORE the `value` useMemo
4. Add hook return values to the `value` useMemo dependency array
5. **Never split a hook call across conditionals, loops, or early returns**

See `context/usePersistence.ts` and `context/useBackgroundRemoval.ts` for the pattern.

### Never show pixels no fresh frame will replace

Partial (dirty-rect) redraw, the camera-only worker-bitmap fast path, and
`paintedSurfaceRef` all put previously-painted pixels on screen. Each is a
**loan against an authoritative frame that is on its way**. The moment the
pipeline knows no fresh frame is coming for the current state, it must fall
back to the main-thread replay (`compositorRef.current.drawVectorItems(ir)`),
which is always correct.

Concretely, every reason the render worker might decline a frame must be
decidable **synchronously**, before the frame picks its branch — that is what
`admitWorkerImagePayload` exists for. An async refusal (a `.then()` that
returns early) lands after the surface has already been painted, so the frame
composites the previous bitmap and, with nothing new ever posted, the canvas
freezes on it and merely reprojects it on every camera move. That is what made
a 13-image document render one image after fit-all and smear during scroll
(fixed 2026-08-11).

Do not treat partial redraw as the general answer to "the canvas is slow", and
do not assume it is the only thing that can put wrong pixels on screen — its
own guards (`surfaceMatchesBackingStore`, byte-exact camera equality) were
sound and were not the cause.

When touching any pixel-reuse logic, run the oracle instead of eyeballing it:
hash the surface after the interaction, call `window.__varvePerf.forceFullRedraw()`
at the same camera, hash again. Equal hashes mean the screen matches what a
full redraw would have produced. Frame-rate and handler-time metrics cannot
detect this class of bug. Background: `docs/architecture/render-pipeline.md`
→ "Reuse of already-painted pixels".

### Screen-space vs world-space thresholds

Anything compared against `clientX/Y` deltas is in CSS pixels and must not be
scaled by zoom — it models the user's hand, which does not rescale with the
camera. `BaseTool`'s drag threshold was `3 / zoom`, which demanded 50 CSS px of
travel at 6% zoom and fired on 0.19 px of jitter at 1600% (fixed 2026-08-11).
Use `worldDistanceForCssPixels` only where the result is compared against a
world-space delta.

Likewise, any overlay that draws over the artwork (SelectionOverlay, guides,
warp handles) must use the same camera transform as the renderer —
`screenToWorld` / `worldToScreen`, not the rotation-blind `simpleScreenToWorld`
/ `simpleWorldToScreen`. Those agree at rotation 0, so a mismatch stays
invisible until the view is rotated.

### The clean version is not always the fast version (render/replay hot path)

Varve is a design app — frame time beats complexity score. `renderPipeline.ts`'s
`replaySubtreeToCtx` (moved out of `CanvasArea.tsx` in the 2026-08-10 extraction;
and any function like it: a big `switch` over node/primitive
kind, called once per node per frame) is a classic case where the "obvious"
refactor — replacing the switch with a dispatch table or visitor pattern keyed by
`node.kind` — can make the hot path **slower**, not faster. A monomorphic
`switch` on a small closed set of string/enum kinds gets good branch prediction
and is a strong inlining candidate for the JIT; a table of closures
(`{ rect: fn, ellipse: fn, ... }[kind]()`) produces a megamorphic call site the
JIT can't specialize, which can cost more than the readability win is worth in a
loop that runs per-node-per-frame.

**Rule:** any structural change to `replaySubtreeToCtx`, `replayIr`, or an
equivalent per-node/per-frame dispatch function must be benchmarked before merge
(see the performance harness under `docs/quality/` — benchmark at 100 / 1k / 10k
/ 50k nodes, full-frame and incremental-frame). If a change regresses frame time,
**the readability improvement does not justify it in this specific function** —
revert or find a version that's both faster and clearer, don't ship the
regression on the strength of the diff looking nicer. This applies whether the
change comes from a manual refactor or an automated one (e.g. Stryker-adjacent
cleanup tooling, codemods).

## Hard rules
- No emoji anywhere. SVG icons via Lucide `<Icon>` or Phosphor `<SolidIcon>` only.
- No hardcoded color/space/type values — trace to CSS custom properties.
- TS strict, no `any` (Biome enforces `noExplicitAny: error`).
- Rust `unsafe_code = deny` workspace-wide.
- Cross-platform: if it works on macOS but not Linux, it's not done.
- **No native `<select>` elements** — use `@varve/ui`'s custom `Select` component.
- **No raw `varve-btn` markup.** Actions go through `@varve/ui` `Button` /
  `IconButton` / `ToggleButton`; the variant/size vocabulary is closed
  (`ButtonVariantParity.test.ts`) and `tests/unit/button-system.test.ts` fails
  on hand-rolled `varve-btn` markup or undeclared modifiers. Website CTAs use
  `apps/website/src/components/Button.astro`, never raw anchors with `.btn-*`.
  Unavailable actions whose blocker is not obvious from the label use
  `disabledReason`. See `docs/architecture/button-action-system.md`.
- **No AI tool attribution in commit messages or author metadata.** Do not add
  `Co-authored-by:` trailers for Claude, Devin, Copilot, Codex, ChatGPT,
  Gemini, Cursor, Windsurf, or any other AI tool. Do not add "Generated with
  [Devin]", "Generated by Claude", or similar attribution signatures. All
  commits are authored by the maintainer. AI tool output is reviewed and
  committed as the maintainer's work — it is not a separate legal
  contribution. A commit-msg hook (`.githooks/commit-msg`) enforces this.
  Do not disable it.

## Trust boundaries (do not violate)

Source sharing is not trust sharing. Canonical doc:
`docs/security/trust-boundaries.md`. Machine-enforced by
`scripts/security/validate-client-env.mjs` (client builds fail closed on
private credential classes), `scripts/secret-scan.mjs --dir/--canary` (built
artifacts are scanned, canary asserts no env leakage), the
`scripts/security/workflow-policy.mjs` deny-lists (backend/DNS credentials in
NO workflow; signing secrets only in release.yml gated on signed mode;
`VARVE_SIGNING_STEP_ALLOWED` only in release.yml), and
`scripts/security/import-boundaries.mjs` (apps never import each other;
packages never import apps; the future `apps/api` is unreachable from
clients). Run them with `pnpm audit:secrets`, `pnpm audit:clientenv`,
`pnpm audit:artifacts`, `pnpm audit:boundaries`; the regression tests run in
`pnpm test:ci:tools` and in ci.yml `pipeline-validate`.

Rules that must not be violated:
- Website and desktop builds consume only the documented client-safe
  allowlist (see trust-boundaries.md §5); never add a private credential
  class to a client build's environment.
- Never reference signing, backend, DNS, or updater-private credentials from
  any workflow other than the release pipeline paths the policy allowlists.
- No client app may import another app or the future backend; shared code
  lives in `packages/` only.
- GitHub Secrets never enter client artifacts; if a value must reach the
  artifact, it is public configuration by definition.

## Lifecycle System

Canonical doc: `docs/architecture/lifecycle-system.md`, ADR-0216.

- **One coordinator**: every graceful termination request converges on
  `TerminationCoordinator` (`packages/editor/src/lifecycle/`). No
  presentation component, native menu item, shortcut, OS event, or browser
  lifecycle event may independently decide that user data can be destroyed.
- **Intents are explicit**: `close-document` / `close-window` /
  `quit-application` / `reload` / `restart`. Back-to-Home never closes
  documents (Resume Editing keeps them mounted); quitting inspects ALL
  sessions, hidden or Home-hidden.
- **Native interception is authoritative on desktop**: Rust prevents
  `CloseRequested`/`ExitRequested` (main window only), asks the webview;
  one-shot per-window tokens in `LifecycleGuard` prevent recursion.
  Auxiliary windows close freely (ADR-0211 D1). macOS close-window keeps
  the app running; Linux/Windows last-window close exits.
- **Do NOT call `getCurrentWindow().close()` from UI code** for
  user-visible close operations — use `requestCloseWindow()`
  (`apps/desktop/src/lifecycle/requestCloseWindow.ts`) or the coordinator.
- **Dirty authority**: `state.sessions[]` per-session `dirty`. The save
  plan is revision-safe (a stale save never marks newer edits clean) and
  Save-As cancellation aborts the transaction — never "discard".
- **Clean marker** (`strata-clean-shutdown`) is written ONLY after
  finalization; a crash mid-quit stays unclean. Intentional discard deletes
  the tab's recovery points at commit (`deleteRecoveryForTab`).
- **Web**: beforeunload warns only when genuinely unsaved; pagehide/
  visibilitychange flush best-effort; never `await save()` in unload.
- **New termination entry points must flow through the coordinator**
  (request → guard → resolve → commit → native/browser terminate).

## Architecture decisions
- **ADR-0001** — native engine renders by IR-replay (not pixel-push). Rust computes
  scene, emits compact IR (~42 KB/frame for 600 shapes); webview replays to canvas2D.
- **ADR-0002** — teal accent, 12-step neutral+teal ramps, Light/Dark/High-Contrast themes.
- **ADR-0003** — Canvas2D default, WebGPU opt-in with fallback.
- **ADR-0004** — varve-bridge + varve-wasm for shared IPC/WASM IR.
- **ADR-0005** — Offline-first ONNX: bundled models manifest, remote download explicit only.
- **ADR-0237** — Native `wgpu` compute (effects/resampling) with truthful accelerator capability stages (discovered → runtime-loadable → device-usable → execution-verified); inference stays CPU until a provider artifact ships; no NPU claims.

## Session history

Detailed per-session development records have been moved to
[docs/agents/session-history.md](session-history.md).

For new contributors and maintainers, see:
- [docs/development/setup.md](../development/setup.md) — development setup
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — contribution guidelines
- [README.md](../../README.md) — project overview and architecture
- [docs/agents/README.md](README.md) — AI-assisted development practices

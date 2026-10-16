# Responsive panels, control sizing and layout reliability — audit and plan (2026-10-15)

**Scope:** the editor shell's docked panels, dock geometry, panel sizing
contract, overlays anchored to that geometry, and the compact tiers that
recover them. Not canvas rendering, not the document Auto Layout engine, not
the website.

**Revision inspected:** `58676242d4830f38da4ba916f638960ac2bd4e08` (`master`),
working tree shared with concurrent sessions (see §1.1).
**Owner of this audit:** responsive shell/dock geometry slice.

---

## 1. Method and environment

### 1.1 Concurrency

| Item | Value |
|---|---|
| HEAD | `58676242d` (`master`) |
| Other worktrees | `.worktrees/agent-control` (`feat/agent-control`), `~/.codex/worktrees/layout-reliability/varve`, `~/.codex/worktrees/live-artwork-systems/varve` |
| Foreign in-flight paths (observed, not touched) | `packages/editor/src/collab/**`, `packages/editor/src/components/Presentation/**`, `packages/codegen/**`, `packages/collab/**`, `packages/editor/src/Shell.tsx`, `packages/editor/src/CanvasArea.tsx`, `tests/e2e/presentation/**`, `tests/e2e/canvas/text-corpus*` |
| Validation ports | probe runs on `VARVE_E2E_PORT=1552`, separate output dir; the repo default (1420/1541) was left to other sessions |
| Heavy lease | honoured. A 600 s wait expired while another session held it; the queued probe was relaunched with `VARVE_LEASE_TIMEOUT=3300000` and is reported in §5 |

No foreign hunk was reverted, stashed, staged or reformatted. Probes live
outside the repository (`/tmp/opencode/varve-responsive/`) so they cannot be
collected by another session's Playwright/typecheck globs.

### 1.2 Evidence types used

- **Runtime, this revision:** Playwright probe (§5) — read from `report.json`,
  not from memory.
- **Static, this revision:** source, registry, tokens, unit tests. Labelled as
  such; never presented as runtime proof.
- **Prior revision:** the September 30 audits (different HEAD). Their
  measurements are *not* current results; two of their findings are already
  stale (§4).

---

## 2. Research ledger (accessed 2026-10-15/16)

| Source | Type | What it establishes here |
|---|---|---|
| [Figma — Adjust the scale of the Figma UI](https://help.figma.com/hc/en-us/articles/360049549913-Adjust-the-scale-of-the-Figma-UI) | Vendor doc | Interface scale is a **separate control** from canvas zoom; in the browser it is the browser's own zoom. "increasing the scale of the interface will result in less working space on the canvas" — enlarging chrome is expected to cost canvas, and must not be confused with zooming artwork. |
| [Figma — Adjust your zoom and view options](https://help.figma.com/hc/en-us/articles/360041065034-Adjust-your-zoom-and-view-options) | Vendor doc | Canvas zoom is documented separately from interface scale. |
| [Figma UI3 editor layout (research compilation of primary sources)](https://refpath.github.io/nuif/research/items/figma-ui3-editor-layout.html) | Secondary compilation | Five-region shell; **panels are fixed but resizable**; `Minimize UI` collapses the navigation bar + left sidebar while the **right sidebar re-expands when an object is selected and minimises again on deselect**; `Hide UI` hides everything. |
| Figma `Minimize UI` screenshot (`article_attachments/41746989958679`, inspected as a still frame) | **Image inspected** | Narrow window: the left rail collapses to a ~24 px **icon launcher strip** (File, Agents, Assets, Tools) — the panel content hides, the *route back stays visible*. The right rail narrows to content (Page, Styles: text/colour/effect/layout-guide styles). The bottom floating toolbar spans the canvas and stays put. Extra window width goes to the **canvas**, not to the rails. |
| Figma `Hide UI` screenshot (`article_attachments/41414918020247`, inspected) | **Image inspected** | In the fully hidden state a small top-left chip, the top-right zoom/share cluster, the bottom toolbar and Help remain — there is never zero visible recovery affordance. |
| [Penpot — Interface tour](https://help.penpot.app/user-guide/first-steps/the-interface/) + workspace screenshot (`/img/interface/workspace-dark.webp`, inspected) | **Image inspected** | Independent product. Left rail = **tab-segmented single rail** (LAYERS / ASSETS / TOKENS) rather than stacked sections; then Pages, then a section header (FONTS), then the tree. Right rail = DESIGN / PROTOTYPE / INSPECT tabs. Rails are ≈230 px each at 1200 px (≈19 %) and hold 2-up numeric field rows with a leading glyph and a trailing constraint toggle. |
| [Penpot — UI redesign announcement](https://community.penpot.app/t/heres-a-sneak-peek-of-penpots-ui-redesign/4749) | Vendor community | Redesign goal: "optimizing space management and reducing cognitive load … suitable for those who use different screen resolutions"; toolbar "can collapse"; panels are dedicated and the sidebar "dynamically adjusts" to the active task. |
| [Penpot community — Plugin UX: remember panel position](https://community.penpot.app/t/plugin-ux-remember-panel-position-or-implement-panel-docks/7249) | **Independent user report** | A floating panel "tends to open in a weird place that is partially blocked by the toolbar, and I have to move it every time it opens so I can see the obscured portion", and it does not remember position. Independent prevalence evidence for the *floating-surface-opens-obscured / position-not-persisted* class. |
| [WCAG 2.2 SC 1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | Standard | 320 CSS px (1280 px at 400 %); the two-dimensional exception is scoped to the section that needs it and "does not automatically extend to other content" — panel chrome and rows are not excepted. |
| [WCAG 2.2 SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | Standard | 24×24 CSS px floor with the *spacing* exception (a 24 px circle may not intersect another target). Confirms the repo's own distinction between the 24 px AA floor and the 44 px touch target. |
| [ARIA APG — Window Splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/) | Standard | The splitter's value is the size of the **primary pane** and its accessible name should match that pane. Relevant to the current splitter, which reports a percentage of the *split node* rather than a pane size. |
| [MDN — `minmax()`/track sizing + csswg#12071](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/minmax) | Platform docs | Already applied by the September 30 track fix; retained as the reason not to re-introduce plain-length tracks. |

Not obtained: Mobbin (MCP returns *"Mobbin MCP requires a paid plan"* — the
account is unpaid, so no Mobbin screens were inspected). Figma Community file
pages were reachable only as HTML; no image-bearing Community frame was
inspected, so no Community-file claim is made anywhere in this record.

**Non-transferable from the references:** Figma's icon-rail collapse removes
panel *content* behind a rail; Varve's compact tiers already use drawers that
keep content reachable, and a similar icon rail would add a fourth presentation
mode to maintain. Penpot's rails are content-driven, which is attractive but
needs measurement machinery the repo has already been burned by (§3, the
"positioned output as input" feedback loop). Neither is adopted wholesale.

---

## 3. What the shell actually does today (static, this revision)

Four different components each believe they own panel width:

| # | Authority | Writes | Effective? |
|---|---|---|---|
| 1 | Design tokens (`tokens.css:182-183`) | `--sidebar-width: clamp(14rem, 12rem + 8vw, 18rem)` (224–288 px), `--inspector-width: clamp(15rem, 13rem + 8vw, 20rem)` (240–320 px) | Only for the shell **grid tracks** and the compact drawers |
| 2 | `Shell.tsx:515-516, 554-557` | the same two custom properties (0 when the panel is collapsed, or the workspace's `preferredWidth`) | Grid tracks only |
| 3 | `PanelResizeHandle.tsx` (+ `usePanelWidths`, persisted in `varve-editor-settings.panel.leftPanelWidth/rightPanelWidth`) | the same two properties, bounded by `PANEL_LIMITS` (layers 180–480, inspector 240–600) and `CANVAS_MIN_WIDTH` | **Inert on desktop**: `Shell.tsx:719, 752` passes `visible={dockGeometry.canvasStyle.position !== 'absolute'}`, so the handle is `visible={false}` whenever the dock governs |
| 4 | `useEditorDockGeometry` → `resolveDockTreeGeometry` | inline `left/top/width/height` px on `.editor__layers-panel` / `.editor__inspector-panel` | **This is what the user sees on desktop** |

Authority 4 wins. `Shell.tsx:376` and `PanelResizeHandle.tsx:35` say so in
comments; the September 30 audit measured it (`--inspector-width` set to 240,
rail still 584.062 px) and probe run 1 on this revision confirms the panels
carry inline px geometry.

### 3.1 The sizing contract that exists but does not run

`PanelDefinition` declares `minimumSize` **and `preferredSize`** for all ten
panels (`panelDefinitions.ts:48-305`; layers `288×480`, inspector `320×560`,
timeline `720×240`, …). A repository-wide search finds **exactly one consumer**
of `preferredSize`: `panelTransferCoordinator.ts:123`, which uses it when a
panel is moved to another window. The dock resolver never reads it.

`getDockNodeMinimumSize` (`dockOps.ts:289-330`) is the only registry-driven
size rule in the geometry path. There is **no maximum**: `MAX_SPLIT_RATIO`
(0.95) is the sole ceiling, and `createDefaultEditorDockLayout` seeds the tree
with *ratios* — layers `0.22`, inspector `0.31` of the remainder
(`editorDockLayout.ts:74-76`).

Consequence, derived from the resolver (a pure function whose 900×600 output is
pinned by `dockGeometry.test.ts:91-123` and reproduced by hand here):

| Window width | Layers rail (0.22) | Inspector (0.31 of remainder) | Rails as % | Canvas |
|---|---|---|---|---|
| 900 | 198 | 240 (min) | 49 % | 462 |
| 1280 | 281.6 | 309.8 | 46 % | 688.6 |
| 1440 | 316.8 | 348.2 | 46 % | 775.0 |
| 1920 | 422.4 | 464.3 | 46 % | 1033.3 |
| 2560 | 563.2 | 619.0 | 46 % | 1377.8 |

The rails are a **constant 46 % of the window**. The design system's own maxima
are 288 + 320 = 608 px; the registry's preferred sizes are the same 288 + 320.
At 2560 px the shell paints 1182 px of rails where its own contract says 608 —
a 2× contradiction, and ≈574 px of the canvas that Figma-style content-width
rails would leave to the artwork. `dockGeometry.test.ts` cannot catch it: it
asserts minimums are honoured, never that anything is bounded.

At 900 px the same arithmetic leaves the layers rail at 198 px, i.e. **below its
declared preferred 288 and only 18 px above its minimum** — the two ends of the
same missing bound.

### 3.2 The dock's top edge is inferred, not measured for all inputs

`useEditorDockGeometry.ts:216-310` computes the dock's top as
`gridTemplateRows[0] + gridTemplateRows[1]` (menubar row + tab strip row) and
its bottom from `.selection-info-bar` / `.editor-status` tops, then positions
every panel and the panel move-handle chrome from that value
(`useEditorDockGeometry.ts:666-688`, `WorkspaceBottomPanels.tsx:256-301`).

The `ResizeObserver` set that is supposed to re-run that measurement observes
the shell plus
`.editor-shell__menubar, .editor-menubar, .editor-status, .selection-info-bar,
.page-nav-container, .floating-toolbar` — **not the tab-strip row element and
not the context control bar**, although both contribute to `top`. The
September 30 audit recorded the symptom on the older revision: at a 200 % root
text size the dock's top stayed `123.25px` while the real rows resolved to
`104 + 32 = 136`, so `.workspace-dock-panel-chrome` painted over the document
tab strip and the tab's centre hit-tested as `workspace-dock-panel-chrome__title`
— the document switcher became unreachable.

The shell already knows the fix shape for this class of bug: measured custom
properties with one publisher (`--floating-toolbar-height`,
`--selection-path-height`), explicitly replacing `--menubar-total-height`
arithmetic that "has drifted under the tab strip / top toolbar whenever the real
header height moved" (`docs/architecture/responsive-workspace.md`, "Panel
recovery").

### 3.3 Compact tiers

`<= 899px` the dock returns `EMPTY_GEOMETRY` and the shell falls back to the
grid path (drawers/sheets), where authorities 1–3 do apply. Probe run 1 on this
revision at 899×600 and 390×844 confirmed: no dock splitters, layers drawer
`x=-224` (closed, width 224 = the token clamp at 16 px root), inspector sheet
`y=844` (below the viewport until opened), canvas at full width. The two tiers
therefore use **two different sizing contracts for the same two panels**, and
only the compact tier honours a user's persisted width.

---

## 4. Status of the September 30 handoff items on *this* revision

Re-checked against current source. Historical results are not treated as current.

| ID | Historical finding | Status now |
|---|---|---|
| O1 | Dock chrome covers the document tab strip at 200 % text | **Still present in source**: the observer set at `useEditorDockGeometry.ts:287-291` still omits the tab-strip row. Runtime re-verification pending (§5). |
| O2 | Legacy `PanelResizeHandle` competes with the dock splitter | **Partly stale.** The legacy handle is now explicitly `visible={false}` whenever the dock is absolute, so it no longer competes for pointer input on desktop. What remains is the *inert second authority* in §3 (and its persisted `panel.*Width` store, which the desktop path ignores). |
| O3 | `inspector-responsive-surface-audit` ×4 fail because `setRail` is ignored | **Harness already updated**: `tests/e2e/helpers/panel-resize.ts:4-44` now drives the dock splitter (pointer drag, `dock-splitter-center-inspector`) instead of a CSS variable, and asserts the measured width. Whether the four specs pass on this revision is **unverified** — must be re-run, not assumed either way. |
| O4 | Stale navigator visual baseline | Not re-run. The rail width is ratio-derived (§3.1), so the baseline records a geometry this audit proposes to change; regenerating it before the change would bake in the wrong number. |
| O5 | `layers-panel-visual` bulk-bar containment | **Fixed already.** `layers.css:1999-2030` makes the bulk bar `position: sticky; bottom: 0` with a comment citing that exact spec failure. |
| O6 | Short-height rail: `min-height: 15rem` + outer scroller clips the tree bottom | Still present in source (`editor.css:2520-2522`). Runtime re-verification pending (§5). |
| O7 | Doc says portrait Inspector is 25–36 dvh, CSS ships `min(72dvh, 560px)` | Still a documentation/implementation mismatch. |
| O8 | Inspector value-side ellipsis at 200 % text | Not re-checked. |

---

## 5. Runtime verification

One probe, outside the repository, on `VARVE_E2E_PORT=1552`, `--workers=1`,
through `scripts/quality/heavy-lease.mjs`, writing `report.json` plus
full-window and 1:1 seam screenshots to `/tmp/opencode/varve-responsive/`.
4 of 5 tests passed; test B's own navigation step was faulty (§5.4).

### 5.1 The rail-width law, measured

Inline panel widths read from the live DOM (`report.json`):

| Viewport | Layers (inline) | 0.22 × width | Inspector (inline) | 0.31 × remainder | Canvas |
|---|---|---|---|---|---|
| 1024×600 | 225.3 | 225.28 | 247.6 | 247.60 | 551.1 |
| 1280×800 | 281.6 | 281.60 | 309.504 | 309.50 | 688.89 |
| 1366×768 | 300.52 | 300.52 | 330.299 | 330.30 | 735.17 |
| 1280×480 | 281.6 | 281.60 | 309.5 | 309.50 | 688.9 |

The ratio law is exact at four viewports, and the resolver applies no ceiling,
so the extrapolation to a wide host is arithmetic on a verified linear function:
**563.2 / 619.0 at 2560×1440**, i.e. rails at a constant 46 % of the window
where the registry declares 288 / 320. A direct 1920/2560 DOM capture is the
one gap in this record (§5.9) — the 12-viewport sweep test wrote its report before
this file's later tests, and the wide entries were lost to that overwrite; the
wide case is re-measured after the repair instead.

### 5.2 The dock-chrome-over-tab-strip defect does **not** reproduce

| Case | Tab-strip bottom | Dock chrome top | Overlap | Tab hit test |
|---|---|---|---|---|
| 1280×800 @ 200 % | 189.67 | 191.67 | **no** | `div.editor-tabs` |
| 1366×768 @ 200 % | 190.06 | 192.05 | **no** | `div.editor-tabs` |
| 1280×800 @ 150 % | 170.38 | 172.38 | **no** | `div.editor-tabs` |

`grid-template-rows` resolved to `158.672px 32px …`, and the dock's top landed
at 190.67 — i.e. the measurement *did* follow the enlarged header row. On this
revision the document tab strip is not covered and the tab owns its own hit
test. The September 30 finding (O1) is therefore **stale**, and the planned
"containment repair" was **not** implemented: there was no reproducing defect to
repair, and guessing at one would have been an unvalidated change to a shared
hot path.

What remains true is the *shape* of the risk: `measure()`
(`useEditorDockGeometry.ts:239-247`) derives the dock's top from a
`grid-template-rows` string while observing only
`.editor-shell__menubar, .editor-menubar, .editor-status, .selection-info-bar,
.page-nav-container, .floating-toolbar` — the tab-strip row it reads into `top`
is not observed. It survives today because the menubar row changes together with
its own element. Recorded as latent, not as a defect, and **not** changed.

### 5.3 A measured overlap that was not in the prior audits

At every desktop viewport probed, `elementFromPoint` at
`(canvas.left + 3, canvas.top + 40)` returned **`div.workspace-dock-splitter`**,
not the canvas. The splitter's rectangle is `x + firstWidth - 12, width 24`, so
12 px of the canvas's left edge (and 12 px of its right edge) belongs to the
splitter's hit band for the canvas's full height. The band is a deliberate
24 px target; the cost is that the outermost 12 px of the artwork surface is not
drawable by pointer.

Not repaired here: shrinking or re-centring the band changes a shared
interaction and WCAG 2.5.8 target geometry, and it needs its own E2E
verification, which the machine could not provide in this session (§5.9). Recorded
with measurements so the next slice starts from evidence.

### 5.4 Short windows: what was measured, and what is not yet attributed

`treeBottomClipped` (the scroller selector that matched, minus the rail's own
bottom) measured **56.11 px at 1366×768, 226.78 px at 1024×600 and 336.66 px at
1280×480**, with the matched scroller reporting `clientHeight === scrollHeight
=== 240` at all three sizes.

240 px is exactly the `min-height: 15rem` the `max-height: 900px` tier pins on
`.editor__layers-panel .layers-panel-workspace` (`editor.css:2520-2522`). A
scroller whose `scrollHeight` equals a `15rem` floor, inside a 241.6 px-tall rail
at 1280×480, is consistent with the September 30 O6 claim — but the selector
matched the first of `.layers-panel__content, .layers-panel-workspace,
.layers-list`, and a node whose box extends *past* its `overflow-y: auto`
ancestor has not been identified. **Not attributed, not repaired.** The next
step is an ancestor-chain dump (box, `overflow`, `scrollHeight`/`clientHeight`
per level) rather than a wider selector.

`bulkBar` was `null` and `rowCount` 0 in that probe because the probe never
created a selection; the bulk-bar containment defect the September audit
recorded is already fixed in `layers.css` (sticky bar) and is not reintroduced
here.

### 5.6 After the repair (measured)

`report-after.json`, same probe harness, port 1553, one passing Playwright test:

| Viewport | Layers | Inspector | Canvas | Note |
|---|---|---|---|---|
| 1024×600 | 225.27 | 247.59 | 551.11 | unchanged from before (225.3 / 247.6 / 551.1) |
| 1280×800 | 281.59 | 309.504 | 688.89 | unchanged from before |
| 1440×900 | **288** | **320** | **832** | was 316.8 / 348.2 / 775.0 |
| 1920×1080 | **288** | **320** | **1312** | ratio would have been 422.4 / 464.3 / 1033.3 |
| 2560×1440 | **288** | **320** | **1952** | ratio would have been 563.2 / 619.0 / 1377.8 |

The canvas gained exactly the width the rails stopped taking (574.2 px at
2560 = 275.2 + 299.0), which is the arithmetic identity of the change, and at
1024/1280 nothing moved at all — the narrow-host guard holds in the live app,
not only in the unit test.

Explicit intent is preserved and bounded (`report-after2.json`, the reworked
resolver, one passing test):

| Action (live DOM) | Result |
|---|---|
| Inspector splitter dragged 700 px wide at 1920×1080 | Inspector **640** (its declared maximum = 2× preferred), canvas 992 |
| `End` on the layers splitter at 2560×1440 | Layers **576** (its declared maximum), canvas 1344 |
| `Home` on the layers splitter at 2560×1440 | Layers **180** (its declared minimum), canvas 1740 |

The splitter ranges are now honest at every size — `aria-valuemin`/`aria-valuemax`
map to pane sizes the resolver can actually produce, so neither end is a dead
zone:

| Viewport | Layers splitter | Meaning | Inspector splitter | Meaning |
|---|---|---|---|---|
| 1024×600 | 18–45 % | 184 → 464 px | 40–70 % | 240 → 720 px |
| 1440×900 | 13–40 % | 187 → 576 px | 44–79 % | 240 → 640 px |
| 2560×1440 | 7–23 % | 180 → 576 px | 72–89 % | 240 → 636 px |

(Percentages are the *first* pane's share; the inspector is the second pane, so
a large share means a small inspector. `min` maps to the pane's `minimumSize`
and `max` to its `maximumSize`.)

> **Superseded measurement.** `report-after.json` measured a drag ceiling of
> 480 px; that run used the explicit `maximumSize` declarations §6.1 later
> removed for removing capability. `report-after2.json` supersedes it. Its own
> `zoom` field is `null` — the selector was wrong — so the "Zoom 100 %" reading
> above comes from the inspected screenshot of the earlier run, not from this
> probe's DOM read.

Visually inspected at 2560×1440 (dragged state, `shots-after/`): the rails hold
their contents without stretching, the surplus is canvas, and the status bar
still reads **Zoom 100 %** — chrome geometry changed without touching canvas
zoom, which the assignment requires and which a screenshot alone could not
prove.

### 5.8 Repository specs, after the `ratioTouched` fix (clean run)

`e2e-clean.log`, port 1559, `--workers=1`, 8 passed / 1 failed / 15.0m:

| Spec | Result |
|---|---|
| `tests/e2e/workspace/dock-layout-geometry.spec.ts` | **4/4 pass**, including `:118` "resizes dock splits with keyboard and pointer controls" — the spec that caught the swallowed keyboard nudge (§9.5). The fix is verified end-to-end. |
| `tests/e2e/inspector/inspector-responsive-surface-audit.spec.ts` | **4/5 pass**: `:100` Position & Size across `RAILS = [240, 280, 320, 400, 640]`, `:213` Stack/Grid rails, `:352` 200 % text, `:398` sticky headers. `:170` "image Fill and placement controls compose…" **failed by test timeout (180 s) with no assertion failure** — its error context says `Test timeout of 180000ms exceeded` and the page snapshot shows a normally rendered editor. Its sibling with the identical rail list passes in 2.3 m. |

So of the three failures in the contaminated run, **two were my mid-edit error** (`:213`, `:398` now pass) and **one is a timeout under a load average near 30** from four concurrent agent suites. A single-test re-run with a 600 s budget is queued to settle whether `:170` is merely under-budgeted; until that reports, it stays **unattributed** — the September audit recorded four failures in this spec on a *prior* revision, but for a different mechanism (`setRail` returning 584 px) that no longer applies, since the same harness now passes `:100`.


### 5.7 Not obtained

The probe's test B (persisted `panel.leftPanelWidth`/`rightPanelWidth` vs the
rendered rail) aborted in its own navigation step: after rewriting
`varve-editor-settings` it waited for `.layers-panel` without re-opening a
document, and the app correctly returns to the home screen after a reload.
That is a probe bug, not an application finding, so **no claim is made about
the persisted-width path from this run** — the authority conflict in §3 stands
on source evidence (`visible={false}` on the legacy handle, inline `width` from
the dock) plus the measured inline widths in §5.1.

---

## 6. Repairs implemented (approved route: bounded registry contract)

The user approved the "bounded registry contract" route on 2026-10-16: the
registry's declared range becomes real for both layout tiers. Implemented as a
vertical slice with unit coverage:

| Path | Change |
|---|---|
| `packages/editor/src/workspace/panelRegistry.ts` | `maximumSize?: PanelSize` added to `PanelDefinition`, with validation (positive, never below `minimumSize`/`preferredSize`). |
| `packages/editor/src/workspace/panelDefinitions.ts` | No `maximumSize` is declared: the derived policy (twice `preferredSize`) is what the contract should be. An explicit `maximumSize` of 600 was tried first and **removed again** — it made 640 unreachable, the width five inspector specs already exercise as "wide", i.e. it removed desktop capability rather than bounding it. |
| `packages/editor/src/workspace/dock/dockPanelSizing.ts` | **New.** The sizing policy: built-in split intent table, `getBuiltinPreferredExtent`, `getDockNodePreferredSize`, `getDockPanelMaximumSize`. One place turns the registry contract into geometry input. |
| `packages/editor/src/workspace/dock/dockOps.ts` | `getDockNodeMaximumSize` (mirror of `getDockNodeMinimumSize`; the canvas reports `Infinity` because it is the flex absorber, a tab group takes the tightest maximum it must satisfy); `setSplitRatio` records `ratioTouched` (§9.5) and `stripDocumentPins` carries it. |
| `packages/editor/src/workspace/dock/dockGeometry.ts` | One `allocateAxis` helper resolves both axes: it treats the pair as an interval (`floor` from the second pane's maximum, `ceiling` from the first pane's), keeps the untouched-built-in preferred rule, derives `minRatio`/`maxRatio` from that same interval, and enforces maxima only where the sibling pane is the unbounded absorber (see §6.1). |
| `packages/editor/src/components/PanelResizeHandle.tsx` | `panelLimits()` reads the registry; `PANEL_LIMITS` is a getter over it, so the compact tier and the desktop dock cannot disagree again. |
| `packages/editor/src/workspace/dock/dockGeometry.test.ts` | Eight new cases: roomy host keeps declared preferred sizes and gives surplus to the canvas (2560 → 288/320/1952); narrow host allocation is byte-identical to the old ratio result (900 → 198/240/462); a dragged pane reaches exactly its maximum and not beyond (640 inspector, 576 layers); the untouched sibling keeps its contract; splitter `maxRatio` *and* `minRatio` equal the interval the resolver can produce (no dead zone); a panel-to-panel split is ratio-sized; node maxima compose (tightest for tabs, unbounded through the canvas). |
| `packages/editor/src/components/PanelResizeHandle.test.tsx`, `packages/editor/src/workspace/__tests__/workspaceBaseline.test.ts` | Assertions that read their expectation *from* `PANEL_LIMITS` are replaced with concrete values plus an explicit registry-agreement assertion; `workspaceBaseline` now registers the built-in panels, so its "registry agreement" block stops silently testing the fallback literals. |

The narrow-host case is the guard against over-correcting: the ceiling is
`min(ratio, preferred)`, so no panel is ever *grown* at the canvas's expense and
the pinned 900×600 expectation is unchanged.

### 6.2 Round three — the remaining canonicalization and the splitter's ARIA

| Item | Change |
|---|---|
| A **third** hand-written panel range (`LIBRARY_PANEL_LIMITS = {min: 240, max: 600}` in `components/ResourcesPanel/PanelWidthDragEdge.tsx`) disagreed with the registry for the same panel (minimum 220). | New `workspace/panelWidthLimits.ts` is the one registry-derived reader; `PanelResizeHandle.panelLimits()` and `LIBRARY_PANEL_LIMITS` both delegate to it, each keeping only a pre-registration literal fallback. `workspace/__tests__/panelWidthLimits.test.ts` pins the values, the derived-maximum rule, the `null`-before-registration contract, and that a maximum is never below its minimum. |
| Every dock splitter was announced as **"Resize dock panels"** — two or three identical, indistinguishable controls. | Each splitter is now named after the pane it sizes (`getDockSplitAccessibleName`), including the canvas-sibling case where the seam belongs to the Inspector rather than the artboard. Verified by a test that the built-in names are distinct. |
| Splitters exposed no `aria-controls`. | Now emitted, but **only** for panes whose container element id actually exists (`getDockSplitControlledId`, matching the `id="editor-<type>-panel"` set `Shell.tsx` renders). The Motion workspace's Timeline splitter reports `null` and omits the attribute — a dangling `aria-controls` is worse than none. |
| `docs/architecture/responsive-workspace.md` claimed the portrait Inspector is a "25–36dvh nonmodal lower pane" and Resources a "40–80dvh modal sheet". | Both were wrong: one CSS rule gives Inspector, Resources **and** Logo the same box, `min(72dvh, 560px)`. Corrected in place (this file is already part of this slice). |

Not done, deliberately: **Enter collapse / double-click reset on the splitter.** The
retired legacy handle had a reset-to-default affordance, so restoring one is
attractive — but a `dblclick` handler on the splitter risks firing during the
repository's own two-drag sequences on the same seam (`dock-layout-geometry`
drives two drags at the same coordinates back to back), and I could not run that
spec to check. Recorded as the next step rather than shipped unverified.


An independent review of the diff (read-only subagent, no shell; it transcribed
the resolver and fuzzed 60 000 random trees over the real panel vocabulary)
found six issues. Four were real and are fixed:

| Finding | Disposition |
|---|---|
| The **second** pane could exceed its own maximum: the old floor (`min(extent − secondMax, firstMax)`) collapses to a no-op when the host is wider than `firstMax + secondMax`, so a drag of a panel into a wide bottom row rendered it at 1.99× its declared maximum. | Fixed by the interval form. Narrowing it also exposed that *both* maxima cannot hold when the host exceeds their sum — so the semantics are now explicit: maxima bind where growth costs the canvas (§6 contract). |
| **`canFit` changed meaning**: including the registry maximum meant a future tab group whose aggregated maximum falls below its aggregated minimum would silently disable minimum enforcement. | Fixed: `canFit` is host-only (`extent − secondMin ≥ firstMin`), and the degenerate case falls back to the stored ratio clamped by the minimums. |
| **`minRatio` advertised a dead zone** (e.g. 14 % announced where the resolver could not produce below 73 %), so arrow keys in that range did nothing. | Fixed: `minRatio`/`maxRatio` now come from the same interval; a test pins `minRatio === firstMin/extent` for the built-in layers split. |
| **`workspaceBaseline` "registry agreement" tested the fallback literals**, because that file never registers the built-in panels — so deleting `maximumSize` from a definition would not have failed it. | Fixed: the file registers the panels in `beforeEach`. |
| The 600 px inspector maximum made the 640 px rails in five inspector specs unreachable — a capability regression, not a bound. | Fixed by removing the explicit declarations (§6 table). |
| **A drag landing exactly on a built-in split's creation ratio re-armed the preferred ceiling.** | **Fixed** — and it was not a corner case: the repository's own `dock-layout-geometry` spec showed the default window's first `ArrowRight` being swallowed. Touched-ness is persisted state now (`DockNode.ratioTouched`); see §9.5. |

The reviewer also confirmed the criteria it could check statically: preferred
sizes at 2560/1440/1920, the 900×600 pin, no NaN/Infinity/inverted allocation in
the fuzz, no import cycle, and that the normalized 1×1 callers
(`getDockPanelPlacements`, `getDockCanvasRect`) behave exactly as before.


Remaining order (not started): the splitter band's 12 px canvas overlap (§5.3),
the short-window rail containment once §5.4 is attributed, then the September
items O4/O7/O8 (stale navigator baseline, doc/CSS mismatch on the portrait
Inspector sheet height, Inspector value ellipses at 200 % text).

## 9. Remaining work, with what each needs

> File-order note: this section was written before the validation record, so it
> sits above §7 in the file. Numbers are stable (other documents link to
> §9.5/§9.6/§9.7); read §6 → §9 → §5.8 → §7 if you are following the work
> chronologically.

Ordered by the assignment's priority (access first, then authorities, then
polish), each with the evidence already gathered:

1. **Tree-level reachability at short heights (O6, partially attributed).** The
   probe §5.4 closed the *mechanism* half: `.editor__layers-panel` is the scroll
   owner (`overflow-y: auto`, `client 529 / scroll 585` at 1366×768;
   `363/590` at 1024×600; `242/578` at 1280×480), so rail content is reachable by
   scrolling and the "box extends past a scrolling ancestor" reading was my own
   metric's false positive. The replacement probe (`report-rail2.json`) creates
   real rows with the rectangle tool and hit-tests the last row plus the sticky
   bulk bar at 1280×480 / 1024×600 / 1366×768; its result lands separately.
2. **Splitter collapse/reset affordance.** Naming and `aria-controls` are done
   (§6.2). Enter-to-collapse is optional for a *variable* splitter in the APG
   pattern, but the retired legacy handle's reset-to-default is a real capability
   the dock has not restored. A `dblclick` handler is the obvious implementation
   and the obvious flake risk against the repo's own double-drag specs — it needs
   a run of `dock-layout-geometry` before it ships.
3. **The splitter band's 12 px canvas overlap (§5.3)**. Reducing it means
   choosing a smaller fine-pointer band (24 px is retained for coarse pointers)
   and justifying it against WCAG 2.2 SC 2.5.8's spacing exception — a UX
   decision that needs its own E2E before shipping, since the band is a shared
   interaction. Measured evidence is in §5.3 so the next attempt starts from data.
4. **The `isUntouchedBuiltinSplit` limitation — FIXED** (see §9.5). The
   repository's own `dock-layout-geometry` spec caught it swallowing the default
   window's first `ArrowRight`; touched-ness is now state on the split node.
5. **`getDockNodePreferredSize` chrome asymmetry** — the minimum/maximum helpers
   add `DOCK_PANEL_CHROME_HEIGHT` on the block axis, the preferred helper does
   not, so a bottom companion's opening height includes its chrome (motion
   Timeline: 240 declared, 208 body). One-line fix, no reachability impact; not
   attempted because the constant lives in `dockOps`, which already imports
   `dockPanelSizing`, so the tidy fix is a shared constants module — a refactor
   of a hot file that should not ride along unverified.
6. **Reproduce the 640 px inspector rails in the browser** — the derived maximum
   makes them reachable again and `report-after2.json` measured 640 live from a
   pointer drag, but the five inspector specs themselves have not been run.
7. September items O4 (stale navigator visual baseline — its recorded 288 px
   width is exactly what this change restores, so it may now pass on width and
   still differ in height; must be regenerated *after* this change, never
   before), O7 (**fixed** in §6.2), O8 (Inspector value-side ellipses at 200 %
   text).

### 9.5 Fixed: the resize that lands on a built-in split's creation ratio

`isUntouchedBuiltinSplit` originally compared the stored ratio to the creation
default within `1e-9`. That looked like a one-pixel corner case; it is not.

**The repository's own spec caught it.** `tests/e2e/workspace/dock-layout-geometry.spec.ts`
asserts that `ArrowRight` on the first splitter advances `aria-valuenow` by 2.
At the default 1440px window the Layers rail opens at its preferred 288px, i.e.
an effective ratio of `288/1440 = 0.2`; the keypress stores `0.2 + 0.02 = 0.22`,
which **is** the built-in creation ratio. The value-based check therefore read
the split as never-resized, re-applied the preferred ceiling, and swallowed the
keypress:

```
Expected: "22"      Received: "20"
aria-valuenow="20" aria-valuemin="13" aria-valuemax="40"
aria-label="Resize Layers panel" aria-controls="editor-layers-panel"
```

The first keyboard interaction from the default state, at the default window
size, silently did nothing. Touched-ness is therefore real state on the split
node (`DockNode.ratioTouched`), written by `setSplitRatio` (its only writer) and
read instead of compared; `stripDocumentPins` carries it so a portable layout
keeps the distinction. Two tests pin it: a resize landing on the creation ratio
now renders `0.22 × 1440`, and a split nobody has resized still opens at its
declared preferred size.

Recorded here rather than quietly fixed, because the general lesson matters more
than the bug: **a persisted intent must not be re-derived from a value that the
user's own input can reproduce.** The earlier decision to defer this as "needs a
schema change" was wrong on impact — the schema addition is one optional boolean,
and deferring it left a failing spec in the tree.

### 9.7 Run contamination (recorded, because it affects what the numbers mean)

The first run of `inspector-responsive-surface-audit` in this session reported
3 failures of 5, and its log contains an unhandled page error that is **mine,
from a mid-edit window, not a defect in the committed state**:

```
[Unhandled error] ReferenceError: panelWidthLimits is not defined
```

I added the registry-derived getters to `LIBRARY_PANEL_LIMITS` in one edit and
its import in the next; a Playwright run that started between the two saw the
intermediate file through Vite. The current file imports the helper (line 18) and
the whole workspace layer passes (`647/647` at that point, `26/26` on the three
files this round touched). A clean re-run is queued. Two results from that run
are still worth recording:
- `tests/e2e/responsive/layers-inspector-panels.spec.ts` **7/7 passed** —
  including both text-enlargement contracts and "layer rows stay operable with
  the rail scrolling" at a short desktop window. That is this slice's own
  responsive contract, green.
- `dock-layout-geometry` failed at line 118 on `aria-valuenow`, and **that one
  was mine and real**, not contamination: it exposed the swallowed keyboard nudge
  fixed in §9.5.
- "Position & Size keeps equal value columns across Inspector widths" — the spec
  that walks `RAILS = [240, 280, 320, 400, 640]` — **passed**, which is the
  wide-rail reachability this change restored.
- Its three sibling failures in `inspector-responsive-surface-audit` remain
  **unattributed** until the clean run reports. The September audit recorded four
  failures in that same spec as pre-existing, but that is a prior revision and is
  not treated as an explanation.

Lesson recorded for the next session: do not start a browser run while a
multi-file edit is in flight; the dev server reads the tree live.

### 9.6 Browser verification status

The repository's own affected specs are queued through the heavy lease:
`tests/e2e/workspace/dock-layout-geometry.spec.ts`,
`tests/e2e/responsive/layers-inspector-panels.spec.ts`,
`tests/e2e/inspector/inspector-responsive-surface-audit.spec.ts` (the 640 px
rail), plus a probe that re-measures the opening sizes and the drag/keyboard
ceilings in the live app after the §6.1 rework. The first attempt is documented
above: it failed in global setup on another session's transient mid-edit state
(`useCollabSession` outside its provider), which is no longer present.


## 7. Validation performed

| Command | Result |
|---|---|
| `npx vitest run packages/editor/src/workspace/dock packages/editor/src/workspace/__tests__/panelRegistry.test.ts packages/editor/src/workspace/__tests__/workspaceBaseline.test.ts packages/editor/src/components/PanelResizeHandle.test.tsx` | **118/118 pass**, 8 files (includes the 8 new dock-geometry cases) |
| `npx biome check` on the 9 touched files | clean |
| `pnpm audit:sizing` | pass |
| `pnpm audit:docs` | pass |
| `pnpm audit:emoji` | pass |
| `pnpm audit:spacing` | **fail — all 30 drifts are in other sessions' files** (`FirstRunOverlay.css`, `DownloadRedirect.astro`); none in this slice |
| `pnpm --filter @varve/editor exec tsc --noEmit` | **fail — 3 errors, all in other sessions' in-flight files** (`PresenterConsole.tsx`, `context.tsx`, `context/PrototypeContext.tsx`); none in this slice |
| `pnpm verify:plan` | ran; reports `FULL-SUITE ESCALATION: YES` for *"workspace/toolchain/validation-infrastructure change"* — driven by the 146 changed paths in this shared tree, not by this slice |
| Playwright probe (before) | 4/5 passed, `VARVE_E2E_PORT=1552`, isolated output dir |
| Playwright probe (after) | 1/1 passed, `VARVE_E2E_PORT=1553`, `report-after.json` |
| `tests/e2e/workspace/dock-layout-geometry.spec.ts` + `tests/e2e/responsive/layers-inspector-panels.spec.ts` | queued through the heavy lease; not complete at write time (§5.9) |

**Full suite: not run.** It is an escalation the planner attributes to
foreign toolchain changes, the tree carries three type errors from other
sessions, and a green full gate on a mid-flight shared tree would not be
evidence about this slice.

### Lease contention and the first E2E attempt

Three other sessions held the heavy lease throughout (`presentation transitions
and mode specs`, `collab realtime two-client`, `onboarding occlusion probe`,
`presentation motion presenter mode fidelity`). Lease waits expired at the
600 s deadline several times and were re-queued with `VARVE_LEASE_TIMEOUT`
raised. The two node-only Vitest runs were executed with the documented
`VARVE_HEAVY_TASK_PARALLELISM=0` override at 5.4 GB available while 17 browser
processes from other sessions were live — a deliberate, disclosed override for a
non-browser test process, not the default escape hatch. Playwright runs were
never overridden; they queued.

The first queued run of the repository's own affected specs died in
`tests/e2e/global-setup.ts` (`.editor-shell` never became visible) because the
editor tree was replaced by an error boundary:

```
Error: useCollabSession must be used within CollabSessionProvider
  at useCollabSession (packages/editor/src/collab/CollabSessionContext.tsx:44)
  at ShareDialog (packages/editor/src/collab/ShareDialog.tsx:28)
```

**That was a transient mid-edit state of another session's work, not a standing
defect, and the record is corrected here rather than left as a blocker:** on
re-inspection `CollabSessionProvider` wraps the shell (`Shell.tsx:584–1243`) and
`<ShareDialog>` is rendered inside it (`Shell.tsx:645`). The specs were re-queued
and their result supersedes this note. Until it lands,
`dock-layout-geometry` and `layers-inspector-panels` are **unverified in this
session**, as are the five inspector specs that exercise the 640 px rail.




Other results from the same clean run and the run before it:

- `tests/e2e/responsive/layers-inspector-panels.spec.ts` — **7/7 pass** in the
  earlier run: filter-bar containment, canvas-navigator row, both text-
  enlargement contracts, compact drawer reachability, and "layer rows stay
  operable with the rail scrolling" at a short desktop window.
- `dock-layout-geometry` and `inspector-responsive-surface-audit` results are in
  §5.8.

### 5.9 Not established

- No Firefox/WebKit run; no packaged Tauri run; no physical keyboard, IME, pen
  or multi-monitor check; no screen-reader pass. Chromium only.
- No OS-level text scaling or real Firefox "zoom text only" — enlarged text is
  exercised through the repository's established stand-in
  (`documentElement.style.fontSize`).
- A direct 1920/2560 **before** capture is missing (see §5.1); the wide case is
  measured *after* the repair, and the pre-repair wide numbers in §3.1 are the
  verified ratio law applied to an unbounded resolver.
- No measured paint/layout cost or memory profile of the transitions.


# Overlay occlusion and inset contract — audit and repair (2026-10-15)

**Scope:** transient interface chrome that is pinned to the viewport bottom or a
side edge — the "Did You Know?" tip, the onboarding checklist, `WhatIsThis`
hints, micro-hints, the import progress panel, and the toasts they share a
placement problem with. Plus the reconciliation of the responsive-workspace open
items that earlier audits handed off.

**Branch:** `responsive-workspace`, created from `58676242d4830f38da4ba916f638960ac2bd4e08`
(`master`). No branch of `master` was rewritten; the integration route is a
normal merge.

**Why a separate worktree.** The shared checkout carried 111 modified/untracked
paths from concurrent sessions, including `packages/editor/src/Shell.tsx` with
628 insertions / 612 deletions of another session's in-flight re-indentation.
Editing that file in place would have buried this change in unrelated churn and
made attribution impossible. An isolated worktree at a known revision keeps the
diff reviewable; see "Concurrent agents" below for the coordination record.

**Hardware:** none. All evidence is headless Chromium driven by Playwright on
this machine, through `scripts/quality/heavy-lease.mjs`. No packaged desktop
app, no real touch/pen digitizer, no screen reader, no real OS text scaling —
see "Not established".

---

## 1. Research (accessed 2026-10-15/16)

### Standards

| Source | Type | What it establishes here |
|---|---|---|
| [Understanding SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) (W3C WAI, updated 11 May 2026) | Standard | 24×24 CSS px minimum with five exceptions: Spacing, Equivalent, Inline, User Agent Control, Essential. "The requirement is independent of the zoom factor of the page" — sizing cannot be met by telling the user to zoom. Two notes matter for this repair: the criterion **does** apply to targets in new content that appears on top of other content, and the guidance explicitly recommends "a mechanism to control the density of layout and thereby change target size or spacing, or both" — i.e. Varve's `data-density` contract is the endorsed shape. Technique C42 (min-height/min-width on the target container) is the named sufficient technique. |
| [Window Splitter Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/) (W3C ARIA APG) | Standard | Required roles/states: focusable `separator`, `aria-valuenow` / `aria-valuemin` / `aria-valuemax`, an accessible name that **matches the primary pane**, and `aria-controls` referring to the primary pane. Required keys: Left/Right (vertical splitter), Up/Down (horizontal), and **Enter** — "if the primary pane is not collapsed, collapses the pane; if the pane is collapsed, restores the splitter to its previous position". Home/End and F6 are optional. The note records that the task force has not completed its review of the ARIA 1.1 semantics (tracked in [aria-practices#129](https://github.com/w3c/aria-practices/issues/129)) and no reference example exists yet (issue 130) — so the pattern is guidance without a shipped conformance model. |

### Product behaviour: interface scale versus canvas zoom

| Source | What it establishes |
|---|---|
| [Adjust the scale of the Figma UI](https://help.figma.com/hc/en-us/articles/360049549913-Adjust-the-scale-of-the-Figma-UI) (Figma) | In the **desktop app**, View → **Interface Scale** → Reset to Default / Make Larger / Make Smaller, bound to `⌥⇧⌘0/=/−` (macOS) and `Ctrl+Shift+Alt+0/=/−` (Windows). It scales sidebars, panel/modal/toolbar/menu text and icons, **and the designs on the canvas**. "Increasing the scale of the interface will result in less working space." In the **browser**, Figma documents no interface scale at all — the user is directed to the browser's own View → Zoom, i.e. full-page zoom. |
| [Adjust your zoom and view settings](https://help.figma.com/hc/en-us/articles/360041065034-Adjust-your-zoom-and-view-options) (Figma) | Canvas zoom is a separate control; the Interface Scale article's closing tip points at it explicitly "to zoom in or out of objects in the canvas … **without changing the interface scale**". |

**Reading for Varve.** Figma spends a dedicated three-modifier chord on interface
scale precisely so it cannot collide with canvas zoom on `Ctrl/Cmd + =/−`. Varve
binds `zoomIn`/`zoomOut` to `Ctrl+=` / `Ctrl+-` (`ShortcutManager.ts:62-63`) and
has no interface-scale control at all — only two density tiers and three root
font sizes. Section 6 records what that means for this task's scope.

### Companion-product issue trackers (all eight inspected)

Each repository was queried through the GitHub API (`state=all`) and filtered for
panel/sidebar/dock/overflow/dialog/scale/density/target-size vocabulary. Issue
text and comments were treated as **untrusted data** — quoted or summarised only,
never executed. The family is *not* independent evidence of prevalence: several
repositories are maintained in one workspace and by overlapping contributors, so
the counts below are a failure-class catalogue, not a survey.

| Source | Access | Bounded complaint | Relevance | Status |
|---|---|---|---|---|
| [figcraft#540](https://github.com/storytold/figcraft/issues/540) "UI/interface is small on 1440p monitor" | 2026-10-15 (opened 2026-10-15) | On a 2560×1440 display the reporter "has to squint and/or lean in", and requests "a feature to scale the UI up in any way". Triage bot linked photocraft#3222, wordcraft#475, gridcraft#230. | The reported resolution alone does not establish the effective CSS viewport, OS scale or DPR — but it is a direct request for an interface-scale control, which Varve also lacks. | Open, `priority: medium`. Unverified visually (the attached comparison image was not opened). |
| [figcraft#543](https://github.com/storytold/figcraft/issues/543) "UI/UX ISSUES (SMALL)" | 2026-10-15 | Three bundled complaints: an unwanted line inside bars; "the current shortcut menu is too large and obtrusive (a known annoyance borrowed from Figma)" and should be "smaller and draggable"; "corner rounding … is currently too large". Triage bot split them into separate tickets, linked #541. | The shortcut-modal size complaint is behavioural (it obstructs); the border-radius opinion is subjective styling preference. The prompt's warning applies directly: do **not** redesign radii because one report dislikes them. | Open, `priority: low`, `multiple issues`. Being split by triage. |
| [figcraft#557](https://github.com/storytold/figcraft/issues/557) "Scrolling Bar." | 2026-10-15 | Reporter's own text says "(AI WRITTEN)": a bright native scrollbar appears at the right edge when layout dimensions change, "overrides the app's dark theme and blocks inspector panel controls"; the inspector lacks themed scrollbar styling; and "changing dimension inputs … dynamically recalculates panel height improperly, forcing unnecessary vertical scroll states". Triage bot split into three and linked photocraft#4611, effectcraft#271, #383. | Two of the three are this task's subject matter: an overlay/scrollbar obstructing inspector controls, and a content-driven height feedback loop. The third (theming a scrollbar) is cosmetic — and the prompt is explicit that an unattractive native scrollbar is not justification for removing access. | Open, `priority: medium`, `multiple issues`. Description is self-declared AI-written, so weighted as a hypothesis, not as observed evidence. |
| [figcraft#550](https://github.com/storytold/figcraft/issues/550) "Popover growing on mousein and out" | 2026-10-15 | A video shows the "…" text-options popover growing while the pointer moves in and out during text editing. Triage marked it a duplicate of #323. | Directly names the unstable-size class this task warns about ("avoid unstable size feedback, threshold oscillation"). | Open, `duplicate`. **A contributor attempted it and could not reproduce on current main** ("the Type settings (…) popover kept the same size after moving the pointer in and out of it several times") and stepped back. Treated as **reported, not reproduced**. |
| [figcraft#548](https://github.com/storytold/figcraft/issues/548) "Small Shortcuts Module Issue" | 2026-10-15 | The keyboard-shortcuts modal "is popping up … on the home/recents view", "takes up an overwhelmingly large footprint", and is "completely static (not draggable or resizable)". | Oversized dialog + wrong ownership scope (a canvas-scoped surface appearing on Home). Testable as an obstruction/ownership class. | Open, `priority: medium`. |
| [figcraft#569](https://github.com/storytold/figcraft/issues/569) "Panels" | 2026-10-15 | Panel toggle shortcut `Shift+\` is "awkward" and should be remappable; marquee selection over-grabs; canvas panning feels clunky. | The panel-toggle complaint is about *discoverability and remapping* of the panel-visibility control, which this task's panel-recovery section covers. Triage asked for repro details; reporter replied only "1080p. 60hz". | Open, `priority: medium`, `needs info`. |
| [figcraft#580](https://github.com/storytold/figcraft/issues/580) "Zoom with Ctrl++ and Ctrl+- also change app DPI" | 2026-10-15 | "When I zoom in and out, it does properly zoom in and out on my workspace but it also changes the size of all UI elements. … Zooming using the clickable percentage dropdown functions properly. Zooming by holding Ctrl and scrolling functions properly." | The exact interface-scale/canvas-zoom conflation this task asks Varve to label accurately. | **Closed** — fixed by #584 below. |
| [figcraft#584](https://github.com/storytold/figcraft/pull/584) "Cmd/Ctrl+= and - zoom the canvas only, not the whole interface" | 2026-10-15 | Root cause stated in the PR: "egui ships its own browser-style keyboard zoom (`Options::zoom_with_keyboard`, on by default): at the end of every frame it reads Cmd/Ctrl+=, Cmd/Ctrl+- and Cmd/Ctrl+0 and changes the context's zoom factor. FigCraft binds the same keys to `view.zoomIn`… so one key press zoomed the canvas and then scaled every panel as well." Fix disables it once at context setup "so the keys only reach the canvas, **as in Figma**." Validation includes a new regression that fails on main (`left: 1.1, right: 1.0`, the interface zoom factor after `Cmd+=`). | Names the precise failure mode: a toolkit-level default zoom handler silently double-binds canvas-zoom keys to interface scale. This is the mechanism to check in any webview-based editor, including Tauri. | **Merged/closed.** |
| [lightcraft#1263](https://github.com/storytold/lightcraft/issues/1263) "UI layout truncated on 1366x768 display resolution" | 2026-10-12 (via Discord ticket relay) | At 1366×768 "the user interface exceeds the visible area"; "critical control panels and dialog boxes (such as the export settings window) are truncated, making several options and buttons inaccessible". Reported expectation: "dialogs should scale properly or fit within the vertical height of a 1366x768 resolution, with scrollbars provided if needed." | The requested expectation is a complete action path plus a defined scroll owner — exactly the assignment's export-dialog scenario. | Open, no comments. Reporter has no GitHub account (relay), so replies do not reach them. |
| [filmcraft#1951](https://github.com/storytold/filmcraft/issues/1951) "Panels are locked within MDI boundaries and cannot span multiple monitors" | 2026-10-14 | Undocked panels "hit a hard, invisible wall at the edge of the master program window"; system window shortcuts cannot move them because "the panel is treated as an internal child element rather than a native operating system window". | Confirms the distinction this task requires: internal floating panels and native OS windows are different capabilities. It is a feature request for a multi-window system, not a defect in the current internal-panel model. | Open, no comments. |
| [designcraft#883](https://github.com/storytold/designcraft/issues/883) | 2026-10-14 | Bundled request; item 3: "Scaling down the window or zoom level causes the floating/fixed 'Properties' panel to overlap and obscure the canvas content. Expected: Make the Properties panel responsive, dockable, or auto-collapse so it does not block the workspace when scaled down." Maintainer reply asks for "a screenshot of the Properties overlap, with the window size". | The panel-overlaps-canvas-on-shrink class, with a requested remedy (responsive/dockable/auto-collapse) that matches this task's compression order. | Open. **Not reproduced** — the requested evidence has not been supplied, so this is a report awaiting detail, not a confirmed defect. |
| [designcraft#493](https://github.com/storytold/designcraft/issues/493) "Presentation mode: Escape doesn't leave it" | 2026-10-11 | "In Presentation screen mode the in-window menus, toolbars and panels are hidden, and Escape does nothing. … the only way out is W (Toggle Normal/Preview), which nothing on screen mentions. A new user on Discord got stuck there." Expected: Escape leaves Presentation; Shift+W toggles it. | A trapped mode with an undiscoverable exit — the highest-severity recovery class in this task's priority order ("lost save/recovery/exit controls and trapped interaction before cosmetic spacing"). | Open, but **a fix is already in flight**: comments record "A PR for this is in progress" and "PR #503 already covers this fix". Do not duplicate. |
| [artcraft#2352](https://github.com/storytold/artcraft/issues/2352) "[Bug]: UI panels cannot be docked into workspace sidebars in PhotoCraft" | 2026-10-15 | Panels cannot be docked into the workspace sidebars. | The inverse of this task's panel-recovery requirement: a docking route that does not exist. | Open, no comments. |
| [photocraft#6416](https://github.com/storytold/photocraft/issues/6416) "[Bug Report] [PhotoCraft] Properties window missing in PhotoCraft" | 2026-10-15 | The Properties panel is missing. Triage linked #129, #150, #5610. | A panel with no visible route back — the recovery class this task's inventory is meant to catch. | Open. |
| [photocraft#6417](https://github.com/storytold/photocraft/issues/6417) "Context menus: an overflowing menu shows ▲/▼ scroll arrows (#2091)" | 2026-10-15 | Implementation note: an overflowing context menu reveals scroll arrows instead of clipping. | This is the **good** pattern, worth copying: a visible overflow affordance on a constrained menu. | Open (tracking). |
| [photocraft#6356](https://github.com/storytold/photocraft/issues/6356) "Menus: rows scrolled out of view no longer open their submenus (#5896, #6225)" | 2026-10-15 | A menu row that has been scrolled out of view can no longer open its submenu — a stale anchor after recycling. | Names precisely the recycled-popup-anchor hazard the task calls out ("virtualized rows need … safe handling of recycled popup anchors"). | Open. |
| [photocraft#6441](https://github.com/storytold/photocraft/issues/6441) "Confirmation dialogs do not automatically focus a button for keyboard navigation" | 2026-10-15 | Confirmation dialogs do not move initial focus to a button. | Dialog focus entry, adjacent to this task's "restore focus to a valid invoker/fallback" requirement. | Open. |
| [effectcraft#1532](https://github.com/storytold/effectcraft/issues/1532) "side scrollbar in a pop-up" | 2026-10-15 | An unwanted side scrollbar inside a pop-up. | Accidental scroll ownership inside a floating surface. | Open. |
| [effectcraft#1600](https://github.com/storytold/effectcraft/issues/1600) "Expressions: a long expression scrolls inside its Timeline field instead of running under the rows below" | 2026-10-15 | A long value scrolls inside its field rather than expanding into the rows beneath. | Scroll-owner assignment for long values — the same decision this task requires per region. | Open. |

**Searched and not found in these trackers:** a report whose fix is a *panel
that disappears with no recovery route* and whose linked patch adds a View-menu
or launcher entry. The closest are photocraft#6416 (missing panel, no fix
linked) and figcraft#569 (panel toggle shortcut). No report in the sampled set
documents interface scale and canvas zoom being separated as a *Varve* concern.

**Could not access:** the image and video attachments on figcraft#540, #543,
#548, #550, #557, #569 and designcraft#883. Several are
`user-attachments` URLs requiring an authenticated session; the accessible ones
were not opened, because this session has no image-fetch path for
`github.com/user-attachments`. Every visual claim above is therefore **the
reporter's written description**, not an observation. This is recorded rather
than papered over, and it is why no finding below rests on a companion-product
screenshot.

---

## 2. Reconciliation of previously handed-off open items

The 2026-09-30 audits handed off four open defects. Before touching anything,
each was re-checked against the current revision — a concurrent session's
measurement sweep (`/tmp/opencode/varve-responsive/report.json`, run against the
shared checkout at `0368…`-era `master` plus their in-flight work) plus a
read-only source review here. Historical results were **not** counted as current
passes.

| Prior ID | Claim | Status on the current revision | Evidence |
|---|---|---|---|
| text-enlargement D2 / layers D3 — shell grid tracks overflow at 200% text | Three `minmax(0, …)` panel tracks now yield to the container. | **Fixed.** `grid-template-columns` sums to exactly the viewport at 100%, 150% and 200% text (1280 → `480px 320px 480px 0px`; 1366 → `493.266px 347.469px 525.266px 0px`). The `minmax(0, …)` fix and its mechanism comment are present at `editor.css:371`. | Concurrent sweep `textEnlargement`; source review. |
| text-enlargement D3 / layers O1 — dock panel chrome covers the document tab strip at 200% text | The dock derives its top from `getComputedStyle(shell).gridTemplateRows` (actual track sizes), not from the drifted `--menubar-total-height` arithmetic. | **Fixed.** `chromeOverlapsTabStrip: false` at 100%, 150% and 200%; the dock chrome top sits ~2px below the tab strip bottom (191.67 vs 189.67 at 1280×800@200%), and `hitTabStripMiddle` returns `div.editor-tabs`. | Concurrent sweep `textEnlargement`; `useEditorDockGeometry.ts:239-247`. |
| layers O2 — two competing resize systems (legacy `PanelResizeHandle` vs the dock splitter) | The legacy handle is no longer rendered when the dock owns geometry. | **Resolved in the docked desktop case.** `[role="separator"]:not([data-testid^="dock-splitter-"])` returns **0 entries** at every swept viewport and text size, so only the dock splitters remain. `PanelResizeHandle` is still the grid fallback for compact hosts and is authored to that intent ("The grid fallback uses pixel widths; the dock tree owns its splitters"). | Concurrent sweep `legacy: []`; `PanelResizeHandle.tsx:136-137`. |
| layers O3 — `setRail` writes `--inspector-width` but the dock's inline px width wins (inspector test suite red) | The shared helper now drives the **dock splitter** first (`panelResizeHandle` → `getByTestId('dock-splitter-center-inspector')`), so it is no longer writing a token the dock overrides. | **Explained; the remaining gap is semantic, not geometric.** The helper still computes its drag distance as a *pixel-linear* function of panel width (`delta = (width - panelBox.width) * sign`), while a dock splitter sets a **ratio** on a split whose extent is the canvas-and-rail region, clamped by `minRatio`/`maxRatio` derived from registered panel minimums. Requesting a width below the dock's registered minimum cannot be honoured, and a drag that does not land on the splitter leaves the panel at its previous width — consistent with the recorded `expected 240px, received 584.062px`. Not repaired here; see "Open items". | `tests/e2e/helpers/panel-resize.ts:4-44`; `dockGeometry.ts:155-183`. |
| layers O6 — the short-height rail's outer workspace wrapper floors at `min-height: 15rem` and clips the tree box | Mechanism present verbatim at `editor.css:2522` (`flex: 0 0 auto; min-height: 15rem`) inside the `min-width: 900px and max-height: 900px` tier. | **Present, magnitude not independently verified.** The sweep reports the wrapper's bottom exceeding the panel's bottom by 56.11px at 1366×768, 226.78px at 1024×600 and 336.66px at 1280×480. Those numbers come from `querySelector('.layers-panel__content, .layers-panel-workspace, .layers-list')`, which resolves in **document order**, so it matched the outer `.layers-panel-workspace` wrapper — confirmed by `clientHeight === scrollHeight === 240` at every viewport, i.e. the element measured is not the scrolling region. The containment signal is real (a wrapper whose bottom exceeds its panel's is clipped), but the px magnitudes are the wrapper's, not the tree's, and are reported here as unverified. | `editor.css:2522`; concurrent sweep `shortWindows`. |

**Not re-checked here:** the Dock-tabs, `layers-panel-visual` bulk-bar
containment and visual-baseline items recorded as O4/O5 in the earlier audit.
They are outside this change's boundary and remain with their owners.

---

## 3. Defect found and repaired: bottom-anchored overlays occlude interface controls

### 3.1 The observation

`tests/e2e/responsive/dock-panels.spec.ts` — the repository's own regression
contract for dock geometry — **fails on the current revision**:

```
900px .editor__inspector-panel: unreachable control Snap tolerance 8 CSS pixels
  insp-num__input at (797,698) covered by did-you-know-tip__title [542,683 335x23]
```

The `.editor__inspector-panel` containment, canvas-floor and clipped-text
assertions all passed; the single finding is an Inspector number field whose
centre hit-tests to the **onboarding tip's title**, not to the field.

### 3.2 Why it only appeared intermittently (and why that mattered)

`useDidYouKnow` surfaces a tip after `IDLE_THRESHOLD_MS = 15_000` of idleness
(`useDidYouKnow.ts:8`). The failing spec sweeps twelve viewport widths with
300ms waits, so it crosses the 15-second boundary partway through and reports
the collision at whichever width it had reached — here, the seventh. The same
run therefore passes or fails depending on machine speed.

This is a flaky detector over a real defect, and it is worth naming as its own
finding: the sweep's finding list is *correct*, but its trigger is a race. The
repair therefore includes a detector that waits for the tip explicitly
(`waitForTip`) rather than racing the idle timer.

### 3.3 Root cause

Four surfaces are `position: fixed` and pinned to the viewport bottom or a side
edge, and each had independently re-derived its own offset:

| Surface | Offset before | Keyboard inset | Safe area | Status bar | Rail gutter |
|---|---|---|---|---|---|
| `.did-you-know-tip` | `bottom: space-4; right: space-4` | no | no | no | no |
| `.onboarding-checklist` | `bottom: space-4; left: space-4` | no | no | no | no |
| `.what-is-this` | `bottom: space-4` (centred) | no | no | no | n/a |
| `.import-progress` | `bottom: space-3; right: space-3` | no | no | no | no |
| `.varve-toast-container` (canonical) | `bottom: calc(statusbar + space-3 + keyboard + safe-area)`; `right: max(space-4, inspector-width + space-4)` | **yes** | **yes** | **yes** | **yes** |
| `.editor__fab` | `calc(… + keyboard inset)` | **yes** | no | yes (compact) | n/a |

The canonical `@varve/ui` toast container had already solved all of it, and the
2026-09-30 responsive contract already *claimed* the behaviour — "Toasts and
drawer FABs subtract `--keyboard-inset-bottom` from their bottom offsets" — but
only the toast container and the FAB implemented it. The four editor-local
surfaces were outside that claim's enforcement, so the documented contract was
false for them.

Concretely, `right: var(--space-4)` places a right-anchored surface ~13px from
the viewport's right edge, which at desktop widths is *inside* the docked
Inspector rail. That is the observed collision.

### 3.4 The repair

One recipe, published once. `.editor-shell` (`editor.css:346-377`) now defines:

```css
--overlay-bottom-inset: calc(
  var(--statusbar-height) + var(--space-3) + var(--keyboard-inset-bottom, 0px) +
    env(safe-area-inset-bottom, 0px)
);
--overlay-right-inset: var(--space-4);
--overlay-left-inset: var(--space-4);
```

with a `@media (min-width: 900px)` override making both side gutters
rail-aware (`max(var(--space-4), calc(var(--inspector-width) + var(--space-4)))`
and the sidebar equivalent). The boundary is deliberate: above it both panels are
docked rails that a fixed surface can land on; below it they are drawers, where a
gutter would push transient chrome off the edge for no reason.

All four surfaces now consume the tokens. Three of them additionally bound their
own width by the space actually left — `calc(100vw - var(--overlay-right-inset) -
var(--space-4))` — because `.did-you-know-tip`'s previous
`min-width: 18rem` / `.import-progress`'s `min-width: 280px` are rem-based, so at
an enlarged root text size they could exceed that space on their own and push the
surface off the *opposite* edge. At 100% text with ordinary content the boxes are
unchanged (18–24rem and 280px).

Two deliberate non-changes:

- `.prototype-presenter__toolbar` keeps `bottom: var(--space-5)`. The prototype
  presenter is a full-bleed presenting surface where the shell, its rails and the
  status bar are not rendered; there is no rail to clear and no editor keyboard
  to inset for. It is an explicit, reasoned exemption in the guard rather than a
  silent omission.
- `.editor__layers-panel` / `.editor__inspector-panel` / `.editor__library-panel`
  keep their `bottom: 0` / `bottom: var(--statusbar-height)` offsets. They are
  positioned *from the shell grid* so they meet its rows exactly; adding the
  keyboard inset would double-count the status bar. Also an explicit exemption.

### 3.5 Regression proof

`tests/unit/overlay-inset-system.test.ts` (5 tests) discovers every
`position: fixed` block with a `bottom` declaration across
`packages/editor/src` and `packages/ui/src`, and requires each to consume
`--overlay-bottom-inset`/`--keyboard-inset-bottom` or to appear in a reasoned
exemption list. It also asserts the recipe is published exactly once, that a
`min-width: 900px` rule makes the right gutter rail-aware, that both gutters are
capped by a viewport fraction, and that every viewport-width bound subtracts
**both** gutters. It fails if an exemption stops matching anything, so a
carve-out cannot outlive its surface.

Two failures were observed against the previous behaviour, each with the guard
unchanged and the fix reverted:

```
# 1. DidYouKnowTip.css reverted to `bottom: var(--space-4)`
Test Files  1 failed (1)
     Tests  1 failed | 3 passed (4)
#   "every viewport-anchored bottom offset consumes the shared inset recipe"

# 2. DidYouKnowTip's width bound reverted to the one-sided
#    `calc(100vw - var(--overlay-right-inset) - var(--space-4))`
Test Files  1 failed (1)
     Tests  1 failed | 3 passed (4)
#   "a viewport-width bound subtracts only --overlay-right-inset; it must
#    subtract both gutters, or the surface can cross the left rail"
```

Restored, the file passes 5/5. The guard also has a discovery self-check
(`finds the surfaces it is supposed to guard`) and a scan-sanity assertion, so a
parser bug cannot silently turn it into a no-op.

### 3.6 Browser results — and the second defect they exposed

`tests/e2e/responsive/overlay-inset-occlusion.spec.ts` was executed through the
heavy lease (`--workers=1`, isolated port 1481). **3 passed, 1 failed**, and the
failure was worth having:

| Test | Result |
|---|---|
| shell insets clear both docked rails and the status bar | **pass** |
| the tip covers no rail control at 1280×800 | **pass** — `coveredControls: []` |
| the tip covers no rail control at 900×800 | **pass** — `coveredControls: []`; this is the width where `dock-panels.spec.ts` reported the original collision |
| the tip stays inside the viewport at 200% text | **fail** — two Layers-rail controls covered |

The 200% measurement:

```
insets        { left: 478.92, right: 510.92, bottom: 68.39 }
layersRight   198        inspectorLeft  660        statusbarTop  748
tip           { left: 22.94, right: 389.09, top: 435.16, bottom: 731.62 }
covered       [ 'section-collapse-btn "Hide Design Canvases section"',
                'pages-panel__add-btn "Add Design Canvas"' ]
```

Root cause, and it was **my own bound, not the original code**: the tip's width
was bounded by `100vw - var(--overlay-right-inset) - var(--space-4)`. A
right-anchored surface sized that way extends *leftward*, so the bound only
protected the Inspector side; nothing stopped it reaching across the Layers rail.
The measurement shows why it bit at 200% text specifically: the token gutters ask
for **478.92 + 510.92 = 989.84px of a 900px viewport**, while the rails they
stand for actually measure 198px and 240px. `--sidebar-width` /
`--inspector-width` are rem-derived *preferred* widths; the dock resolves the real
rails from ratios of its own bounds, so at an enlarged root text size the token is
2.4× the rail. The inter-gutter space went negative, the rem floor won, and the
tip landed at x 22.94 — over the Layers rail.

Two corrections, both now guarded:

1. The width bound subtracts **both** gutters
   (`calc(100vw - var(--overlay-left-inset) - var(--overlay-right-inset))`),
   which is what makes "left edge ≥ left gutter" a guarantee rather than a hope.
   The same correction is applied to the import progress panel and the centred
   `WhatIsThis` hint.
2. Both rail-aware gutters are capped at `38vw`, so the pair can never claim
   more than 76vw and at least 24vw always remains for the surface. The cap does
   not bind at 100% text at desktop widths, where the tokens are the smaller
   term.

The same over-reservation means the gutter is *wider* than the rail it clears
(478.92px reserved for a 198px rail at 900×800@200%): safe in direction,
wasteful in magnitude. A gutter derived from the dock's *resolved* rail widths
would fix both, and is recorded as the follow-up.

Verification note: the corrected spec was re-run through the heavy lease
(isolated port 1482, `--workers=1`) and **passed 4/4** — see §3.7.

### 3.7 Confirmation run — behaviour-verified

`overlay-inset-occlusion.spec.ts`, isolated port 1482, `--workers=1`:
**4 passed (6.4m)**.

| Case | `insets.left` | Layers rail | `insets.right` | Inspector rail | tip box | covered |
|---|---|---|---|---|---|---|
| 1280×800 @100% | 301.12 | 281.59 | 323.52 | 309.50 | 572.48–956.48 | **[]** |
| 900×800 @100% | 276.36 | 198 | 292.36 | 240 | 276.375–607.64 | **[]** |
| 900×800 @200% | 342 | 198 | 342 | 240 | 342–558 | **[]** |

Three things the numbers establish:

- **No control is covered at any of the three configurations**, including
  900×800 — the exact width at which `dock-panels.spec.ts` reported the original
  collision — and 900×800 with a 200% root text size.
- **The both-gutters bound is exact, not merely safe.** At 900×800 (100% and
  200%) the tip's left edge lands on `insets.left` to three decimals
  (276.375 / 342). The tip fills the inter-gutter space and stops precisely at
  the left gutter, which is what makes "its left edge can never cross the Layers
  rail" a guarantee.
- **The cap binds exactly where predicted.** At 900×800@200% both gutters
  resolve to `342px = 0.38 × 900`, i.e. the `38vw` cap rather than the uncapped
  `478.92`/`510.92` that produced the failure. The pair asks 684px of 900px,
  leaving the tip 216px — inside the viewport (top 241.98, bottom 731.63 ≤ 800).

Also confirmed on this run: `insets.bottom` tracks the status bar rather than
overlapping it (35.84 ≥ 26.39 at 1280×800; 68.39 ≥ 52 at 200% text), and the
insets are unchanged from the first run at 100% text, so the repair moved nothing
at ordinary sizes.

---

## 4. Validation performed

Validation followed the repository's impact-aware policy
(`docs/quality/validation-strategy.md`); `pnpm verify:plan` was the selection
authority.

```bash
node scripts/quality/verify.mjs plan
#   7 changed files → @varve/editor; 17 lanes; FULL-SUITE ESCALATION: NO
#   Tier 1 includes e2e:file:tests/e2e/responsive/overlay-inset-occlusion.spec.ts

pnpm typecheck:e2e                                  # pass
npx biome check --write <the 7 touched files>        # 4 format fixes applied
npx biome check <the 7 touched files>                # 0 errors, 3 pre-existing warnings
npx vitest run tests/unit/overlay-inset-system.test.ts   # 4/4 pass
npx vitest run packages/editor/src/onboard \
  packages/editor/src/components/PanelResizeHandle.test.tsx   # 20/21 files, 174/176 tests
pnpm audit:emoji                                     # pass
pnpm audit:sizing                                    # pass
pnpm audit:radius                                    # pass
pnpm audit:tokens                                    # pass (324 pairs / 3 themes; usage clean)
pnpm audit:docs                                      # pass (1142 docs, 820 links, 179 ADRs)
npx stylelint <the 5 touched CSS files>               # 9 errors, all on pre-existing lines
pnpm audit:spacing                                   # FAIL — pre-existing, not this change (below)
```

### The `learning-system.test.tsx` timeout, attributed rather than dismissed

The onboard unit run reported 2 failures in `onboard/learning-system.test.tsx`,
both `Test timed out in 30000ms` in `SpotlightOverlay viewport clamping` — a
component this change does not touch. It was **not** waved through as
"unrelated": reverting this change's five CSS files appeared to clear it, which
would have made it a regression. The sequence that settled it:

| Run | CSS | Result | Transform | Reading |
|---|---|---|---|---|
| onboard suite | mine | 2 failed / 176 | 263.67s | — |
| `learning-system` isolated | mine | 1 failed / 35 | 27.49s | fails |
| `learning-system` isolated | **HEAD** | **0 failed / 35** | 12.92s | looked like my regression |
| `learning-system` isolated, again | mine | 3 failed / 35 | 78.32s | fails worse |
| `learning-system` isolated, again | mine | 1 failed / 35 | 24.33s | fails |
| `learning-system` verbose | mine | **0 failed / 35** | — | first test took **27780ms** against a 30000ms budget |
| `learning-system`, `--testTimeout=120000` | mine | **0 failed / 35** | 18.57s | passes once the budget is not binding |

The failing test does `await import('../components/Onboarding/SpotlightOverlay')`
**under `vi.useFakeTimers()`**, so it pays a cold module-graph transform inside a
single 30s per-test budget. Observed transform cost swung 12.92s → 78.32s across
runs of identical content, tracking whether the concurrently-running
`cargo check: varve-desktop` build was saturating the machine. The `HEAD` run
that "passed" landed in a fast window; the decisive run is the last one, where
the same code passes 35/35 with the timeout raised.

**Verdict:** load-induced timeout marginality in a pre-existing cold-import test,
not a regression from this change. The honest caveat: a fully controlled
attribution would need a quiesced machine, which the shared host could not
provide. Recorded as an open item — the test should warm its import (or the
budget should reflect a cold transform) so it stops reporting load as failure.

**Pre-existing failures, attributed rather than fixed:**

| Check | Result | Attribution |
|---|---|---|
| `pnpm audit:spacing` | FAIL, 16 drifts | Every reported path is `packages/editor/src/components/FirstRunOverlay/FirstRunOverlay.css` or `apps/website/src/components/DownloadRedirect.astro`. Neither is in this change set, and `.spacing-baseline.json` (3 keys) contains no entry for either. Since neither the files nor the baseline are modified here, the audit fails identically at `58676242d`. Not repaired: the baseline "may only shrink", so enrolling these values is the owning session's decision, not a side effect of this one. |
| `npx stylelint` | 9 errors | All on lines this change does not touch (`editor.css` 1267/3202/3411/4003/4162/5297; the `.sr-only` `clip` block in `WhatIsThis.css`, shifted but unedited). This matches the 2026-09-30 audit's record of a pre-existing stylelint set on this tree. |
| `pnpm audit:spacing` for the two new test files | n/a | The two new test files are TypeScript, not CSS, so they add no spacing surface. |
| `dock-panels.spec.ts` at 900px | FAIL (the reproduced defect) | Reproduced before the fix, on the current revision, at HEAD. That is this change's target. |

**Not run:**

| Check | Reason |
|---|---|
| `pnpm verify:affected` (full lane set) | Its browser lanes require the cross-worktree heavy lease. Concurrent sessions held it for the whole of this session's verification window (a `cargo check: varve-desktop` build, then collab E2E runs, then other geometry probes). The lanes were run individually instead — the list above is the affected closure minus the two browser lanes. |
| `e2e:editor-chrome-visual` | Same lease contention. |
| `just test` / `pnpm test` / `cargo test --workspace` / `pnpm verify:full` | Full-suite operations; the planner explicitly did not escalate (`FULL-SUITE ESCALATION: NO`). Section 5 records the consequence honestly. |

**Browser lane** (through the heavy lease, `--workers=1`):
`tests/e2e/responsive/overlay-inset-occlusion.spec.ts` → first execution
**3 passed, 1 failed** (port 1481), which exposed a real flaw in this change's
own width bound (§3.6); after the correction, **4 passed** (port 1482, §3.7).
The spec earned its place by catching a defect that source review and the unit
guard had both missed.

**The original defect's own contract was not re-run.** `dock-panels.spec.ts`
at 900px is the spec that reported the collision. It takes ~7.6 minutes for two
files and needs the same contended lease, so its re-run is left as the first
item in §8 rather than claimed. What is established independently: the exact
width and configuration where it failed (900px, Inspector "Snap tolerance")
now reports `coveredControls: []` under the equivalent probe in a passing spec.

---

## 5. Not established

- **The occlusion contract is behaviour-verified for the three configurations
  the spec drives.** `tests/e2e/responsive/overlay-inset-occlusion.spec.ts`
  passed 4/4 (§3.7): `coveredControls: []` at 1280×800, at 900×800 (the width
  where `dock-panels.spec.ts` reported the original collision) and at 900×800
  with a 200% root text size; the shell insets clear both rails and the status
  bar; and the tip's bounds stay inside the viewport. The source-level guard was
  separately proven to fail against two distinct previous behaviours.
- **`dock-panels.spec.ts` at 900px has not been re-run** in its own contract, so
  the fix is verified through the equivalent probe rather than through the spec
  that originally reported it. It shares the contended lease.
- **Not covered by the passing run:** widths other than 900 and 1280, heights
  below 800, short-wide windows (1280×480), the ≤899px drawer tiers, RTL, and
  the other three repaired surfaces (`OnboardingChecklist`, `WhatIsThis`,
  `ImportProgress`). Those share the same tokens and are guarded at source
  level, but their resolved geometry was not measured. The checklist is the one
  whose left gutter has the same both-sides dependency as the tip.
- **How the intermittent tip race behaves under load.** The tip fires at 15s of
  idleness; the spec waits for it explicitly, but the wait's stability across
  slow CI shards was not measured.
- **Variance in `--inspector-width` versus the real rail.** The side gutter uses
  the rails' *preferred* width token, capped at 38vw. With an enlarged root text
  size it is much wider than the docked rail (478.92px reserved for a 198px rail
  at 900×800@200%), so the gutter is correct in direction and wasteful in
  magnitude. A gutter derived from the dock's resolved rail widths would fix
  both; that needs the dock to publish them, which is a follow-up rather than a
  change to make blind.
- **Real devices and inputs.** No packaged Tauri run, no real virtual keyboard,
  no physical touch/pen, no multi-monitor, no real OS text scaling. The
  keyboard and safe-area insets were verified as CSS wiring, not under a real
  keyboard or gesture bar.
- **Non-Chromium engines.** Chromium only. Firefox/WebKit not run.
- **Screen readers.** No NVDA/VoiceOver/Orca. Accessible names were checked by
  reading the source, not by listening.
- **The `setRail` semantic gap (O3)** is diagnosed but not repaired, so the
  inspector responsive suites that depend on it remain red.
- **The short-window Layers wrapper (O6)** is confirmed present in CSS but its
  px magnitude is unverified; no fix attempted.
- **`onboard/learning-system.test.tsx` cold-import marginality** (§4): the two
  `SpotlightOverlay viewport clamping` timeouts are attributed to a cold
  `await import()` under fake timers exceeding a 30s per-test budget while a
  concurrent `cargo check` saturated the machine. The attribution rests on a
  35/35 pass with the same code at a raised timeout, plus transform cost varying
  6× across identical runs; it does **not** rest on a quiesced-machine
  comparison, which was not available.

---

## 6. Consequences for interface scale (a scoping finding, not a repair)

The assignment requires Varve's scaling controls to be labelled accurately
against Figma's model. Recorded here because it changes what a future slice may
safely do, and because it was verified rather than assumed:

- Figma separates **Interface Scale** (desktop only, `Ctrl+Shift+Alt` chord,
  scales rails/panels/modals *and* canvas content) from **canvas zoom**
  (`Ctrl/Cmd +/−`). Varve has **no interface-scale control**: only
  `data-density` (`comfortable` 32px / `compact` 28px,
  `settings/interfaceDensity.ts`) and a root font size
  (`small` 15px / `medium` 16px / `large` 18px).
- The interface **font-size** option is the fragile path: the token contract
  makes interface *type* rem-based and interface *geometry* px-based, so raising
  the root font size grows labels without growing the bars that hold them. That
  is precisely the mechanism behind the D1/D2/D4 text-enlargement defects the
  2026-09-30 audits found and fixed at a 32px root size. The `large` option
  (18px, a 1.125× step) is far milder than the 32px case those audits tested, so
  it is very likely already safe — but "very likely" is not evidence, and no
  test pins the shell at an 18px root size.
- `zoomIn`/`zoomOut` are bound to `Ctrl+=` / `Ctrl+-`
  (`shortcuts/ShortcutManager.ts:62-63`). The figcraft#580/#584 pair shows the
  failure mode to check for in a webview host: a toolkit-level default zoom
  handler that sees the same keys and scales the whole interface. **This was
  checked by reading, not by running:** `apps/desktop/src` and
  `packages/editor/src` contain no `zoomFactor`/`setZoom`/webview-zoom call, so
  the mechanism the FigCraft PR had to disable is not present in this codebase.
  A packaged-app keyboard run would be required to state it as verified.

Recommended follow-up (not done here, to keep this change's boundary at the
occlusion repair): a shell test at `font-size: large` mirroring the existing
200% text-enlargement contract, and an explicit decision on whether Varve wants
a true interface-scale control or will document the density + font-size pair as
its answer to figcraft#540.

---

## 7. Concurrent agents and integration

| Session | Surface | Interaction with this work |
|---|---|---|
| Dock geometry sweep | `probe: dock geometry sweep + text + short windows` (`/tmp/opencode/varve-responsive/`) | Same surface (`useEditorDockGeometry`, shell grid, short windows). Its measurement sweep was **read** for reconciliation (§2) and credited; its files were not modified. It had finished before this session's verification window. |
| Collaboration / Shell | `packages/editor/src/Shell.tsx` (`MM`, 628/612 re-indentation churn), `CanvasOverlays`, collab components; `AGENTS.md` gained a Collaboration System section, ADR-0243 | `Shell.tsx` is a hub file this change's successor work may need. Working in a separate worktree at `58676242d` avoided editing their in-flight file; expect a merge on `Shell.tsx`'s neighbourhood if a later slice touches the shell. |
| Collaboration E2E | `e2e: collab realtime two-client` | Held the heavy lease during this session. |
| Rust build | `cargo check: varve-desktop baseline` | Held the heavy lease at the end of this session, which is what blocked §4's browser lanes. |
| Shared checkout | 111 modified/untracked paths | Not touched. No revert, no stash, no blanket stage, no `--force`. |

Files changed by this work (26):

| Path | Change |
|---|---|
| `packages/editor/src/editor.css` | Publishes `--overlay-bottom-inset` / `--overlay-right-inset` / `--overlay-left-inset` on `.editor-shell`, plus the `min-width: 900px` rail-aware override |
| `packages/editor/src/components/Presentation/show/morphMatch.ts` | Syncs the tuple assertion with the already-fixed local `master` version so the editor typecheck passes on this older worktree base |
| `packages/editor/src/components/FloatingToolbar/TabletTouchControls.tsx` | Raises the active tablet controls popover above passive toast notifications |
| `packages/editor/src/components/FloatingToolbar/TabletTouchControls.css` | Removes the conflicting lower overlay z-index from the same portal |
| `scripts/quality/operation-history.mjs` | Uses the Git adapter for the requested checkout path, fixing temp-repository receipt placement in the selected CI tooling test |
| `packages/editor/src/onboard/DidYouKnow/DidYouKnowTip.css` | Consumes the insets; bounds its rem-based width by the available space |
| `packages/editor/src/onboard/OnboardingChecklist/OnboardingChecklist.css` | Consumes the insets; bounds its width |
| `packages/editor/src/onboard/WhatIsThis/WhatIsThis.css` | Consumes the bottom inset; bounds the nowrap hint |
| `packages/editor/src/components/ImportProgress.css` | Consumes the insets; bounds its rem-based width |
| `tests/unit/overlay-inset-system.test.ts` | **New** — source-level contract guard + reasoned exemption list |
| `tests/e2e/responsive/overlay-inset-occlusion.spec.ts` | **New** — resolved-geometry guard in the real editor, including toolbar clearance |
| `tests/e2e/responsive/tablet-toolbar-geometry.spec.ts` | **New** — toolbar bounds and launcher collision checks in forced tablet mode across the breakpoint |
| `docs/architecture/responsive-workspace.md` | Documents the overlay inset and responsive toolbar-clearance contracts |
| `docs/audits/overlay-inset-occlusion-2026-10-15.md` | Research ledger, review findings, and measured validation evidence |
| `docs/screenshots/2026-10-19-overlay-inset-review/` | Four visually inspected Chromium captures at 1280×800, 900×800, and 200% root text |
| `docs/screenshots/2026-10-19-tablet-toolbar-review/` | Eight visually inspected toolbar and open-popover captures across 820px–1024px tablet layouts |

## 8. The staged commit checkpoint does not fit its own budget

This change could not be committed through `.githooks/pre-commit`, and the cause
is not this change. `scripts/quality/commit-checkpoint.mjs:187` registers the
lane as

```js
commands.push(command('typecheck:e2e', ['pnpm', 'typecheck:e2e']));
```

which takes `DEFAULT_TIMEOUT_MS = 120_000` (line 20) because no per-lane override
is passed. The command itself, measured directly on the same worktree:

| Condition | `pnpm typecheck:e2e` wall time | Hook budget | Outcome |
|---|---|---|---|
| Quiet machine, 12.1 GiB available | **85s**, exit 0 | 120s | would pass |
| Loaded, 1.5–4.9 GiB available | **199s**, exit 0 | 120s | times out |
| Five consecutive hook runs (3.1 / 4.9 / 9.0 / 9.1 / 7.3 GiB free) | — | 120s | **all timed out** |

So the budget sits inside the command's own variance band: `typecheck:e2e` is a
cold full-program `tsc` over `tests/e2e/tsconfig.json`, it costs 85–200s on this
host, and any commit that touches `tests/e2e/` pays it. The hook runs its lanes
sequentially (`for (const item of selection.commands)`, line 244), so nothing is
competing with it from inside the checkpoint — the variance is the machine.

I did **not** work around this: no `--no-verify`, no `CI=1` (the hook exits 0
under `CI`, which would skip the checkpoint entirely), no raised budget, and no
edit to the checkpoint tooling, which is a shared quality gate whose policy is
not this change's to alter. At the time of this audit, the work was staged in
`.worktrees/responsive-workspace` on branch `responsive-workspace`; later review
and commit status is recorded in §10.

Suggested fix for the owner of that tooling: give `typecheck:e2e` a lane budget
that reflects a cold `tsc` (it is the slowest lane by an order of magnitude), or
run it with `--incremental` and a cached `tsbuildinfo` so repeat runs are cheap.

## 9. Open items handed forward
1. **Re-run `dock-panels.spec.ts`** (7.6 min, needs the heavy lease) so the
   original contract that reported the collision is green in its own terms. Its
   finding is already cleared under the equivalent probe (§3.7). Then extend
   `overlay-inset-occlusion.spec.ts` to the surfaces the passing run did not
   measure — the checklist, `WhatIsThis`, `ImportProgress` — and to short-wide
   windows (1280×480) and the ≤899px drawer tiers.
2. **Derive the rail gutters from the dock's resolved rail widths** instead of
   the rem-derived `--sidebar-width` / `--inspector-width` tokens. The tokens
   over-reserve badly at enlarged text (478.92px for a 198px rail) and the 38vw
   cap is a safety net, not a measurement. `resolveDockTreeGeometry` already
   returns the canvas rect, so the two rail widths are `canvas.x` and
   `width - (canvas.x + canvas.width)`; publishing them as custom properties on
   the shell would let the gutters be exact. This also fixes the canonical
   `.varve-toast-container`, which shares the approximation.
3. **`setRail` / dock-splitter semantics (O3):** the shared helper needs a
   dock-aware width contract — either convert a requested px width into the split
   ratio the dock enforces, or assert against the registered panel minimum when
   the request is below it. Until then the inspector responsive suites stay red.
4. **Short-window Layers wrapper (O6):** `editor.css:2522`'s
   `flex: 0 0 auto; min-height: 15rem` should yield in a panel shorter than that,
   and `treeBottomClipped` needs a measurement that targets the real scrolling
   region rather than the outer wrapper.
5. **Dock splitter semantics vs the ARIA APG pattern** — a regression that
   arrived with the dock, and the most concrete a11y gap found. The splitters
   (`WorkspaceBottomPanels.tsx:236-247`) carry `role="separator"`,
   `aria-orientation` and `aria-valuenow/min/max`, but:

   | APG requirement | Current state |
   |---|---|
   | Accessible name matching the **primary pane** | **Missing** — every splitter is named `"Resize dock panels"`, so with two splitters a screen-reader user hears the same name twice and cannot tell which pane each controls. The retired legacy handle did name its pane (`"Resize layers panel"`). |
   | `aria-controls` referring to the primary pane | **Missing here** (present on the legacy handle as `editor-layers-panel` / `editor-inspector-panel`). |
   | `aria-valuenow` / `min` / `max` | Present. |
   | Left/Right, Up/Down | Present (`useEditorDockGeometry.ts:803-815`). |
   | Home / End | Present (optional in the pattern). |
   | **Enter** — collapse the primary pane, restores on second press | **Missing**, although the pattern lists it as required (only Home/End and F6 are optional). |

   Suggested order, cheapest first — each step is independently testable in
   vitest and needs no browser:
   1. Add `primaryPanelTypeId?: PanelTypeId` to `DockSplitPlacement` in
      `dockGeometry.ts`, resolved from `node.first` (the primary pane is the
      first child: `firstWidth`/`firstHeight` derives from `ratio`, and
      `minRatio` is computed from `firstMin`). Add a small
      `getDockNodePrimaryPanel(node)` helper — `panel` → itself, `tabs` → the
      active ref, `split` → recurse into `first`. Extend
      `dockGeometry.test.ts`, which already covers ratio and minimum
      behaviour.
   2. Resolve the label and the controlled element in
      `useEditorDockGeometry.ts`, which already imports
      `tryGetPanelDefinition` — `dockGeometry.ts` should stay free of
      `panelRegistry` so the geometry module remains pure. The
      `PanelId → element id` map currently lives as `DOCK_PANEL_ELEMENT_IDS`
      inside the component `components/Shell/WorkspaceBottomPanels.tsx`; it
      belongs in the workspace layer (`workspace/panelIds.ts` or a sibling) so
      the hook can use it without a hook→component import.
   3. Thread `ariaLabel` / `controlsId` onto `DockSplitView` and consume them in
      `WorkspaceBottomPanels.tsx`. Keep `aria-controls` pointing only at
      elements that exist — the repo's disclosure contract makes that explicit.
   4. Add Enter: collapse to `minRatio` and restore the remembered ratio. The
      previous ratio must be held in the hook (a ref keyed by `nodeId`, cleared
      on mode change like `activeSplitResize` already is), and the collapse must
      go through `persistSplitRatio` so it is one undo-free preference write,
      matching the existing arrow/Home/End path.
   5. Extend `tests/e2e/workspace/dock-layout-geometry.spec.ts`, which already
      drives "resizes dock splits with keyboard and pointer controls" (it passes
      3/3 on the current revision), with the Enter round trip and the per-pane
      names. Do **not** assert on the generic label.

   Note for whoever takes this: the APG page itself records that the task force
   has not finished reviewing the ARIA 1.1 `separator` semantics and no reference
   example exists ([aria-practices#129](https://github.com/w3c/aria-practices/issues/129),
   [#130](https://github.com/w3c/aria-practices/issues/130)). Implement the
   required pieces, and treat F6 pane cycling as out of scope.
6. **Interface-scale decision** (§6): add the `font-size: large` shell contract,
   and decide whether Varve ships a true interface-scale control.
7. **`audit:spacing`** baseline needs the owning session to enrol or convert
   `FirstRunOverlay.css` and `DownloadRedirect.astro`.

## 10. Review addendum — floating-toolbar overlap

Visual review found a defect that the initial geometry check missed: the tip
avoided the Inspector, Layers, and status bar but covered the floating toolbar.
At 900×800 with 200% root text, the measured tip bottom was 731.63px while the
toolbar top was 628.05px. The E2E test now measures the rendered toolbar top and
asserts an 8px clearance. The shared bottom inset includes the floating
toolbar's published height and additional tokenized clearance. The final
four-case Chromium matrix passed. Measured tip-to-toolbar clearance was 14.4px
at 1280×800, 11.5px at 900×800, and 22.7px at 900×800 with 200% root text.
The shell-only 1280×800 case also verified both rail gutters and status-bar
clearance. The earlier intermediate measurements (tip bottoms 667.75px and
651.38px) failed the new assertion as expected.

The browser warned that WASM failed to load and used the pure-TypeScript stub
renderer. These assertions exercise DOM geometry and hit testing, not canvas
renderer parity. Reviewed captures are stored in
`docs/screenshots/2026-10-19-overlay-inset-review/`. At 200% text, the narrow,
tall tip overlaps the central “Start designing” help card; it clears toolbar and
rail controls, but this remains a visual usability follow-up along with short
wide windows and coverage for the checklist, `WhatIsThis`, and import progress.

The separate tablet toolbar sweep passed 4/4 cases with touch emulation at
820×520, 899×640, 900×700, and 1024×768. Toolbar widths resolved to 600px,
601px, 407px, and 509px; all visible controls met 44px touch targets, the
toolbar did not overflow its clip box, and none of the panel launchers collided
with it. The Editing controls popover opened, stayed within each viewport, and
closed on Escape. At 820px the top menu labels are visually crowded; the
available toolbar controls remain reachable, with overflow collected under
“More tools”. Browser worker startup timed out once at 1024px, and the renderer
fell back to main-thread Canvas 2D plus the TypeScript stub. These checks do not
establish native Tauri or physical tablet behavior.

The first popover screenshots exposed two issues: at 1024×768 the passive
“Design workspace” toast painted above the active Editing controls popover, and
at 820–900px the popover's gesture guide was clipped behind its bounded height.
`TabletTouchControls` now gives the active popover a layer above toasts and
removes its competing stylesheet layer. The dialog no longer creates a nested
scroller; `FloatingPortal` owns the height cap and scrolling. The tablet E2E
checks the layer ordering, portal containment, that the gesture guide can be
scrolled fully into view and hit-tested, and Escape dismissal.

The final Chromium touch-emulation sweep passed 4/4 at 820×520, 899×640,
900×700, and 1024×768. All visible toolbar controls measured 44px, the toolbar
fit its clip box, panel launchers did not collide with it, and the bounded
popover stayed inside the viewport. The gesture guide passed the scroll and
hit-test check at every size. Fresh open, scrolled, and dismissed frames are
stored in `docs/screenshots/2026-10-19-tablet-toolbar-review/`. The browser
warned that WASM failed to load and used the TypeScript stub renderer; these
checks cover browser DOM and touch emulation, not native Tauri or a physical
tablet. At 820px, the menu labels remain visually crowded, with overflowed
tools reachable under “More tools”.

The selected CI-tools regression also exposed that
`commonGitDirectory({ cwd })` created its default Git adapter from the process
directory instead of the supplied temporary repository. The default adapter
now uses the requested `cwd`, matching the helper's contract. Its direct and
full-gate rechecks pass, and the focused operation-history tests pass. The full
CI-tools lane initially reached the website E2E port-wrapper test but that test
timed out at its 10-second subprocess limit while another worktree's editor
suite was active (`result.status` was null). The exact wrapper test then passed
7/7 after the load cleared, and the full `pnpm test:ci:tools` rerun passed.

## 11. Validation status (2026-10-20)

- Tablet toolbar Chromium touch-emulation E2E: **4/4 pass** at 820×520,
  899×640, 900×700, and 1024×768; fresh opened/scrolled/dismissed frames are
  archived above.
- Overlay-inset Chromium E2E: **4/4 pass** on its 1280×800, 900×800, and 200%
  root-text cases.
- Focused overlay and tablet-control Vitest: **7/7 pass**; E2E TypeScript check
  passes; CI-tools suite passes after the transient port-test timeout cleared.
- Documentation, sizing, radius, and token audits pass. The spacing audit still
  reports 16 pre-existing raw spacing declarations in untouched
  `FirstRunOverlay.css` and `DownloadRedirect.astro`; these are outside this
  inset repair.
- The planner selects full-suite escalation because of the validation-helper
  change. `pnpm verify:full --local` was attempted: architecture audit passed,
  then workspace typecheck stopped in untouched `packages/scene` presentation
  migration tests, where schema-version-1 fixtures no longer satisfy the
  schema-version-2 `Document` type. The remaining full-gate lanes did not run.
  This feature worktree starts at `58676242d`; integration against the newer
  master tree is required before the final full-gate result can be established.

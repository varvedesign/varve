# FINDINGS — shell + Home

Severity: **S0** blocks a core task / legal exposure · **S1** major friction or
frequent error · **S2** minor · **S3** polish.
Confidence: **Confirmed** = measured and seen in the DOM/screenshot ·
**Probable** = measured, cause inferred · **Needs human check**.

Baseline: `master` @ `41ce72061`, worktree `.worktrees/shell-home`, dev server
`5341`, 320/1440/1920 × light/dark, axe-core 4.11.0.

---

## F-01 · S2 · Confirmed · Home, all widths · Landmark nesting

**What.** `main#home-main` and `aside[aria-label="Navigation"]` are inside
`<section aria-label="File drop zone">`, which is itself a `region` landmark.
axe reports `landmark-main-is-top-level` and
`landmark-complementary-is-top-level` at 320/1440/1920, light and dark
(10 findings across 6 runs).

**Evidence.** `ui-audit-before/SUMMARY.md`; DOM probe `audit-kit/debug-home.mjs`
shows `H1 "Recent"` parented by `SECTION.varve-home`. Confirmed on the other
agent's live branch too (port 5293, same 5 findings at 1440) — their in-flight
work does not fix it.

**User impact.** A screen-reader user navigating by landmarks hears a "File drop
zone" region wrapping the whole page; the main landmark is no longer top-level,
which is what the ARIA practices and axe's rule require. Structural, not
blocking.

**Root cause.** `packages/home/src/HomeShell.tsx` uses an accessible-name
`<section>` as the drop-zone wrapper. Giving a `<section>` an `aria-label`
promotes it to a `region` landmark.

**Fix direction.** Keep the drop-zone behaviour, drop the landmark: either make
the wrapper a `<div>` and move the drop-zone description to `aria-describedby`
on the main element, or keep `<section>` without `aria-label` and expose the
drop zone as a status message while dragging. Blast radius: Home only.

**Status.** Not applied — the file is dirty in the live agent's worktree.
Exact patch in `PLAN.md` → E1.

---

## F-02 · S2 · Confirmed · Home, all widths · Heading order skips a level

**What.** Home renders `<h1 class="sr-only">Recent</h1>` and then the empty-state
headline as `<h3>`. axe `heading-order` fired in 6/6 Home runs.

**Evidence.** Before: `axe:heading-order items:["h3"]` at 320/1440/1920 ×
light/dark. After: **0 findings**, same widths. The retained 1440px screenshot
pair has 51 changed pixels (0.003935 %), confined to a 7×8 px corner region
(2026-10-23 recount; see EVIDENCE §4).

**User impact.** Heading navigation (a primary screen-reader mode) jumps h1 → h3,
suggesting a missing section. Low visual impact, real navigation cost.

**Root cause.** `EmptyState` hard-coded `<h3>`; Home's only page heading is the
sr-only `<h1>`.

**Fix direction (applied).** `EmptyState` takes `headingLevel?: 2 | 3 | 4`
(default 3, so existing callers keep their outline); `EmptyStates` (Home) passes
2. Blast radius: every `EmptyState` caller; verified no outline regression
because the default is unchanged.

**Status.** **Fixed** in `dcf080c32`.

---

## F-03 · S2 · Confirmed · Home + editor · iOS zooms on field focus

**What.** The search field renders at 15 px. On iPhone, focusing it zooms the
page by 16/15 ≈ 1.07× and does not zoom back out.

**Evidence.** `input-zoom-ios` info finding at 1440/1920 on both surfaces;
`packages/ui/src/components/components.css` sets
`font-size: var(--type-interface-control-size)` on `.varve-search__input`.
Research A3.

**User impact.** Mobile browser-demo users get a shifted layout and an off-screen
submit affordance after tapping search. Desktop unaffected.

**Root cause.** The control type token resolves to 15 px.

**Fix direction.** Raise the search field to ≥16 px at phone widths (e.g. the
existing compact-on-pointer-fine pattern), or raise the token globally — the
latter is a design-system decision with a wide blast radius. Never fix with
`maximum-scale`.

**Status.** Not applied — `components.css` is in the live agent's **exclusive**
paths. `PLAN.md` → E2.

---

## F-04 · S1 · Confirmed · Editor tabs · Close button nested in `role="tab"`

**What.** Each tab is `<div role="tab">` containing the close `<button>`. axe
`nested-interactive` (impact: serious, WCAG 4.1.2 A) fires on `.editor-tabs__tab`
at every width and theme tested (4/4 runs).

**Evidence.** `ui-audit-before/SUMMARY.md`; code in `TabStrip.tsx` (the header
comment claims the `div role="tab"` makes the inner button "valid HTML" — true
for HTML, not for ARIA). `tabIndex={-1}` on the close button does not clear the
rule (RESEARCH A2).

**User impact.** The close control is not announced with a name/role; screen
reader users get an unannounced stop, and the tab's accessible name can absorb
the button's text.

**What I tried, and why it is not shipped.** Moved the close button beside the
tab inside a `role="presentation"` wrapper. Measured result at 4 viewports:
`nested-interactive` 4 → **0** (fixed), but `aria-required-children` 0 → **4**
(new, on `.editor-tabs` — a tablist may only own tabs) and `occluded-control`
0 → 4 (the button now overlays the tab). Reverted; the final tree has the
original profile (re-run confirms `nested-interactive` present, no
`aria-required-children`).

**Fix direction (needs a design decision).** Options in `PLAN.md` → E3. The only
fully conformant option that preserves the current affordance is to keep close
buttons in a sibling layer outside the `tablist` (visually overlaid, aligned to
each tab), or to accept a per-tab close inside a non-`tablist` item wrapper and
re-declare the tab semantics. Both need visual review; neither is a one-line
change.

**Status.** Not applied (reverted after measurement).

---

## F-05 · S2 · Confirmed · Editor shell · Chrome outside landmarks

**What.** axe `region`: `.editor-shell > h1`, `.floating-toolbar`,
`.editor-tabs`, `.workspace-bottom-panels`, `.editor-status__diagnostic` are not
contained by a landmark.

**Evidence.** 4/4 editor runs. Confirmed present on the other agent's branch
(port 5293) as well.

**User impact.** Screen-reader landmark navigation skips the tab strip and status
bar; the toolbar is reachable only by linear navigation.

**Root cause.** `Shell.tsx` structure: the tab strip sits outside `<main>`, and
the floating toolbar is a sibling of the shell.

**Fix direction.** Wrap the tab strip in the existing header landmark (or give it
`role="navigation"` with a label) and place the toolbar/status diagnostic inside
a labelled region. Blast radius: editor shell. `PLAN.md` → E4.

**Status.** Not applied — `Shell.tsx` is dirty in the live agent's worktree.

---

## F-06 · S3 · Confirmed · Editor · Duplicate landmark name

**What.** axe `landmark-unique` on `#editor-layers-panel`: two landmarks resolve
to the same role+name combination.

**Evidence.** 4/4 editor runs.

**User impact.** Landmark lists show an ambiguous duplicate; users cannot tell
which is which.

**Fix direction.** Give the docked panel a distinct accessible name from the
other panel with the same label (e.g. include its dock position or panel role).
`PLAN.md` → E5.

**Status.** Not applied — `Shell.tsx` is owned.

---

## F-07 · S3 · Needs human check · Editor · Presence layer spans the whole shell

**What.** `.collab-presence-layer > svg` covers the full editor box and is the
`b` element in ~1,300 collision candidates across runs. `onTop: "a"` in the
samples inspected means the shell chrome paints above it, so nothing is actually
occluded at rest.

**Evidence.** Collision records in `ui-audit-before/results.json`; 319/319 at
1440 share the same `b` selector.

**Why not a confirmed defect.** No remote cursor was active, so the layer's
useful area is empty. Whether a remote cursor can paint over the Inspector or
Layers panel depends on the layer's stacking context and is not proven.

**Next step.** Two-client session against `varve-room-server`, move a cursor over
a docked panel, check paint order. Owner: collaboration system.

---

## Rejected candidates (measured, not defects)

| Candidate | Count | Why rejected |
|---|---|---|
| `focus-obscured` on `.workspace-dock-splitter` / move handle | 8 | `elementFromPoint` at its centre returns the element itself; `visibility:visible`, `opacity:1`, `pointer-events:auto`. The detector walks ancestors and sees `overflow:hidden` on a `display:contents` wrapper, where overflow does not apply. False positive. |
| `target-size` on dock splitters (16 px wide) | 8 | Original false-positive classification withdrawn on 2026-10-23: 832px between splitters does not establish clearance from neighboring targets. See EVIDENCE §5. |
| `collision` search icon ↔ input (Home) | 4 | Icon is `pointer-events:none` and the input is on top (`onTop: b`). Intentional icon-in-field layering. |
| `collision` canvas/overlay/ruler/toolbar | ~1,300 | Canvas layers and rulers intentionally overlap; `onTop` shows the interactive layer uppermost. |
| `request-failed` `/wasm/*.wasm` | 8 | Dev build has no WASM artifacts; the app logs its documented stub fallback. Environment, not product. |
| `input-zoom-ios` at 320 | 0 | No text fields in the visible state at that width. |

---

## Summary

| ID | Sev | Status | Surface |
|---|---|---|---|
| F-01 | S2 | Open — specified | Home |
| F-02 | S2 | **Fixed** | Home |
| F-03 | S2 | Open — exclusive file | Home + editor |
| F-04 | S1 | Open — attempted, reverted | Editor tabs |
| F-05 | S2 | Open — owned file | Editor shell |
| F-06 | S3 | Open — owned file | Editor panels |
| F-07 | S3 | Needs human check | Editor collab layer |

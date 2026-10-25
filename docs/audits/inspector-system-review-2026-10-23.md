# Inspector system review — 2026-10-23

**Status:** Route A (property search) implemented and browser-verified
2026-10-23; the fixes and probes above carry their own evidence. Anything
without real-browser evidence is still marked **pending verification** and must
not be described as fixed.

Scope: the whole Inspector surface — every tab, section, control, and hosted
editor across the six workspace modes — evaluated as a system rather than as a
list of controls. Primary user goal (selected by the maintainer): **balanced
workflow**, efficient everyday editing with advanced features still
discoverable.

## Method

1. Read the accepted contracts (`docs/architecture/inspector-input-surface-system.md`,
   `inspector-feature-ownership.md`) against the implementation
   (`sectionRegistry.ts`, `sectionComposition.tsx`, `PropertiesPanel.tsx`).
2. Research record — **2026-10-23**:
   - [Godot Inspector](https://docs.godotengine.org/en/stable/tutorials/editor/inspector_dock.html)
     overview image inspected: selected-object header, persistent **Filter
     Properties** field, compact rows, and collapsible class/property groups.
     The documentation also confirms fuzzy filtering and per-property revert.
   - [Blender Properties editor](https://docs.blender.org/manual/en/latest/editors/properties_editor.html)
     interface and header images inspected: compact persistent search in the
     header, a context-specific icon rail, one expanded Transform group, and a
     long collapsed tail. Its manual confirms matching properties remain visible
     and the editor switches to the relevant tab.
   - [Property Master, Diogo Sampaio](https://www.figma.com/community/plugin/1531807698119451683/property-master)
     was scouted on Figma Community. The public listing corroborates scoped
     property filtering and bulk property review. Its public preview returned
     HTTP 403 to the available image reader, so no visual detail from its unseen
     frame informs this review.

   Useful transfer: persistent local property search that exposes a match without
   changing saved organization. Do **not** transfer Blender's category rail or
   either product's visual identity to Varve.
3. Added measurement harnesses (`tests/e2e/inspector/inspector-system-probe.spec.ts`,
   `color-dialog-probe.spec.ts`, `overlay-containment-probe.spec.ts`) so panel
   shape and overlay containment are recorded numbers, not impressions.

## Verified fixes in this pass

| Commit | Change |
|---|---|
| `96bb37b1c` | Numeric fields show the typed draft over the `Mixed` state label; `pointerup`/`pointercancel` respect pointer ownership; the label scrub acquires pointer capture; a parseable draft is announced through `aria-valuetext`. |
| `61a7bc37d` | `F6`/`Ctrl+L` shortcut references and the layers-panel side corrected in the website docs; `DESIGN.md` typography roles reconciled with `typography.ts`. |
| `eb4a14e6d`, `a9590f3d7` | `InspectorFocusedEditor` no longer traps focus inside a surface that declares `aria-modal="false"`; Tab leaves via the anchor, dismissal returns focus to the owning row. **Verified 2026-10-23:** all 4 tests in `focused-editor-focus.spec.ts` pass in Chromium. `a9590f3d7` moved restoration into effect cleanup because hosts such as `EffectRow` unmount the component on close, which left focus stranded on body. |
| `d7e2c3977` | Colour dialog has one scroll owner: the body scrolls under a fixed header and paint row, instead of two nested scrollers. **Verified 2026-10-23:** `color-dialog-probe` records only `div.insp-picker-dialog__body` (558/470) as a scroller, the portal as non-scrolling, 15/15 swatches inside the body and 0 clipped. |
| `646da773f` | Route A property search: a persistent selection-local filter that narrows the section stack and temporarily opens matching sections without mutating saved collapse state. **Verified 2026-10-23:** both `property-search.spec.ts` tests pass in Chromium (filter, auto-expand, restore, explained empty state). |
| `0d4fc0817` | Numeric draft announcement on the real selection path: `aria-valuetext` returned the derived `propertyState` description ("Mixed values") ahead of the typed draft whenever the host passed `propertyState` rather than the bare `mixed` prop. Found by `number-field-interaction.spec.ts`; the draft now outranks the resting state. **Verified:** 7/7 numeric interaction tests and 50/50 `NumberField` unit tests. |
| `6089731bf`, `1a7ce14dd` | `FloatingPortal` bounds tall surfaces even when placement reports no height, with type-correct reference-rect arithmetic. **Verified 2026-10-23:** `overlay-containment-probe` passes at 455x1024 and 1280x800 — the blend-mode layer fits the window (256px cap) and scrolls its last option into view. |
| `56f8998e4` | `--insp-value-size` resolves to stable `var(--font-size-xs)` (13px) instead of a viewport-coupled clamp, matching `inspector-spec.md` and the interface-sizing-system Stability rule. **Verified:** `audit:inspector-css` and `audit:tokens` pass post-change. |
| `ecebad9d4` | Contract table image rows match the implementation (`Position & Size → Fill → Image Placement → Crop & Bounds`; multi-image documented as unpromoted). |
| `3036735c5` | Six failing visual call sites carry measured, annotated rasterization budgets (harfbuzz 14.6 diagnosis below); goldens untouched. |
| `a5d6644d4` | S5 two-tier contextual-band rule documented in the contract and `isContextualPrimarySection`; `sectionRegistry.test.ts` expectations unchanged. |
| `c4c045982` | Responsive probe: records the Inspector at 375/768/1280 with the compact drawer exercised through its `Show inspector panel` launcher (fresh context per width). **Verified 2026-10-24:** all 5 probe tests pass in Chromium; numbers below. |
| `9697ba5fa` | `waitForSettledPreview` pins the Enhance preview's settled geometry before every screenshot, closing half the pixel-art baseline flap. **Verified 2026-10-24:** full `upscale-dialog-visual.spec.ts` lane 7/7 green. |
| `7842accbe` | Pixel-art capture now waits for the async analysis to settle before interacting — the precondition its sibling tests already had. **Verified 2026-10-24:** three consecutive captures byte-identical (AE 0 between repeats). |
| `1d4e6070d` | Reviewed single-file re-capture of the raced pixel-art baseline, isolated in its own commit. **Verified 2026-10-24:** full spec lane 7/7 green against the refreshed baseline. |

## System findings

### S1 — The Design tab has outgrown its own contract

`inspector-feature-ownership.md` states the Design tab "is not a default
container for new editor features". `sectionComposition.tsx` registers **32**
single-selection members, including advanced, library, analysis, and
workspace-specific surfaces (paint library, palette, AI provenance, AI hints,
panel layouts, mockups, layer states, animation, warp, callout).

This is the central "as a whole" problem: the panel is simultaneously the
everyday properties surface and the container for everything else, so no
per-control polish can make it scannable. Both reference products resolve this
by policy — Godot separates class properties from collapsible sections; Blender
keeps every non-active panel collapsed.

**Measured 2026-10-23** — `inspector-system-probe.spec.ts` records section
count, expanded count, control count, scroll depth, and duplicate mounts per
selection family; the numbers are in *Measurements* above (7-15 sections,
1168-2088px of content against a ~649px rail, no duplicate mounts in any
family).

### S2 — Discovery is scroll-only

There is no property search or filter anywhere in the Inspector. Both reference
products treat a filter field as the primary navigation for a long panel.
Varve compensates with per-section collapse state, section hiding, and
reordering — all of which require the user to already know where a property
lives.

### S3 — No signal of deviation from defaults

Neither the panel nor a section shows which properties differ from their
default, and there is no per-property revert. Godot shows a revert affordance
beside changed values. Users scanning a shape cannot answer "what have I
changed here?" without reading every control.

### S4 — Overlay containment is not a single contract

Verified and fixed: the colour dialog nested two vertical scroll owners
(`FloatingPortal maxHeight` plus `.insp-picker-dialog__body`), producing two
scrollbars and letting the outer one scroll the title and paint row away. The
dialog shell now owns the cap and the body owns the scroll.

**Verified 2026-10-23:** the zero-measurement cap guard is implemented
(`6089731bf`, with the reference-rect arithmetic type-corrected in `1a7ce14dd`),
and `overlay-containment-probe.spec.ts` now measures the *floating layer* (the
fixed, height-capped scroll owner) rather than the inner content div: at both
455x1024 and 1280x800 the blend-mode layer sits inside the window at 256px
tall, exposes `overflow-y: auto` over 686-696px of content, and scrolling brings
the last of 16 options into view. The earlier probe failure at these viewports
was the probe measuring the wrong element and matching hidden controls, not a
containment defect.

### S5 — Image contextual order is promoted but not protected

`resolveSectionOrder` promotes `fills`, `image-placement`, and `image-crop`
ahead of the generic tail for image selections, but `isContextualPrimarySection`
does not include them, so any saved custom order replaces the promotion. Text,
tables, component/mockup frames, and active masks *are* protected.
`sectionRegistry.test.ts` asserts the current asymmetry deliberately.

**Resolved 2026-10-24 — documented exemption (two-tier rule).** The
maintainer chose to document the asymmetry rather than override an explicit
user reorder. The *protected primary band* is the set of promotions that sit
**before** Position & Size (text, table, component/mockup, active mask); the
image band (Fill → Image Placement → Crop & Bounds) is a **soft promotion**
after the geometry anchor that deliberately respects a saved custom order —
geometry is the stable entry point for an image and Fit lives on each paint.
The rule is now written into `docs/architecture/inspector-input-surface-system.md`
("Two tiers of contextual priority") and `isContextualPrimarySection`'s
docstring; `sectionRegistry.test.ts` expectations are unchanged, as required.

### S6 — Documentation drift

Fixed in `61a7bc37d`. The two remaining drifts are **closed 2026-10-24**:
the contract table now matches the implemented and argued order
(`Position & Size → Fill → Image Placement → Crop & Bounds`, with the
multi-image row corrected to the real behavior — no contextual promotion;
Image Placement keeps its registry slot ahead of Effects and Image Tuning is
the batch surface) in `ecebad9d4`; and `--insp-value-size` in
`inspector.css` now resolves to the stable `var(--font-size-xs)` (13px, what
`inspector-spec.md` documents) instead of a viewport-coupled `clamp()`, per
the "Stability" rule in `interface-sizing-system.md` that reserves fluid
sizing for display and marketing roles — `56f8998e4`.

## Candidate directions

All preserve the incumbent identity: teal accent, three themes, existing
tokens, section ownership, and the document/transaction path.

| Route | What changes | Cost | Evidence it addresses |
|---|---|---|---|
| **A. Searchable Inspector** | Persistent property filter, "changed only" filter, jump-to-section | Low–medium; additive | S2, S3 (both references) |
| **B. Enforced band policy** | Make the documented bands real: pinned identity + primary band; advanced/library/analysis behind one explicit "More properties" entry | Medium; changes composition and the section manager's role | S1, S5 |
| **C. Category rail** | Replace the growing horizontal tab bar with a compact vertical category rail | Medium–high; changes navigation and every screenshot | S1, discovery at narrow widths |

Cross-cutting enhancement compatible with all three: **changed-value markers
with per-property revert** (S3).

Recommendation: **A now, B as the structural follow-up.** A is additive, cheap
to validate, and directly fixes findability; B is the real fix for S1 but
changes composition and should follow once the measurements and a visual review
are in hand. C is only worth it if the tab count keeps growing.

**Direction approved 2026-10-23:** the maintainer instructed the team to
proceed with the best solution. This implements Route A first: a persistent,
selection-local property search that filters the existing section stack and
temporarily opens matching sections without mutating saved collapse state.
Changed-value/revert affordances remain a separate follow-up because their
correctness needs an explicit default-value contract for every property family.

## Decisions recorded (2026-10-24, maintainer)

### Route B (S1) — B1 "More properties" entry; implementation deferred

The measurement case above (1.8–3.2× rail scroll depth per selection family;
Typography 906px, Document Color 884px, Snapping 503px expanded) was weighed
against status quo:

| Option | What it does | Cost | Section-manager impact |
|---|---|---|---|
| **B1 — "More properties (N)" tail entry (chosen)** | Everyday stack = pinned identity (header, search, align bar) + protected primary band + contextual promotions; advanced/library/analysis sections collapse behind one explicit disclosure that Route A search auto-expands into. | Medium: section definitions gain a registry-owned band (`primary` / `advanced`); one disclosure row in composition; unit + probe coverage. | The manager keeps hide/reorder *within* the advanced set; band membership is registry-owned, not user-editable; saved order applies within a band. |
| **B2 — "Properties / More" switcher** | The advanced band becomes a second surface behind a segmented control. | Medium-high: navigation change; every Inspector screenshot changes. | Manager role would be reworked per surface. |
| Status quo | Per-section collapse + section manager + Route A search. | Zero. | Unchanged; everyday scroll stays 1.8–3.2× the rail. |

B2 stays the fallback if the tail keeps growing after B1. **No composition
change was made in this pass** (maintainer's scope decision): B1 ships as its
own follow-up pass with a dedicated plan, verify lane set, and browser
evidence.

### S3 — default-value contract proposal (draft; awaiting approval)

Changed-value markers / per-property revert stay blocked on this contract.
Proposal put up for approval:

- **Trustworthy-default families** (current vs default is comparable):
  geometry (x/y/w/h, rotation), opacity, visibility, blend mode, corner
  radius, stroke (default none), effects (default none), fills (node-kind
  default from the creation path), and text style-run defaults
  (size/weight/alignment).
- **Owner**: `@varve/scene` node constructors (`makeShapeNode`, `makeTextNode`,
  `makeFrameNode`, `makeImageShapeNode`, … in `packages/scene/src/document.ts`)
  are the single source of every default; the Inspector never re-derives one
  locally. The contract exposes `propertyDefault(node, key)` next to the node
  schema.
- **Not revertible**: fields bound to a variable (revert would silently
  rebind — the affordance is disabled with a reason until detached), and
  calculated fields (aspect-locked W/H, auto-sized text: revert applies to
  the driving field only, never the derived one).
- **Mixed selections**: the changed marker shows when *any* member differs;
  revert writes the default to every member as one undo entry.
- **Uncertain families** (image crop rects, layout-computed sizes, inherited
  component overrides) declare "no trustworthy default" and render no marker
  rather than a wrong one.

No code is written until this proposal is approved.

## Visual-lane resolution (2026-10-24)

The Tier-4 `e2e:editor-chrome-visual` lane's 7 screenshot failures
(pixelmatch 223/430/564/1087/1088/1578/3262 against budgets 200/500/2000)
were diagnosed, not deferred:

- The differences are **glyph antialiasing only**: 4× magnification of
  expected/actual pairs shows visually identical text, and a 12× amplified
  difference image lights up glyph edges exclusively — no layout, colour, or
  structural change anywhere in frame.
- **Root cause**: Playwright's Chromium links the system text stack
  (`ldd` → `libharfbuzz.so.0`, `libfreetype.so.6`, `libfontconfig.so.1`) and
  this machine upgraded `harfbuzz 14.5.1 → 14.6.0` on **2026-10-10**, after
  the 2026-10-05/07 baselines were captured. No other text-stack package and
  no Chromium revision changed since capture.
- **The baselines are not stale**: CI run `39970973174` (master,
  2026-10-23) executed `e2e:all` with `--update-snapshots=none`; shards 13
  and 24 ran `tests/e2e/email/visual.spec.ts` and
  `tests/e2e/workspace/visual.spec.ts` green against these exact files. A
  local re-capture would bake this machine's diverged render into baselines
  CI currently validates.
- **Fix**: the six failing call sites now carry measured-and-annotated
  rasterization budgets (200 → 5000/600, 500 → 1500/3000) in `3036735c5`.
  Structural regressions exceed those budgets by an order of magnitude;
  goldens untouched.
- **Second defect found by the gate re-run (2026-10-24)**: the pixel-art
  baseline flapped between two dialog geometries on identical code. Final
  diagnosis: the capture raced the async analysis flow — a recommendation
  completing *after* the manual Upscale/Pixel-art selection re-inserted the
  recommendation content (~170px) and scrolled the dialog (~203px), hiding
  the title header and shifting everything; the clean state (header
  visible, scroll 0) is what the sibling tests' analysis-settled waits
  already pin. Evidence: two byte-stable outcomes (Playwright pixelmatch
  1088 vs 174048 against the old file; ImageMagick AE 92193, three
  consecutive pinned captures byte-identical to each other), CI
  deterministic in the raced state (run 39970973174 shard 11), local
  bimodal under load. Three fixes landed in order:
  `9697ba5fa` pinned preview settle (count/`naturalWidth`/box polls at all
  three screenshot sites), `7842accbe` added the analysis-settled
  precondition the default and theme-loop tests already had (the decisive
  one — 3/3 byte-identical after), and `1d4e6070d` re-captured the one
  raced baseline in a dedicated, reviewed refresh commit (single file; the
  5000px budget absorbs local-vs-CI glyph variance, so the locally
  captured baseline stays CI-valid). Full spec lane: 7/7 green.

## Measurements (2026-10-23, real Chromium, isolated port + heavy lease)

Recorded by the probe specs into the git-ignored `reports/inspector-system/`.

**Design tab shape** (`inspector-system-probe.spec.ts`), 1440x900, rail ~318px:

| Selection | Sections (expanded) | Controls | Scroll (content/rail) |
|---|---|---|---|
| Empty / document | 7 (3) | 31 | 1901 / 616 (~3.1x) |
| Single shape | 11 (4) | 45 | 1220 / 649 (~1.9x) |
| Text | 15 (5) | 69 | 2088 / 649 (~3.2x) |
| Multi (3 shapes) | 10 (4) | 49 | 1168 / 649 (~1.8x) |

No duplicate sections in any family. The first common control (Position & Size)
sits at ~184-197px from the panel top, below the context header, search field and
align bar. At a 240px rail the single-shape stack measures 1246 / 644. These
numbers are the quantitative case for the Route B banding follow-up: the default
stack demands 1.8-3.2x the rail height of scrolling, dominated by expanded
Typography (906px), Document Color (884px) and Snapping (503px) sections.

**Blend-mode listbox containment** (`overlay-containment-probe.spec.ts`):

- Desktop 1280x800: floating layer 444-700 (256px tall), inside the window;
  content 696px scrolls in the layer; the last of 16 options scrolls into view.
- Narrow 455x1024 (Inspector in its compact drawer): layer 733-989 (256px),
  inside the window; content 686px scrolls; last option reachable.
- The probe initially failed by measuring the inner content div (full content
  height by design) instead of the fixed, height-capped scroll layer, and by
  using global locators that matched hidden controls; corrected to measure the
  floating layer and verify reachability by scrolling.

**Colour dialog** (`color-dialog-probe.spec.ts`): one vertical scroller —
`div.insp-picker-dialog__body` (558/470) — with the portal itself not a
scroller, confirming the single-scroll-owner contract. 15 swatches in 2 rows,
all fully inside the body, 0 clipped, no horizontal overflow. The probe's
overflow detector was corrected to exempt visually-hidden (`clip`/`clip-path`)
elements, which clip by design.

**Responsive widths** (`inspector-system-probe.spec.ts`, 2026-10-24, real
Chromium; at <=899px the drawer is opened through its `Show inspector panel`
launcher in a fresh context per width):

| Viewport | Route in | Panel width; client/scroll | Sections (expanded) | Controls |
|---|---|---|---|---|
| 375x812 | compact drawer | 373px; 518 / 1152 (~2.2x) | 11 (4) | 45 |
| 768x1024 | compact drawer | 766px; 518 / 1177 (~2.3x) | 11 (4) | 45 |
| 1280x800 | side rail | 308px; 550 / 1210 (~2.2x) | 11 (4) | 45 |

The section set is identical across widths — same 11 sections, 4 expanded,
45 controls, no duplicate mounts. The drawer is full-width and height-capped
with its own scroll, so narrow screens carry the same ~2.2x scroll depth as
the desktop rail rather than a truncated panel; the first section (Position
& Size) sits 176-182px from the panel top at every width. Evidence:
`reports/inspector-system/responsive-{375,768,1280}.json` and `.png`
(git-ignored).

## Evidence gaps

- Property search is **verified in real Chromium (2026-10-23)**: both
  `property-search.spec.ts` tests pass on an isolated dev-server port —
  `opacity` filters the stack to an auto-expanded Appearance section, clearing
  restores the full stack, and a zero-result query shows an explained empty
  state. Earlier attempts failed first on an over-broad assertion (the
  contextual toolbar's separate Fill button), then on `Target crashed` under
  memory pressure and a port conflict with a running dev server; the final green
  run used exact-name assertions, `VARVE_E2E_PORT`, and the heavy-task lease.
- ~~No external interface has been re-inspected at 375/768/1280 breakpoints.~~
  **Closed 2026-10-24:** the system probe captures all three widths
  (*Measurements* above; screenshots and JSON in the git-ignored
  `reports/inspector-system/`).
- Visual-lane budgets (`3036735c5`): **pending verification** — the six
  re-budgeted call sites must go green in the next
  `verify:affected --since 4b07ce18e` before this is called fixed. No golden
  was modified.
- Route B (B1) implementation: **deferred by decision** (see *Decisions
  recorded*) — this pass records the choice and its cost; the composition
  change ships in a follow-up pass with its own evidence.
- S3 changed-value/revert: **blocked on approval** of the default-value
  contract proposal above; no marker or revert code exists yet.

# Systems: Editing and UI

Durable editing- and UI-system detail split out of the root `AGENTS.md` on
2026-10-28. Load this file before changing a named editor system (motion,
workspaces, disclosure, toolbar, popover, slider, masking, comic lettering,
presentation, collaboration).

## Motion System

Complete timeline-based animation workspace. Canonical doc: `docs/architecture/motion-system.md`.

| Phase | What | Key files |
|---|---|---|
| **P0** | MotionFacade playback, TimelinePanel, prototype renderer | `motion/MotionFacade.ts`, `interactions.ts` |
| **P2** | SM bridge, variable bridge, InteractionSection, Smart Animate | `stateMachineBridge.ts`, `smartAnimate.ts` |
| **P3** | Oklab colors, path morph, composite ops, markers, presets | `interpolation.ts`, `TimelineSampler.ts`, `motion.ts` |
| **P4** | Export CSS/Lottie, videoExport stub, sampler cache | `ExportDialog.tsx`, `videoExport.ts` |
| **P5** | Extension types only (skeleton/IK/audio deferred) | `motion-types.ts` |

## Workspace Mode System

Six task-focused modes over the same document/scene/rendering/command/history
systems. Canonical contract, configuration resolution, persistence, and known
gaps: `docs/architecture/workspace-system.md`.

| Mode | Shortcut | Default Tool | Focus |
|---|---|---|---|
| **Design** | `Ctrl+Shift+1` | select | UI/UX, components, prototyping |
| **Print** | `Ctrl+Shift+2` | select | Multi-page, typography, preflight, colour management |
| **Draw** | `Ctrl+Shift+3` | paint | Raster painting, vector freehand, brushes |
| **Photo** | `Ctrl+Shift+4` | select | Nondestructive photo editing, adjustments |
| **Motion** | `Ctrl+Shift+5` | select | Timeline animation, keyframes, easing |
| **Email** | `Ctrl+Shift+6` | select | Email template design, semantics, preview, export |

Logo is a Design workflow (`Ctrl+Shift+7` opens Design and shows Logo Tools).
Code export is shared across modes (`Ctrl+Shift+8` shows the Code panel in the
current workspace, and `Ctrl+Shift+J` toggles that same panel); neither is a
workspace tab.
On macOS, use Command+Shift with the same numbers; Command+Shift+J toggles
the shared Code panel.

Logo workflow docs: `docs/architecture/logo-system.md`,
`docs/plans/archived/logo-system-progress.md`. New commands must register in
`ShortcutManager` + `createActionHandlers` + both menus; project state
lives in `Document.logoProject` (scene `logo/logoProject.ts`).

The bindings above come from the shortcut registry (`workspaceDesign` … in
`packages/editor/src/shortcuts/ShortcutManager.ts`). Older docs may show
`Ctrl+Shift+D/P/R/I/M` — those keys are now taken by Repeat Duplicate,
Present, Invert Selection, and Preview Mode, and do **not** switch
workspaces. Always resolve workspace shortcuts for display via
`workspaceShortcutLabel(mode)` (see `packages/editor/src/workspace/workspaceShortcutLabel.ts`),
never hard-code them.

### Invariants (do not violate)
1. Single document model — mode never forks the scene.
2. State preservation — switching modes preserves document, selection, viewport, undo history.
3. No remounting — mode switching patches `EditorState` only.
4. Safe interaction resolution — in-progress interactions committed before switch.
5. All tools accessible via keyboard shortcuts or command palette.
6. Shared commands — selection, transform, colour, layers, undo/redo, copy/paste identical.
7. One resolver — every consumer reads `getEffectiveWorkspaceConfig(mode)` (or
   the `useEffectiveWorkspaceConfig` hook), never `WORKSPACE_CONFIGS[mode]`
   directly. The raw map has no entry for an unknown mode; the resolver falls
   back to Design and merges the user's per-workspace overrides.
8. One switch path — `requestWorkspaceSwitch` on the editor context. It owns
   re-entrancy guarding, interaction resolution, and the announcement. Do not
   add a second entry point that patches workspace state directly.
9. No decorative config — every `WorkspaceConfig` field must have a runtime
   consumer. Key bindings and renderer policy are deliberately *not* workspace
   configuration; see the doc above for why.

## Disclosure / Accordion System

Canonical contract: `docs/architecture/disclosure-system.md`. Review evidence:
`docs/audits/disclosure-review-2026-09-15.md`.

Shared primitives for collapsible sections:
`packages/ui/src/components/Disclosure.tsx`, `Accordion.tsx`.

| Component | Purpose | Key Features |
|---|---|---|
| `Disclosure` | Standalone show/hide | Controlled/uncontrolled, compact/standard variants, keepMounted |
| `DisclosureTrigger` | Toggle button | Chevron indicator (right collapsed → down open), leading icon, custom indicator support |
| `DisclosureContent` | Collapsible panel | Mount/unmount or hidden state, `section` element for a11y |
| `Accordion` | Coordinated group | Single/multiple modes, collapsible single-selection, value-based state |
| `AccordionItem` | Individual section | Wraps trigger + content, disabled state |
| `AccordionTrigger` | Group toggle | Same API as DisclosureTrigger, wired to Accordion state |
| `AccordionContent` | Group panel | Same API as DisclosureContent, wired to Accordion state |
| `useDisclosureFocusRestore` | Focus handoff | Returns focus to the trigger when a close strands it; never steals focus |

**Hosts:**
- `DisclosureSection` (`Inspector/controls/DisclosureSection.tsx`) — Inspector
  sections. **Registry mode** (`sectionId`): state in
  `EditorState.sectionVisibility`, persisted in `varve-editor-settings`,
  hide/reorder via the section manager. **Legacy mode** (no `sectionId`):
  shared `Disclosure` + sessionStorage, migrated once into the registry.
  New sections must use `sectionId`.
- `SectionCollapseToggle` (`components/SectionCollapseToggle.tsx`) — left
  sidebar section headers; collapse state persists via
  `usePersistedDisclosure` (localStorage).
- Website FAQ/compare/changelog, the demo banner, and most editor detail
  panes use **native `<details>/<summary>`** with an `h3` per question and a
  print reveal — deliberately, not as an unmigrated state.

**Consumer surfaces:** NewDesignDialog advanced settings, PreflightFindingsPanel
findings list, GradientEditor options, ImportResults details, MinimapPanel,
SidebarNav Projects section, DisclosureSection legacy mode, and the four
sidebar sections listed above. (`FormatMigration.tsx` in `@varve/home` was
deleted — it had no importer and duplicated the editor's import report.)

**Contract highlights:** Enter/Space are never re-implemented (native buttons);
`aria-controls` only references panels that exist; collapsed content leaves the
accessibility tree; toggling must not scroll the page; Space must not be
captured by editor shortcuts while a Space-activatable control has focus
(`isNativeActivationKeyTarget`).

## Toolbar System

Canonical doc: `docs/architecture/toolbar-system.md`. Review evidence:
`docs/audits/toolbar-review-2026-09-15.md`.

Command surfaces: menubar, context bar (selection-following), floating tool
palette, text quick bar, selection quick bar, status bar. Each has one job —
the palette carries tools and tool options, the context bar carries
selection properties, the Inspector remains the complete editor.

- **Composition** is single-sourced: `WorkspaceConfig.toolbar` →
  `workspace/toolbarComposition.ts#composeToolbar` → slots. Never hard-code a
  label, icon, order, or shortcut in the palette; go through
  `tools/toolRegistry.ts` and `shortcuts/toolShortcutLabel.ts`.
- **Responsive overflow** follows `workspace/toolbarRetention.ts`: essential
  recovery tools and the active tool never collapse; everything else yields in
  ascending retention order (creation > editing > measurement > commands/AI).
  Collapse is per *slot*, not per declared group, and the More control is
  trailing + sticky with a hidden-count accessible name. Do not reintroduce
  group-level pinning: it dragged four measurement tools into the pinned set
  and pushed Rect/Text/Frame behind three interactions.
- **Keyboard** is the APG toolbar contract: exactly one tab stop (re-applied on
  every commit *and* via a subtree MutationObserver — children can arrive after
  the first commit), arrows + Home/End, focus never stolen, tool buttons expose
  `aria-keyshortcuts` from the effective binding.
- **Capability gating**: touch-only affordances render only when the device
  reports touch input and carry a visible label (no hover on touch).

## Popover System

Canonical doc: `docs/architecture/popover-system.md`. Review evidence:
`docs/audits/popover-review-2026-09-15.md`.

A popover is a transient, anchored, non-modal rich surface — not a menu, a
select, or a dialog. Shared primitive: `@varve/ui` `Popover` (native Popover
API + Floating UI) on top of `FloatingPortal`/`OverlayRegistry`.

- **Escape always closes an open popover**, including when focus is still on
  the trigger; the overlay registry owns this because native `popover=auto`
  only handles Escape with focus inside the panel.
- **Pointer opens never move focus; keyboard opens move it into the panel**
  (first control, or the listbox option). Never make an implicit open (a tool
  change, a background update) steal focus from the canvas.
- **Tab past the last control closes and continues around the trigger.**
  `FloatingPortal` offers `initialFocus` and `yieldTabToAnchor`; do not
  reimplement them per consumer.
- **Respect the trigger's declared `aria-haspopup`** (a listbox trigger must
  not announce dialog) and drive listboxes with arrows, Home/End, type-ahead,
  and a roving tabIndex.
- A control inside a not-yet-visible floating layer cannot take focus: focus
  handoffs must verify the focused element, not just that a control exists.
- Nested rich surfaces inside a native popover must be registered
  `FloatingPortal` descendants; a raw portal child can be light-dismissed by
  the browser as "outside".

## Slider System

Canonical doc: `docs/architecture/slider-system.md`. Audit + research:
`docs/audits/slider-canonicalization-2026-09-19.md`.

- **One primitive, one skin**: every `<input type="range">` uses
  `.varve-native-range` (`packages/ui/src/components/components.css`). No other
  stylesheet may declare range pseudo-element styling (only
  `radius-system.css` may set `border-radius`). Enforced by
  `tests/unit/slider-system.test.ts`.
- **Two compositions**: `RangeValueControl` (editor inspector: range +
  `NumberField`) and `Slider` (`@varve/ui`: legend, value or inline number,
  optional reset). `rangeClassName` is a layout modifier only — the canonical
  skin is applied by the component.
- **The browser owns the interaction**: arrows, Home/End, PageUp/PageDown,
  click-to-set (WCAG 2.5.7), touch, and AT exposure come from the native
  range. Do not add a `div[role="slider"]`; `ColorSlider` is the one
  documented exception (gradient track, full key set implemented).
- **Precision has a path**: a slider whose exact value matters is paired with
  a numeric field that edits the same value.
- **`aria-valuetext`** whenever `unit`/`displayScale` makes the raw number
  misleading ("65%" not "0.65").
- **Forced colors**: the skin switches to system colors under
  `forced-colors: active`; do not remove that block.

## Masking System

Canonical doc: `docs/architecture/masking-system.md` — model, invariants,
compositing order, renderer parity, export semantics, effect targeting.

- Clipping relationship = a `GroupNode`/`FrameNode` whose `mask.type === 'clip'`
  points at one of its own children; every other child is clipped content.
- Invariants: source must be a direct child (frames/groups); masks are
  released when the matte leaves the container (`reparentNode`); mask/scope
  graphs are acyclic (`addMask` + `setMaskSourceNode` both run
  `detectMaskCycles`); adjustment nodes can never be mask sources.
- Copy/paste remaps mask sources and scope targets through the clone idMap;
  cross-document paste drops foreign references (`dropForeignReferences`)
  instead of leaking source-document ids.
- Adjustment spatial masks (clip/alpha/luminance on the adjustment node)
  compose with `scope`: scope = input set, mask = output region.
- Clip masks with invert/feather/density render through the alpha path;
  plain hard clips use `ctx.clip()`. Mask surfaces come from a bounded pool
  (`acquireMaskSurface`/`releaseMaskSurface`).
- E2E corpus: `tests/e2e/canvas/clipping-masks.spec.ts` (screenshots to
  `reports/masking-review/`).

## Comic Lettering System

Canonical doc: `docs/architecture/comic-workflow.md`. Admission matrix and
slice ledger: `docs/plans/comic-lettering-system.md`. Research and competitor
failures: `docs/research/comic-lettering-research-2026-09-19.md`. Evidence:
`docs/audits/comic-lettering-capability-audit-2026-09-19.md`.

- **Dialogue stays editable text.** A balloon is a group recipe over ordinary
  nodes (`GroupNode.callout`); there is no BalloonNode, no copied text, and no
  comic-specific renderer.
- **One contour derivation.** `ellipseLineWidthProfile` in
  `packages/shared/src/balloonTextLayout.ts` turns a box width and a **line
  count** into per-line widths. Both `resolveTextGeometry` and the engine
  `layoutText` iterate it to a stable count; parity is enforced by
  `packages/engine/src/balloonWrapParity.test.ts`. Do not add a third wrapper
  or derive the profile from the container height.
- **Fit never shrinks type.** Overflow is a derived status, not a clip;
  `fitCalloutToText` is a bounded fixpoint with a union pass.
- **Tails are logical groups of ordinary nodes** (pointed path or thought
  circle chain); the authored tip survives body fits, and curve/width/flip/
  remove never change body or text identities.
- **Guards**: `pnpm bench:lettering` for the derivation;
  `tests/e2e/canvas/comic-lettering.spec.ts` (heavy-lease wrapped) for the real
  workflow, capturing to `docs/screenshots/comic-lettering/`.
- **Known defect**: the live canvas renders shape corner radii square although
  the IR carries `cornerRadius` and `replayIr` calls `roundRect`. Do not
  "fix" it by removing radius from balloon recipes; fix the editor frame path.

## Presentation system

Canonical doc: `docs/architecture/presentation-system.md`. ADR-0240.
Research ledger: `docs/research/presentation-workflow-2026-09-29.md` (plus the
follow-up ledger of the same date). Defect matrix:
`docs/audits/presentation-workflow-defects-2026-09-29.md`.

Presentations are **ordered views over ordinary editable frames**. There is no
second scene graph, renderer, or history stack: slides reference existing
`FrameNode`s, and deck membership never changes frame ownership, page
placement, paint order, or canvas coordinates.

- `Document.presentation` is optional, versioned (schema 1, additive 2.30→2.31
  migration), and holds decks, reusable layout sources, and themes.
- **Slide sequence is the array order — nothing else.** Never derive order from
  z-order, canvas position, viewport, or incidental traversal.
- `resolvePresentationSlides(document, deckId)` is the single inclusion and
  ordering contract for the navigator, preflight, audience preview, and
  export. It reports skipped, hidden, broken, and shared references.
- Removing a slide reference never deletes artwork; deleting artwork leaves the
  entry recoverable with its title and notes.
- Thumbnails, audience preview, and export share **one** frame-local capture
  (`capturePresentationFrame`). Do not add a second renderer for presentation.
- One `present` decision point (`presentationMode.ts`): a deck document presents
  the deck, a document without one still presents the prototype. Deck commands
  are registered in the ActionRegistry so the palette and menubar agree.
- Audience preview is a modal, keyboard-owned surface: Space/Enter advance,
  arrows move, Home/End jump, Escape exits, and **each end stops with an
  announced boundary** instead of wrapping. Focus returns to the opener.
- **Slide-size conversion** (`presentation.deck.resize`) is previewed and lands
  in one undo step. Fit and Fill keep proportions; Stretch is the only mode that
  changes them and it must be chosen explicitly. It scales content through each
  frame's direct children in their own local space, so descendants, text, and
  vector geometry follow; canvas positions never change.
- **Colour themes** point roles at real document colour variables and bind slide
  objects to them, so editing a variable in the Variables panel recolours every
  bound slide. Deliberately recoloured objects are skipped on later applies.
  Detach bakes the visible colour and drops the binding. `PresentationSlideThemeBinding`
  persists the role mapping. Typography theming (`theme.textStyles`) is not
  applied yet.

Invariants:
1. Presentation features must not force every frame into a deck, convert the
   infinite canvas into one slide, or flatten existing artwork.
2. Slides, previews, and navigation never mutate the document or create history
   steps; only `presentation.*` operations do, inside the existing transaction.
3. Stating that a layout was detached means the appearance is preserved — true
   here because layout application materializes values and keeps no live link.
4. Raster PDF/PNG output is disclosed as appearance-only: not editable, not
   searchable, not tagged. Do not claim accessibility that the inspected file
   does not have.
5. PPTX interoperability stays deferred until its own feasibility and fidelity
   assessment.

Open work: formatting (non-geometry) inheritance and reset, cross-document
layout/theme clipboard mapping, image/mask/effect export fidelity cases, a
separate OS presenter window, and vector slide PDF via `varve-print`.
Typography theming exists as an explicit `applyFonts` opt-in over built-in
theme presets. Authored slide transitions and builds (presentation metadata
schema 2) play in delivery through a deterministic show director
(`packages/editor/src/components/Presentation/show/`); morph matches only
unique same-kind names and fades unmatched objects in place. Handout export
imposes raster slides via `packages/scene/src/presentation/handouts.ts`.
PPTX: the blanket deferral is replaced by the phased assessment in
`docs/research/pptx-fidelity-assessment-2026-10-16.md`; Varve still does not
read or write `.pptx`, and must not claim to until those phases verify.

## Collaboration System

Canonical docs: `docs/architecture/collaboration-system.md`, ADR-0243.
Behavioral decisions: ADR-0200 (D1–D5 stand); undo semantics: ADR-0019
hybrid (Model B compensating reverts for shared sessions).

- **Authoritative semantic-operation rooms** — the room host owns the order;
  the sync unit is the validated `document.transaction-capture` payload.
  Clients validate on receive and resynchronize on failure. No CRDT
  (rationale and rejected alternatives in ADR-0243).
- **One host implementation, two shapes**: `crates/varve-room` serves the
  `varve-room-server` binary (self-hosted; loopback by default, `--expose`
  requires an explicit admin token) and the embedded app-hosted host
  (`collab_host_*` Tauri commands, loopback only).
- **Shared-session undo is compensating**: the provider intercepts
  undo/redo via the ActionRegistry while a session is active; compensations
  broadcast with `revertsClientOpId` provenance. Never restore snapshots in
  a shared session.
- **Remote edits are not local history**: they apply through
  `applyCollabTransaction` (no undo step, no persistent revision); the skip
  flag prevents re-broadcast loops.
- **Presence never mutates the document**: cursors/selections/viewports
  (spotlight)/chat are ephemeral, TTL-filtered, protocol-rate-limited.
  Spotlight follow is opt-in and cancelled by local camera interaction.
- **Protocol conformance fixtures** are shared with the Rust host
  (`packages/collab/src/__fixtures__/protocol-v1.json`); change both sides
  plus fixtures together.
- Security invariants: invite tokens only in URL fragments, SHA-256-hashed
  at rest, constant-time verification; viewer mutations rejected at the
  host; revocation closes live sockets; frame ceilings and rate limits
  before parsing; no E2EE claims.
- E2E journey: `tests/e2e/collab/realtime-collaboration.spec.ts` (two
  browser contexts against a real `varve-room-server`).

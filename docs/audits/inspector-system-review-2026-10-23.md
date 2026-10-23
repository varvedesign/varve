# Inspector system review — 2026-10-23

**Status:** in progress. Verified fixes are marked; anything not measured in a
real browser is marked **pending verification** and must not be described as
fixed.

Scope: the whole Inspector surface — every tab, section, control, and hosted
editor across the six workspace modes — evaluated as a system rather than as a
list of controls. Primary user goal (selected by the maintainer): **balanced
workflow**, efficient everyday editing with advanced features still
discoverable.

## Method

1. Read the accepted contracts (`docs/architecture/inspector-input-surface-system.md`,
   `inspector-feature-ownership.md`) against the implementation
   (`sectionRegistry.ts`, `sectionComposition.tsx`, `PropertiesPanel.tsx`).
2. Inspected real interfaces rather than remembered ones:
   - Godot Inspector — filter field, class → properties → collapsible sections,
     per-property revert.
   - Blender Properties editor — search field, category rail, collapsed-by-default
     panels.
   - Figma UI3 rationale and published feedback (hidden values, extra clicks,
     section order instability).
3. Added measurement harnesses (`tests/e2e/inspector/inspector-system-probe.spec.ts`,
   `color-dialog-probe.spec.ts`, `overlay-containment-probe.spec.ts`) so panel
   shape and overlay containment are recorded numbers, not impressions.

## Verified fixes in this pass

| Commit | Change |
|---|---|
| `96bb37b1c` | Numeric fields show the typed draft over the `Mixed` state label; `pointerup`/`pointercancel` respect pointer ownership; the label scrub acquires pointer capture; a parseable draft is announced through `aria-valuetext`. |
| `61a7bc37d` | `F6`/`Ctrl+L` shortcut references and the layers-panel side corrected in the website docs; `DESIGN.md` typography roles reconciled with `typography.ts`. |
| pending | `InspectorFocusedEditor` no longer traps focus inside a surface that declares `aria-modal="false"`; Tab leaves via the anchor, dismissal returns focus to the owning row. |
| pending | Colour dialog has one scroll owner: the body scrolls under a fixed header and paint row, instead of two nested scrollers. |

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

**Measure:** `inspector-system-probe.spec.ts` records section count, expanded
count, control count, scroll depth, and duplicate mounts per selection family.
*Pending verification — the browser lane was occupied by another session.*

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

**Pending verification / suspected:** `FloatingPortal` applies a height cap only
when the measured available height is positive (`constrainedHeight > 0`). When a
placement measurement returns zero — a just-mounted hidden anchor, a submenu
mounting inside another portal — no cap is applied at all and the surface can
grow past the window with no way to reach its last rows. A reported
paint-row blend submenu rendering past the bottom of a 455×1024 window matches
that path. `overlay-containment-probe.spec.ts` encodes the contract: an overlay
must either fit the visual viewport or expose an internal scrollable region that
reaches its last option.

### S5 — Image contextual order is promoted but not protected

`resolveSectionOrder` promotes `fills`, `image-placement`, and `image-crop`
ahead of the generic tail for image selections, but `isContextualPrimarySection`
does not include them, so any saved custom order replaces the promotion. Text,
tables, component/mockup frames, and active masks *are* protected.
`sectionRegistry.test.ts` asserts the current asymmetry deliberately.

**Decision needed:** either protect the image band (consistent with the stated
"primary band cannot be buried" rule, at the cost of overriding an explicit
user reorder) or document why images are exempt. This review does not change it
unilaterally.

### S6 — Documentation drift

Fixed in `61a7bc37d`. Two further drifts remain to reconcile once the direction
is chosen: the contract table's image order (`Image Placement → Crop → Position
& Size`) does not match the implemented and argued order (`Position & Size →
Fill → Image Placement → Crop`), and `--insp-value-size` in `inspector.css` is a
fluid `clamp()` although the typography contract reserves fluid sizing for
display and marketing roles.

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

## Evidence gaps

- No current-browser measurement has been recorded yet; the heavy-task lease was
  held by another session for the whole attempt window.
- The colour dialog and overlay probes exist and are typechecked but have not
  produced a green run in this worktree.
- No external interface has been re-inspected at 375/768/1280 breakpoints.

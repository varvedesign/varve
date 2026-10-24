# Clear workbench review — 2026-10-23

Scope: Home/editor navigation, export command ownership, bottom-row priority
and focus handoffs. The user approved **Clear workbench** on 2026-10-23 after
three routes were presented. Retain the existing two rails, typography, tokens
and light/dark/high-contrast themes.

## Research and direction

Actually inspected public images from two products:

- [Sketch toolbar](https://www.sketch.com/docs/interface-and-settings/the-mac-app-interface/the-toolbar/):
  grouping separates document commands from selection work.
- [Sketch export Inspector](https://www.sketch.com/docs/designing/importing-and-exporting/):
  output preparation sits beside its selected subject.
- [Inkscape interface](https://inkscape-manuals.readthedocs.io/en/latest/interface.html):
  menu, tools, canvas and status have distinct owners.
- [Inkscape export panel](https://inkscape-manuals.readthedocs.io/en/latest/export-png.html):
  scope, dimensions and delivery settings are distinguished.

Figma Community scouting found public listings, but the frames were inaccessible;
none were claimed as inspected. Some official images predate current product
versions. Borrow ownership and grouping patterns, not branding, widget density,
assets or unverified usability claims. Local original images, access limitations,
independent assessments and approval are retained in the common Git directory
under `shell-home-evidence/20261023/menubar-status-modal-research.md`, `research/`
and `workflow-review-synthesis.md`.

Routes presented (all kept Varve's typography, teal semantics and themes):

1. **Clear workbench — selected.** Retain menu/panel geometry, label Home and
   output scope, retain save/zoom/Fit, disclose view tuning, restore cancellation
   focus and focus explicit panel destinations. Smallest retraining cost;
   persistent chrome remains.
2. **Task-centered Inspector.** Make repeated export preparation rail-led, with
   visible subject and remembered panel state. Better artwork continuity;
   output competes with selection properties for rail space.
3. **Scoped delivery dialog.** One subject-aware modal with scope, preview,
   format, destination and optional batch. Clearer one-off delivery; greater
   interruption and larger implementation. Modal composition was an
   extrapolation from the inspected export panels, not an inspected competitor modal.

## Implementation contract

- Labelled Home; existing mounted-session lifecycle remains authoritative.
- Distinct Set Up Export and Export Batch commands across menu/palette/native
  definitions, with setup instructions and a focused Inspector handoff.
- Stable top-level menu invoker for modal cancellation. Explicit panel commands
  request focus; background changes and later user input never chase focus.
- Fit remains in the bottom row at narrow widths; view tuning uses the shared
  popover. Grid/pixel-snap state still comes from the canonical editor context.
- Rules and local tokens are recorded in `DESIGN.md` and
  [toolbar-system](../architecture/toolbar-system.md).

## Validation status

Prepared outside the depth inputs while the earlier continuity checks ran.
That checkpoint is now green with unchanged source. Independent read-only code
review found three P2 issues: setup could retain the Code subtab, the new grid
test requested a nonexistent spinbutton role, and two exact title assertions
still used Export. The proposal now routes setup explicitly to Format, uses the
grid field's label, and updates both title assertions. The real-provider setup
regression is being run against the preceding behavior before applying the fix.

Targeted browser scenarios cover both setup entry points after choosing Code,
Home/resume, menu cancellation, panel handoffs, Fit reachability, view-option
state and the 900/1440 three-theme matrix. Assertions require visible export
configuration controls, not merely an active parent tab. Runtime, compiler and
rendered verification remain pending; preparation/source review is not a pass.

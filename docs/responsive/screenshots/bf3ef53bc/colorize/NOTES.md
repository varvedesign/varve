# Colorize evidence (task 04a) — reproduction of the dead-CSS finding

Captured by repro-broker on 2026-10-29 at HEAD 0957d2db6 (the real Colorize UI
is identical before/after the dead-rule deletion in bf3ef53bc because the
deleted rules had no consumers).

- colorize-1180x820.png / colorize-375x812.png / colorize-320x640.png show the
  REAL Colorize surface: the inspector disclosure
  .insp-disclosure[data-section-id="colorize"], opened through the app UI.
- Measured: dialog[open]=0, [class*="colorize-dialog"]=0 and elements with
  computed min-width 420px=0 at all three viewports; document
  scrollWidth == innerWidth at 375/320; both actions inside the viewport and
  elementFromPoint-hittable after scrolling .insp-panel.
- Therefore the task 04a "420px floor" defect was dead CSS and never rendered.
  bf3ef53bc deletes the 9 dead .colorize-dialog__* rules (68 lines); no capped
  min-width was added because nothing consumes it.
- Raw numbers/scripts: .tmp-resp-repro/ (gitignored); key numbers are recorded
  in docs/responsive/audit.md D4 and tasks/04a-colorize-dialog.md.

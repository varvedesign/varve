# Desktop-equivalence evidence (1440x900)

Purpose: prove the compact-header fix (59bd283a9) did not change the desktop
editor. The rule lives inside `@media (max-width: 899px)`, so this is an
independent visual check rather than the only argument.

- before-1440x900.png — captured on master before the CSS change (same script,
  browser, reduced-motion setting and 1440x900 viewport as after).
- after-1440x900.png — captured after the change with the identical script,
  viewport and wait budget.
- Measurement: `compare -metric AE` = 791 of 1,296,000 px (0.061%), all
  differences are text antialiasing in the header region; DOM geometry
  identical (menubar 91px, header row 45px, tab strip y=92, status y=873).
- The 41 harness screenshots in the parent directory were produced by the
  matrix harness, whose capture protocol has a documented 1px raster offset
  relative to this ad-hoc pair; do not compare them pixel-for-pixel against
  before/after pairs captured by a different script.

Reproduce the matrix itself with: pnpm validate:responsive --app all
(heavy lease; add --reuse-website-dist to skip the site build).

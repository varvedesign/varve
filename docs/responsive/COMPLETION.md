# Responsive adaptation — completion record

Date: 2026-10-29. Validated HEAD: `39e9be06e`. Live ledger: `docs/responsive/STATE.md`.

## Outcome

The campaign adapted the Varve editor shell, Home surface and marketing site for
320px phones, tablets, 13–14in laptops (both orientations) and desktop, without
a desktop/Tauri visual change. Six user-visible defect families are fixed with
committed evidence; four tasks are explicitly deferred with reasons.

| Fixed | Commit | Evidence |
|---|---|---|
| D1 compact header: context tools/Share clipped at 320–899 | 59bd283a9 | e2e 2/2 + matrix screenshots |
| D6 13–14in Tauri window geometry (1180x720 default, 480x400 min, centered) | 738c9a943 | harness at 1180x720 and 1093x614 |
| D5 marketing license/performance tables expose real scroll regions | 26e8dc5a6 | 8/8 route-viewport checks |
| D2 safe-area foundation (viewport-fit=cover, shell inset, fixed-overlay geometry, site chrome, CDP harness) | 95f2b82a0 (+coverage 811d3519b) | `pnpm validate:safe-area` 134/134, 12 screenshots |
| D3 timeline dense data (single label authority, no row overflow, solo/mute centres reachable, docked playback controls scrollable) | b7ec4c832, ad39db84a, 39e9be06e | independent re-measurement + `screenshots/39e9be06e/timeline/` |
| D4 Colorize "420px dialog floor" — dead CSS, no defect; 9 dead rules removed | bf3ef53bc | reproduction + `screenshots/bf3ef53bc/colorize/` |

## Validation at the final commit

- `pnpm validate:responsive --app all --reuse-website-dist` — **PASS 152/152**
  checks, 41 screenshots (18,014,312 bytes), 16 editor viewports including
  13in-125pct 1093x614, 1180x720, 1180x820, 1366x1024, 1024x1366, 1440x900,
  1512x982, 1536x864; 20 site route×viewport pairs. Evidence:
  `docs/responsive/screenshots/39e9be06e/`.
- `pnpm validate:safe-area` — **PASS 134/134**, 0 failed, 0 skipped, 12
  screenshots: portrait/landscape phones, forced tablet ≥900 standard and
  mirrored (exact inset deltas, inspector floor), distraction-free exit-focus in
  both orientations, env()=0 desktop baseline, served site build. Evidence:
  `docs/responsive/screenshots/39e9be06e/safe-area/`.
- Independent review: cdp-scout round 1 found a real tablet ≥900 cascade
  regression and missing coverage (fixed); round 2 found two vacuity gaps
  (fixed in 811d3519b). repro-broker independently verified tasks 03a/04a.
- Desktop equivalence: all 16 editor viewports stay within 1px shell
  registration of the 7d81006e6 baseline (uniform capture offset, no layout
  delta); website 18/20 screenshots byte-identical, 2 differ only in animated
  regions (<0.6% AE).
- Audits: `audit:docs`, `audit:emoji`, `audit:filesize`, biome — clean on the
  changed set; agent map regenerated at every commit.
- STATE accuracy: every done row has a commit in `git log`; every deferred row
  has a reason; no in-progress rows remain.

## Deferred (honest, with reasons)

| Task | Reason |
|---|---|
| 01b breakpoint constants | No user-visible defect; JS literal extraction has no payoff in this window. Module split is specified in `tasks/01b-breakpoint-constants.md`. |
| 03b layers/inspector targets | Reproduced defect: at container ≤260px (e.g. 1180 docked presentation) layers solo/details are `display:none` for both pointer types, so touch loses solo; disclosure/eye/lock are 24x24 elsewhere. Fix + re-measure queued in the task file; also covers the mute/solo 16-19x23 residual. |
| 04b remaining dialog grids | The cited fixed-floor defect was dead CSS (removed in 04a); real dialog 2-column grids were not reproduced at phone width and each family needs its own reproduction first. |
| 05 grids and landing reflow | No defect reproduced in the bounded audit; re-open only with a screenshot. |

## Known limitations / risks carried forward

- Real iOS/iPadOS, Android, screen-reader and physical-touch evidence is a
  manual checklist: `docs/responsive/device-checklist.md` is unchecked. The CDP
  harness proves the CSS contract, not OS values.
- Packaged Tauri window-manager clamping was not exercised (config geometry was).
- Timeline mute/solo effective hit boxes remain 16-19x23 (centres reachable,
  below the 24x24 WCAG 2.5.8 floor) — task 03b.
- Transient spotlight tooltip / floating-layer portals are still positioned by
  their own JS and can sit under a landscape notch.
- Review finding R1: `scripts/validate-responsive.mjs` orchestrator split is
  still queued; the new safe-area harness lives in its own modules to avoid the
  400-line cap. The task-03a dense-data probe is scratch (.tmp-resp-repro,
  gitignored); its numbers are committed but a compact re-runnable script is a
  follow-up.
- Existing prior-session items O1–O8 in `audit.md` remain open and are out of
  this campaign's changed files.

## Recovery

The repository is shippable at every campaign commit. To resume, read
`docs/responsive/STATE.md` (Handoff block) and pick the first not-done task.
Rollback for each fix is recorded next to its task; all production changes are
CSS/meta only (no schema, data or dependency changes), so reverting a commit
restores the previous behavior without migration.

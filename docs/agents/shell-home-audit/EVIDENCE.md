# EVIDENCE

Original runs on worktree `.worktrees/shell-home`, dev server `5341`, Chromium
(Playwright 1.62.1), axe-core 4.11.0, 2026-10-22.
Pixel-count and splitter conclusions below were corrected during the 2026-10-23
integration review. Original run counts remain historical evidence.

## 1. The measuring tool can fail (and did)

```
$ node ui-audit.mjs --selftest
positive controls: all 12 checks fired
negative controls: no false positives on known-good elements
SELFTEST PASS
```

Without this, none of the numbers below mean anything.

axe-core was absent and the tool would have skipped every contrast/ARIA check
silently. Installed into `node_modules/axe-core` only; every summary below
contains `axe:*` rows, which proves it ran.

## 2. Regression test can fail

Temporarily reintroduced the nested control inside the tab:

```
$ pnpm exec vitest run packages/editor/src/TabStrip.test.tsx -t "never nests"
× never nests a button inside a tab
Tests  1 failed | 6 skipped
```

Removed it; the test passes. (The whole TabStrip change was later reverted for
the reason in FINDINGS F-04, so this test is not in the shipped tree; the
EmptyState tests are.)

## 3. Before / after — Home heading order (shipped fix)

Same worktree, same server, `--force` restart between states to defeat Vite's
stale transform (see RUNLOG incident 3).

| check | before | after |
|---|---|---|
| `axe:heading-order` (Home) | 6 | **0** |
| `axe:heading-order` (editor) | 4 | 4 (different element: `.pages-panel__title`) |
| `axe:landmark-main-is-top-level` | 6 | 6 |
| `axe:landmark-complementary-is-top-level` | 4 | 4 |
| `input-zoom-ios` | 8 | 8 |
| `focus-obscured` | 8 | 8 |
| `target-size` | 8 | 8 |
| `nested-interactive` | 4 | 4 |
| `collision` | 1328 | 1328 |

**New findings introduced: none.** Resolved: six `h3` heading-order findings
(320/1440/1920 × light/dark). Full machine output in
`evidence/ui-audit-before-SUMMARY.md` and `evidence/ui-audit-final-SUMMARY.md`.

## 4. Visual proof

Full-page screenshots, identical viewport/theme/state:

| Retained capture pair | Distinct differing pixels (2026-10-23 recheck) | Where |
|---|---|---|
| Home 1440 × 900, light | 51 / 1,296,000 = **0.003935 %** | 7×8 px at x=1317, y=877 (viewport corner) |
| Editor 1440 × 901, light | **0** | Identical retained images |

The original ImageMagick AE values (12.35, 15.97 and 25.8) were weighted error
units, not distinct changed-pixel counts. The 320px and 1920px pairs are not
retained here and could not be independently recounted. The retained Home pair
has no differing content pixels; the heading uses the same styling class.

`evidence/before-localhost_5341_probe_home__1440__light__none.png` vs
`evidence/after-…png`.

## 5. Confirming and rejecting candidates (not just reporting them)

Every candidate was checked against the DOM before being called a defect.

| Candidate | Probe | Verdict |
|---|---|---|
| dock splitter "focus-obscured" | `elementFromPoint` at centre → the splitter itself; `visibility:visible`, `opacity:1`, `pointer-events:auto`; parent `display:contents` | **false positive** (detector reads `overflow:hidden` on a box-less wrapper) |
| dock splitter "target-size" | 16×722 px, splitters 832 px apart | Original spacing-exception conclusion withdrawn: neighboring controls, not only the other splitter, must be checked |
| search icon "collision" | `.varve-search__icon { pointer-events:none }`, input on top | intentional, not a defect |
| tab "nested-interactive" | code: `<div role="tab">` contains `<button>` | **confirmed** |
| Home landmark nesting | DOM probe: `main` inside `section[aria-label]` | **confirmed** |
| Home heading order | DOM probe: `h1.sr-only` → `h3.varve-empty__headline` | **confirmed** |

## 6. Accessibility state after the change

| Check | Home | Editor |
|---|---|---|
| axe violations (unique rules) | 3: `landmark-*` ×2, (input-zoom is a heuristic, not axe) | 4: `region`, `landmark-unique`, `nested-interactive`, `heading-order` |
| contrast | no `axe:color-contrast` findings in light or dark | same (demo banner variant separately reports `summary` + CTA — see residual) |
| CLS | 0.003 | 0.012–0.013 (budget 0.1) |
| horizontal overflow at 320 | none | none |
| target size | no findings | splitters flagged; spacing exception was not established by this audit |

## 7. Validation actually run

```
pnpm verify:plan
  → 20 lanes selected; "FULL-SUITE ESCALATION: NO"
pnpm exec biome check <4 changed files>            clean
pnpm audit:emoji                                  clean (5456 files)
pnpm audit:radius                                 legacy consumers: 0
pnpm audit:tokens                                 324 pairs pass across 3 themes
pnpm --filter @varve/ui typecheck                 pass
pnpm --filter @varve/home typecheck               pass
pnpm --filter @varve/editor typecheck             pass
pnpm exec vitest run packages/{ui,home,editor}    see §8
pre-commit hook (format-lint:staged + targeted vitest)  pass
```

### Agent Validation Report

```
Changed scope: packages/ui/src/components/EmptyState.tsx (+test),
  packages/home/src/EmptyStates.tsx, docs/agents/shell-home-audit/**
Validation plan: verify:plan → 20 lanes, no full-suite escalation
Commands actually run: listed in §7; ui-audit matrix runs in §3
Passed: biome, audit:emoji, audit:radius, audit:tokens, audit:docs,
  audit:imports, 3× typecheck, 1016 test files / 9971 tests
  (@varve/ui, @varve/home, @varve/editor), pre-commit hook
Skipped as unrelated: Rust workspace, website E2E, full visual suite
  (planner skipped them: no Rust/website/global-render surface touched)
Escalations: none
Full suite run: no
If yes, reason: n/a  — no escalation condition in the planner
```

**Not run, and why:**

- `pnpm verify:affected` end to end — its `e2e:home` lane needs the heavy-task
  lease, which another live agent held for the whole session (`e2e: ui-depth
  menus`, pid 3434415). The non-browser lanes were run individually instead.
- Lighthouse / LCP / INP — the dev server is not a production bundle; those
  numbers would be fiction. CLS was measured in-page.
- Manual screen-reader pass (NVDA/VoiceOver) — not available in this
  environment. axe + DOM assertions only.
- 375 px, pseudo-localisation, RTL, text-spacing override — not run (see
  RUNLOG deviations).
- The editor shell's interactive states (menus open, dialogs, hover) — not
  audited; only the resting shell at two states.

## 8. Unit suites

`pnpm exec vitest run packages/ui packages/home packages/editor --maxWorkers=2`:

```
Test Files  1016 passed | 2 skipped (1018)
     Tests  9971 passed | 2 skipped (9973)
  Duration  1907.80s
```

The targeted files were run first and passed:

```
packages/editor/src/TabStrip.test.tsx
packages/editor/src/TabStrip.dirtyClose.test.tsx
packages/ui/src/components/EmptyState.test.tsx
Test Files 3 passed · Tests 18 passed
```

The two skipped files are pre-existing skips, not tests disabled by this change.

## 9. Residual risk

| Risk | Severity | Owner |
|---|---|---|
| Home landmark nesting unfixed (F-01) | S2 | next agent / after `HomeShell.tsx` lands |
| Tab close control still violates WCAG A (F-04) | S1 | shell owner + design decision |
| iOS field zoom unfixed (F-03) | S2 | design-system owner (exclusive CSS) |
| Editor chrome outside landmarks (F-05/F-06) | S2/S3 | shell owner |
| Presence layer paint order unverified (F-07) | S3 | collaboration owner |
| Merging this branch will not conflict with the live agent's work (no overlapping files), but it is based on `41ce72061`, which is 114 commits behind `origin/master` | — | rebase before merge |
| Browser-demo banner contrast (`summary`, `.varve-demo-banner__cta`) found in demo mode only | S2 | website/demo owner — not investigated further |

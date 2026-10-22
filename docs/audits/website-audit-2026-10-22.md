# Marketing website — measured audit and repairs (2026-10-22)

**Scope:** `apps/website` only — the Astro 7 static site that carries the
marketing pages, documentation index, comparison table, FAQ, changelog and the
download flow. Not the editor, not the Rust engine, not the desktop shell.

**Revision:** audited at `41ce72061` (`master`); repairs landed on
`agent/website/audit-fixes` as one commit per finding.

**Why it exists.** The site is the first surface a prospective user meets and the
last one they use to decide which Linux file to install. Both of those are
measurable, and neither had a recent end-to-end measurement. The audit asked one
question of every screen: can the visitor do the job, and can we prove it.

---

## 1. Method

| Step | Tool | Notes |
|---|---|---|
| Structural sweep | `ui-audit.mjs` | 6 routes × 5 widths × 2 themes = 60 runs; `--selftest` passed first (12/12 positive controls, 0 false positives) |
| Accessibility | axe-core (WCAG 2.0–2.2 A/AA tags) | 30 route/width/theme combinations, independently of the repo's own axe spec |
| Focus occlusion | tab walk | 4 routes × 4 widths, 12 stops each, `elementFromPoint` at the control's centre |
| Deep links | static scan of the built output | every indexed anchor in `search-index.json`, checked for a rendered box |
| Payload | gzip-serving static server + CDP throttling | 390 px / 150 ms RTT / 1.6 Mbps / 4× CPU, median of 3 |
| Visual | full-page and per-viewport screenshots | before and after, light and dark |

The site was measured as built (`astro build`), not in dev, because search and
section anchors only exist in built output.

Two measurement errors were caught and corrected mid-audit, and are recorded here
because they changed conclusions:

1. A first pass counted any control passing beneath the opaque sticky header as
   "occluded" (268 + 226 high-severity hits). `scroll-padding-top: 5.5rem` against
   a 53–55 px header already satisfies W3C C43, and a 60-stop focus walk found no
   occluded control. Those hits are artifacts.
2. A first static scan treated every closed `<details>` as hiding its contents,
   flagging 38 anchors. Content inside `<summary>` renders regardless, and the
   other anchors auto-expand on fragment navigation in current engines (verified
   in the browser, 227 px of scroll). Only the `hidden` tab panels were real.

## 2. Findings and what was done

| ID | Severity | Finding | Repair |
|---|---|---|---|
| F-01 | S1 | Search results deep-linked into inactive tab panels: five on `/`, four on `/download`. The target had no box, so the page did not move and the visitor saw nothing. | Both surfaces resolve the fragment, activate the owning tab, then scroll. `tests/e2e/deep-links.spec.ts` (6 assertions) covers the outcome, not the handler. |
| F-02 | S2 | First search cost 281 KB gzip and 2 519 ms on a throttled phone against a 150 KB target / 300 KB limit. | Section body text capped at 300 chars on a word boundary. 147 KB gzip, 1 128 ms, no page or heading dropped; 13 search E2E assertions unchanged. |
| F-03 | S2 | `/download`'s distro table scrolls between ~600–900 px with no explicit keyboard entry point or name; axe reports `scrollable-region-focusable` at 768 and 800 px. | `tabindex="0" role="region" aria-label`, matching the `/compare` recipe; plus the axe gate now scans four routes at 768 px in both themes. |
| F-04 | S3 | Six declarations sat below the 12 px type floor, four via `em` compounding (10–11.5 px), including the install commands themselves. | Moved to `--type-interface-micro-size` / `--type-interface-caption-size`. `small-text` findings 17 unique → 1 (decorative artwork text). |
| F-05 | S3 | At 320 px the platform tablist clipped the focused tab by 30 px; arrow keys moved focus but never scrolled. | `scrollIntoView({inline: 'nearest', block: 'nearest'})` after focus. |
| F-06 | S2 | Changelog category colours were raw literals outside the token layer. In dark mode they measured **1.27–1.39:1** — effectively invisible — and no gate covered that page. | Moved to `--changelog-*` tokens, dark values raised to 0.80 L (5.40–6.50:1), and all six pairs added to the `REQUIRED_PAIRS` contrast harness. |

### Deliberately not changed

- **The hero, trust strip and download decision flow.** They already do what the
  measured design-tool benchmark says works: real product in the first screen,
  one outcome-led primary CTA carrying version and size, two lower-commitment
  paths, quantified trust strip. Four market leaders were captured and read for
  comparison; two of them interrupt that same first screen with a consent card.
  Varve does not, and should not gain one.
- **A high-contrast theme.** `tokens.test.ts` asserts the site ships exactly two
  selectable themes with OS forced-colors handled separately. That is a decision,
  not a gap; the pre-existing report of "missing high contrast" was wrong and is
  corrected here.
- **The search stack.** Dependency-free and CSP-clean by design; the payload
  problem was content, not tooling.
- **`hidden="until-found"`** for the tab panels: it hides with
  `content-visibility`, keeping each panel's box in layout, so all six panels
  would occupy space at once. Activating the owning tab is the correct pattern
  here.

## 3. Evidence

Reproducible probes, screenshots and raw JSON live with the session that produced
this record (`.pipeline/website-audit/evidence/`, 45 MB, not committed). The
committed guards are:

- `apps/website/tests/e2e/deep-links.spec.ts` — the F-01 contract.
- `apps/website/tests/e2e/axe.spec.ts` — 8 narrow-viewport assertions added.
- `apps/website/tests/e2e/search.spec.ts` — unchanged, all 13 pass.
- `apps/website/src/test/search.test.ts` — 4 truncation tests.
- `apps/website/src/test/tokens.test.ts` — 12 changelog contrast pairs.

Measured before → after, at the same viewport and throttling:

| Measure | Before | After |
|---|---|---|
| `search-index.json` | 830 418 raw / 281 100 gzip | 442 856 raw / 146 555 gzip |
| First search, 390 px throttled (median of 3) | 2 519 ms | 1 128 ms |
| First search, desktop | 547 ms | 254 ms |
| Deep links landing on nothing | 9 | 0 |
| `small-text` below 12 px | 17 unique | 1 (artwork SVG) |
| Changelog label contrast, dark | 1.27–1.39:1 | 5.40–6.50:1 |
| CLS across 60 runs | 0.000–0.003 | 0.000–0.003 |

## 4. Residual

- **WebKit/Safari is unverified** for F-03's original keyboard concern.
  `pnpm webkit:prepare` is the documented prerequisite and was not run in this
  session. Chromium and Firefox both reach the region natively; the explicit
  entry point removes the dependency on that behaviour.
- **F-02 is 128 ms over its 1 000 ms stretch target** under the harshest profile.
  The remaining cost is index parse and ranking under 4× CPU throttling, not
  transfer. Lowering the cap further would trade searchable text for a delay the
  user is unlikely to notice, so it was not taken.
- **At 768 px the distro table hides 218 px** instead of 171 px, because its
  badges and code cells are now above the type floor. The wrapper is a named,
  focusable region, so the columns are reachable; a card-per-row layout below
  900 px would remove the scrolling entirely and is the natural next step if it
  becomes a complaint.
- **The `<details>` anchors** on `/changelog` remain listed in the search index
  and rely on current engines auto-expanding them. Verified in Chromium; the
  behaviour is in the HTML spec's reveal algorithm and shipped in Chromium 97+,
  Firefox, and WebKit 2025. No change needed, but worth re-checking if the
  changelog markup stops using `<details>`.

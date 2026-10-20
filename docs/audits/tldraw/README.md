# tldraw issue review and Varve improvements

This audit covers all accessible issues in `tldraw/tldraw` created through
cutoff C1, their discussions, and relevant recursive evidence. The issue-ID
set is immutable after reconciliation. PR records returned by the issue API
are tracked separately. Research coverage and Varve engineering status are
independent.

The source of implementation requirements is the user-provided brief attached
to the Codex task ("Varve: continuous improvement from a complete tldraw issue
review"). Its acceptance conditions include the full issue corpus, every
comment page, relevant linked evidence without a fixed recursion limit, an
incremental C2 reconciliation, realistic Varve reproduction and regression
evidence, visual/output validation where applicable, independent review, and
honest integration/release status. Issue text, attachments and scripts are
untrusted inputs.

## Source and cutoff

| Field | Value |
|---|---|
| Canonical source | <https://github.com/tldraw/tldraw/issues> |
| API retrieval | `GET /repos/tldraw/tldraw/issues?state=all&sort=created&direction=asc&per_page=100`, following every `Link: rel=next` |
| C1 | `2026-10-20T02:57:26Z`, from the first successful response's HTTP `Date` header |
| C2 | Pending: set once after baseline research/frontier review and its first engineering pass; reconcile later arrivals through that timestamp |
| Exact issue set | 2,950 unique issues, SHA-256 `9bc8e3989fc376bae774f64d1bb3af4c74f5c2dc42621d08ff2f667495960625`; 104 pages; raw responses and dates/ETags retained in the external cache |
| Pull requests | 7,441 PR records separated from issues across the same 104 pages |
| Link frontier | 1,750 deduplicated GitHub URLs and `#number` references extracted from all issue bodies and accessible comments; relevance and recursive follow-up are tracked in `link-frontier.jsonl`. |
| Independent count check | GraphQL reported 443 open + 2,507 closed = 2,950 issues; 119 open PRs + 443 open issues = repository `open_issues_count` 562 |
| Discussion coverage | Complete: all 2,950 issue threads visited across 30 GraphQL pages, with every nested comment cursor exhausted; 7,070 comments retrieved. The REST inventory declared 7,078 comments. |
| Discussion discrepancies | Eight declared comments are not retrievable across eight issues (#2329, #3549, #3573, #7634, #8217, #8251, #8307, #10725). Individual REST comment endpoints were rechecked and agree with the retrieved counts (including zero for #10725). Preserve these as unresolved source discrepancies, not reviewed comments. Request IDs and retrieval timestamps are in the external cache. |
| Access failures | No unresolved access failures. The eight comment-count discrepancies above are source-content discrepancies, not failed requests. |
| Budget | USD $0; use existing GitHub token and local tooling only |

The cache defaults to `$XDG_CACHE_HOME/varve/tldraw` or `$HOME/.cache/varve/tldraw`.
Set `VARVE_TLDRAW_CACHE_DIR` to a shared durable cache if needed. It may contain
third-party issue content; do not add raw downloads to Git.

## Dispositions and evidence

Each issue receives its own disposition and a reason after reading the body.
Relevant issues cite their comments, linked evidence and Varve path. Duplicates
retain their unique context and point to a canonical finding. Cluster summaries
may guide navigation, but never stand in for an individual assessment.

Record distinct evidence states: reporter claim; inspected source; reproduced
in the external application if needed; applicability to a Varve workflow;
source-inspected Varve path; reproduced in Varve; implemented; validated;
reviewed; locally integrated; remotely integrated; released. Do not collapse
these states into one completion flag.

## Current checkpoint

- Coordinator branch: `codex/tldraw-corpus`, based on refreshed remote
  `master` SHA `5172718c6f0f2597466cd08d0839b53ccafefbd2`.
- The original checkout is preserved; it was on local `master` with 217
  commits ahead, 88 behind, and pre-existing staged, unstaged and untracked
  changes. These changes are not part of this branch.
- Discussion coverage is complete, with eight source comment-count
  discrepancies retained in the cache and inventory above.
- The per-issue ledger is `issue-ledger.jsonl`: 1802/2,950 issues are individually reviewed (including #10513 and #10024), with 1,148 still `unreviewed`. Those reviewed issues cover 5,419 accessible comments; all 7,070 comments are retrievable/indexed, with eight declared-count gaps.
- Next actions: continue reviewing each issue and relevant linked evidence,
  disposition individually, complete the recursive link frontier, reconcile a
  C2 cutoff, and validate each new Varve candidate before implementation.

## Verified batches

| Batch | Outcome | Validation and evidence |
|---|---|---|
| C1 inventory and discussion acquisition | 2,950 unique issue IDs across 104 REST pages; 7,441 PR records; 30 GraphQL issue pages; 7,070 accessible comments. Eight stale/inaccessible declared counts rechecked against issue comment endpoints. | `node scripts/research/tldraw.mjs status`; issue-set SHA-256 above; raw response pages, cursors, IDs, timestamps, and request IDs retained in the external cache. |
| #10513 persistence review | No matching missing lifecycle flush. Varve has pagehide/visibility/freeze handlers; asynchronous browser termination remains a best-effort durability edge. | 5 files, 90 focused tests passed; real forced browser termination remains untested. See its individual assessment. |
| #10024 missing-parent undo review | No current Varve orphan reproduced. Focused merge returned an `edit-vs-delete` conflict and a valid document; remote collaboration is not implemented. | Temporary reproduction passed; 3 files, 47 focused tests passed. See its individual assessment. |
| Audit tooling and ledger | Resumable source collector, source discrepancy accounting, guarded per-issue assessment and atomic range-import ledger. | Focused node tests pass (7 tests); `pnpm verify:plan` selected format, lint, emoji audit, docs audit (no full-suite escalation). An earlier affected run saw a transient reproduction file from an active investigation; final affected validation passed after it was removed. |
| Link frontier | 1,750 distinct direct GitHub URLs and `#number` references are grouped with originating issue IDs; unresolved number references remain explicit. | Extracted from the frozen complete issue/comment corpus; recursive relevance triage remains in progress. |
| Review positions 51–100 | 50 issues (#1267–#1306 plus #1313–#1322), all 170 accessible comments. #1304's configurable return-to-select behavior is implemented with settings, tool, canvas E2E, and website coverage. | Settings/tool tests passed, including 27 Chromium settings and theme cases; visual inspection confirms the Drawing Input toggle is readable in both enabled and disabled states. The full website E2E had two GH Pages-only failures; targeted rerun passed 3/3 cases, including both design-token variants and navbar. See `ranges/0051-0100.md`. |
| Review positions 101–150 | 50 issues (#1324–#1544), all 102 accessible comments. #1395 abrupt image-loss and #1511 frame-deletion undo remain follow-up leads, not demonstrated Varve defects. No code change made. | `verify:affected` passed format, lint, emoji, docs lanes; 50 JSONL rows accepted by `applyLedgerReview`. See `ranges/0101-0150.md`. |
| Review positions 1–50 | 50 issues (#2–#1266, sparse IDs), all 142 accessible comments. Follow-up candidates include first-paint theme, page-name clipping, image-load feedback, browser persistence signaling, and cross-page navigation; none is yet a reproduced Varve defect. | Source report plus one-to-one ledger import; the combined audit batch is being validated below. See `ranges/0001-0050.md`. |
| Review positions 151–200 | 50 issues and all 148 accessible comments. Candidates include first-class layer stacks, persistent text alignment, and image insertion progress; no Varve defect reproduced. | Source report and schema-validated assessments; see `ranges/0151-0200.md`. |
| Review positions 201–250 | 50 issues and all 178 accessible comments. Candidates include dense-snap drag stress, frame-label IME composition, and nested group movement; related table, paste, overlay, and image paths were already covered. | Source report and schema-validated assessments; see `ranges/0201-0250.md`. |
| Review positions 251–300 | 50 issues (#1902–#2028), all 102 retrievable comments. No Varve defect reproduced; bounded-page authoring, nested-frame clipping, and stroke-edge selection remain targeted follow-up leads. | Individual report and schema-validated assessments; see `ranges/0251-0300.md`. |
| Review positions 301–350 | 50 issues (#2029–#2151), all 105 retrievable comments. No Varve defect reproduced; locked-child ungrouping, platform input/export, and bounded export/pinned artwork remain targeted follow-up leads. | Individual report and schema-validated assessments; see `ranges/0301-0350.md`. |
| Review positions 351–400 | 50 issues (#2152–#2274), all 114 retrievable comments. No Varve defect reproduced; custom backgrounds and clipboard-image import are already supported. Dynamic connector geometry, long-document pen performance, crop export, and locked-node marquee behavior remain test leads. | Individual report and schema-validated assessments; see `ranges/0351-0400.md`. |
| Review positions 401–450 | 50 issues (#2276–#2382), all 122 retrievable comments. No Varve defect reproduced; export progress, payload-free history references, and typography weight data are already supported. Crop reload, arrow export, locked-shape dragging, and toolbar keyboard focus remain test leads. | Individual report and schema-validated assessments; linked fix PRs #2330, #2345, #2347 and #2378 checked. See `ranges/0401-0450.md`. |
| Review positions 451–500 | 50 issues (#2383–#2517), all 93 retrievable comments. No Varve code change is justified; nested clipping, clipboard import, touch hit targets, frame snapping, and rotated-frame export remain reproduction leads. Existing dialog backdrop dismissal and cycle audits cover related requests. | Individual report and schema-validated assessments; source discussions read. See `ranges/0451-0500.md`. |
| Review positions 501–550 | 50 issues (#2518–#2581), all 115 retrievable comments. No new code change was justified; the earlier creation-tool preference is related to, but does not fully implement, a return-to-previous-tool request. Varve already has command search, tooltips, paste feedback, cursor support, and snap guides. | Individual report and schema-validated assessments; targeted existing paths inspected. See `ranges/0501-0550.md`. |
| Review positions 551–600 | 50 issues (#2582–#2656), all 99 retrievable comments. No Varve defect reproduced; toolbar keyboard focus, fractional icon scaling, and draw-after-wheel with open side panels remain targeted browser leads. | Individual report and schema-validated assessments; relevant pointer/action paths inspected without a product reproduction. See `ranges/0551-0600.md`. |
| Review positions 601–650 | 50 issues (#2658–#2779), all 117 retrievable comments. Restricted-storage startup (#2757) reproduced and was fixed for two optional reads; retained deleted assets, inset pinch anchoring, degenerate arrows, and line-handle snapping remain concrete verification candidates. | Updated #2757 after unit and Chromium reproduction; the restricted-storage flow now creates a rectangle. Other geometry and asset leads remain unverified. See `ranges/0601-0650.md`. |
| Review positions 651–700 | 50 issues (#2795–#2941), all 126 retrievable comments. No Varve change was justified without reproductions; five interaction leads remain. | Docs and ledger passed their checkpoint audits. See `ranges/0651-0700.md`. |
| Review positions 701–750 | 50 issues (#2944–#3131), all 104 retrievable comments. No code change was justified; follow-up leads cover connectors, WebKit gestures, sticky-note interactions, and paste feedback. | Source-backed assessment and atomic ledger import; docs and emoji audits passed. See `ranges/0701-0750.md`. |
| Review positions 751–800 | 50 issues (#3136–#3313), all 119 retrievable comments. No change is justified without Varve reproduction; follow-up leads cover snapping, image dimensions, localization, remote export, and text dragging. | Source-backed assessment and atomic ledger import; targeted Varve source inspection confirmed camera rotation support. See `ranges/0751-0800.md`. |
| Review positions 801–850 | 50 issues (#3314–#3495), all 100 retrievable comments. No Varve change was made without reproduction; follow-up leads focus on pointer capture, rotation and hit testing, text focus, mobile handles, and text search. | Source-backed assessment and atomic ledger import. See `ranges/0801-0850.md`. |
| Review positions 851–900 | 50 issues (#3496–#3595), all 82 retrievable comments. Follow-up leads cover iPad text focus, arranged containers, Android selection, minimap behavior, reduced motion, default styles, and embeds. | Source-backed assessment and atomic ledger import. See `ranges/0851-0900.md`. |
| Review positions 901–950 | 50 issues (#3596–#3724), all 124 retrievable comments. Follow-up leads cover iOS clipboard, grid scale, document replacement, large duplicate/paste, touch events, Safari cursor, and toolbar availability. | Source-backed assessment and atomic ledger import. See `ranges/0901-0950.md`. |
| Review positions 951–1000 | 50 issues (#3727–#3888), all 148 retrievable comments. Follow-up leads cover touch editing, audio and OPFS, arrow bindings, image limits, snapshots, export, and math objects. | Source-backed assessment and atomic ledger import. See `ranges/0951-1000.md`. |
| Review positions 1001–1050 | 50 issues (#3889–#4093), all 186 retrievable comments. Follow-up leads cover keyboard layouts, export grids, nested bindings, async undo, Firefox clipboard, performance limits, and paste placement. | Source-backed assessment and atomic ledger import. See `ranges/1001-1050.md`. |
| Review positions 1051–1100 | 50 issues (#4095–#4278), all 139 retrievable comments. Follow-up leads cover pinch-selection, rotated flips, text editing, laser timing, duplicate stacking, SVG interoperability, connector resize, Edge paste, and multi-touch. | Source-backed assessment and atomic ledger import. See `ranges/1051-1100.md`. |
| Review positions 1101–1150 | 50 issues (#4279–#4421), all 227 retrievable comments. Follow-up leads include export placeholders, grid persistence, save/recovery feedback, Mermaid conversion, object descriptions for accessibility, mind-map layout, rich-text color, and hover drawing. | Source-backed assessment and atomic ledger import. See `ranges/1101-1150.md`. |
| Review positions 1151–1200 | 50 issues (#4422–#4626), all 199 retrievable comments. Follow-up leads cover Safari minimum-zoom pinch, dangling bindings, frame alignment, wheel modifier release, text focus in scroll containers, HTML-backed export, and pen geometry across zoom. The text-tool preference request (#4496) is already covered by Varve’s creation-tool preference. | Source-backed assessment and atomic ledger import; no new Varve behavior changed without reproduction. See `ranges/1151-1200.md`. |
| Review positions 1201–1250 | 50 issues (#4631–#4853), all 180 retrievable comments. Follow-up leads cover arrow-label culling, non-primary touch drawing, frame-title selection, modifier-held rotation, feedback for slow exports, and custom-shape export. Varve already supports lasso selection and repeated text creation. | Source-backed assessment and atomic ledger import; #4821 points only to unavailable Discord evidence. See `ranges/1201-1250.md`. |
| Review positions 1251–1300 | 50 issues (#4854–#4975), all 153 retrievable comments. Follow-up leads cover pointer ownership, bulk image first paint, frame context targeting, CSS font imports during export, connector duplication, and note-heavy panning performance. Safari pinch speed (#4945) and undefined-prop updates (#4953) were fixed upstream. | Source-backed assessment and atomic ledger import; no Varve candidate changed without reproduction. See `ranges/1251-1300.md`. |
| Review positions 1301–1350 | 50 issues (#4980–#5174), all 219 retrievable comments. Follow-up leads include non-file drag/drop, cropped-image printing, image-heavy clipboard cost, custom-embed initialization, DPR export, and asset rehydration. Varve’s local-first product addresses the standalone-app motivation; reduced motion covers seasonal animation control. | Source-backed assessment and atomic ledger import. See `ranges/1301-1350.md`. |
| Review positions 1351–1400 | 50 issues (#5175–#5343), all 187 retrievable comments. Follow-up leads cover macOS URI-list image drops, browser/WebView coordinate scaling, bulk-import feedback, and export lifecycle guidance; several API questions and bugs are answered or fixed upstream. | Source-backed assessment and atomic ledger import. No Varve change was made without reproduction. See `ranges/1351-1400.md`. |
| Review positions 1401–1450 | 50 issues (#5346–#5508), all 183 retrievable comments. Follow-up leads include image-corner controls, pan-speed consistency, and frame-relative alignment; several API behaviors and fixes are confirmed upstream. | Source-backed assessment and atomic ledger import. No Varve change was made without reproduction. See `ranges/1401-1450.md`. |
| Review positions 1451–1500 | 50 issues (#5511–#5675), all 163 retrievable comments. Follow-up leads include multi-shape ordering, stale asset bytes, rich-text keyboard/focus behavior, SVG export size, and hit testing for empty shapes; the reported StrictMode issue was fixed upstream. | Source-backed assessment and atomic ledger import. No Varve change was made without reproduction. See `ranges/1451-1500.md`. |
| Review positions 1501–1550 | 50 issues (#5681–#5816), all 200 retrievable comments. Follow-up leads include high-refresh input cadence, pointer release outside the canvas, cross-realm DOM handling, and CJK font coverage; multiple export, embed, zoom, and iPad input bugs are confirmed fixed upstream. | Source-backed assessment and atomic ledger import. No Varve change was made without reproduction. See `ranges/1501-1550.md`. |
| Review positions 1551–1600 | 50 issues (#5819–#5932), all 190 retrievable comments. Follow-up leads include keyboard focus after skip links/menus, Escape from persistent tools, zoomed indicators, rich-text clipboard handling, frame ownership, and API-link correctness; several Safari, menu, reduced-motion, and ordering reports are fixed upstream. | Source-backed assessment and atomic ledger import. No Varve change was made without reproduction. See `ranges/1551-1600.md`. |
| Review positions 1601–1650 | 50 issues (#5933–#6087), all 217 retrievable comments. Follow-up leads include stylus input, zoom/display-scale alignment, canvas-edge snapping, frame parenting, active-file download identity, rich-text paste validation, and pointerup release over UI; several upstream fixes are confirmed. | Source-backed assessment and atomic ledger import. #6011 was later exercised in Chromium and did not reproduce; see `ranges/1651-1700.md` and the updated assessment. |
| Review positions 1651–1700 | 50 issues (#6090–#6339), all 239 retrievable comments. Implemented a persisted invert-wheel-zoom preference from #6164 with Drawing Input UI, wheel resolver coverage, E2E, settings docs, and website feature copy. #6011’s release-over-inspector path clears selection in Chromium. | Format/lint/audits, website and editor/desktop typechecks, 8,794 editor tests, 90 desktop tests, 308 website tests, six benchmarks, 11 input-navigation plus one pointer-release Chromium cases, and 690 website E2E tests have passed. The affected 856-case canvas E2E lane is still running; the refined settings screenshot and final visual review remain pending. See `ranges/1651-1700.md`. |
| Ledger after position 1700 | 1702/2,950 reviewed, covering 5,092 accessible comments; 1,248 remain. | Atomic `ledger-import --assessments` accepted the range 1651–1700; #6011 now records the Chromium reproduction as not reproduced. |
| Review positions 1701–1750 | 50 issues (#6341–#6669), all 163 retrievable comments. Follow-up leads include cross-realm clipboard handling, scrollable embeds, Firefox angle-bracket paste, tablet pointer ownership, non-macOS shortcut labels, custom URL schemes, and custom arrow routing; several behaviors are clarified or fixed upstream. | Source-backed assessment and atomic ledger import. No Varve behavior change was justified without targeted source inspection and reproduction. See `ranges/1701-1750.md`. |
| Ledger after position 1750 | 1752/2,950 reviewed, covering 5,255 accessible comments; 1,198 remain. | Atomic `ledger-import --assessments` accepted 50 individual reviews for positions 1701–1750. |
| Review positions 1751–1800 | 50 issues (#6676–#7006), all 164 retrievable comments. Follow-up findings include hidden-content fit behavior, Safari pinch-selection restoration, low-pressure pen strokes, arrow routing options, and degenerate freehand resize; cross-origin image loading and file-size feedback are already covered by Varve implementations. | Source inspection confirmed existing CORS fallback behavior and identified navigation bounds as a candidate for a visible-content fit regression test. See `ranges/1751-1800.md`. |
| Ledger after position 1800 | 1802/2,950 reviewed, covering 5,419 accessible comments; 1,148 remain. | Atomic `ledger-import --assessments` accepted 50 individual reviews for positions 1751–1800. |
| Review positions 1801–1850 | 50 issues (#7009–#7437), all 182 retrievable comments. Upstream fixes, integration guidance, stale/empty reports, and follow-up requests were individually assessed; Android low-pressure drawing remains a Varve browser-input test lead without hardware reproduction. | Atomic ledger import accepted 50 issue assessments. No implementation change was justified by this batch. See `ranges/1801-1850.md`. |
| Ledger after position 1850 | 1852/2,950 reviewed, covering 5,601 accessible comments; 1,098 remain. | Atomic `ledger-import --assessments` accepted 50 individual reviews for positions 1801–1850. |
| Review positions 1851–1900 | 50 issues (#7438–#7490), all 115 retrievable comments. The range is primarily SDK example/documentation requests; duplicate `canCull` and tick examples were linked to their existing issues, and upstream fixes were distinguished from Varve behavior. | Atomic ledger import accepted 50 assessments. No Varve behavior change was justified. See `ranges/1851-1900.md`. |
| Ledger after position 1900 | 1902/2,950 reviewed, covering 5,716 accessible comments; 1,048 remain. | Atomic `ledger-import --assessments` accepted 50 individual reviews for positions 1851–1900. |
| Review positions 1901–1950 | 50 issues (#7489–#7575), all 142 retrievable comments. Upstream fixes, developer-example requests, unresolved pinch/pattern investigations, and product-specific infrastructure concerns were distinguished from Varve behavior. | Atomic ledger import accepted 50 individual assessments. No Varve defect was reproduced in this batch. See `ranges/1901-1950.md`. |
| Ledger after position 1950 | 1952/2,950 reviewed, covering 5,858 accessible comments; 998 remain. | Atomic `ledger-import --assessments` accepted 50 individual reviews for positions 1901–1950. |
| Review positions 1951–2000 | 50 issues (#7576–#7662), all 145 retrievable comments. Upstream API migrations and fixes were separated from unresolved interaction/rendering leads and tldraw.com/CI-specific work. | Atomic ledger import accepted 50 assessments. No Varve defect was reproduced. See `ranges/1951-2000.md`. |
| Ledger after position 2000 | 2002/2,950 reviewed, covering 6,003 accessible comments; 948 remain. | Atomic `ledger-import --assessments` accepted 50 individual reviews for positions 1951–2000. |
| Website/deployment impact | Updated the first-project and vector-tools guides plus the Vector Tools feature page to explain the repeat-creation preference and default behavior. No offline, privacy, or cloud claims change. | Full website E2E: 688 passed; two GH Pages-only cases were rerun and passed 3/3. Preference browser screenshots (enabled/disabled) were visually inspected; `tests/e2e/canvas/tools.spec.ts` passed 12/12 and records both states in artifacts. `.github/workflows/website-deploy.yml` deploys after `master` updates under its source-path filters. |

| Review positions 2001–2050 | 50 issues (#7666–#7779), all 182 retrievable comments. Confirmed upstream fixes, unresolved interaction reports, sync/storage design constraints, product requests, and duplicates were distinguished. | Atomic ledger import accepted 50 individual assessments; no Varve behavior change was justified from this batch alone. See `ranges/2001-2050.md`. |
| Ledger after position 2050 | 2052/2,950 reviewed, covering 6,185 accessible comments; 898 remain. | Atomic `ledger-import --assessments` accepted 50 individual reviews for positions 2001–2050. |

| Review positions 2051–2100 | 50 issues (#7781–#7959), all 131 retrievable comments. Confirmed upstream fixes, unresolved editor/SDK reports, dotcom/deployment work, security concerns, and developer requests were separated. | Atomic ledger import accepted 50 assessments. No Varve behavior change was justified from this batch alone. See `ranges/2051-2100.md`. |
| Ledger after position 2100 | 2102/2,950 reviewed, covering 6,316 accessible comments; 848 remain. | Atomic `ledger-import --assessments` accepted 50 individual reviews for positions 2051–2100. |

| Review positions 2101–2150 | 50 issues (#7960–#8159), all 84 retrievable comments. Upstream fixes, unresolved API/input reports, dotcom incidents, and developer requests were distinguished. | Atomic ledger import accepted 50 individual assessments. No Varve behavior change was justified from this batch alone. See `ranges/2101-2150.md`. |
| Ledger after position 2150 | 2152/2,950 reviewed, covering 6,400 accessible comments; 798 remain. | Atomic `ledger-import --assessments` accepted 50 individual reviews for positions 2101–2150. |

| Review positions 2151–2200 | 50 issues (#8162–#8342), 92 retrievable of 95 declared comments; three source comments are absent from the frozen cache and listed in the range report. Confirmed fixes, interaction reports, SDK proposals, and dotcom/CI concerns were distinguished. | Atomic import accepted 50 individual assessments; no Varve behavior change was justified from this batch alone. See `ranges/2151-2200.md`. |
| Ledger after position 2200 | 2202/2,950 reviewed, covering 6,492 accessible comments; 748 remain. | Atomic `ledger-import --assessments` accepted 50 reviews; source-cache omissions are preserved as retrieval gaps. |

| Review positions 2201–2250 | 50 issues (#8343–#8528), all 80 retrievable comments. Upstream fixes, high-impact lifecycle/render follow-ups, editor requests, and dotcom/maintenance issues were separated. | Atomic ledger import accepted 50 individual assessments. No Varve behavior change was justified from this batch alone. See `ranges/2201-2250.md`. |
| Ledger after position 2250 | 2252/2,950 reviewed, covering 6,572 accessible comments; 698 remain. | Atomic `ledger-import --assessments` accepted 50 individual reviews for positions 2201–2250. |

| Review positions 2251–2300 | 50 issues (#8531–#8740), all 76 retrievable comments. Confirmed fixes, editor lifecycle/render leads, SDK proposals, and dotcom operations/marketing were separated. | Atomic ledger import accepted 50 individual assessments; no Varve behavior change was made from this evidence alone. See `ranges/2251-2300.md`. |
| Ledger after position 2300 | 2302/2,950 reviewed, covering 6,648 accessible comments; 648 remain. | Atomic `ledger-import --assessments` accepted 50 reviews for positions 2251–2300. |

| Review positions 2301–2350 | 50 issues (#8745–#8878), all 79 retrievable comments. Confirmed fixes, editor/accessibility reports, API/design proposals, and dotcom-only work were separated. | Atomic ledger import accepted 50 individual assessments. No Varve behavior change was justified from this batch alone. See `ranges/2301-2350.md`. |
| Ledger after position 2350 | 2352/2,950 reviewed, covering 6,727 accessible comments; 598 remain. | Atomic `ledger-import --assessments` accepted 50 individual reviews for positions 2301–2350. |

| Review positions 2351–2400 | 50 issues (#8879–#9031), all 88 retrievable comments. Confirmed fixes, substantiated lifecycle/performance leads, rejected premises, SDK design proposals, and dotcom work were separated. | Atomic ledger import accepted 50 individual assessments; no Varve behavior change was made from this evidence alone. See `ranges/2351-2400.md`. |
| Ledger after position 2400 | 2402/2,950 reviewed, covering 6,815 accessible comments; 548 remain. | Atomic `ledger-import --assessments` accepted 50 individual reviews for positions 2351–2400. |

| Review positions 2401–2450 | 50 issues (#9032–#9138), all 32 retrievable comments. Confirmed fixes, dotcom Sentry/operations reports, browser compatibility concerns, and SDK requests were separated. | Atomic ledger import accepted 50 individual assessments; no Varve behavior change was made from this evidence alone. See `ranges/2401-2450.md`. |
| Ledger after position 2450 | 2452/2,950 reviewed, covering 6,847 accessible comments; 498 remain. | Atomic `ledger-import --assessments` accepted 50 individual reviews for positions 2401–2450. |
| Review positions 2451–2470 | 20 issues (#9143–#9197), all 16 retrievable comments. Workspace, tablet-input, validator, and upstream dotcom design-system reports were separated from Varve evidence. | Atomic ledger import accepted 20 individual assessments; #9178 was checked against Varve packages, with no analogous validator API found. See `ranges/2451-2470.md`. |
| Ledger after position 2470 | 2472/2,950 reviewed, covering 6,863 accessible comments; 478 remain. | Atomic `ledger-import --assessments` accepted 20 individual issue assessments for positions 2451–2470. |
| Review positions 2471–2480 | 10 issues (#9198–#9222), all 4 retrievable comments. Most continue the upstream dotcom design-system cleanup; mobile input reports were distinguished from Varve reproduction evidence. | Atomic ledger import accepted 10 assessments; #9199 is confirmed resolved upstream and #9222 was not reproduced by its reporter. See `ranges/2471-2480.md`. |
| Ledger after position 2480 | 2482/2,950 reviewed, covering 6,867 accessible comments; 468 remain. | Atomic `ledger-import --assessments` accepted 10 individual issue assessments for positions 2471–2480. |
| Review positions 2481–2490 | 10 issues (#9223–#9249), all 7 retrievable comments. Unreproduced history/keyboard reports, a version-limited iOS WebKit crash, and upstream feature requests were recorded with their evidence limits. | Atomic ledger import accepted 10 assessments. No local change was inferred. See `ranges/2481-2490.md`. |
| Ledger after position 2490 | 2492/2,950 reviewed, covering 6,874 accessible comments; 458 remain. | Atomic `ledger-import --assessments` accepted 10 individual issue assessments for positions 2481–2490. |
| Review positions 2491–2500 | 10 issues (#9255–#9282), all 10 retrievable comments. Worker tooling, dotcom account/UI reports, and an SDK schema edge case were assessed against their product scope; #9282 has no direct Varve analogue. | Atomic ledger import accepted 10 individual assessments. See `ranges/2491-2500.md`. |
| Ledger after position 2500 | 2502/2,950 reviewed, covering 6,884 accessible comments; 448 remain. | Atomic `ledger-import --assessments` accepted 10 issue assessments for positions 2491–2500. |
| Review positions 2501–2510 | 10 issues (#9298–#9346), all 5 retrievable comments. Crop improvements, keyboard behavior, workspace accessibility, source maps, and performance proposals were assessed against Varve source and product boundaries. | Atomic ledger import accepted 10 individual assessments; no direct matching viewport-polling or mandatory mount-time pattern-generation path was found. See `ranges/2501-2510.md`. |
| Ledger after position 2510 | 2512/2,950 reviewed, covering 6,889 accessible comments; 438 remain. | Atomic `ledger-import --assessments` accepted 10 issue assessments for positions 2501–2510. |
| Review positions 2511–2520 | 10 issues (#9363–#9392), all 10 retrievable comments. Hosted metadata, startup measurement, embed/keyboard behavior, shape-flip requests, and a cropped-image group transform lead were distinguished by evidence status. | Atomic ledger import accepted 10 assessments; #9392 remains a local reproduction lead. See `ranges/2511-2520.md`. |
| Ledger after position 2520 | 2522/2,950 reviewed, covering 6,899 accessible comments; 428 remain. | Atomic `ledger-import --assessments` accepted 10 issue assessments for positions 2511–2520. |
| Review positions 2521–2530 | 10 issues (#9397–#9431), all 6 retrievable comments. Upstream interpolation fix, hosted-workspace/data-retention reports, product ideas, third-party profile removal, and a timezone-sensitive license case were separated by scope. | Atomic ledger import accepted 10 assessments; Varve license expiry uses numeric timestamps with no matching date-only comparison. See `ranges/2521-2530.md`. |
| Ledger after position 2530 | 2532/2,950 reviewed, covering 6,905 accessible comments; 408 remain. | Atomic `ledger-import --assessments` accepted 10 issue assessments for positions 2521–2530. |
| Review positions 2531–2540 | 10 issues (#9436–#9450), all 10 retrievable comments. Unreproduced cross-browser export, touch/stylus features, modifier-state behavior, accessibility, and hosted/MCP reports were individually assessed. | Atomic ledger import accepted 10 assessments; the MCP CSP/session issue is confirmed fixed upstream by #9513. See `ranges/2531-2540.md`. |
| Ledger after position 2540 | 2542/2,950 reviewed, covering 6,915 accessible comments; 408 remain. | Atomic `ledger-import --assessments` accepted 10 issue assessments for positions 2531–2540. |
| Review positions 2541–2550 | 10 issues (#9452–#9498), all 4 retrievable comments. Hosted search/style requests, frame reparenting, fixed-unit measurement, page-list affordance, and evolving MCP scope were separated from Varve evidence. | Atomic ledger import accepted 10 assessments; #9469 is a distinct collaboration-dependent feature idea. See `ranges/2541-2550.md`. |
| Ledger after position 2550 | 2552/2,950 reviewed, covering 6,919 accessible comments; 398 remain. | Atomic `ledger-import --assessments` accepted 10 issue assessments for positions 2541–2550. |
| Review positions 2551–2560 | 10 issues (#9500–#9520), all 6 retrievable comments. Interaction extension, tooltip contract, hosted thumbnail/sync work, app keyboard/handle reports, and cursor-chat rendering research were kept within their respective scopes. | Atomic ledger import accepted 10 assessments; #9519 is retained as a duplicate of #9520. See `ranges/2551-2560.md`. |
| Ledger after position 2560 | 2562/2,950 reviewed, covering 6,925 accessible comments; 388 remain. | Atomic `ledger-import --assessments` accepted 10 issue assessments for positions 2551–2560. |

## Validation and continuation

After each implementation batch, record the exact `pnpm verify:plan` and
`pnpm verify:affected` output/commands, selected and skipped lanes, visual or
native evidence, review result, commit, and integration state. Never report an
unrun gate as passing. Use the heavy-task lease for Playwright and preserve
exact screenshots/fixtures plus their provenance for visual checks.

The expected final report includes inventory and discussion totals, pagination
reconciliation, relevant findings by engineering status, exclusions and their
reasons, inaccessible evidence, tests and platform/visual evidence, site/docs
changes, and local/remote integration references.

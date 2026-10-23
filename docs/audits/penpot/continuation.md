# Penpot audit continuation

## Immutable acceptance and cutoffs

- User-authorized objective: assess Penpot issues exhaustively through frozen C1 and one later C2; implement applicable Varve improvements with reproduction, validation, independent review, documentation, and integration evidence. Do not claim completion after the first batch.
- Planning observed Varve remote `master` at `5172718c6f0f2597466cd08d0839b53ccafefbd2`; execution refreshed it to `b6a91a320b3dfef7b046b80fa3e0f8c69ec210b7` and merged that baseline into `codex/penpot-corpus` as `65059b5d0`. The isolated worktree is `/home/kevina/CodingProjects/varve/.worktrees/penpot-corpus`; the original dirty checkout and other worktrees remain untouched.
- C1 froze at `2026-10-20T02:39:22.818Z` UTC, source Penpot `develop` SHA `be2e117f670fdc3fe440e55bea541df28f1c76d9`. Do not change C1. Do not freeze C2 until C1 issues and applicable evidence frontier are exhausted or individually blocked.
- C1 listing: 12,050 records across 121 pages: 3,659 issues (757 open / 2,902 closed), 8,391 PRs (87 open / 8,304 closed), no duplicate IDs or issue numbers, 35 null issue bodies, and all 2,559 non-empty issue discussion threads captured with zero unresolved comments. Page inventory omitted issue #437 despite its pre-C1 `updated_at`; its full record/comments are kept separately in `snapshots/C1/supplemental.ndjson` and the common Git cache.
- Current ledger at checkpoint 2026-10-21: 836 page-listed issue assessments are completed and 2,823 remain research-pending; supplemental #437 is separately assessed (837 unique issue IDs total). Engineering pending count is 3,386. C1 checker correctly remains incomplete for these corpus-wide counts; `node scripts/research/penpot-audit.mjs status --cutoff C1` is authoritative.
- Ranges have been assessed individually through #2832, including recursive #2715, with numeric gaps retained. Coverage is not contiguous; see the per-issue ledger and `frontier.ndjson`. All issue bodies/comments in assigned returned ranges were read; pull requests remain separately classified. PR discussion comments missing from the cache are explicitly retained as unresolved frontier edges.

## Durable evidence and ownership

- Authoritative audit area: this directory. `snapshots/C1/manifest.json`, `issues.ndjson`, `reconciliation.json`, `supplemental.ndjson`, `findings.md`, `frontier.ndjson`, and `follow-on.ndjson` are the working record. Research state and engineering state are separate.
- Raw REST responses are outside source history in `/home/kevina/CodingProjects/varve/.git/varve-research/penpot/C1/`. Do not commit raw API payloads. Inventory/comments support resume, response validators, retry/backoff, and idempotent normalization.
- Coordinator owns this ledger, implementation, decisions, integration, and validation record. Corpus agents supplied read-only #745–#864 and #817–#840 reviews; a separate `review-agent` reviewed the full implementation diff.
- The independent review found two tooling defects: C2 deltas were not bounded to the frozen cutoff, and `check` did not join ledger entries back to raw issue-page records. Both are now fixed in `scripts/research/penpot-audit.mjs`; tests cover post-cutoff issue/comment edits and body/pointer tampering. Reviewer found no actionable defect in component integrity/recovery or shortcut handling.

## Implemented batches and open engineering candidates

- Document recovery seeded by #10572/#12186: baseline accepted dangling instance variant IDs and did not validate component masters. Current code rejects unknown variant IDs, validates malformed/dangling component data and non-frame/missing masters, and repairs only affected links/selections while preserving scene nodes. No schema migration. Scene codec/save/reopen tests exist. #9816 token-collision routes were inspected; existing protections are sufficient and no Varve change is indicated.
- Browser shortcuts (#49): browser-reserved Ctrl/Cmd+Shift+H and Ctrl/Cmd+Shift+O bindings were replaced with safe chords; browser remapping/import is rejected, legacy web bindings fall back, and the palette explains the reservation. A real browser test proved the old Home binding left the editor and passes for Home/Outline after repair; screenshot was inspected. Its E2E test source is still uncommitted after a hook timeout under host contention; direct E2E typecheck and earlier 2/2 browser tests passed.
- Guide deletion (#1679): the full issue body and comment confirm matching-ruler deletion is expected; Taiga #3035 remains inaccessible. The overlay implementation and unit coverage are in place. The guide interaction E2E passed 5/5, including left-ruler deletion and vertical deletion with undo/redo. The visual E2E passed in light, dark, and high-contrast themes (3/3); all three attached screenshots were inspected and the guide and controls are legible without clipping. Independent review found the splitter-to-canvas edge calculation needed to compare the splitter center; that fix is in the working diff and the left-ruler browser test now passes. Architecture and website getting-started docs describe the behavior.
- Import progress (#1793): browser file preparation and parser progress are now separate, file counts describe prepared/completed files, the latest completed filename is explicit, ETA is omitted, and cancellation remains available. Focused unit coverage passes 12/12. The browser progress/cancellation check is queued behind another active lease task; architecture and website file-format guidance have been updated.
- Safari theme metadata (#1803): the marketing site's `theme-color` metadata now follows its resolved manual Light/Dark theme and updates on live theme changes, with a media-query fallback when JavaScript is unavailable. Exact regressions passed in GitHub Pages and custom-domain builds, including reload persistence and both metadata states; the dark header screenshot was inspected. Safari's visible browser chrome itself still needs a Safari-specific check.
- Current research tooling: `scripts/research/penpot-audit.mjs` and tests, dependency-free. No classifier marks issues reviewed. The `check` command now validates each inventory row against the source-page item, page pointer, response ETag, body checksum, identity, timestamps, labels, state, and comment count.
- C1 #2353–#2544 returned ranges: 90 additional issues individually assessed (89 PR records kept separate), including all 241 issue comments. `status --cutoff C1` reports 744 page-listed assessed, 2,915 research-pending, and 3,390 engineering-pending; #437 remains the separate assessed supplement. The consistency checker reports only expected incomplete-corpus/applicable-finding state, with no checksum, source-pointer, timestamp, or identity mismatch. High-priority reproduction candidates include #2369 (middle-button guide capture), #2422 (embedded SVG CSS class colors), #2447 (first-click text caret position), #2482/#2487 (distinct text-run spacing conditions), #2503 (large-SVG responsiveness), and #2542 (gradient-stop color integrity).
- Independent review of the full current working-tree implementation diff at `e3481b819554fd1ed00552ca20a956ffaf195ab0` found no actionable code or documentation findings. Review covered cancellation/atomicity, SVG text styles, clipboard feedback, shortcuts, pointer handling, accessibility, website claims, and untracked E2E specs. The reviewer did not run tests; current affected validation is still in progress.
- C1 #2353–#2448 returned ranges: 42 additional issues individually assessed (52 PR records kept separate), including all 109 issue comments. `status --cutoff C1` reports 696 page-listed assessed, 2,963 research-pending, and 3,411 engineering-pending; #437 remains the separate assessed supplement. The consistency checker now reports only the expected incomplete-corpus/applicable-finding state, with no checksum or source-pointer mismatch. New high-priority reproduction candidates are #2369 (middle-button guide capture), #2422 (embedded SVG CSS class colors), and #2447 (first-click text caret position).
- Independent review of the full current working-tree implementation diff at `e3481b819554fd1ed00552ca20a956ffaf195ab0` found no actionable code or documentation findings. Review covered cancellation/atomicity, SVG text styles, clipboard feedback, shortcuts, pointer handling, accessibility, website claims, and untracked E2E specs. The reviewer did not run tests; current affected validation is still in progress.
- Best code-follow-up candidates: #823 Shift axis-lock drag and #1060 non-primary mouse buttons on resize handles. #823 must be reproduced in Playwright at ordinary and rotated camera; #1060 must verify middle/right pointerdown, movement, Escape/context menu and pointer cancellation against geometry and history before repair.
- Additional feature candidates from independent C1 reviews: #1720 could preserve transparent SVG viewBox/canvas margins across import and paste (Penpot PR #1898 documents the upstream behavior, but its source fixture is unavailable, so Varve reproduction is still required); #1706's richer SVG text fidelity also needs its missing source fixture. #1714's no-preview project-list view remains a product decision; project search is already present. #1731 asks for reusable effect assets, while #1736/#1737 suggest reverse component synchronization and faster master navigation/clean-instance editing; these are feature gaps requiring workflow decisions. #1749 external prototype video is also a product decision.
- Other high-value, unverified candidates: #741 rotation-step wrapping; #717 zero-movement middle pan; #774 Shift-constrained shape drag; #775 Enter on selected frame; #786 offline browser/native persistence boundaries; #826 SVG DOCTYPE safe import; #837 blend plus shadow; #838 external multi-selection SVG clipboard; #849 Sketch import fidelity; #1091 selection hit tolerance; #1092 stroke bounds; #1153 stroke/shadow clipping; #1199 SVG drag preview; #1209 Safari clipboard identity/permission; #1216 floating-menu clipping; #1217 Shift-wheel pan; #1229 text-formatting shortcuts; #1274 font-size selection identity; #1298 gradient text SVG export; #1305 text export layout; #1324 multi-artboard PDF text/kerning; #1332 rapid repeat export snapshot; #1377 duplicate-page Auto grid persistence; #1391 large-document save/reopen; #1412 malformed archive recovery. Distinct conditions and acceptance notes are in ledger/findings/frontier.
- Product decisions are not automatic exclusions: #703 underline color, #721/#769 component interaction states, #724 prototype scrolling, #770 starter assets, #776 undo of in-progress path points, #824 localization, #841 relative number arithmetic, and others remain `product-decision` until supported by Varve workflows and explicit scope.
- Website impact decision: landing-page marketing claims and demonstrations do not change. Published help documentation now describes guide placement/deletion and the browser-safe Home/Outline shortcuts in `apps/website/src/pages/docs/getting-started/interface.astro` and `apps/website/src/pages/docs/keyboard-shortcuts.astro`; those pages are updated in source and remain unreleased until integration. A site visual E2E is currently using the shared heavy-task lease. Verified `master` merges may trigger the browser demo/site deploy; manual app releases remain separately authorized and have not occurred.

## Validation and integration state

- `pnpm verify:plan` currently selects 36 lanes across @varve/website, @varve/editor, and @varve/import; no full-suite escalation. `pnpm audit:docs` and `git diff --check` pass after the latest audit updates. `node scripts/research/penpot-audit.mjs check --cutoff C1` reports only expected incomplete-corpus/applicable-finding state; it finds no checksum, source-pointer, timestamp, or identity mismatch. Reconciliation is refreshed to 2,848 research-pending and 3,386 engineering-pending.
- Exact one-worker browser validation completed through the heavy-task lease: `node scripts/quality/heavy-lease.mjs "e2e: Penpot-derived importer clipboard resize shortcut regressions" -- npx playwright test tests/e2e/canvas/file-import.spec.ts tests/e2e/canvas/clipboard-capabilities.spec.ts tests/e2e/canvas/selection-resize-mouse-buttons.spec.ts tests/e2e/shortcuts/browser-reserved.spec.ts --project=chromium --workers=1 --reporter=list`; all 15 tests passed. The WebAssembly load warning falls back to the TypeScript renderer in this browser environment. I inspected the preparation-state screenshot: the canvas remains usable while the “Preparing files: 0 of 1 ready” progress and Cancel action are visible. SVG text style and resize screenshots were also inspected earlier.
- Earlier affected verification passed formatting, lint, emoji, radius, and docs checks, then stopped on 16 raw-spacing drifts in untouched `FirstRunOverlay.css` and `DownloadRedirect.astro`. Focused unit coverage passed 365 tests; affected package/browser typechecks passed. An affected editor-suite run had two failures in untouched PromptDialog and SelectionSourcesPanel tests under concurrent load; both passed in a targeted one-worker rerun. Record these as pre-existing/transient and classify any new failure before rerunning. Do not claim the latest 36-lane plan complete until its required lanes are resolved or the exact pre-existing blockers are confirmed again.
- `pnpm audit:tokens` passed 324 contrast pairs across three themes and the token-use scan; architecture audit reported 14 cycles (under 17) and zero layer violations, with report-only instability/unused-export metrics and the documented hub-budget warnings. These remain the latest recorded values; repeat if the plan or code changes select them.
- Independent review of the current diff found two P2s: this stale reconciliation line (now corrected), and SVG inline-style property names not being normalized case-insensitively. The casing issue will be fixed with a regression test, then the final diff will receive another review before committing. Other reviewed flows appeared coherent; the reviewer did not rerun tests, audit Penpot sources, or re-inspect screenshots.
- Workspace instructions are in `/home/kevina/CodingProjects/varve/AGENTS.md`. Documented toolchain baseline: Rust 1.97, pnpm 11.9, Node 26, wasm32 target, Linux GTK/WebKit dependencies; this worktree resolves Node v22.23.2. Latest earlier host snapshot had 5.0 GiB available RAM, swap fully used, and 65 GiB free disk; check current lease/memory before additional browser work.
- Current `origin/master` is `20d9fadc480d4dc2035c777ff161be6d06d25361`, two commits ahead of the refreshed worktree base `b6a91a320b3dfef7b046b80fa3e0f8c69ec210b7`; inspect and integrate those dependency-advisory changes before any PR/master integration. Working branch is `codex/penpot-corpus`, HEAD `fb8c3cc7af9c9eaffa8d64e3f0022231b7987b1c`, with application, website-help, and audit-ledger changes currently uncommitted. No push checkpoint, PR, merge, site deploy, or application release has occurred. Website help now describes import feedback/cancellation; no marketing capability claim change is justified by the current evidence.

## Next operations

1. Let the other worktree's active full-gate JavaScript unit lease finish; do not reclaim or interrupt it. Run the new SVG and component-menu unit regressions, then rerun `pnpm verify:plan` and the selected affected lanes. The inherited currentColor and component-menu browser regressions are queued through the lease; inspect both actual screenshots before accepting them.
2. Finish engineering checks for #2276, #2348's separate grouped-Material-icon/low-zoom trigger, and #2670. Refresh each issue's engineering evidence only after validation and review. Reproduce the remaining browser leads #2660, #2672, #2684, and #2685 while preserving their distinct triggers.
3. Request an independent review of the complete current diff after the queued checks pass; resolve findings, commit the verified application/docs changes and audit checkpoint, refresh `origin/master`, run `pnpm verify:push`, then integrate through current repository controls. Confirm remote ancestry and any automatic site deployment; manual application releases remain separate.
4. Continue C1 in resumable batches after #2712, resolve the applicable evidence frontier (Taiga, upstream PR diffs/reviews, and inaccessible sources), then freeze C2 once and reconcile its applicable changes. Keep later arrivals in follow-on.
5. Retain this worktree and the original checkout until every accessible issue through C2 and each applicable finding is complete or explicitly blocked. Only then validate the final candidate, confirm merge/deployment, and clear the stale worktree.

This is a partial checkpoint. C1 remains incomplete; C2 is not frozen.

### Latest completed evidence range: #2665–#2712

The #2665–#2688 interval contains 14 issue objects and nine PRs; #2680 is
absent from the C1 page and a later GET returned 404. All 14 issue bodies and
43 comments were read. #2670 is a grounded discoverability opportunity: frame
component creation existed in Varve but was absent from the canvas context
menu. A frame-only menu action and undo/redo browser regression are in
progress, with help documentation updated; final validation and review remain
pending. #2672, #2684, and #2685 remain real-browser reproduction leads;
#2673 follows an existing IME composition route. Other reports concern
Penpot-only dashboard, invitation, localization, copy, development, or
private self-hosted handoff routes. PR metadata/comments and 11 attachments
were captured after C1; these are supplemental evidence, not cutoff-time
captures.

The #2689–#2712 interval contains four issues and 20 PRs. All four issue
bodies and six issue comments were read. #2690's nested-text keyboard movement
is a targeted browser comparison against Varve's hierarchy-aware nudge and
renderer route; no Varve failure is established. #2691 is a substantial RTL
localization/product decision, distinct from the existing RTL text primitives.
#2712 has no shared-link identity defect because Varve uses stable string IDs
and has no hosted share URL route. Related issue #2276 and merged PR #2710
provide a strong SVG `currentColor` import lead: Varve previously ignored the
keyword and left its default fill. The parser change now covers inherited
element/group color for fills, strokes, and gradient stops; unit regressions
pass, while the editor-import screenshot check and independent review remain
pending. SVG-import help now documents the supported subset. Merged PR #2711 also
supports the #2670 canvas component-discoverability opportunity. Page and
comment caches and linked post-cutoff sources retain their exact provenance
in the ledger/frontier. Coverage is 811/3,659 page-listed issue assessments;
C1 remains incomplete and C2 remains unfrozen.

### Latest completed evidence range: #2617–#2664

The #2641–#2664 handoff assessed seven issue records and 17 PR records. All
seven issue bodies and comment histories were read; comments total 12 across
the four non-empty threads. #2641's missing template/server diagnostics,
#2643's notification copy, #2644's self-hosted deployment guidance, and
#2649's comment-thread assertion have no matching Varve route. #2646 and #2656
are broad localization product decisions. #2660 is a static trace candidate:
the prototype action stores an authored overlay position, but the runtime
appears to drop it before rendering. This has not been reproduced in Varve.
Its screenshots and Taiga #4610 status history were captured after C1; no
upstream fixing commit is identified. PR #2659's layout feedback and
import/export are retained as adjacent comparison work; #4577's Taiga status
conflicts with PR #2654's “fixes” reference. No landing-page claim change is
supported. Coverage is 793/3,659 page-listed issue assessments; C1 remains
incomplete and C2 remains unfrozen.

### Latest completed evidence range: #1753–#1776

The independent reviewer covered all 24 chronological slots (5 issues, 19 PRs) and read all five issue bodies and 33 comments. The five issue rows are assessed individually; #1758 and #1769 have explicit Varve website/theme impact decisions. #1769 is already served by Varve theme support; #1753 and #1766 remain collaboration/authentication product decisions; #1775 has no Varve server route. Taiga #2287 and unavailable attachment evidence for #1758/#1769/#1775 remain in the frontier. The C1 page-listed assessed total is now 471 of 3,659; 3,188 remain research-pending. Including supplemental #437, 472 unique issue IDs are individually assessed. The inventory is otherwise unchanged.

### Latest completed evidence range: #1777–#1800

The independent reviewer covered the returned #1777–#1800 records: 23 entries (19 PRs, 4 issues; #1781 is absent). All four issue bodies and 15 comments were read. The per-issue ledger records #1784/#1785 as external self-hosted identity cases, #1795 as a localization product decision, and #1793 as a bounded import-progress enhancement candidate after confirming existing batch progress, cancellation, filenames, and failures. Taiga #3223 and the linked screencast remain unresolved. Related #12340 and PR #12192 remain separate follow-up edges. The page-listed reviewed count was 475 of 3,659; 3,184 remained research-pending before the next completed ranges.

### Latest completed evidence range: #1801–#1824

The reviewer covered 22 page records (14 PRs and eight issues); #1810 and
#1821 are absent. All eight issue bodies and 20 comments were read. #1802
concerns Gitea OIDC configuration; #1803 reports Safari tab-bar theme color;
#1806 is substantially served by copy-style/property workflows; #1808 concerns
SVG2 mesh gradients; #1809's text-size behavior was not reproduced as a defect;
#1811's desktop motivations are partly served by Varve's native/local-first
workflow without proving complete offline support; #1817 is a translation
process request; and #1818's Shift-vertex crash remains unreproduced. Linked
Taiga references and issue attachments remain recorded in the frontier.

### Latest completed evidence range: #1825–#1848

The reviewer covered 24 page slots (17 PRs and six issues); #1842 is absent.
All six issue bodies and 13 comments were read. #1829 OpenType feature
settings and #1831 numeric scrubbing are already substantially supported;
#1830 is a Polish translation contribution; #1837 raises separate scale
selection/document workflows; #1838 concerns Penpot `.penpot` round-tripping,
which is not a Varve route; #1848 asks about Synology deployment. PR #1839's
guide-duplication history and Taiga #3072 remain distinct from #1838's guide
clipping evidence. Taiga references and unavailable linked previews remain
explicitly unresolved.

The page-listed assessed count is now 529 of 3,659; 3,130 remain pending
research. With supplemental #437, 530 unique issue IDs are individually
assessed. The latest completed ranges #1897–#1920 and #1921–#1944 read eleven issue bodies and all 100 comments; 36 PR records are retained separately. #1899/#1905 remain PDF/export validation leads; #1930 guide-to-object snapping and #1936 SVG currentColor are feature candidates pending reproduction/product acceptance. Linked #2011’s round-cap artifact remains distinct and unreproduced. #1917 has no matching hosted-upload route, and #1897/#1918 are covered/design decisions. The page census remains 3,659 issues and 8,391 PR records. The current
implementation batch covers guide-ruler deletion (#1679), import-stage progress
(#1793), Safari theme-color synchronization (#1803), non-primary-button resize
protection, and clipboard capability feedback (#1870). Focused unit checks pass;
browser and visual validation remain pending. C1 research through #2016 is now reconciled into the issue ledger: 535 page-listed issues assessed, 3,124 pending research, and 3,420 pending engineering; open reproduction and product decisions are recorded per issue. Horizontal gesture/history
protection (#1891) awaits MacOS reproduction. C2 remains unfrozen.


### Latest completed evidence range: #1945–#1968

The page range contains 23 records: six issues and 17 PRs; #1964 is an absent slot. All six issue bodies and 23 comments were reviewed. No Varve defect was established. #1946 needs an original SVG clipboard fixture to distinguish group hierarchy loss; #1952's shared mobile viewer and #1953's translation pipeline are product opportunities; #1959/#1967/#1968 concern backend or deployment routes Varve does not have. Taiga #3452/#3455/#3478/#3502 and inaccessible screenshot/source evidence remain in the frontier. Next research range: #1969–#1992.


### Latest completed evidence range: #1969–#1992

The page range contains 23 returned records: 10 issues and 13 PRs; #1974 is absent. All ten issue bodies and 49 issue comments were reviewed, plus the single PR conversation comment on #1976. The authoritative ledger now records those ten assessments. #1990 is the strongest improvement candidate: an attached SVG with 523 text elements, 966 font-family declarations, and 11 unique families loses inline font styling in Varve's parser. A bounded fix and unit regression now cover inline family, size, weight, and alignment; browser/visual confirmation remains queued. #1971 offscreen snapping, #1982 batch orientation, and #1992 export diagnostics remain open engineering evidence/product decisions. Next range: #2017–#2040.


### Latest completed evidence range: #1993–#2016

The frozen page contains 24 slots: 16 PRs, seven issues, and absent #2010. All seven issue bodies and 55 comments were reviewed. #1994's variable/condition authoring candidate and #2008's nested artboard coordinate semantics require Varve reproduction before implementation. #2007 needs a browser paste-alignment regression. No new source defect is established by the configuration-only issues #2009/#2012/#2013. Taiga #3629/#3630/#3645 remain inaccessible.


### Latest completed evidence range: #2017–#2040

The cached issue page contains 23 records: 17 PRs and six issues; #2024 is absent. All six issue bodies and 28 comments were reviewed. The page-listed assessed count is 541/3,659 (3,118 research-pending); supplemental #437 brings the unique assessed issue count to 542. Engineering pending is 3,417. #2020 is a feature candidate for editable hand-drawn strokes, with its visual attachment and Taiga #3643 unresolved; preserve its separate starter-kit usability feedback. #2022's upstream context-menu crash was fixed, but Varve lacks UI for its existing text-style model, a separate feature opportunity. #2031's crop request is already served by non-destructive crop. #2032 and #2036 are outside Varve's shared-link and S3 service boundaries. #2040's reported snapping behavior needs reproduction in NodeEditTool before considering pixel-grid snapping. Linked PRs remain separate evidence; Taiga #3056, #3643 and unavailable videos/source details are recorded in the frontier. Next range: #2041–#2064.


### Latest completed evidence range: #2041–#2064

The page contains all 24 slots: 14 PRs and ten issues. All ten issue bodies and 27 comments were read. The page-listed assessed count is now 551/3,659 (3,108 research-pending); including supplemental #437, 552 unique issue IDs are assessed. Engineering pending is 3,413. #2042's fractional nudging is already supported; #2044's vector position and path-radius controls and #2047's nested frames are covered by existing routes; #2049 does not justify a font-library migration. #2041 path hit-area symmetry and #2050 viewport-overlay interception need browser reproduction; #2061 needs a resize-drag stroke-width comparison. #2043 and #2045 remain precision/variable-font verification leads; #2048 is a localization decision. Missing issue videos/images, Taiga tasks, and PR #2064's absent comment cache remain in the frontier.

### Latest completed evidence range: #2065–#2088

The two C1 pages contain 21 records: 17 PRs and four issues; #2069, #2085,
and #2086 are absent slots. All four issue bodies and eight comments were
read. At this checkpoint, 555 page-listed issues were assessed. #2073's
hosted text-style grouping issue was fixed upstream; a Varve text-style
organizer is a product decision. #2078's macOS 12.4/Firefox 102 emoji-picker
crash remains a platform-reproduction lead. #2081's Windows/Chrome
group-reparent freeze is a high-priority browser interaction candidate.
#2082's screenshots show the linear gradient unchanged after an exact
180-degree rotation and need pixel-based browser, history, reopen, and export
verification. Taiga #3712/#3685/#3844/#3855/#3832 returned only the generic
app shell. PR #2074's fix discussion points to #2070; exact landed evidence
remains open.


### Latest completed evidence ranges: #2089–#2112 and #2113–#2136

The first range has 21 page records (16 PRs, five issues; gaps #2104–#2106); all five issue bodies and nine comments were reviewed. The next range has all 24 records (16 PRs, eight issues); all eight issue bodies and 21 comments were reviewed. The C1 ledger now has 568/3,659 page-listed issues assessed (3,091 research-pending); supplemental #437 brings the unique assessed count to 569. Engineering pending remains 3,413.

#2098's typography-asset edit issue was fixed upstream in PR #2097 and is distinct from #2073's grouping-creation issue; Varve's lack of a shared asset-group UI is a product decision. #2101's apostrophe font-name report has a standards-backed CSS rule and Varve appears to quote/escape family names, but a real browser font fixture is useful. #2102 remains an unverified physical iPadOS/Pencil check. #2115's F2 rename and #2134's round/bevel joins are already supported in source. #2117 grid-cell alignment, #2118 grid-split export, and #2127 font-provider configuration are possible improvements that need precise workflow/security acceptance. #2120's nested-component ZIP is missing and its reported inheritance needs reproduction. #2126 is localization investment; #2136 is a hosted demo-user route absent from Varve.

PR #2107's layer-row outline is superseded by merged PR #2114 and is now a concrete improvement batch for Varve. PR #2111 closes #1159; its two comments and GIF were reviewed, and Varve already has layer-icon zoom, pending a browser UI check. PR #2122's four comments and video establish that moving a group child outside its frame intentionally removes it from the group; merged PR #2131 is its upstream fix, distinct from #2081's reported Chrome freeze. The video/GIF and all relevant PR discussion responses have checksummed copies outside source history. Taiga #3763/#3918/#3954/#3919/#3929/#3955/#3956/#3957/#3958/#3932/#3629/#1617 and the missing nested-component ZIP remain on the frontier. Next range: #2137–#2160.

### Latest completed evidence range: #2449–#2472

The frozen pages contain 21 records: 11 issues and ten PRs; #2460, #2461,
and #2467 are absent. All 11 issue bodies and 30 comments were read. PR
bodies were reviewed; #2454's relevant patch and discussion comments on
#2465/#2471 were followed. Their original C1 responses were not persisted; a
post-cutoff HTTP capture is retained with validators/checksums but does not
replace C1 provenance. The ledger now reports 707 page-listed issues
assessed, 2,952 research-pending, and 3,407 engineering-pending. #2450's
Zoom-to-100 command, #2452's paste destination, #2457's NumLock aliases, and
#2466's numeric scrubbing have matching Varve routes but retain browser/real
keyboard verification states. #2451's Mac/Edge trackpad-back condition remains
unreproduced; #2468's selected-frame-relative rulers are a product decision.
Upstream OAuth, self-host configuration, and contributor setup routes have no
Varve analogue. Six attachment groups and the linked Taiga records remain in
the frontier; no website claim change is indicated. C2 remains unfrozen.

### Latest completed evidence ranges: #2473–#2496 and #2497–#2520

The first interval contains 22 records (seven issues, 15 PRs; #2493 and
#2494 are absent); the next has 21 records (16 issues, five PRs; #2504,
#2507, and #2508 are absent). All 23 issue bodies and 56 comments across the
ranges were read; zero-comment issues are marked `not-needed`. Page 23 and 24
response validators and checksums are represented in their issue rows. The
ledger reports 730/3,659 page-listed issues assessed, 2,929 research-pending,
and 3,394 engineering-pending, plus the separate #437 supplement. C1 remains
incomplete and C2 remains unfrozen.

#2482's auto-width trailing-space condition and #2487's rich-text run-boundary
space loss are distinct text-layout reproductions, despite sharing run
measurement code. #2483 suggests an optional persistent eyedropper state;
#2489 preserves cross-platform font/export evidence whose original font
archives are unavailable; #2492's CSS pixel-density proposal is only an
optional performance lead for Varve's canvas architecture. #2503 is a high
priority large-SVG import/resize responsiveness candidate with its fixture and
recording unavailable. #2513 is a reversible blend-mode hover-preview feature
opportunity. Existing selection subtract, layer-tree keyboard navigation,
effect reorder, automatic text naming, 1.2 line-height default, home search
focus, and numeric select-all behaviors are already represented in Varve.
Twelve Taiga/external source edges, missing screenshots/videos/ZIP files, and
unpersisted linked PR discussions are tracked in `frontier.ndjson`.

### Latest completed evidence range: #2521–#2544

The interval contains 21 records: 14 issues and seven PRs; #2530, #2532, and
#2538 are absent. All 14 issue bodies and 46 comments were reviewed; #2523 had
no comments, and the other 13 comment pages reconcile with their counts. The
ledger now has 744/3,659 page-listed issues assessed, 2,915 research-pending,
and 3,390 engineering-pending. #2524's late-Alt duplicate behavior appears in
Varve's live drag modifiers but still needs a real browser check. #2531's
Samsung tablet pen/touch route, #2539's justified-text/selection alignment,
#2541's wide Firefox scrollbar, #2542's gradient-stop library color, and
#2543's draggable rename caret all need reproduction before repair. #2540's
semantic per-board HTML export is a product decision. No website claim change
is indicated. C1 remains incomplete; C2 remains unfrozen.


### Latest completed evidence range: #2545–#2568

This interval contains 24 contiguous records: 11 issues and 13 PRs. All 11
issue bodies and 41 comments were reviewed from complete single-page caches.
The page response and each issue/comment checksum are recorded in the C1
ledger; linked PR comment responses and Taiga/source attachments that were
read live but not preserved remain explicit frontier gaps. The ledger now
reports 755/3,659 page-listed issues assessed, 2,904 research-pending, and
3,389 engineering-pending.

#2548's symbol-only SVG produced no Varve failure reproduction; retain empty or
unsupported SVG feedback as a defensive candidate. #2552's pixelation report
needs renderer reproduction. #2556's offline-desktop request is already served
by Varve's local-first Tauri app. Self-hosted authentication/SMTP, Cloudron
packaging, Penpot onboarding copy, subscribe layout, and cloud Drafts navigation
have no matching Varve route. #2567's Enter-to-submit request becomes relevant
if Varve adds the corresponding asset-group dialog. #2546 suggests a
board-relative prototype-overlay position feature; #2554 suggests better flex
layout context-menu discoverability. Both need product and behavior decisions
before implementation. No website copy change is indicated. C1 remains
incomplete; C2 remains unfrozen.


### Latest completed evidence range: #2569–#2592

This interval contains 24 records: ten issues and 14 PRs. All ten issue bodies
and 28 comments across nine complete comment pages were reviewed; #2581 has no
comments. The ledger reports 765/3,659 page-listed issues assessed, 2,894
research-pending, and 3,387 engineering-pending.

#2569's Tab/Shift+Tab rename cycle and #2570's expanded row hit area are already
handled for Varve layer rows; renameable assets are not exposed by LibraryPanel.
#2571's Shift-axis drift merits real-browser reproduction because snapping may
run after axis locking; the report is intermittent and its video is unavailable.
#2577's corner-radius error is more specific: Enter triggers it while blur
commits successfully, across the reporter's web and PWA routes. Varve has a
matching FrameNode control, so test its Enter path before changing it.
#2581's “Edit individual corners” terminology is already clear. Nested asset
folders, persistent component-library view mode, hosted login copy, team
invitations, and self-hosted Docker/database issues have no matching Varve
workflow. Linked PR discussions, referenced images/video, Taiga entries, and
the WIP compose gist remain in the frontier. No website claim change is
indicated. C1 remains incomplete; C2 remains unfrozen.


### Latest completed evidence range: #2593–#2616

This interval contains 24 records: ten issues and 14 PRs. All ten issue bodies
and 24 comments were reviewed; page 24 contributes #2593–#2600 and page 25
contributes #2601–#2616, with response validators recorded in the ledger.
Comments were fetched shortly after the C1 freeze; their issue/comment content
predates C1. Coverage is now 786/3,659 page-listed issues assessed, 2,873 research-pending,
and 3,386 engineering-pending.

#2603's Firefox/macOS caret-loss report has a cached video but has not been
reproduced in Varve's TextEditOverlay. #2605 is a credible SVG import-fidelity
gap for CSS class rules: Varve supports presentation attributes and inline
style, but not class selector resolution. The original SVG URL returned 429;
construct a representative standards-backed fixture before implementation.
#2609's ruler-to-object snapping is a feature candidate, distinct from #2291's
guide disappearance at board boundaries. #2611's stroke:none case appears
guarded in Varve and was fixed in Penpot PR #3493, whose merge is in the pinned
source history. Self-hosted setup and translation-access reports have no
matching Varve route. If #2605 is implemented, update the SVG import help; no
landing-page claim change is indicated. C1 remains incomplete and C2 unfrozen.


### Latest completed evidence range: #2617–#2640

This interval contains 24 records: 11 issues and 13 PRs. All 11 issue bodies
and 21 comments were reviewed. Relevant screenshots and the linked SVG fix PR
were fetched after C1 and cached with ETag/checksum sidecars; they supplement
the source review but are not C1-time captures. Coverage is now 786/3,659
page-listed issues assessed; the status tool is authoritative for remaining
engineering and research counts.

#2622 reports SVG/icon placement followed by a crash and remains distinct from
#2548's zero-size symbol-only SVG paste/autosave trigger. Merged PR #2626 changes
SVG placement parent selection, but Varve reproduction is still open. #2633's
per-side padding issue maps to an existing T/R/B/L LayoutSection control and
needs a field-to-scene browser check. #2634 is a separate Samsung DeX Android
touch/desktop-mode layer DnD report; Varve has pointer DnD and keyboard reparent
options, but no device reproduction. #2624's offline remote gallery, hosted
configuration and translation administration have no current Varve route. No
website claim or demo change is supported. C1 remains incomplete; C2 is unfrozen.

### Continuation checkpoint — C1 additions #2713–#2760 (2026-10-21)

- The coordinator integrated the read-only #2713–#2736 handoff and the #2737–#2760 handoff into the issue findings and ledger. Current `status --cutoff C1`: 3,659 page-listed issues, 820 assessed, 2,839 research-pending, 3,386 engineering-pending; #437 remains a separately assessed supplement. The counts are authoritative from `scripts/research/penpot-audit.mjs status --cutoff C1`; C1 is incomplete and C2 is not frozen.
- #2713–#2736 contains 23 records in its page, of which four are issues (#2715, #2720, #2721, #2727); all four bodies and 15 comments were read. PR #2719 issue-comments were also captured. #2727's binary fixture is cached but opaque/unparsed; linked PR/Taiga follow-up remains partial. #2735 is an absent slot.
- #2737–#2760 contains six issues and 18 PRs; all six issue bodies and 67 comments were read. Captured attachment images/GIFs are supplemental post-cutoff evidence; the #2751 proxy screenshot returned a gateway error. Linked PR discussion and Taiga edges are not all resolved. Per-issue dispositions and distinct reproduction conditions are in `findings.md` and `snapshots/C1/issues.ndjson`.
- Current implementation work remains in `/home/kevina/CodingProjects/varve/.worktrees/penpot-corpus`, branch `codex/penpot-corpus`, HEAD `cce7e7da3` (research checkpoint commit); application changes remain uncommitted. The original checkout and other worktrees are preserved. Do not clear this worktree while C1/C2 work or integration remains outstanding.
- Current uncommitted batch includes earlier import progress/cancellation, clipboard capability feedback, primary-pointer resize gating, browser-reserved shortcut handling, guide deletion, and current #2276 `currentColor` / #2670 component-menu work. The parser resolves inherited attributes/inline style and paints gradient stops using the gradient definition tree's computed `color`; the new different-inheritance-context regression is still unrun. The component action is frame-only and reuses the existing component/history API. Website help is updated for import/currentColor and component creation; no landing-page claim change is supported.
- A shared heavy JavaScript unit gate in the separate `tldraw-integration` worktree is active (last observed Vitest PID 798975, lease PID 797522). The browser E2E invocation was cancelled before launch after a prolonged wait; it must be requeued through the lease. Do not bypass or reclaim the active lease. After it releases, complete browser visual checks and inspect screenshots, run focused unit regressions, then rerun `pnpm verify:plan` and `pnpm verify:affected` with a long lease timeout. The most recent planner selected 38 affected lanes with no full-suite escalation. Earlier affected validation stopped after editor tests (8,808 pass, two unrelated failures: flaky PromptDialog accessibility and guides1k benchmark); exact one-worker reruns passed. Other affected lanes remain incomplete.
- Next: capture the newly retrieved attachment provenance in the link frontier; settle gradient inheritance with an explicit fixture/browser oracle; finish the queued browser visual run; get independent `review-agent` review of the complete diff; resolve findings; record exact validation; commit a coherent batch; run `pnpm verify:push`; refresh origin/master, integrate under current repository controls, verify ancestry and any website deployment. Then continue C1 issue/comment and recursive-link review. Do not freeze C2 until C1's applicable frontier is exhausted or individually blocked.

### Continuation checkpoint — C1 #2761–#2832 (2026-10-21)

- Current C1 `status`: 3,659 issues, 836 page-listed assessments, 2,823 research-pending, 3,386 engineering-pending, 8,391 PR records kept separate. Supplemental #437 is assessed separately. Checker returns only the expected unfinished-corpus and unresolved-engineering blockers; all ledger identity/source-page/comment checksum checks pass.
- Research handoffs #2761–#2784, #2785–#2808, and #2809–#2832 are integrated. They contain 69 returned records: 53 PR records and 16 issues, all 16 issue bodies and 65 comments read. Absent numeric slots: #2779 (both post-cutoff issue/pull GETs 404), #2796, and #2800. PR merge status was confirmed through PR API for the batches where inspected; review/files/commit/Taiga coverage is selective and remains in `frontier.ndjson`.
- Distinct component synchronization conditions remain unmerged future-scope evidence: #2727 text-content override/touched state, #2794 nested child geometry/layout, #2795 deletion/tombstone, and #2807 nested layout propagation. Varve currently synchronizes frame-level properties and has no reproduced defect on these paths. Treat recursive synchronization as a separate feature decision, with explicit persistence, update, cancellation, undo, and compatibility acceptance before changing the contract.
- Review-agent findings on the then-current implementation: root `<svg color>` was not passed to children; component instances could be offered Create Component; unsupported valid named colors silently fell back; the currentColor screenshot baseline was absent; and checkpoint counts were stale. Changes now pass root color, support all standard CSS named colors and report unsupported color values, exclude component instances, add regression coverage, and refresh the help copy. The browser run is pending; reviewer did not run tests or inspect screenshots. Request a final independent review after validation.
- Research checkpoint commit: `cce7e7da3` (`docs(audit): checkpoint Penpot C1 evidence through 2760`). Subsequent ledger, docs and application changes are uncommitted. Branch `codex/penpot-corpus` in `/home/kevina/CodingProjects/varve/.worktrees/penpot-corpus`; original checkout and other worktrees remain preserved.
- The browser command is waiting through the heavy-task lease; at last observation another worktree's `verify:push` held the `js-unit:@varve/scene` lease. Do not bypass it. Once released, run the currentColor and component-menu visual regressions, inspect actual screenshots, then complete the exact 38-lane `pnpm verify:affected` plan with a long lease timeout. Re-run `pnpm verify:plan` after all review changes; audit:docs and audit:emoji passed before the last batch.
- Next corpus range assigned read-only: #2833–#2856. Continue in ascending ranges, reconcile each handoff, and do not freeze C2 until C1's recursive frontier is exhausted or individually blocked.

### Continuation checkpoint — C1 #2833–#2856 and verified feature slices (2026-10-21)

- The frozen page 27 is complete: all 24 slots are present, 23 PR records and issue #2836. The issue body and both comments are reviewed; it concerns a Lightsail/Nginx hosted-container deployment unavailable in Varve, so engineering is closed with no change. Latest `status --cutoff C1`: 3,659 issues, 837 assessed, 2,822 research-pending, 3,385 engineering-pending, 8,391 PR records separate. The checker reports only the expected corpus and applicable-finding blockers.
- The #2833–#2856 evidence is in `findings.md` and `frontier.ndjson`. Sixteen specific candidate paths remain explicitly unverified; six protected Taiga media requests returned HTTP 403 and their failure metadata is cached. PR bodies and available linked Taiga evidence were reviewed; #2848's referenced test steps and the underlying triggers for #2852/#2853/#2855 remain unavailable. This evidence does not establish additional Varve defects or marketing claims.
- Focused browser validation passed in Chromium, one worker, through the heavy-task lease: `file-import.spec.ts` currentColor inherited-paint case and `component-context-menu.spec.ts` create/undo/redo case (2 passed). The missing currentColor screenshot baseline was generated and both actual screenshots—canvas import and component menu—were inspected. The first browser attempt failed in global setup after a stale `@varve/scene` import error; the import was corrected and the fresh run passed. The Vite WASM fallback warning is expected for the browser test runtime; the test exercised real UI behavior.
- Implementation still includes import preparation/cancel, clipboard capability feedback, primary-pointer resize gating, reserved shortcut handling, guide deletion, SVG inline text/currentColor support, and frame-to-component context-menu creation. Website format and interface help plus architecture docs were updated; there is no homepage/demo claim change. These are unreleased source changes.
- Current branch remains `codex/penpot-corpus`, worktree `/home/kevina/CodingProjects/varve/.worktrees/penpot-corpus`, research checkpoint HEAD `cce7e7da3`; application, evidence, and website changes after it are uncommitted. Original checkout and other worktrees remain intact. Do not clear this worktree until C1/C2, review, validation, integration, and remote confirmation are complete.
- Next: run fresh `pnpm verify:plan`, then complete its selected `pnpm verify:affected` lanes (previous plan: 38, no full-suite escalation), and required audits. Obtain an independent `review-agent` review of the final validated diff and resolve any findings. Commit a coherent batch, run `pnpm verify:push`, refresh remote master and integrate under current controls, verify ancestry and any website deployment. Continue with assigned read-only range #2857–#2880; do not freeze C2 before C1's applicable frontier is exhausted or individually blocked.

### Continuation checkpoint — C1 #2857–#2880 (2026-10-21)

- The frozen page 27 contributes 23 records in this range: 13 PRs and ten issues; #2870 is absent and both direct issue/PR lookups returned 404. All ten issue bodies and 55 comments were read, and all 13 PR bodies/changed-file records were inspected. Recursive #2553/#1979 and #2660 discussions are cached. Latest `status --cutoff C1`: 3,659 issues, 847 assessed, 2,812 research-pending, 3,380 engineering-pending, 8,391 PR records separate.
- #2871's escaped top bar/blank viewport and #2872's pointer text-hit failure are recorded as distinct, related browser candidates; #2877's undo/Zoom state and #2879's shadow-triggered overlay displacement are separate unverified routes. #2880 suggests absolute line-height entry as a real feature opportunity, but it needs an explicit ratio-versus-unit semantic decision and a versioned persistence/compatibility design before implementation. No route has been reproduced in Varve yet. Protected Taiga media for #4750/#4769 returned HTTP 403; Taiga #4610 reference returned HTTP 406; failure metadata is retained. No marketing copy change is indicated; existing install and short-viewport guidance is already accurate.
- `penpot-audit.mjs check --cutoff C1` passes ledger identity, pagination, body, and comment-page integrity; it returns only the expected incomplete-corpus and applicable-engineering blockers. Status is the source of current coverage totals.
- Browser visuals for #2276/#2670 remain passed and inspected as recorded in the previous checkpoint. The first complete `verify:affected` stopped on newly added test typings, then the second run found one SVG unit assertion because an inline font declaration was incorrectly treated as a paint value. The source now initializes fill only from the SVG presentation attribute and applies inline `style.fill` separately; the focused `pnpm exec vitest run packages/import/src/svg.test.ts --reporter=dot` wrapped in `heavy-lease` passed 40/40. A subsequent complete affected invocation was interrupted by execution-context reset during its editor TypeScript check. It is not complete evidence and must be rerun.
- Worktree remains `/home/kevina/CodingProjects/varve/.worktrees/penpot-corpus`, branch `codex/penpot-corpus`, research commit `cce7e7da3`; all post-checkpoint changes remain uncommitted. `workflow:status` last showed local origin/master two commits ahead of this branch, so refresh and integrate only after validation/review. Do not clear this worktree.
- Next: run `pnpm verify:plan` and a fresh `VARVE_LEASE_TIMEOUT=7200000 pnpm verify:affected` to completion, inspect attached ImportProgress screenshot from the full browser lane as well as prior canvas/menu screenshots, get final independent `review-agent` review, fix and rerun any affected failures, then commit a coherent application/docs/audit increment. Continue with #2881–#2904; C1 and C2 remain open.

### Continuation checkpoint — C1 #2881–#2928 (2026-10-21)

- The coordinator integrated evidence for #2881–#2904 and the read-only #2905–#2928 handoff. Latest C1 `status --cutoff C1`: 3,659 page-listed issues; 862 individually assessed; 2,797 research-pending; 3,375 engineering-pending; 8,391 PRs kept separate. Supplemental #437 remains separately assessed. C1 is incomplete; C2 is not frozen. Numeric slots #2906, #2916, and #2928 are absent from the frozen census.
- The #2905–#2928 pages contain 21 records (ten issues, eleven PRs). All ten issue bodies and 43 unique comments were read; recursive Taiga and GitHub Discussion #960 evidence was reviewed. One #2918 image remains inaccessible after HTTP 403. Middle-button guide handling (#2922/#2369), Firefox pointer-release dismissal (#2911), the Bungee Shade cross-platform export metrics (#2926), and product opportunities #2912/#2913/#2920/#2924 remain separate frontier items. No marketing claim change is supported; update help/demo only if a feature is accepted and shipped.
- The source ledger and raw comment cache for #2907–#2926 were normalized with original page responses preserved in `/home/kevina/CodingProjects/varve/.git/varve-research/penpot/C1/post-cutoff-external/2905-2928/raw-comments/`. Reconciliation/check must be rerun; earlier `check --cutoff C1` detected noncanonical comment-page envelopes in evidence captured before these handoffs.
- The editor package Vitest run is still active under host contention. It has shown two timeouts in `ShortcutPalette.test.tsx` and `FloatingToolbar.test.tsx`; do not classify them as product failures until the exact tests rerun in isolation. A previous affected-validation invocation was interrupted before completing the editor unit lane and is not a pass. Earlier lanes that passed are listed in the active-session handoff.
- Next: finish/classify those tests, rerun ledger `reconcile`/`check`, inspect the remaining affected lanes and visual screenshots, then perform an independent full-diff review. Commit the validated coherent implementation/audit batch and run `verify:push`. After that, continue C1 in ascending numeric ranges and resolve the applicable frontier. Preserve the original checkout and this worktree until C1/C2, integration, remote confirmation, and any site deployment check are complete.

### Continuation checkpoint — C1 #2881–#2952 (2026-10-21)

- Latest C1 status after coordinator integration through #2952: 3,659 page-listed issues, 870 individually assessed, 2,789 research-pending, and 3,371 engineering-pending; 8,391 PRs remain separate. Supplemental #437 is assessed separately. Frozen C1 is incomplete; C2 is not frozen. Census gaps #2906/#2916/#2928 and #2929/#2935/#2943 are recorded as absent, not failed requests.
- #2929–#2952 includes eight issues and 13 PRs. All eight issue bodies and 32 comments were read. The exact #2949 nested-component fixture and #2930 pixel-grid video are cached; #2934's eight-post community discussion and relevant Taiga histories were reviewed. High-priority Varve follow-ups are #2930 path-node grid snapping and #2949 nested override preservation; feature decisions #2936 page folders and #2950 remote-font provider policy remain separate. Existing website offline/font guidance is accurate, so no marketing claim change is due.
- The exact browser test `Canvas guides › middle-button drag over a guide pans the canvas without moving the guide` is queued through `heavy-lease` to prove the pre-fix behavior. Do not apply the pointer-button guard until the previous behavior is shown by the real browser test. A one-worker editor package Vitest probe without the lease showed failures/timeouts in ShortcutPalette, FloatingToolbar, and GradientEditor under concurrency; that manual probe was stopped and is not validation evidence. The actual affected validation run remains incomplete and must complete through the repository verifier/lease.
- After the baseline test, implement the minimal primary-button guard in GuideOverlay, update guide usage help, and rerun its exact Playwright regression with screenshots inspected. Then run the full current `verify:plan`/`verify:affected` plan, classify failures, capture website visual results, request independent `review-agent` review, and commit a coherent implementation batch. Keep the current worktree and original checkout until C1/C2, integration, remote confirmation, and any site deployment check are complete.

### Continuation checkpoint — C1 #2881–#3024 (2026-10-21)

- The coordinator integrated the read-only #2953–#3024 research handoffs. The added intervals contribute 33 individually reviewed issues and 33 distinct PR records; page evidence includes the noted #2953–#2976 post-cutoff retrieval timing (no material issue-body/state drift), one absent census slot each at #2962 and #2999, and later community replies after C1 held out of the frozen assessment. Latest C1 totals should be confirmed with `node scripts/research/penpot-audit.mjs status --cutoff C1`; C1 remains incomplete and C2 unfrozen.
- The #2922/#2369 middle-button guide issue was reproduced in Chromium against pre-fix code: the guide moved during middle drag and camera panX stayed at -295.5. The fix routes a middle drag starting on a guide hit-area into the established canvas pointer pipeline, and GuideOverlay ignores non-primary pointer downs. The exact one-worker Chromium regression now passes and compares guide screen movement with committed camera pan. Before/after screenshots were inspected and show the guide remaining visible during pan; artifacts are in `test-results/run-1439201-1420/`. Website interface help now explains primary-button guide drag, middle-button pan, and right-click context actions. No new marketing claim or demo is warranted.
- New product leads worth a grounded decision: preserve compatible component overrides on swap (#2953); expose on-canvas layout padding controls (#2970/#3023); prototype board scrolling with per-file overflow semantics (#2998, requires schema and compatibility decisions); and per-side stroke Figma import/SVG export fidelity (#9854, with PDF and token behavior separate). These remain unimplemented candidates pending investigation and bounded acceptance. Touch reorder (#2958), constrained viewport layout (#2957), semantic SVG IDs (#2965), nested prototype anchors (#3003), and source-structure-preserving SVG output (#3004) remain separate research/testing or product decisions. Marketing changes follow verified shipped behavior only.
- Changed application scope now also includes `CanvasArea.tsx` system pointer routing and its capture/cancel lifecycle. Run fresh `pnpm verify:plan`, then complete `pnpm verify:affected` under the lease with bounded workers, plus `node scripts/audit-architecture.mjs --ci`. The prior affected run did not finish editor package unit tests, so it remains incomplete. Check focused unit/E2E test lanes, inspect the latest successful before/after screenshots from `run-1439201-1420`, and exercise the full guides spec for primary drag, deletion, visibility, keyboard nudge, and context-menu regression.
- Then inspect the interface-doc page visually, reconcile/check the audit ledger, complete one coherent app/docs/audit commit, run `pnpm verify:push`, request final independent `review-agent` review, and resolve findings. Refresh remote master and current PR/rule/CI evidence before integration. Do not delete this worktree until C1/C2, review, merge, remote ancestry, and triggered website deployment are confirmed.

### Execution checkpoint: 2026-10-21 — import fidelity and interaction batch

The application checkpoint is `2e9002d56` on `codex/penpot-corpus`; audit
ledger edits remain uncommitted. Latest remote `master` advanced after the
original worktree refresh to `f0b82567d`; integrate that commit before pushing.
The original checkout and other worktrees remain preserved, and no open PR
currently overlaps this batch.

### Continuation checkpoint — C1 pages 29–30 (2026-10-21)

- Pages 29 and 30 contain 76 issue records and 124 PR records. Five page-29 issues (#3015, #3016, #3017, #3022, #3024) already had individual assessments; the remaining 71 issue records are now assessed from their complete captured bodies and issue-comment threads. PRs remain separate evidence and do not count as issues reviewed.
- `status --cutoff C1` now reports 974/3,659 page-listed issues assessed (2,685 research-pending) and 3,318 engineering-pending; supplemental #437 is separate. Reconciliation still reports 12,050 records, zero duplicate IDs/numbers, 35 bodyless issue records, and no unresolved issue comments. `reconcile` passes. `check` exits 1 only for the expected incomplete corpus and unresolved applicable findings; checksum and source-pointer checks pass. C1 remains frozen; C2 remains unfrozen.
- Fifty-three issues in these pages were given reasoned no-change dispositions. Eighteen retain engineering follow-up with distinct conditions recorded, including #3026 color-asset detachment during HEX-field focus/copy, #3027 failed remote-save recovery feedback, #3107 palette parity for stroke/shadow, #3114 nested flex placement, #3157 guide-to-object snapping, #3162 typography-definition identity, #3182 shape fill with unavailable original fixture, #3200 touch layer reorder, #3210 auto-parenting through flex content, and #3214 zoom while eyedropper is active. See per-issue ledger entries and `findings.md`.
- The latest verified Varve master baseline was refreshed to `f0b82567d` and merged into this worktree. Current branch HEAD is `74e23b79dcb5525beae15a4d94a67fcccefe7828`. The website changelog resolver now prefers the active worktree; after the merge exposed a stale-root test failure, the targeted affected plan passed all selected lanes, including 309 website unit tests, all 696 website E2Es across Pages/custom-domain/touch projects, and both website builds. The earlier broader 72-lane attempt is recorded as failed at the stale-root assertion and is not claimed green; focused app E2Es and package checks from the preceding batch remain as recorded above.
- Next: reproduce #3157 in the real guide-drag browser route, inspect the affected guide/snap preference boundaries and screenshots, then implement only if the current behavior misses the reported precision workflow. Preserve C1 issue distinctions, continue ascending page reviews and recursive frontier work, and keep the worktree until C1/C2, integration, remote ancestry, and deployment confirmation are complete.

### Continuation checkpoint — C1 pages 31–32 (2026-10-21)

- Read-only reviewers completed pages 31 and 32. Page 31 has 29 issues plus 71 PRs and 162 captured comments; page 32 has 24 issues plus 76 PRs and 67 captured comments. All issue comment counts reconcile. PRs remain separate evidence. Linked PR #7575, #3391, #3382, and #3414 were inspected; Taiga and original media availability is recorded in `frontier.ndjson` as that frontier is reconciled.
- The per-issue ledger now has 1,128/3,659 page-listed issues assessed, 2,531 research-pending, and 3,231 engineering-pending; supplemental #437 is separate. The frontier contains 899 explicit edges, including the newly recorded inaccessible Taiga stories and linked PR evidence. The checker remains intentionally incomplete for the wider C1 corpus and applicable evidence frontier. C2 is not frozen.
- Page 31 follow-ups include #3230 transaction-history consistency, #3233 hidden/locked parent drag, #3254 nested-text ungroup at zoom, #3276 slash/traversal export paths, #3289 click-through hit testing, #3293 imported-format filename handling, and #3318 tool-switch routing. Page 32 adds #3340 numeric SVG resizing/strokes, #3365 clipped layout-grid overlays, #3372 image seams, #3373 nested-text prototype overlay closure, #3387 recent-color gradient-asset creation, #3394 external-format compatibility, and #3421 negative shadow spread. Exact conditions are in the ledger.
- Website impact for these upstream reports remains “no claim change”; update the marketing site only after a capability is implemented, reviewed, integrated, and publicly available. Current website test evidence remains 696/696 E2Es and both site builds passed on the changelog resolver fix.
- Current browser work: the #3157 guide-snap regression is queued through the heavy-task lease behind an independent `verify:push` operation in `/home/kevina/CodingProjects/varve/.worktrees/layout-pr-integration`. Its first fixture attempt failed before exercising snapping because it did not create a guide; the fixture now follows the established ruler-drag interaction and is awaiting a clean baseline result. Do not classify #3157 until the exact test reaches its snap assertion. Browser evidence uses the TypeScript renderer fallback; native GUI and real WASM remain unverified.
- Current branch has committed C1 checkpoint increments `6d8dc9705` (pages 29–30), `7f1fa377c` (refined dispositions), and `605943860` (pages 31–32), alongside prior implementation commits. Continue with the exact #3157 reproduction, then decide the smallest complete vertical slice. Preserve the original checkout/worktrees and do not clean this worktree until all C1/C2 work, review, integration, remote confirmation, and site deployment checks are complete.

Application increments committed: `fb068e0d5` preserves SVG `currentColor`,
named colors, and inline text styles; `9c0412d3b` restores middle-button guide
panning and adds frame-to-component creation and primary-button resize routes;
`457b55fb7` separates file preparation from import progress and retains visible
cancellation; `2cd8c7950` explains clipboard read capability failures; and
`2e9002d56` adds browser-reserved shortcut regressions. The independent review
of the implementation diff found no actionable findings. Website impact is
limited to accurate file-format and interface guidance; no homepage or demo
claim is warranted.

Inspected visual evidence: SVG inherited-color and inline-text browser
snapshots, and before/after guide-pan captures showing the guide stays anchored
while the camera pans. Changed website routes passed in both GitHub Pages and
custom-domain builds. The broad website E2E run reached 583/692 tests before
the runner session was terminated; it remains incomplete. The affected plan
selected 40 validation lanes without full-suite escalation. Formatting,
affected package typechecks, editor tests (8,815 passed, two skipped), import
tests (403 passed), desktop package tests (90 passed), website unit tests
(308 passed), focused app E2E, keyboard/navigation E2E (28), adjacent import
E2E (12), and export E2E (15) passed. `audit-architecture.mjs --ci` reported
14 known cycles and no layer violations, within enforced ceilings. Browser
runs used the TypeScript renderer fallback after WASM failed to load; native
GUI and real-WASM behavior remain unverified. No native code changed.

`reconcile --cutoff C1` passes. The frozen inventory holds 3,659 issues and
8,391 PR records, with zero duplicate IDs/numbers and no unresolved issue
comments in the cache. Current status: 903/3,659 page-listed issues assessed,
2,756 research-pending, and 3,371 engineering-pending; supplemental #437 is
separately assessed. The checker exits 1 for the expected remaining corpus and
applicable engineering findings. The evidence frontier currently has 885
edges, including inaccessible external evidence and Varve reproductions still
to perform. C1 pages 29–34 are assessed individually, including pages 33–34 (50 issues, 150 PR records, 139 comments). Page 33 WOFF2 support (#3521) is already covered by Varve and upstream implementation evidence; page 34 confirms existing Magic Wand/Slice routes and identifies superscript/subscript controls (#3614) as a feature opportunity. C2 is not frozen. Current guide-snap browser regression remains queued through the heavy lease. Next: finish #3157 baseline reproduction; then continue the explicit per-page issue review and frontier. The audit worktree must remain until C1/C2, review, integration, remote confirmation and deployment checks are complete.


### Continuation checkpoint — C1 pages 33–34 (2026-10-21)

- Independent read-only review completed all 50 issue bodies and 139 comments; the pages also contain 150 separately classified PR records. Page 33: 20 no-change, 10 follow-up; page 34: 14 no-change, 6 follow-up. `reconcile --cutoff C1` passes; inventory remains 3,659 issues / 8,391 PRs, no duplicate IDs/numbers, zero unresolved cached issue comments.
- Updated totals: 1,077/3,659 issues assessed, 2,582 research-pending, 3,251 engineering-pending; supplemental #437 remains separately assessed. `findings.md` records candidate boundaries and the WOFF2 implementation chain; frontier edges preserve inaccessible attachments, hosted examples, and Taiga references.
- C1 remains frozen at 2026-10-20T02:39:22.818Z. C2 is not frozen. Website decision remains no marketing changes until a verified capability ships and is publicly available.
- Current working change is the #3157 browser regression fixture; it has not yet reached the snapping assertion. Heavy Playwright lease is queued behind the active independent website E2E. Preserve this worktree and continue with the lease result before classifying #3157.


### Continuation checkpoint — C1 pages 35–36 (2026-10-21)

- Read-only reviews assessed 51 issue rows, 149 separate PR rows, and all 103 comments across pages 35–36. No issue bodies or comment pages are missing. Related PRs #3641, #3814 and #4760 were inspected. The audit ledger now records upstream-only fixes, existing Varve routes, data/render reproduction candidates and product decisions separately.
- Updated totals: 1,128/3,659 page-listed issues assessed; 2,531 research-pending and 3,232 engineering-pending; supplemental #437 remains separately assessed. The frontier includes unresolved Taiga stories and unavailable source files.
- Strong feature opportunity #3754 is style-property transfer, including multi-shadow stacks. It requires a real command/history/clipboard route and acceptance around selection, undo and save/reopen. No marketing claim until published. C1 remains frozen and C2 is not frozen.
- The exact #3157 guide-snap E2E remains queued behind the active website E2E lease; `pnpm verify:affected` passed formatting, lint, emoji/docs audits, and E2E typecheck before waiting at the lease. Continue with that baseline run; preserve the worktree.


### Continuation checkpoint — C1 pages 37–38 (2026-10-21)

- Read-only reviewers assessed 34 issue rows, 166 separate PR rows, and all 81 comments. Linked PRs #9005 and #4020 were followed. Updated totals: 1,240/3,659 issues assessed, 2,419 research-pending and 3,175 engineering-pending; supplemental #437 remains separate.
- #3928 fixed-source prototype overlay placement has a concrete Varve runtime path to reproduce next; #3885, #3905, and #3941 retain their independent conditions and missing evidence. Existing capabilities and explicit product decisions are recorded individually. C1 remains frozen; C2 is not frozen.
- Website impact remains no public claims before verification and release. The #3157 E2E remains queued behind the same active website lease; its typecheck passed and docs/emoji audits pass after the new checkpoints. Continue to hold code classification until the browser test executes.


### Continuation checkpoint — C1 pages 39–40 (2026-10-21)

- Read-only review assessed 22 issue rows, 178 separate PR rows, and all 94 comments across pages 39–40. PRs #4134, #4231 and #4118 were followed. C1 totals: 1,184/3,659 issues assessed; 2,475 research-pending; 3,206 engineering-pending; supplemental #437 separate. Reconciliation passes.
- New reproduction candidates preserve distinct causes: #4062 versus #4163 IME conditions, #4119 nested-flex stale canvas/export, #4124 repeated SVG clipPaths, #4125 group-title change after layout, and #4128 device-scaled raster eyedropper sampling. Missing private fixtures remain explicit.
- #3157 browser validation is still waiting behind the live website E2E lease. It has not yet reached the snap assertion. Website impact remains no new claims until a capability is verified and released. C2 remains unfrozen.


### Continuation checkpoint — C1 pages 41–42 (2026-10-21)

- Independent read-only review assessed 56 issue rows, 144 separate PR rows and 186 comments across pages 41–42. C1 totals are 1,240/3,659 issues assessed, 2,419 research-pending and 3,178 engineering-pending; supplemental #437 remains separate. Reconcile/checksum validation remains expected to report only incomplete remaining corpus/findings.
- Linked-source pages had no directly referenced issue PRs; comment-linked external Taiga stories, OpenType specification, and unavailable report attachments are listed in the frontier. Page 41/42 reproductions preserve distinct text, layout, export and pointer conditions. C1 frozen; C2 not frozen.
- #3157 guide browser test remains queued behind the live 690-test website run; do not classify it until the test reaches its snap assertion. Preserve the worktree.

### Continuation checkpoint — guide snapping, export names (2026-10-21)

## Checkpoint state

- Worktree `/home/kevina/CodingProjects/varve/.worktrees/penpot-corpus`, branch `codex/penpot-corpus`.
- Frozen corpus C1 unchanged: 12,050 records (3,659 issues, 8,391 PRs), 121 pages,
  source SHA `be2e117f670fdc3fe440e55bea541df28f1c76d9`, cutoff
  `2026-10-20T02:39:22.818Z`. Supplemental #437 assessed separately. C2 is **not** frozen.
- Coverage: 1,240/3,659 page-listed issues assessed (2,419 research-pending). The
  engineering counter is not a completion signal — it counts every issue whose
  `engineeringStatus` is not `closed`.
- Frontier: 898 edges. Recurring unresolved classes: Taiga stories that 404 for the
  public, `tree.taiga.io` media returning 403, private report attachments, and hosted
  reproduction pages that no longer exist.

## Implementation batches completed in this session

### 1. Penpot #3157 — ruler guides snap to object geometry
- `components/GuideOverlay/guideSnapTargets.ts` (target enumeration, scope-rooted walk,
  hidden/snapExcluded exclusion, locked nodes eligible).
- `components/GuideOverlay/guideSnapResolver.ts` (gesture-scoped resolver shared by the
  ruler-creation and re-drag routes; platform-aware Ctrl/Cmd bypass).
- `GuideOverlay.tsx` lazy target resolution on the first pointer move, exact-coordinate
  snapping, solid-while-held feedback; `Ruler.tsx` creation route.
- Evidence: 11 target tests, 9 resolver tests, 8 component tests, 5 ruler tests, 2
  benchmark budgets (8.6 ms/1k, 15.6 ms/5k), and `guides.spec.ts` creation+re-drag
  regression that fails pre-fix (302.5 vs 300).

### 2. Penpot #3276 — export names stay inside one path segment
- `@varve/scene` `formatFileName` flattens token values before substitution, so a slash
  in a name cannot create a folder; template separators remain the only structural ones.
- `exportSaveAdapter` sanitizes the browser archive name and suggests only a sanitized
  final file name to a single-file save dialog.
- Evidence: 4 naming regressions + 4 adapter regressions, each failing before the fix.

### 3. Recorded, not implemented
- #3289 transparent-fill interiors still intercept clicks: the click policy excludes
  transparent fills only from the tolerance halo. The correct slice needs stroke-aware
  hit testing for non-path primitives; recorded with the planned acceptance in
  `findings.md` rather than shipping a change that would make stroke-only shapes
  unselectable.

## Independent review

Two read-only reviews of the guide-snap diff were run. The first raised five findings
(eager render-time target build, locked targets, ruler-creation route, scene scope,
exact-hit sentinel); all five were fixed and the second review verified them, then
raised four more (traversal root for master edit, ruler-route bypass, platform-aware
modifier, Alt-duplicate highlight, click-time resolution, weak E2E creation assertion).
All of those were also fixed before commit, with regressions where the review showed a
coverage gap.

## Environment notes

- Website E2E: one run aborted because the preview server on port 15992 died mid-run
  (`ERR_CONNECTION_REFUSED` for 276 tests). A clean rerun of the same lane passed
  696/696; the failure was infrastructure, not content.
- `audit-architecture.mjs --ci` reaches the dead-code stage and fails because `ts-prune`
  exceeds its hardcoded 60s budget on this host; cycle identities (14) and layer
  violations (0) pass enforcement. Recorded as an environment limitation.
- Browser evidence uses the TypeScript renderer; WASM failed to load in the E2E harness,
  and the native Tauri GUI was not exercised.

## Affected-gate record (merged candidate, 2026-10-21)

`pnpm verify:affected` ran under the heavy-task lease on the merged candidate
(`origin/master` merged as `286eee0a6`). 68 of 79 lanes reported before the first
failure; the run aborts on the first failing lane, so the remainder were re-run
individually through the same lease.

Passed: format/lint on touched files, audit:emoji, audit:radius, audit:claims,
audit:docs, audit:spacing, audit:sizing, typecheck:e2e, typecheck:website-e2e,
typecheck for website/editor/import/scene/desktop/ai/cli/codegen/collab/history/
home/layout/print/prototype/ui, the fourteen file-scoped unit lanes, the unit
suites for website/editor/import/scene/desktop/ai/cli/codegen/history/home/
layout/print/prototype/ui, website-unit, and the clipboard-capabilities,
component-context-menu and file-import browser lanes.

Re-run individually after the abort: guides-visual + guides + selection-resize +
browser-reserved (pass), keyboard-nav + input-navigation (pass), table-import +
lut-import + gradient-map import workflow (pass), export (pass), file-import
(10/11, see below).

Not green locally:
- `file-import.spec.ts` "identifies the file during asynchronous PSD decoding"
  failed because it polled for a transient progress label; the failure screenshot
  shows the completed import. Rewritten to observe progress mutations and import a
  three-file batch; passes deterministically (commit `122b0a02b`). This is a test
  defect, not a product defect.
- `editor-chrome-visual` (overlay-alignment, upscale-dialog-visual, email/visual,
  workspace/visual) fails five screenshot comparisons in this environment. The
  committed baselines are byte-identical to `origin/master`, the branch touches no
  upscale/email/workspace component, and the diffs are font-metric offsets plus a
  transient engine status word ("Processing" vs "Modified") captured in a baseline.
  Classified as environment-sensitive baselines; CI is authoritative for that lane
  and no baseline was updated.
- `audit-architecture.mjs --ci` cannot complete its dead-code stage on this host
  because `ts-prune` exceeds the script's 60s budget; enforced cycle identities (14)
  and layer violations (0) pass. Unchanged from the earlier checkpoint.

## Push blocked by repository policy (2026-10-21)

`git push --dry-run origin codex/penpot-corpus` runs the pre-push checkpoint and stops
with `Push checkpoint: BLOCKED`:

```
History-sensitive findings:
- large-binary-addition 5c8c95f0ec865e3a6030c45a30b7f40cecd81948 \
  docs/audits/penpot/snapshots/C1/issues.ndjson
Local blocking lanes: history:secrets, history:policy, ...
```

The finding is the frozen machine-readable ledger: `issues.ndjson` was added in
`5c8c95f0` at 11,068,269 bytes, above `PUSH_LIMITS.maxBinaryAdditionBytes`
(10 MiB, `scripts/quality/validation-policy.mjs`). It is text, but the history
policy classifies additions by size only. Current size is 11,420,795 bytes, so
the final blob is also over the limit; only an *addition* commit is flagged.

Resolution applied: the ledger is now `snapshots/C1/issues.ndjson.gz`
(1.68 MB, deterministic gzip; the research tool reads and writes it
transparently and `zcat` still yields the same NDJSON). The manifest checksum
tracks the uncompressed content. The work is published from a fresh
`codex/penpot-corpus-integration` branch cut from `origin/master`, so the
11 MB blob never enters remote history and no repository control is bypassed;
the progressive 45-commit record stays on the local `codex/penpot-corpus`
branch. The two options below are kept for the record:

1. **Shard the ledger (preferred).** Split `issues.ndjson` into
   `snapshots/C1/issues/part-NN.ndjson` shards under 10 MiB each, teach
   `scripts/research/penpot-audit.mjs` (and `penpot-audit.test.mjs`) to read and
   write the shard set, then rewrite this unpublished branch's history so the
   11 MB blob never exists. Rewriting invalidates every commit SHA cited in this
   record and in the earlier checkpoints, so those references must be updated in
   the same pass.
2. **Explicit override.** `VARVE_PUSH_OVERRIDE_REASON="<reason>"` on the push
   records a local audit entry (`scripts/quality/pre-push.mjs`). That bypasses a
   repository control, so it needs the maintainer's decision; it was **not**
   used here.

`pnpm audit:imports` (the gate added on `master` after this branch last merged)
was run from the upstream implementation against this branch's committed tree:
12,343 relative imports across 10,333 files resolve — clean. Nothing in this
branch reintroduces the untracked-module defect that gate exists for.

## Next operations

1. Resolve the push policy block above (shard + rewrite, or a maintainer
   override), then push `codex/penpot-corpus`, open a PR to `master`, and merge
   only after the required checks are green for the exact candidate SHA.
2. Continue C1 in ascending page order from page 43 and resolve the applicable frontier,
   starting with the recorded high-priority candidates (#3114 nested flex placement,
   #3162 typography identity, #3372 image seams, #3026 colour asset detachment, #3289
   stroke-aware hit testing).

### Continuation checkpoint — PR #174 E2E triage (2026-10-23)

- Remote integration target: `varvedesign/varve` `master` at
  `6eebb9581eb40f36608b772af6b039114a5f30c5` (PR #186 merged). PR #174 head
  `9b720a648d5a2ef77073b75b8fbe6ce18ae2cf53` opened against it. GitHub reports
  `master` as protected only against deletion and force-push; PR-only
  integration remains policy.
- PR #174's CI run `39758713624` failed 11 of 24 E2E shards, not 7. The
  synthetic merge under test was `5dd2c23d` (`9b720a64` into `6df242fb`).
  Reading the per-job logs separated the failure classes instead of treating
  them as one canvas-routing regression:
  - Eight shards failed because the vertical dock splitter intercepted
    pointer input. The log names `workspace-dock-splitter--ruler-adjacent` as
    the covering element for Add publishing page, Add Design Canvas, Save
    current selection, Detach Layers, and the responsive dock contract.
  - The layers shard failed because `dismissMissingFontsDialogIfPresent` and
    its two call sites had been deleted from the branch, so the Missing Fonts
    overlay covered the panel for every later click.
  - Thumbnail and format shards pressed `Control+Shift+H`. The branch moved
    Home to a browser-safe chord but left these master-side call sites, the
    in-app help text, and the Home tooltip assertion on the old binding.
  - The currentColor import regression compared a new baseline PNG with
    `maxDiffPixels: 0`; CI reported 86 differing pixels (0.01), the same
    font/antialias baseline class already rejected for the inline-text spec.
  - The middle-button resize spec measured screen geometry, so a legitimate
    camera pan read as a resize; its locator also resolved to a different
    overlay rect after the camera moved.
- Fixes in this checkpoint, each reproduced first in Chromium at one worker
  through the heavy-task lease:
  - The splitter's pointer band is now `SPLITTER_HIT_EXTENT` (12) pixels deep
    and ends exactly at the divider, inside the leading panel. `rulerAdjacent`
    and its `translateX(-12px)` override are removed; the grip is pinned to
    the divider edge. Before: `dock-panels` reported 11 unreachable controls
    and the a11y shard could not click Add publishing page. After: the same
    spec reports `DOCK-PANEL-FINDINGS []`, and the a11y, deep-selection,
    Design Canvas, and responsive dock specs pass.
  - The missing-font dismissal helper and its call sites are restored.
  - Home navigation in specs goes through the menubar's Home button through a
    shared `returnToHome` helper; the Home button now exposes
    `aria-keyshortcuts`, and the tooltip spec compares the tooltip with that
    registry-derived value instead of a literal chord. In-app help and the
    website keyboard reference use the same chord the app renders.
  - The currentColor regression counts pixels painted with the inherited
    `#123456` fill instead of comparing a screenshot; the new baseline PNG is
    deleted. The middle-button spec targets a stable `selection-outline` test
    id and asserts an unchanged size plus a translated box (a pan), not an
    unchanged screen position.
  - Verified in Chromium at one worker through the heavy-task lease after the
    fixes: `a11y/prompt-dialogs-axe`, `canvas/deep-selection` (10),
    `canvas/design-canvas-navigation`, `canvas/tooltip-system` (10),
    `shortcuts/browser-reserved` (3) and `responsive/dock-panels` -> 30 passed
    (25.0m) plus the dock contract. The dock spec reports
    `DOCK-PANEL-FINDINGS []`. These are the same shards that failed on the
    pull request.
  - Commit hook note: `typecheck:e2e` takes 3m10s on this host under load and
    the commit checkpoint caps that lane at 120s. The lane was run standalone
    and passed; the checkpoint passed on retry. This is a local budget
    limitation, not a skipped check, and CI runs the same lane.
- Integration: the branch now merges `master` at
  `6eebb9581eb40f36608b772af6b039114a5f30c5` (`9983c49e8`). The only conflict
  was `tests/e2e/canvas/guides.spec.ts`, where master's #186 already carries the
  guide-snapping tests that this branch also carries in its squashed commit.
  The resolution keeps master's four shared tests and appends the three
  branch-only ones (middle-button pan over a guide, vertical and horizontal
  ruler-drop removal). Nothing was dropped and no implementation was reverted.
  The merge keeps master's single `convertElement(root, ...)` call in
  `parseSvg`; `inheritedColor` and `inheritedVisibility` both flow through
  `convertElement` and `convertElementContents` as recorded earlier.
- Additional Chromium evidence after the restart: `bleed-baseline` (no-bleed
  inspector guides), both `font-availability` cases, and two `multipage-canvas`
  cases passed (5/5) before the runner session was restarted. The rest of that
  batch and the guide-conflict resolution are re-queued through the lease.
- Corpus state is unchanged at this point: C1 remains frozen at
  `2026-10-20T02:39:22.818Z`; C2 is not frozen. The ledger checksum matches
  the manifest.
- Coverage gap found while reconciling: 95 issues on pages 9, 10, and 13–16
  remain `unreviewed` although later pages are assessed. C1 completion needs
  those backfilled, not just pages 43–121.

### Merge follow-up — middle-button pan over interactive overlays (2026-10-23)

- The first post-merge browser run failed the two middle-button pan specs for
  two distinct reasons, neither of which was a flaky rerun:
  - `tests/e2e/canvas/guides.spec.ts` lost `?perf=1` when master's #186 copy of
    the file replaced the branch's. The spec reads the render camera through
    `window.__varvePerf`, which only installs with that flag, so it threw
    "render camera was not available". The merged file now keeps master's four
    shared tests with the perf flag restored for the branch-only pan test.
  - `selection-resize-mouse-buttons` showed a zero pan delta: the selection
    overlay consumed the middle-button pointerdown, so `SelectionOverlay`'s
    non-primary guard prevented a resize but nothing started a pan either.
    `CanvasArea` now forwards a middle-button gesture that starts on ANY
    canvas overlay (guide hit area, selection outline, handles) into the canvas
    input pipeline in the capture phase, and stops the overlay handler from
    double-acting. The guide-only routing it replaces covered one overlay and
    left the rest inert.
- This is an integration regression class the earlier checkpoint warned about:
  master moved while the branch was open, and the merge silently dropped a
  test assumption that the branch depended on. Both were caught by running the
  affected specs after the merge rather than trusting the pre-merge evidence.

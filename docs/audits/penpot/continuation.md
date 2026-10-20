# Penpot audit continuation

## Immutable acceptance and cutoffs

- User-authorized objective: assess Penpot issues exhaustively through frozen C1 and one later C2; implement applicable Varve improvements with reproduction, validation, independent review, documentation, and integration evidence. Do not claim completion after the first batch.
- Baseline Varve remote `master` SHA: `5172718c6f0f2597466cd08d0839b53ccafefbd2`. Isolated branch/worktree: `codex/penpot-corpus` at the same SHA; original dirty checkout and other worktrees remain untouched.
- C1 froze at `2026-10-20T02:39:22.818Z` UTC, source Penpot `develop` SHA `be2e117f670fdc3fe440e55bea541df28f1c76d9`. Do not change C1. Do not freeze C2 until C1 issues and applicable evidence frontier are exhausted or individually blocked.
- C1 listing: 12,050 records across 121 pages: 3,659 issues (757 open / 2,902 closed), 8,391 PRs (87 open / 8,304 closed), no duplicate IDs or issue numbers, 35 null issue bodies, and all 2,559 non-empty issue discussion threads captured with zero unresolved comments. Page inventory omitted issue #437 despite its pre-C1 `updated_at`; its full record/comments are kept separately in `snapshots/C1/supplemental.ndjson` and the common Git cache.
- Current ledger at checkpoint 2026-10-20: 570 page-listed issue assessments are completed and 3,089 remain research-pending; supplemental #437 is separately assessed (571 unique issue IDs total). Engineering pending count is 3,412. C1 checker correctly remains incomplete for these corpus-wide counts; the current snapshot checksum and page/comment consistency checks pass. `node scripts/research/penpot-audit.mjs status --cutoff C1` is authoritative.
- Ranges assessed individually through #2160: selected early ranges through #696, then sampled/bounded ranges through #2160, with numeric gaps retained. Coverage is not contiguous; see the per-issue ledger and `frontier.ndjson`. Agents reported all bodies/comments in their assigned returned ranges read; pull requests remain separately classified.

## Durable evidence and ownership

- Authoritative audit area: this directory. `snapshots/C1/manifest.json`, `issues.ndjson`, `reconciliation.json`, `supplemental.ndjson`, `findings.md`, `frontier.ndjson`, and `follow-on.ndjson` are the working record. Research state and engineering state are separate.
- Raw REST responses are outside source history in `/home/kevina/CodingProjects/varve/.git/varve-research/penpot/C1/`. Do not commit raw API payloads. Inventory/comments support resume, response validators, retry/backoff, and idempotent normalization.
- Coordinator owns this ledger, implementation, decisions, integration, and validation record. Corpus agents supplied read-only #745–#864 and #817–#840 reviews; a separate `review-agent` reviewed the full implementation diff.
- The independent review found two tooling defects: C2 deltas were not bounded to the frozen cutoff, and `check` did not join ledger entries back to raw issue-page records. Both are now fixed in `scripts/research/penpot-audit.mjs`; tests cover post-cutoff issue/comment edits and body/pointer tampering. Reviewer found no actionable defect in component integrity/recovery or shortcut handling.

## Implemented batches and open engineering candidates

- Document recovery seeded by #10572/#12186: baseline accepted dangling instance variant IDs and did not validate component masters. Current code rejects unknown variant IDs, validates malformed/dangling component data and non-frame/missing masters, and repairs only affected links/selections while preserving scene nodes. No schema migration. Scene codec/save/reopen tests exist. #9816 token-collision routes were inspected; existing protections are sufficient and no Varve change is indicated.
- Browser shortcuts (#49): browser-reserved Ctrl/Cmd+Shift+H and Ctrl/Cmd+Shift+O bindings were replaced with safe chords; browser remapping/import is rejected, legacy web bindings fall back, and the palette explains the reservation. A real browser test proved the old Home binding left the editor and passes for Home/Outline after repair; screenshot was inspected. Its E2E test source is still uncommitted after a hook timeout under host contention; direct E2E typecheck and earlier 2/2 browser tests passed.
- Guide deletion (#1679): the full issue body and comment confirm matching-ruler deletion is expected; Taiga #3035 remains inaccessible. The overlay implementation and unit coverage are in place. Vertical-ruler deletion with undo/redo and corrected left-ruler geometry passed a targeted browser diagnostic. The full guide interaction suite is queued behind the shared lease; the three-theme visual suite passed before screenshot attachments were added and must be rerun for inspection. Architecture and website getting-started docs describe the behavior.
- Import progress (#1793): browser file preparation and parser progress are now separate, file counts describe prepared/completed files, the latest completed name is explicit, ETA is omitted, and cancellation remains available. Focused unit coverage passes 12/12. Browser and visual confirmation are queued behind the guide suite; architecture and website file-format guidance have been updated.
- Safari theme metadata (#1803): the marketing site's `theme-color` metadata now follows its resolved manual Light/Dark theme and updates on live theme changes, with a media-query fallback when JavaScript is unavailable. A website E2E regression covers persistence and both metadata states; run it with the exact browser/lease, inspect the attached page screenshot, and note that Safari's browser chrome itself needs a Safari-specific check.
- Current research tooling: `scripts/research/penpot-audit.mjs` and tests, dependency-free. No classifier marks issues reviewed. The `check` command now validates each inventory row against the source-page item, page pointer, response ETag, body checksum, identity, timestamps, labels, state, and comment count.
- Best code-follow-up candidates: #823 Shift axis-lock drag and #1060 non-primary mouse buttons on resize handles. #823 must be reproduced in Playwright at ordinary and rotated camera; #1060 must verify middle/right pointerdown, movement, Escape/context menu and pointer cancellation against geometry and history before repair.
- Additional feature candidates from independent C1 reviews: #1720 could preserve transparent SVG viewBox/canvas margins across import and paste (Penpot PR #1898 documents the upstream behavior, but its source fixture is unavailable, so Varve reproduction is still required); #1706's richer SVG text fidelity also needs its missing source fixture. #1714's no-preview project-list view remains a product decision; project search is already present. #1731 asks for reusable effect assets, while #1736/#1737 suggest reverse component synchronization and faster master navigation/clean-instance editing; these are feature gaps requiring workflow decisions. #1749 external prototype video is also a product decision.
- Other high-value, unverified candidates: #741 rotation-step wrapping; #717 zero-movement middle pan; #774 Shift-constrained shape drag; #775 Enter on selected frame; #786 offline browser/native persistence boundaries; #826 SVG DOCTYPE safe import; #837 blend plus shadow; #838 external multi-selection SVG clipboard; #849 Sketch import fidelity; #1091 selection hit tolerance; #1092 stroke bounds; #1153 stroke/shadow clipping; #1199 SVG drag preview; #1209 Safari clipboard identity/permission; #1216 floating-menu clipping; #1217 Shift-wheel pan; #1229 text-formatting shortcuts; #1274 font-size selection identity; #1298 gradient text SVG export; #1305 text export layout; #1324 multi-artboard PDF text/kerning; #1332 rapid repeat export snapshot; #1377 duplicate-page Auto grid persistence; #1391 large-document save/reopen; #1412 malformed archive recovery. Distinct conditions and acceptance notes are in ledger/findings/frontier.
- Product decisions are not automatic exclusions: #703 underline color, #721/#769 component interaction states, #724 prototype scrolling, #770 starter assets, #776 undo of in-progress path points, #824 localization, #841 relative number arithmetic, and others remain `product-decision` until supported by Varve workflows and explicit scope.
- Website impact decision: landing-page marketing claims and demonstrations do not change. Published help documentation now describes guide placement/deletion and the browser-safe Home/Outline shortcuts in `apps/website/src/pages/docs/getting-started/interface.astro` and `apps/website/src/pages/docs/keyboard-shortcuts.astro`; those pages are updated in source and remain unreleased until integration. A site visual E2E is currently using the shared heavy-task lease. Verified `master` merges may trigger the browser demo/site deploy; manual app releases remain separately authorized and have not occurred.

## Validation and integration state

- Workspace instructions are in `/home/kevina/CodingProjects/varve/AGENTS.md`. Toolchain baseline recorded Rust 1.97, pnpm 11.9, Node 26, wasm32 target, and Linux GTK/WebKit dependencies; this worktree currently resolves Node v22.23.2, so the runtime differs from the documented baseline. Latest host snapshot during concurrent work: 5.0 GiB available RAM, swap fully used, 65 GiB free disk; other worktrees are using disk and shared memory.
- Latest `pnpm verify:plan` selected 44 lanes across @varve/website, @varve/editor, and @varve/import, with no full-suite escalation. Latest `pnpm verify:affected` stopped at the spacing audit's 16 pre-existing raw-spacing drifts in two untouched files (`FirstRunOverlay.css`, `DownloadRedirect.astro`); format, lint, emoji, radius, and docs lanes passed before that failure. Focused unit coverage passed 365 tests; editor/import/desktop typechecks, website typecheck, and browser E2E typecheck passed. `pnpm audit:tokens` passed 324 pairs across three themes and no token-use violations. `audit:architecture.mjs --ci` completed with 14 cycles (under 17), zero layer violations, report-only instability/unused-export counts, and existing Shell/Menubar/context budget warnings; health audit passed. Fresh direct docs and emoji audits passed. The exact theme FOUC and theme-color E2Es passed in both GitHub Pages and custom-domain projects (4/4); the dark-header screenshot was inspected and is visually correct. The prior full website run had 688/692 pass: the FOUC selector issue is corrected and its exact regression now passes; navbar visual timed out only on the slow GitHub Pages route; the 390px custom-domain screenshot-layout assertion still needs an exact rerun. A second attempt accidentally started the full site suite because the wrapper script ignores extra arguments; it was stopped before completion and is not validation evidence. The exact 390px regression and editor interaction E2Es remain queued through the shared lease.
- The latest independent research-tool test run passes 16/16; `node --check scripts/research/penpot-audit.mjs` passes. `check --cutoff C1` currently fails only for expected pending issue coverage/applicable findings, with zero inventory pointer, checksum, timestamp, or identity errors. The checker now treats a missing after-cutoff marker as pending for unreviewed rows, while requiring an exact marker for reviewed rows; reviewed rows carry the explicit marker.
- Another worktree's full-gate/triage state must be rechecked before scheduling the next heavy browser run; never reclaim a live lease. Re-run the affected plan after the next implementation slice, then `pnpm verify:affected`; resolve the current untouched spacing-audit baseline failure or record its exact pre-existing evidence before committing. Fresh docs, emoji, and token audits are required after ledger/site edits. No full suite unless the planner escalates or a release checkpoint applies.
- Commits `5c8c95f0e` (audit tooling/evidence), `35c4fef86` (scene document recovery), `23eba88fa` (C1 ledger through #1800), `eef2fb66b` (browser-safe shortcuts plus docs), and `aa01d57c9` (C1 ledger through #1896) are on the task branch. The scene commit checkpoint passed 66 focused tests. The current guide, import-progress, website theme metadata, clipboard feedback, mouse-button, and expanded audit ledger remain uncommitted. No push checkpoint, PR, merge, site deploy, or app release has occurred. After validation/review, run `pnpm verify:push`, then use repository controls for focused PR/integration and verify any triggered deployment.

## Next operations

1. Complete the queued 390px website regression, then the exact import-progress, guide, clipboard, mouse-resize, and browser-shortcut E2Es through the shared lease; inspect every generated screenshot. Check Safari chrome separately if that runtime is available.
2. Re-run the final affected checks after any fixes, review native/browser evidence separately, refresh this checkpoint with exact test outcomes, then commit the implementation/documentation and research ledgers in coherent increments.
3. Run `pnpm verify:push`, inspect current repository branch rules, and integrate via focused PR controls; confirm remote ancestry and any triggered website deployment. Manual app releases remain separate.
4. Validate #1870 clipboard feedback across browser secure/insecure contexts and native fallback. Reproduce #1891 horizontal gesture/history behavior on MacOS/Brave before changing it; strengthen PDF assertions only if a meaningful gap is demonstrated.
5. Finish the reproduced SVG inline-font fidelity improvement from #1990 against the cached source fixture, with parser tests, browser rendering and visual comparison. Implement the layer-row hover outline as a discrete feature slice grounded in merged Penpot PR #2114, with canvas pointer/focus/keyboard and visual regression coverage. Continue bounded read-only issue reviews from #2137 and reconcile each range into the ledger/findings/frontier.
6. Continue C1 until every issue is individually assessed and relevant frontier edges are resolved or explicitly blocked; then freeze C2 exactly once, reconcile changed evidence, and finish its applicable reviews. Later arrivals stay in the follow-on queue.
This is a partial checkpoint. C1 remains incomplete; C2 is not frozen.

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

# Continuation record

Last updated: 2026-10-23 (session 2).

## Frozen baseline

- **Cutoff A:** `2026-10-21T19:30:05Z` – `2026-10-21T19:31:11Z`.
  - 1,237 issues (531 open / 706 closed) and 2,221 pull-request records,
    reconciled against the search index; 4,964 comments over 50 pages.
  - The raw pages lived outside Git at `/tmp/opencode/vectorcraft/raw/`.
    **They no longer exist** (tmpfs cleared). The frozen ledger rows in Git are
    the authoritative inventory; see README.md for what can and cannot be
    re-verified. Do not move cutoff A.
- **Cutoff B:** `2026-10-21T20:41:01Z`. Four issues created after cutoff A
  (#3465, #3467, #3470, #3471) and two older issues whose upstream status
  changed (#3446, #2523). The four new records are reviewed in
  `issue-ledger-cutoff-b.jsonl`; anything created after cutoff B belongs to the
  follow-on queue.

## Repository and ownership

- Session 2 worktree: `.worktrees/vc-open-file`
- Branch: `feat/vc-open-file`, based on `origin/master`
  `6eebb9581eb40f36608b772af6b039114a5f30c5` (the same SHA as
  <https://github.com/varvedesign/varve/commits/master> at session start).
- The main checkout is dirty with other agents' work (42 entries at session
  start). Nothing there was staged, reverted, stashed, or committed.
- `varvedesign/varve` and the previous `K-Arthur/varve` URL are the same
  repository. There is no branch protection and no required checks. A merge is
  not a release.

## CI status of the earlier work (rechecked, not assumed)

| PR | Merge | Checks at handoff |
|---|---|---|
| #165 | `335b4ce9` | Selected checks passed (`Change lanes`, certification, build, AI attribution). Rust, native E2E, benchmarks, hosted Chromium were **skipped**, not passed. |
| #180 | `321cf7c9` | **Failed** 4 E2E shards in run `39751637894` (SVG visibility, Enhance snapshots, empty-document overset expectation, resize interaction, variable-font selection, eight layers cases blocked by Missing Fonts). |
| #175 | `7f9db158` | Successor repairs. Run `39851788872` at `eaae98d0` passed certification and all 24 E2E shards, including the four that failed in #180. |
| #187 | `b9114559` | **Failed** JS in run `39878613867` at `openFileDedupe.test.tsx:85`. The failure is still present on master run `39905949131` (job `120281453188`). |
| master | `6eebb958` | CI failed on the same test. Website Deploy succeeded. `CI Debug Report` workflows are **queued**, not green. |

So the "merged" work is not uniformly certified: #180's failures were repaired
by #175, and #187 left master with a red JS lane.

## Session 2 commits

| Commit | Scope |
|---|---|
| `62f01d560` | `fix(editor)`: refuse an empty payload; one decode gate for `openFile` and `loadDocument`; report `FileReader` failures; rebuild dedupe fixtures with the codec; e2e zero-byte open |
| `6d6bf5213` | `fix(recovery)`: `loadDocument` returns false on refusal; recovery keeps an unreadable snapshot |

Validation for these commits is recorded below. Documentation and audit-record
commits follow them on the same branch.

## Validation evidence (session 2)

| Check | Result |
|---|---|
| `pnpm exec vitest run packages/editor/src/__tests__/openFileDedupe.test.tsx` | **Red before the fix** (`expected … length of 2 but got 1`), green after |
| `openFileUnreadable.test.tsx` empty-payload case | **Red before the guard change** (document identity changed), green after |
| `openFileUnreadable` + `openFileDedupe` + `documentSessionIdentity` | 22/22 pass |
| `openFileUnreadable` + `RecoveryManager` | 14/14 pass |
| `pnpm --filter @varve/editor exec tsc --noEmit` | clean |
| `node scripts/audit-health.mjs --staged` | pass (context.tsx 77 imports, Shell 57, no new imports) |
| `tests/e2e/menus/file-picker.spec.ts` (Chromium, real picker) | see "Browser evidence" below |
| Browser gradient parity probe (Chromium) | Canvas2D and SVG both 252/191/48 at t≈0.1/0.5/0.9 over white; evidence committed |

The pre-fix red runs were executed by temporarily restoring the previous guard
and re-running the new test, then restoring the fix. They are not claims about
the unmodified branch.

## Browser evidence

- `evidence/open-refused-empty-file.png` — the real File > Open picker after
  choosing a zero-byte `.varve`: the error toast names the file, the tab count
  and document name are unchanged. Chromium, workers=1, heavy lease.
- `evidence/gradient-parity-chromium.png` — Canvas2D versus inline-SVG gradient
  interpolation over white. It does **not** contain a Varve document and does
  **not** cover WebKit.

## Corpus status

| Disposition | Count |
|---|---|
| `screened-relevant` (open work) | 823 |
| `outside-varve-scope` (reason recorded per row) | 396 |
| `verified-existing` | 9 |
| `integrated-verified` | 9 |
| `applicable-requires-work` | 0 |

- Review depth is now derived from the review actually performed: **20 rows are
  `thread`**, 1,217 are `title`. Regenerating the ledger previously stamped
  every row `title` even when `research: reviewed-thread` was recorded.
- The live defect queue (`screened-defects.jsonl`) is filtered to rows that are
  still `screened-relevant`: **451** of the original 455. Areas: canvas 72,
  typography 64, geometry 64, stability 58, paint/colour 39, AI/EPS 39,
  persistence 29, document model 25, PDF 20, SVG 15, performance 11,
  accessibility 10, raster export 5.

### Corrections made in this pass

- **#861** — outcome/validation said "proposed, not implemented, none yet" while
  the disposition said integrated. It now records what shipped, the three
  additional conditions found (empty payload, unguarded main-context
  `loadDocument`, recovery snapshot deletion), and the tests.
- **#1140** — the row claimed canvas premultiplication was still proposed while
  the disposition said integrated. It now separates the verified PDF per-stop
  alpha fix from the browser-defined canvas interpolation, which a Chromium
  probe measured equal to SVG.
- **#33** — was excluded as "no Varve subsystem". Varve's `NumberField` holds
  only the number (the unit is a separate span) and selects it on focus, so the
  reported state cannot occur. Now `verified-existing`.
- **#1151** — was excluded as "no Varve subsystem". Varve has a native drop path
  (`tauri://drag-drop` + `read_dropped_file`) because wry/WebKitGTK consumes GTK
  drag signals on Linux. Now `screened-relevant`: the surface exists, but a
  Wayland-native drop has not been exercised.
- **#2177** — read as a full thread: four distinct conditions (heavy decode
  time, missing content, blurry `.ai`, missing font), samples on Google Drive
  not downloaded, and the follow-up says content appears after ~15 minutes. It
  is **not** a decode-guard duplicate; kept open with blockers recorded.
- **#861's original text** cited #1151 and #2177 as the same complaint. That was
  wrong; `findings.md` now says so explicitly.

## Remaining work

1. Merge this branch, verify the merge SHA on the remote, and confirm the JS
   lane turns green. Do not describe queued lanes as passed.
2. Continue the defect queue in 20–30-thread batches, starting with typography.
   Every row needs a full-thread read, an actual Varve path, and a reproduction
   where one is possible.
3. Reassess the remaining title-only exclusions. Two concrete counterexamples
   (#33, #1151) were found out of 295 blanket "no subsystem" exclusions; the
   rest are still title-level.
4. Master-placement hit testing: a placed-bounds AABB prefilter is the bounded
   improvement. It stays O(n); a real fix needs placement-aware indexing and a
   before/after benchmark.
5. Rapid text entry: the dev console reports "Maximum update depth exceeded"
   while typing quickly. Still unproven against a control revision.

## Blockers and honest gaps

- **WebKit gradient parity** is unmeasured. Playwright's bundled WPE WebKit
  fails to launch (`libicudata.so.74`); `pnpm webkit:prepare` provisions it, and
  the `webkit-gtk` lane is the engine family the desktop actually embeds.
- **Native file drop on Wayland** has no local Tauri session; browser tests
  cannot exercise it.
- **Recovery parse failure** (`restoreSession` returns `null`) is still silent
  and has no file name. Closing it needs a recovery-record redesign.
- **Heavy-file samples** for #2177 were not downloaded.
- **Rapid typing** has no reproduction/control comparison yet.
- The heavy-task lease was held by other agents for most of this session; every
  browser run waited for it. Playwright browsers had to be installed for this
  worktree's Playwright version.

## Exact next operation

After the branch is merged and the merge SHA is verified: `git fetch origin
master`, check `gh run list --branch master --limit 5` for the merge SHA, and
record the JS lane result here. Then start the typography batch by reading the
next 25 threads and writing dispositions through `build-ledger.mjs`.

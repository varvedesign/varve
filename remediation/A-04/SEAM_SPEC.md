# SEAM_SPEC — Batch A / A-04 IntelligencePanel

**Status:** seam plan accepted 2026-10-28 by the campaign lead. Implementation may
start only after RESEARCH.md and GAP_ANALYSIS.md exist (they do, at the repo
root) and only inside the seam worktree.

## Seam hypothesis

- **Entry:** Batch A / A-04 (remediation rank #6).
- **Target:** `packages/editor/src/panels/IntelligencePanel.tsx` — 3,191 lines,
  frozen at exactly 3,191 (no slack). Baseline entry must be removed (not lowered)
  because the split leaves every file at or under 400 lines.
- **Single concern:** the workspace-intelligence panel's tab UI (11 tab views,
  their variant-promotion dialogs, the tab model, and the shared severity/tab
  helpers).
- **Single extraction destination:** the new directory
  `packages/editor/src/panels/intelligence/`. One destination directory is one
  seam, matching the precedent of the completed `menu/defs.ts` split (one
  destination directory, 15 modules, one baseline entry removed) and the A-08
  test split. This is the campaign-lead resolution of GAP_ANALYSIS G1; it is
  recorded here so the "one module per tab" wording cannot drift into a
  multi-seam task.
- **Target after seam:** the parent stays as a thin tab router (docstring,
  imports, tab-model/tab-state wiring, render switch) at or under 400 lines.
- **Public API:** only `IntelligencePanel` is exported today and it must stay
  exported from the same path; consumers (`components/Inspector/panels/AuditPanel.tsx`)
  must not change.

## Declaration set before extraction (40 top-level declarations)

| lines | range | declaration | destination |
|-------|-------|-------------|-------------|
| 1 | 116-116 | ExtendedTab | tabModel.ts |
| 4 | 118-121 | IntelligenceTabGroup | tabModel.ts |
| 13 | 124-136 | TAB_LABELS | tabModel.ts |
| 3 | 138-140 | tabLabel | tabModel.ts |
| 5 | 147-151 | humanizeToken | shared.tsx |
| 5 | 158-162 | SEVERITY_MARKS | shared.tsx |
| 10 | 164-173 | SeverityMark | shared.tsx |
| 6 | 176-181 | SEVERITY_LABELS | shared.tsx |
| 3 | 183-185 | severityLabel | shared.tsx |
| 19 | 192-210 | isTabApplicable | tabModel.ts |
| 93 | 212-304 | useWorkspaceTabs | useWorkspaceTabs.ts |
| 136 | 306-441 | IntelligencePanel | IntelligencePanel.tsx (parent router) |
| 207 | 447-653 | LinterTab | LinterTab.tsx |
| 168 | 659-826 | LinterConfigEditor | LinterConfigEditor.tsx |
| 1 | 833-833 | auditPool | reviewAuditPool.ts |
| 446 | 835-1280 | ReviewTab | ReviewTab.tsx + extracted ReviewSummary.tsx |
| 49 | 1286-1334 | AuditTab | AuditTab.tsx |
| 86 | 1340-1425 | SpacingTab | SpacingTab.tsx |
| 27 | 1428-1454 | buildHistogramBars | SpacingTab.tsx |
| 1 | 1460-1460 | EFFICIENTNET_MODEL_ID | NamingTab.tsx |
| 179 | 1462-1640 | NamingTab | NamingTab.tsx |
| 111 | 1646-1756 | GovernanceTab | GovernanceTab.tsx |
| 146 | 1762-1907 | DebtTab | DebtTab.tsx |
| 44 | 1913-1956 | PrototypeTab | PrototypeTab.tsx |
| 72 | 1962-2033 | LayoutTab | LayoutTab.tsx |
| 8 | 2039-2046 | candidateSignature | VariantDiffTable.tsx |
| 5 | 2048-2052 | scoreBadgeClass | VariantDiffTable.tsx |
| 97 | 2054-2150 | VariantDiffTable | VariantDiffTable.tsx |
| 176 | 2152-2327 | PromoteDialog | VariantPromote.tsx |
| 131 | 2329-2459 | VariantCandidateCard | VariantCandidateCard.tsx |
| 69 | 2461-2529 | VariantCandidatesSection | VariantCandidatesSection.tsx |
| 87 | 2531-2617 | ComponentsTab | ComponentsTab.tsx |
| 1 | 2630-2630 | EMBED_IMAGE_MODEL | similar/similarTypes.ts |
| 1 | 2631-2631 | EMBED_IMAGE_MODEL_ID | similar/similarTypes.ts |
| 1 | 2634-2634 | MAX_SIMILAR_CANDIDATES | similar/similarTypes.ts |
| 6 | 2636-2641 | SimilarMatch | similar/similarTypes.ts |
| 3 | 2648-2650 | WindowSimilarityTestHook | similar/similarTypes.ts |
| 5 | 2652-2656 | global | worker to decide (record before coding) |
| 1 | 2658-2658 | MAX_SEMANTIC_SOURCE_DIMENSION | similar/similarTypes.ts |
| 28 | 2660-2687 | loadImageToImageDataForAI | similar/similarTypes.ts |
| 503 | 2689-3191 | SimilarTab | similar/SimilarTab.tsx + similar/useSimilarSearch.ts |

## Applied edge cases (from GAP_ANALYSIS.md section C)

- **Module evaluation order — applies.** `auditPool` is constructed at module
  scope (line 833). Move it to a leaf module (`intelligence/reviewAuditPool.ts`)
  that ReviewTab imports; do not move a tab import above it in a way that
  changes the construction point. Keep the `inspector.css` import in the parent
  shell and verify the CSS is still loaded by the panel path.
- **Incomplete cut / dropped declaration — applies.** Only one of 40 declarations
  is exported, so tsc will not notice a deleted private helper. The proof is
  `node scripts/quality/refactor-verify.mjs --base master --target
  packages/editor/src/panels/IntelligencePanel.tsx --dest
  packages/editor/src/panels/intelligence`, which must report all 40 names
  preserved; plus the 9 covering tests unchanged before and after.
- **Aliased imports — does not apply** (no import aliases in the target).
- **Build tags / per-file init — does not apply** (TypeScript ESM; the only
  module-scope construction is the pool above).
- **Raw strings/comments — applies operationally:** cut with
  `scripts/quality/godsplit-plan.mjs` ranges, never by line counting.
- **Test-file exemption — does not apply:** the covering test stays tracked and
  is not split in this task.
- **Generated files — does not apply.**
- **Baseline growth / `--force` — banned.** `audit-file-size --update` may only
  remove the A-04 entry; `added > 0` or `grown > 0` means the seam is wrong.
- **Concurrent worktrees — applies.** The other agent sessions are active in the
  main checkout; this seam runs only in `.worktrees/A-04` on branch
  `seam/A/A-04`.

## Sub-split requirements

Two declarations exceed the cap on their own and must be split inside the
destination before the seam can pass:

- `ReviewTab` (446 lines) — extract the summary/severity-chip section (or the
  scan hook) to a sibling module; both results ≤400.
- `SimilarTab` (503 lines) — extract the embedding/search/download hook
  (`similar/useSimilarSearch.ts`) and the types/constants/`loadImageToImageDataForAI`
  helpers; both results ≤400.

## Expected reductions

- Target: 3,191 → at most 400 (target 350-400) → baseline entry removed,
  FROZEN_COUNT 960 → 959.
- Destination: every module at or under 400 lines, target 350-400; no new
  baseline entry may be created.

## Proof of behavior preservation

1. Planner used; ranges and declaration manifest above.
2. `refactor-verify` passes with the 40-name manifest (including private names).
3. `pnpm test:agent packages/editor/src/panels/IntelligencePanel.test.tsx`:
   9 tests pass before and after, same test names.
4. `pnpm check:agent` exit 0.
5. `pnpm exec biome check` clean on every changed file.
6. `node scripts/quality/audit-file-size.mjs --update` removes exactly the
   target entry (added=0, grown=0, removed=1) and `audit:filesize` is green.
7. `pnpm agent:map` regenerated and staged.
8. No rendered-output change is intended: the seam is code motion inside one
   component tree. The covering component tests are the visual contract; 04 is
   recorded as "no visual surface changed" with these tests cited. A screenshot
   pass is not required by the visual policy for a pure code motion
   (docs/quality/visual-validation.md), and no design token or CSS rule changes.
9. Commit: seam files + baseline + generated map only; PR against master.

## Out of scope

Behavior fixes, new tabs, CSS changes, test rewrites, renames beyond package
uniqueness, and any second baseline entry. Queue them as separate tasks.

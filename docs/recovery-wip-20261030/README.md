# WIP preservation record - 2026-10-30

This branch is a cloud backup of every piece of uncommitted local work that was reviewed during the consolidation. Nothing was discarded without being preserved in git history or in the archived patch set below.

## Local line
- local master tip: 3afa943a905d48b747c85d7878af0ad40d91b765
- cloud archive of full local line: refs/heads/archive/local-master-20261030 (same tip)
- local branches: 64, tags: 115, stashes: 6 (untouched)

## Recovered WIP commits on branches
- 745dcb287 feat(automation): add the package README (recovered worktree work)  [feat/agent-control]
- 978da47d6 test(export): prove native PDF contract reports errors without a placeholder download  [feat/inkscape-corpus]
- 1dd825849 fix(layout): harden persisted grid tracks and inspector dismissal  [codex/layout-pr-integration]
- 8d39aeaf9 fix(import): budget embedded SVG raster pixels by decoded size  [codex/pc-bounded]
- 2e8ca301d fix(editor): flush tab switching before close and guard live dirty state  [codex/pc-lifecycle]
- 46bd6be46 fix(desktop): require save-target ownership before overwrite  [codex/pc-savepath]
- 350e4f6c4 docs(pdfcraft): correct closure evidence and add recovery-destination e2e  [codex/pdfcraft-closure-20261023]
- 7428c81fe fix(scene): repair non-finite document values and refuse unsafe saves  [codex/pc-nonfinite]
- b92fdd1cb feat(engine): support offsets on open paths  [codex/inkscape-offset-open]

## Archived patch files (held/stale WIP, apply against their worktree branch)
- docs/recovery-wip-20261030/patches/codex-inkscape-master-integration.patch
- docs/recovery-wip-20261030/patches/codex-native-presenter.patch
- docs/recovery-wip-20261030/patches/codex-penpot-pr174.patch
- docs/recovery-wip-20261030/patches/feat-clipboard-svg-flavour.patch
- docs/recovery-wip-20261030/patches/graphite-paint-corpus.patch

## Local-only archived artifacts (git-ignored, not committed)
- .worktrees/archive-20261030/pipeline-evidence (136 MB generated evidence)
- .worktrees/archive-20261030/stale-automation-snapshot (older subset of feat/agent-control automation package)
- .worktrees/archive-20261030/NEXT_PROMPT.md, agent-control-research-main-checkout-duplicate.md, lightcraft* , ui-depth-pipeline
- .worktrees/archive-20261030/worktree-patches (same patches committed here)

## External worktrees
- ~/.codex/worktrees/layout-master-integration and live-artwork-systems remain untouched and dirty by policy.

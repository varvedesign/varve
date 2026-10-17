# Continuation record

Last updated: 2026-10-17 (session 1 of this corpus pass).

## Frozen baseline

- Corpus cutoff **A**: `2026-10-17T04:41:35Z` – `2026-10-17T04:42:17Z`
  (1 296 issues / 1 682 PRs, reconciled; hashes in `README.md`).
- Cutoff **B** (second reconciliation): **not yet taken**. When taken, record
  the window, re-query `state=all` with `sort=created&direction=desc`, diff
  against `issue-ledger.jsonl`, and put arrivals in the follow-on queue below
  rather than editing baseline rows.
- Cache location for the raw crawl (outside the repository, not committed):
  `/tmp/opencode/photocraft/` — `issues.ndjson`, `comments.ndjson`,
  `issues.full.jsonl`, `prs.full.jsonl`, `manifest.txt`. If that directory is
  gone, re-crawl; do not reconstruct from memory.

## Repository state

- Worktree: `.worktrees/photocraft-hardening`, branch
  `feat/photocraft-hardening`, based on local `master` `32de0c41c`.
- The main checkout carries another session's uncommitted work (load/save
  truthfulness, version-field robustness, native lifecycle, collaboration
  host, presentation E2E, `packages/automation/`). **Do not stage, revert or
  commit those paths.** `context/usePersistence.ts` is shared with that
  session: this branch adds one import and one call at the head of `runSave`;
  expect a small import-block conflict if both land.
- `packages/scene/src/nodeResize.ts` was restored from the untracked working
  tree (see `findings.md` §6.1) because local `master` exported it without
  committing it. Master could not build before that.

## Completed in this pass

1. Corpus inventory + ledger for all 1 296 issues (`issue-ledger.jsonl`).
2. Verified and **corrected** the earlier body-level ledger's lock claim
   (`findings.md` §4.3) and confirmed the text-addressing and import-recursion
   classes are already handled.
3. Implemented the pending-text-draft drain (save engine + termination
   coordinator) with unit and end-to-end coverage (`findings.md` §4.1, §6.2).
4. Restored the missing `nodeResize` module so the branch builds.

## Open queue (applicable classes, not yet verified in Varve)

Ordered by the assignment's severity policy.

1. **Compositing against the wrong backdrop** — `findings.md` §4.7.
   First operation: run a same-camera differential oracle on an isolated
   element with a separable blend mode over an empty canvas region and compare
   against a forced full redraw; then read
   `docs/architecture/blend-evaluation-policy.md` for the intended contract.
2. **Colour-glyph and joining-control shaping** — §4.6 residual. Varve already
   discloses missing glyphs; what remains is whether colour emoji render in
   colour and whether ZWNJ/ZWJ survive shaping.
3. **Async generation guards** — §4.9. Audit every async completion for a
   captured session id + generation.
4. **Export fidelity claims** — §4.11. Re-extract produced files and compare
   against the source region; check the colour/print claims the export UI
   makes.
5. **Bounded document-scale work** — §4.12. Find operations that eagerly scan
   the whole document before honouring a limit.
6. **Dirty-state truthfulness** — §4.13. Verify undo-to-saved-revision and
   non-mutating actions against the transaction model (coordinate with the
   session that owns `usePersistence.ts`).

## Follow-on queue (post-cutoff arrivals)

Empty until cutoff B is taken.

## Exact next operation

Re-run the end-to-end spec through the heavy lease once the lease is free:

```bash
VARVE_E2E_PORT=1527 node scripts/quality/heavy-lease.mjs "e2e: text draft save flush" -- \
  npx playwright test tests/e2e/save/text-draft-save.spec.ts --project=chromium --workers=1 --reporter=list
```

Then run `pnpm verify:plan` and `pnpm verify:affected` in the worktree, commit
in this order — (a) restored `nodeResize`, (b) the draft-drain change with its
tests and docs, (c) the corpus ledger — and fast-forward local `master`.

The remote push to `varvedesign/varve` is a **separate** action: it publishes
the website (`website-deploy.yml` triggers on `packages/**` and
`apps/website/**`). Local integration does not imply a deployment.

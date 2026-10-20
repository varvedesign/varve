# Initial data-durability and history research

This is a topic-selected research pass performed while the complete issue
inventory is being fetched. It is **not** full-corpus coverage, Varve
verification, or authorization to implement a presumed shared defect. The
listed issues remain `unreviewed` in the corpus ledger until their IDs are
matched to the frozen inventory and individually assessed.

## Candidate source evidence

| Issue | Reported workflow and source evidence | Fix/history | Varve assessment |
|---|---|---|---|
| [#10513](https://github.com/tldraw/tldraw/issues/10513) | A reported edit can be lost if the page closes during a 350 ms persistence throttle. The issue states the repro was not browser-confirmed. | [PR #10526](https://github.com/tldraw/tldraw/pull/10526), merged as `53900ead3015a423f0731d27ae38e3876381b44e`, adds pagehide and hidden visibility flushes plus a pre-load guard; four unit regressions. The PR notes an in-flight IndexedDB write cannot be awaited at unload. | Varve has dirty-session pagehide/visibility/freeze flushes in `packages/editor/src/lifecycle/LifecycleProvider.tsx`, asynchronous session saves, one-second autosave polling, and recovery. Test real changes immediately followed by hide, close, crash, or forced termination; do not assume browser-event flush alone is durable. |
| [#10412](https://github.com/tldraw/tldraw/issues/10412) | Selection begun by brush/right-click/Enter/group/keyboard traversal did not establish the intended undo boundary. | [PR #10476](https://github.com/tldraw/tldraw/pull/10476), merged `0bba15d71780aca66e48804c0aeaf6ae5bc3aa37`, marks at drag start and avoids empty history entries. | Inspect all Varve selection entry paths and whether gestures intentionally remain one transaction. |
| [#10413](https://github.com/tldraw/tldraw/issues/10413) | Page switching did not establish the same undo boundary as the existing “Go back” action. | [PR #10472](https://github.com/tldraw/tldraw/pull/10472), merged `022e164c8709e567bd3dc790dfa5b12d096eec9a`. | Inspect page navigation and history behavior. |
| [#10414](https://github.com/tldraw/tldraw/issues/10414) | Dropped files/URLs bypassed the undo boundary used by paste and media picking. | [PR #10478](https://github.com/tldraw/tldraw/pull/10478), merged `957d81e58ffe7c985e172d58f542fe4c9fd8418a`. | Inspect drop, paste, and picker behavior as separate entry paths. |
| [#10415](https://github.com/tldraw/tldraw/issues/10415) | Alt-text save did not establish an undo boundary. | [PR #10474](https://github.com/tldraw/tldraw/pull/10474), merged `e8ceb98cf8081eaa94aeea46ba776ce5752da070`; completion paths share the boundary. | Inspect metadata edit/save identity and undo behavior. |
| [#10409](https://github.com/tldraw/tldraw/issues/10409) | Unlock-all lacked its own undo boundary. | [PR #10468](https://github.com/tldraw/tldraw/pull/10468), merged `fdf33d5db1f14a585e3f640e97468e9b0a92c69c`. | Inspect lock transitions and undo grouping. |
| [#10024](https://github.com/tldraw/tldraw/issues/10024) | A concrete `TLStore`/`HistoryManager` repro describes undo restoring a child whose parent was concurrently deleted, leaving the shape invisible and inaccessible while still serialized. | Still reported open. Earlier [PR #9581](https://github.com/tldraw/tldraw/pull/9581) was reverted by [PR #9755](https://github.com/tldraw/tldraw/pull/9755) because it dropped shapes. [PR #9790](https://github.com/tldraw/tldraw/pull/9790) concerns a different concurrent reparent race. | Individually reviewed. Varve stores ownership on container child lists, recursively deletes subtrees, and restores full-document history revisions. Its current merge path reports `edit-vs-delete`, removes the deleted subtree, and yields a valid document. No matching Varve defect reproduced; live collaboration backend is not implemented. No production change recommended. |
| [#9113](https://github.com/tldraw/tldraw/issues/9113) | Undo could replay partial editor metadata and retain a stale editing-shape ID, producing a missing target after create/edit/delete sequences. | [PR #9260](https://github.com/tldraw/tldraw/pull/9260), merged `5c6e63c83a7d0cc71dd2c4b54908e4d464904b8f`, treats that editing state as ephemeral and adds undo/redo coverage. | Inspect Varve transient editor state around deletion and history replay. |
| [#7669](https://github.com/tldraw/tldraw/issues/7669) | A deleted image asset remained in serialized data. Maintainers explain eager collection can break undo and shared/reused assets. | Closed as duplicate of #2711; no fix established from this thread. | Inspect asset reachability against documents, pages, and retained history before proposing garbage collection. |
| [#2320](https://github.com/tldraw/tldraw/issues/2320) | A JPEG was serialized at about 1.9 MiB after a wrong parameter passed to image downscaling. | [PR #2325](https://github.com/tldraw/tldraw/pull/2325), merged `0171d1498d432750a0fe2c2046565c2f4ed39c37`; manual size plan, no automated test was identified. | Measure Varve's image import/downscale/document-size workflow before deciding relevance. |

Other reviewed candidate reports include [#3465](https://github.com/tldraw/tldraw/issues/3465)
(browser storage cleared; documented storage expectation), [#4329](https://github.com/tldraw/tldraw/issues/4329)
(unreproduced Firefox loss report), [#2733](https://github.com/tldraw/tldraw/issues/2733)
(stale/ambiguous extension save report), [#6483](https://github.com/tldraw/tldraw/issues/6483)
(unreproduced large-document load crash), and [#10516](https://github.com/tldraw/tldraw/issues/10516)
(debug-menu-only ID reuse). Each requires individual assessment and a Varve
path check before disposition.

Collaboration reports [#10679](https://github.com/tldraw/tldraw/issues/10679)
and [#11116](https://github.com/tldraw/tldraw/issues/11116)–[#11118](https://github.com/tldraw/tldraw/issues/11118)
concern multiplayer sync and should be assessed in the collaboration batch,
not presumed relevant to local-only persistence. Their reports remain distinct.

## High-value Varve checks

- Commit edits, then hide or close the document within the first second; reopen and compare exact content, dirty state, recovery records, and output bytes.
- Interrupt the browser or native app while foreground save, lifecycle flush, autosave, and recovery writes overlap; verify the prior valid file remains recoverable.
- For every edit that changes persistent document records, check the intended undo boundary, redo, no-op behavior, and neighboring independent transaction.
- Delete a parent/media node, undo/redo, and validate parent/asset references, visibility, selection, serialization, and save/reopen.
- Ensure editor-only state either replays consistently or remains out of persistent history.
- Exercise overlapping media refs and undo before releasing any blobs or external asset data.

### Varve verification for #10513

The current Varve path is different from the reported tldraw throttle. Varve
already handles `beforeunload`, `pagehide`, `freeze`, and hidden visibility in
`packages/editor/src/lifecycle/LifecycleProvider.tsx`; its coordinator drains
pending edits before starting dirty-session saves. Untitled work also routes
through recovery points. The lifecycle save remains asynchronous during browser
termination, and recovery autosave waits for its idle threshold, so a forced
discard remains a plausible durability edge rather than a proven loss.

The focused checks passed: `pnpm exec vitest run
packages/editor/src/lifecycle/__tests__/coordinator.test.ts
packages/editor/src/lifecycle/__tests__/pageHideBoundary.test.ts
packages/editor/src/persistence/lifecycleFlush.test.ts
packages/editor/src/autoSaveService.test.ts packages/editor/src/recovery.test.ts
--reporter=dot` (5 files, 90 tests). These tests verify service/coordinator
logic but do not kill a real browser process, so they do not establish durable
completion under forced shutdown. No concrete Varve defect was reproduced in
this batch; do not copy the tldraw fix mechanically. A future targeted
regression should distinguish synchronous revision capture, queued writes,
completed writes, browser best-effort shutdown, and the native termination
contract.

The complete discussion crawl found no comments on #10513. Its linked PR
contains bot/deployment discussion only; the merge commit and four upstream
unit regressions are recorded above. This batch does not close the issue's
remaining source-level reproduction uncertainty.

### Varve verification for #10024

The frozen issue has no comments. Its linked PR #9581, revert #9755, and
related #9790 were read along with their linked review and inline discussion.
The failed cleanup approach could remove surviving content on undo, which is
why this audit does not carry it into Varve. Varve's normal mutation API stores
parentage in container child arrays and recursively removes descendants; undo
materializes a full historical document. Real-time remote collaboration is not
implemented yet.

A focused temporary reproduction merged a local child edit against deletion of
its parent subtree. It returned an `edit-vs-delete` conflict, omitted both
deleted nodes, and passed `validateDocument`. Permanent checks passed:
`pnpm exec vitest run packages/history/src/__tests__/merge.test.ts
packages/history/src/__tests__/resolveMerge.test.ts
packages/scene/src/document-validation.test.ts
packages/scene/src/document-nodes.test.ts` (3 files, 47 tests). No lasting
test or implementation change is justified by this report alone; a latent
invalid unreachable node may still be caught by validation, but the exercised
merge and normal mutation paths did not create one.

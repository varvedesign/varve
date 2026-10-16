# Agent control: measured cost of the command layer (2026-10-16)

What this measures: the headless command layer (`@varve/automation`) and the
packaged CLI, in Node. What it does not: the editor, the canvas, the GPU, the
Rust socket, or any browser path. Nothing here is a claim about interactive
frame time, which is the editor's own budget
([../architecture/render-pipeline.md](../architecture/render-pipeline.md)).

## Conditions

| | |
|---|---|
| Host | AMD Ryzen 3 5300U (8 threads), Linux 7.2 (CachyOS) |
| Runtime | Node 22.23.2 |
| Load at measurement | load average 24 to 26 on 8 threads; 1.6 GB free memory. Other agents were building and running suites. |
| Confidence | **Low for absolute milliseconds, good for ratios and for anything an order of magnitude apart.** Every figure below was taken on a machine that was oversubscribed three-fold, so quiet-machine figures will be lower. |

The numbers come from `packages/automation/src/__tests__/perf.test.ts` (run with
`VARVE_PERF_REPORT=<file>` to write them as JSON) and from the CLI runs described
under "Findings". Budgets in the test are several times the observed values and
exist to fail on a change of kind, not on jitter.

## Results (production build, i.e. what ships)

| Measurement | Result |
|---|---|
| Commands in the catalog | 15 |
| Listing every command (id, title, summary) | 5.3 KB |
| Describing every command with full schemas | 36 KB; the largest single description is 5.3 KB |
| A relevance-ranked search result | 5.3 KB |
| `varve.document.info`, 1,000 / 10,000 nodes | p50 0.6 ms / 2.8 ms |
| `varve.node.get` of 3 nodes, 1,000 / 10,000 nodes | p50 1.3 ms / 14.6 ms |
| `varve.node.find` by name, 1,000 / 10,000 nodes | p50 2.5 ms / 26.2 ms |
| `varve.node.list` page of 500, 1,000 / 10,000 nodes | p50 13.8 ms / 27.6 ms |
| `varve.node.create`, 1,000 / 10,000 nodes | p50 6.1 ms / 72.3 ms (p95 87.9 ms) |
| Atomic batch of 25 / 50 / 100 creates | 12.6 / 14.5 / 38.4 ms total; about 0.3 to 0.5 ms per step; one undo group |
| 100 separate creates on a small document | 52.6 ms total, 0.53 ms each |
| Receipt for a 100-step batch | 88 KB (about 880 bytes per step) |
| A page of 500 nodes / a lookup of 100 nodes | 109 KB / 22 KB |
| Refusing a 2 MB request | 31 ms, before any work |
| Canonical JSON of 5,000 / 50,000 keys | 5.3 ms / 116 ms (linear) |
| Idempotency store after 3,000 keyed commands | 1,024 entries, 0.88 MB (its bounds) |

Cost grows with the document: a create is about 12 times slower on a document ten
times larger. Per-command drift across a long session was not measured here;
only the retained state was (see finding 2 and the idempotency row).

## Findings, and what was done about them

### 1. The packaged CLI re-validated the whole document after every edit

The scene package's `devValidate` runs a full-document validation (including a
cycle search) after every operation whenever `NODE_ENV` is not `production`.
The desktop build is production; the CLI and MCP server are Node programs that
inherit whatever the user's shell has, which is usually nothing. Profiling a
create on a 3,000-node document attributed about 45 percent of CPU to
`validateDocument` and `findParentCycle`.

| | Without the fix | With the fix |
|---|---|---|
| `create` at 2,000 nodes, in-process | p50 146 ms (p95 204) | p50 9 ms |
| 50 separate commits on a 3,000-node file, CLI | 11.6 s and 15.4 s | 2.0 s and 5.2 s |
| One `exec` on a 3,000-node file, CLI | 1.3 to 1.5 s | 1.2 s |

The one-shot case barely moves because it is dominated by process start and
decoding an 800 KB document; the win is for sessions that make many edits, which
is what an agent does. The bundle now pins `process.env.NODE_ENV` to
`"production"` (`packages/cli/scripts/build-bundle.mjs`), and a test fails if the
built bundle still reads it. The executor validates every command's input and
re-decodes every document it writes, so nothing depends on the diagnostic.

### 2. Retained undo history was bounded by count, not by size

The ledger keeps up to 200 transactions for attributed rollback. Each retained
snapshot owns its own node table, so the bound was a number of transactions, not
an amount of memory. Measured with forced garbage collection:

| Nodes | Retained by history before | After |
|---|---|---|
| 1,000 | 2.4 MB | 2.4 MB |
| 5,000 | 37.7 MB | 37.6 MB |
| 10,000 | 75.2 MB | 37.2 MB |
| 30,000 | about 225 MB (extrapolated) | 48.6 MB |

The ledger now also caps retained node-table entries (1,000,000 by default). A
large document keeps fewer transactions, the most recent one is always kept, and
asking for an evicted one is answered `HISTORY_EXPIRED` rather than "unknown".

### 3. Not fixed: `create` grows with sibling count

Even in production mode a create costs 72 ms at 10,000 nodes (6 ms at 1,000).
That is acceptable for an agent making tens of edits and is not interactive-grade
for thousands. A batch amortizes it. If a workload needs more, the place to look
is the per-command diff and sibling re-indexing, not the schema layer.

## What is not measured

- Latency through a live window, the Rust socket, or the MCP SDK.
- Capture render time (needs a browser; recorded in the verification record
  when it was run).
- Memory of the editor itself with an attached client.
- A quiet machine. These should be repeated on one before any budget is
  tightened.

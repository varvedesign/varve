# Layout reflow profile — updated 2026-10-21

## Environment and identity

- Feature snapshot: `codex/layout-pr-integration` after the no-op reflow fix,
  before its solver commit. The committed ADR checkpoint was `e49317241`.
- Host: AMD Ryzen 3 5300U, 4 cores / 8 threads, Linux 7.2.9-1-cachyos
  x86_64, 22 GiB RAM. About 8 GiB was available during the run.
- Runtime: Node.js 22.23.2, Vitest 4.1.11, TypeScript layout solver.
- Corpus: `packages/layout/src/__tests__/reflow.profile.bench.test.ts`,
  SHA-256 `0a77b9df38c341510c9e557037e9c1362a96547a2e1a10cd6d7469663ba7b876`.
  The flat corpus uses fixed 80×32 shapes in a 1,200-unit wrapped flex frame
  with version-2 semantics, 8-unit gap, and 12-unit padding. The nested corpus
  has depth 4, branching factor 4, alternating row/column frames, and 1,024
  leaf shapes.
- Command: `pnpm exec vitest run packages/layout/src/__tests__/reflow.profile.bench.test.ts --maxWorkers=1 --reporter=verbose`.
  It passed (15.8 seconds of test work, 36.5 seconds including startup).

The first call materializes a new document. Twelve warm calls reflow the same
unmaterialized input to measure repeated calculation. Twelve settled calls
reflow the already materialized result; every case returned that exact document
reference. Each number is solver wall time. The first call is **not** a fresh
process cold start: V8 and module initialization had already run.

| Corpus | First call | Warm p50 / p95 | Settled p50 / p95 |
|---|---:|---:|---:|
| Flat, 100 children | 36.38 ms | 2.59 / 4.73 ms | 0.76 / 8.93 ms |
| Flat, 1,000 children | 51.41 ms | 12.36 / 30.40 ms | 5.67 / 13.26 ms |
| Flat, 10,000 children | 115.69 ms | 88.69 / 129.71 ms | 38.57 / 45.38 ms |
| Flat, 50,000 children | 415.83 ms | 369.79 / 1,366.33 ms | 303.43 / 392.71 ms |
| Nested, 1,024 leaves | 348.93 ms | 318.94 / 361.01 ms | 5.07 / 7.59 ms |

This was a **contended shared-machine sample** while the editor unit suite
and another agent's browser run were active. The 50k warm tail is especially
unsuitable as a release budget. The settled path preserves document identity
but still measures every child and rebuilds the layout result; it is not a
constant-time cache hit. The earlier unversioned legacy sample at source
`89b084f83a735b751acb40bfe9c08f9b0465184c` is not comparable to this
version-2 wrapped Fill corpus.

## Limits

The solver profile excludes browser paint, persistence, memory allocation
totals, and Tauri IPC. A separate lease-wrapped Chromium run of
`tests/e2e/canvas/layout-frame-latency.spec.ts` passed on 2026-10-21. It
authored a two-card grid at 1280×800, made eight successive track additions,
and timed from each button's click event inside the page until a new content
frame had committed **and** the grid overlay pixels changed. The in-page
samples were 266.1, 296.3, 542.8, 569.4, 493.0, 244.1, 300.8, and
642.6 ms: **p50 493.0 ms, p95 642.6 ms**. The final live content hash matched
an authoritative full redraw at the same state. This is an upper bound for
the combined frame and overlay: the harness scans overlay alpha after each
animation frame, and the run shared the machine with the broad editor suite.
It is not a release latency qualification. The native Tauri grid workflow
passed functional geometry assertions at three viewport sizes but did not
measure latency. A quiet-machine repeat, corpus expansion, and native frame
timing remain needed before making a performance claim.

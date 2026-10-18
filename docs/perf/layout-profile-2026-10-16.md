# Layout reflow profile — 2026-10-16

## Environment and identity

- Feature source revision before this profile was committed: `89b084f83a735b751acb40bfe9c08f9b0465184c`.
- Host: AMD Ryzen 3 5300U, 4 cores / 8 threads, Linux 7.2.9-1-cachyos x86_64, 22 GiB RAM (8.7 GiB available when recorded).
- Runtime: Node.js 22.23.2, V8 12.4.254.21-node.56; Vitest 4.1.11; TypeScript layout solver.
- Profile corpus source: `packages/layout/src/__tests__/reflow.profile.bench.test.ts`, SHA-256 `04956c3842e4aadb9b61cb92eece7b50810692dffe94e53854c24acf30152442`.
- The large flat corpus uses fixed 80×32 shapes in a 1,200-unit wrapped flex frame with 8-unit gap and 12-unit padding. The nested corpus has depth 4, branching factor 4, alternating row/column flex frames, and 1,024 leaf shapes.
- Each row reports the first reflow call for that in-memory corpus and 12 repeated calls (warm p50/p95). “First call” is not a fresh-process cold start: V8 and module initialization have already run. Times are solver/reflow wall time and exclude browser paint, persistence, memory allocation totals, and Tauri IPC.

## Results

| Corpus | First call | Warm p50 | Warm p95 |
|---|---:|---:|---:|
| Flat, 100 children | 17.41 ms | 1.93 ms | 7.63 ms |
| Flat, 1,000 children | 120.85 ms | 19.33 ms | 57.81 ms |
| Flat, 10,000 children | 139.58 ms | 192.73 ms | 263.18 ms |
| Flat, 50,000 children | 810.18 ms | 966.32 ms | 1,793.29 ms |
| Nested, 1,024 leaves | 900.36 ms | 837.75 ms | 1,179.47 ms |

The observational profile passed in 26.7 seconds of test time. The existing budget benchmark also passed all 5 cases on this revision: `pnpm exec vitest run packages/layout/src/__tests__/reflow.bench.test.ts --testTimeout=120000 --maxWorkers=1 --reporter=verbose` (100/1k/10k/50k cases plus the loose linearity check).

## Limits

These numbers are one shared-machine sample, not a release budget or a 4 GiB memory qualification. Variance is visible in the 1k and 50k tails. The run does not measure edit-to-correct-frame p50/p95, browser/WASM canvas paint, cold app startup, deep 10k-node nesting, allocations, peak memory, or packaged Tauri. Those remain required before claiming end-to-end performance qualification. The compact browser E2E interactions separately passed wrap, Fill, undo, guide controls, and constrained parent resize; they measured workflow correctness, not frame latency.

## Follow-up sample — 2026-10-18

- Revision: follow-up solver review changes on `codex/layout-reliability` (uncommitted at measurement time).
- Host/runtime: AMD Ryzen 3 5300U, 4 cores / 8 threads, Linux 7.2.9-1-cachyos x86_64, Node.js 22.23.2, Vitest 4.1.11.
- Corpus source is unchanged (SHA-256 `04956c3842e4aadb9b61cb92eece7b50810692dffe94e53854c24acf30152442`). The unrelated `@varve/editor` unit suite remained active on the shared host during this sample; treat these as observational measurements under concurrent load, not a clean before/after comparison.

| Corpus | First call | Warm p50 | Warm p95 |
|---|---:|---:|---:|
| Flat, 100 children | 5.28 ms | 0.86 ms | 1.04 ms |
| Flat, 1,000 children | 27.85 ms | 6.81 ms | 11.71 ms |
| Flat, 10,000 children | 73.02 ms | 78.93 ms | 116.01 ms |
| Flat, 50,000 children | 439.54 ms | 356.01 ms | 408.61 ms |
| Nested, 1,024 leaves | 321.57 ms | 255.67 ms | 904.17 ms |

`reflow.bench.test.ts` also passed all five stable budget cases on this working tree. The warm nested p95 remains variable; this sample does not replace a controlled baseline run or qualify edit-to-correct-frame latency.

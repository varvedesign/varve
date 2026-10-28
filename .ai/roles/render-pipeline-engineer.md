# render-pipeline-engineer

Frame-pipeline persona: canvas scheduling, replay, compositing backends, the render
worker, and WGSL shaders.

## Mission

Own the path from `EngineNode[]` to the screen - frame decisions, replay,
worker-bitmap transport, compositor backends, and GPU shaders - so every frame is
authoritative and every hot dispatch stays benchmarked.

## Scope

- `packages/compositor/src/` - backend router, tile cache, `canvas2d/`, `webgpu/`, `webgl2/`.
- `packages/editor/src/render/` - `renderWorker.ts`, `workerHost.ts`, `replayScene.ts`, `collectImageBitmaps.ts`, `sceneCompositing.ts`.
- `packages/editor/src/canvas/renderPipeline.ts`, `redrawCoordinator.ts`, `perfRuntime.ts`; the render branch of `packages/editor/src/CanvasArea.tsx`.
- `packages/engine/src/replay.ts`, `blur.ts`, `filterCompositor.ts`; shaders in `crates/varve-accel/src/shaders/` and `crates/varve-accel/src/render/shaders/`.
- Docs: [render-pipeline.md](../../docs/architecture/render-pipeline.md), [systems-render-and-platform.md](../../docs/agents/systems-render-and-platform.md), [canvas2d-system.md](../../docs/architecture/canvas2d-system.md), [architecture-invariants.md](../../docs/agents/architecture-invariants.md), [file-size-policy.md](../../docs/quality/file-size-policy.md).

## Invariants that caused regressions

1. Never show pixels no fresh frame will replace. Dirty-rect redraw, the camera-only
   worker-bitmap path, and `paintedSurfaceRef` are loans against an authoritative
   frame; when no fresh frame is coming, fall back to
   `compositorRef.current.drawVectorItems(ir)`. Worker refusal is decided
   synchronously (`admitWorkerImagePayload`), never in a late `.then()`.
2. Every engine node carries a valid `shape`; one malformed node rejects the whole
   `buildIr` batch, so keep `withStubFallback` and test node shape.
3. Image fills reach the worker only through structured-clone transport:
   `collectImageBitmaps` pre-decodes, `sceneCanUseWorkerRenderer` gates.
4. Thresholds compared with `clientX/Y` stay CSS pixels; overlays use
   `screenToWorld`/`worldToScreen`, never rotation-blind `simple*` transforms.
5. The clean version is not always the fast version: benchmark structural changes to
   `replaySubtreeToCtx`, `replayIr`, or a per-node dispatch at 100 / 1k / 10k / 50k
   nodes before merge; the monomorphic `switch` is load-bearing.
6. Hub ceilings: no new import in `CanvasArea.tsx`/`Shell.tsx` without removing one of
   equal weight; new hubs target instability I < 0.85.

## Forbidden

- Async worker refusal, keeping a stale surface when no fresh frame was admitted, or partial redraw as the general answer to a slow canvas.
- Scaling CSS-pixel thresholds by zoom; `simpleScreenToWorld` in overlays.
- Replacing a hot dispatch with a table/visitor for readability without a benchmark, or shipping a frame-time regression for a cleaner diff.
- Growing `renderPipeline.ts` past the file-size budget; editing `.file-size-baseline.json` to silence growth; new hub imports.
- Hardcoded color/space/type values, `any`, emoji, or raw `invoke` in render code.
- Changing worker eligibility, IR payloads, or shared render types without the rust-ipc role and its checks.

## Required checks

```bash
pnpm check:agent
pnpm test:agent packages/editor/src/render/<spec>.test.ts   # no "--"
pnpm audit:filesize
pnpm verify:affected                 # render/state pipeline change
pnpm bench                           # dispatch/IR shape change only
node scripts/quality/heavy-lease.mjs "e2e: <what>" -- \
  npx playwright test tests/e2e/canvas/<spec>.spec.ts --project=chromium \
  --workers=1 --reporter=list
```

Pixel-reuse changes also need the oracle: hash the surface after the interaction, call
`window.__varvePerf.forceFullRedraw()` at the same camera, hash again; equal hashes
only. Registry checks (`check:agent`, `test:agent`, `audit:filesize`) are declared in
[.ai/constitution.json](../constitution.json).

## Definition of done

- The changed frame path is authoritative: oracle hashes match; no stale surface outlives its state; dispatch/IR changes report before/after benchmarks.
- Focused unit specs pass; browser-facing changes have a heavy-lease Playwright run;
  no snapshot, retry, skip, or timeout guess was used to pass.
- `audit:filesize` and `check:agent` pass (live or clean-tree receipt); 3-File / 1-Seam respected; report files, commands, and benchmark numbers.

## Escalation

- Stop and ask the Lead when a fix needs more than three files plus one seam, changes
  worker eligibility or the Rust IR contract, or regresses a benchmark.
- `waiting for ...` and `deadline reached` are queue conditions: read
  [local-validation-queue.md](../../docs/quality/local-validation-queue.md), wait for the holder;
  a full gate needs `VARVE_FULL_GATE_REASON`, never CI or release evidence from a local run.

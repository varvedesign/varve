# AGENTS.md — Varve

Varve is a local-first, cross-platform design suite: a native Rust engine on
desktop (Tauri 2) and WASM behind the same facade on web. Linux (CachyOS/Arch)
is the primary dev OS. This file is the always-loaded index and stays small;
detail lives in `docs/agents/` and is loaded on demand (pointer table at the end).

## Directory map (exact)

- Rust IPC: `apps/desktop/src-tauri/src/*.rs` — `#[tauri::command]` fns by
  domain, registered in `lib.rs` (`generate_handler!`); TS `invoke` call sites
  live in `packages/platform/` and feature packages.
- React shell/state/hubs: `packages/editor/src/` — `Shell.tsx`, `CanvasArea.tsx`,
  `Menubar.tsx`, `context.tsx` (`EditorProvider`); sub-contexts and
  `EditorState` types in `context/`, hooks in `hooks/`, commands in `actions/` +
  `shortcuts/`, canvas/tools in `canvas/` + `tools/` + `hitTest/`.
- Compositor/GPU: `packages/compositor/src/` (`canvas2d/`, `webgpu/`, `webgl2/`);
  WGSL shaders in `crates/varve-accel/src/shaders/` + `render/shaders/`.
- Render worker: `packages/editor/src/render/` (`renderWorker.ts`, `workerHost.ts`).
- Engine IR: `packages/engine/src/types.ts` (`RenderItem`), `engine.ts` facade;
  Rust producer `crates/varve-engine/src/lib.rs` (`build_render_ir`).
- Crates: core, engine, bridge (scene/IR seam); sync (SQLite); trace; print;
  upscale; bgremove; media; effects; colour; accel (GPU); wasm; room (collab
  host); layout (unwired); generative-helper.
- Packages: engine, scene, shared, layout (document model + pure layout);
  editor (UI/state); ui (tokens/components); compositor; platform; import;
  print; codegen; prototype; collab; crash; help; home; tokens; history; cli; ai.
- Apps: `desktop` (Tauri 2 + Vite/React); `website` (Astro static site); `web`
  (scaffold, removed from the workspace — not shippable).
- Docs: `architecture/` current contracts; `quality/` validation policy +
  evidence; `agents/` agent playbooks; `adr/` decisions; `release/`, `security/`,
  `development/` operations; `plans/`, `audits/`, `research/`, `historical/`
  dated records. Full index: `docs/README.md`.

## Quiet verification — default inner loop

Run from the repo root; failures-only output.

```bash
. "$HOME/.cargo/env"
pnpm check:agent        # queued recursive tsc --noEmit --pretty false
pnpm check:rust         # queued cargo check, --quiet --message-format=short
pnpm test:agent packages/editor/src/foo.test.ts      # queued vitest, dot reporter (no "--": pnpm keeps it and vitest drops the filter)
pnpm verify:agent       # check:agent + agent-surface + agent-map + constitution + visual-baselines + file-size + IPC audits
pnpm queue:status       # machine-wide admission holders/waiters
pnpm worktree:status    # all worktrees: dirty/merged/stale + queue holder
pnpm audit:docs         # docs naming/link/ADR-index drift
pnpm audit:emoji        # zero-emoji gate
```

Gate scripts self-queue machine-wide and reuse a passed receipt on a clean
tree; receipts are local cache, never CI evidence. See
`docs/quality/local-validation-queue.md`. `CI`,
`VARVE_VALIDATION_QUEUE=0`, and `VARVE_HEAVY_TASK_PARALLELISM=0` bypass.

Parallel work: one task per worktree (never two writers in one worktree), `pnpm
worktree:status` before starting, single-writer generated surfaces, and merge
after `pnpm verify:plan` + `pnpm verify:affected`. Full contract:
`docs/quality/concurrent-agents.md`; reclaim merged worktrees with
`pnpm worktree:prune` then `--apply`.

Never run by default: `pnpm build`, full `cargo build`, `cargo test --workspace`,
`pnpm test`, full Playwright, `just gate`. Escalate by impact: `pnpm verify:plan`
then `pnpm verify:affected` — affected-first validation (Tiers 0-4). `pnpm check:rust:workspace` only when
the Tauri-crate check is insufficient. A full gate needs a stated reason:
`VARVE_FULL_GATE_REASON=... pnpm verify:full`. Playwright runs are heavy-lease
wrapped:
`node scripts/quality/heavy-lease.mjs "e2e: <what>" -- npx playwright test <spec> --project=chromium --workers=1 --reporter=list`.

## Hard architectural rules

- No circular `workspace:*` dependencies.
- Hub files: no new import in `CanvasArea.tsx`/`Shell.tsx` without removing one of
  equal weight; new hubs target instability I < 0.85.
- 400-line source budget: over-cap files are frozen at baseline (shrink-only) via
  `pnpm audit:filesize` + `.file-size-baseline.json`; split at 350-400 lines.
  Policy: `docs/quality/file-size-policy.md`.
- Complexity ceilings: component 200, function 50, tool handler 30, test body 15;
  extract at 70%. Over-ceiling files need a first-line `// COMPLEXITY:` comment.
- Hooks: same order every render; sub-contexts report via `onReady`; extracted
  hooks go in `context/useX.ts` before the `value` memo.
- Never show pixels no fresh frame will replace; worker refusals must be
  synchronous. Screen-space thresholds stay in CSS pixels; overlays use
  `screenToWorld`/`worldToScreen`. Benchmark per-node render/replay dispatch
  changes before merge.
- IPC seam: every `invoke` names a real `#[tauri::command]` (`pnpm audit:ipc`);
  Rust<->TS payloads and LLM-tool seams use one strict shared schema. Rules and
  the tauri-specta plan: `docs/architecture/ipc-type-contract.md`.
- Trust boundaries: no private credential classes in client builds; no app-to-app
  imports; secrets never enter client artifacts.
- No emoji; no hardcoded color/space/type values; TS strict, no `any`; Rust
  `unsafe_code = deny`; cross-platform (works on Linux); no native `<select>`;
  no raw `varve-btn`; no AI-tool attribution in commits.

## Agent task discipline

- **3-File / 1-Seam**: one task touches at most three files plus one cross-cutting
  seam; split bigger work into separate tasks.
- Name exact paths in the first prompt (`@path/to/file.ts:120-180`), not
  directories. Read files in line ranges, never a whole file over 500 lines.
- Never read lockfiles, build output (`target/`, `dist/`,
  `apps/desktop/dist-try/`, `apps/desktop/public/wasm/`), generated bundles,
  `node_modules/`, `vendor/`, or stale `.worktrees/` checkouts.
- Root `.ignore`/`.dshignore`/`.opencodeignore` exclude those trees from search;
  ripgrep honors `.ignore`, but this DSH build's `glob` tool does not apply
  ignore files — do not glob them either.
- Fresh session after each completed task; keep sessions under ~120K tokens.
  Run checks silently, report only failures.
- Do not modify: `vendor/**`, the generated data tables listed in
  `docs/quality/file-size-policy.md`, lockfiles, `docs` screenshots/artifacts,
  `.worktrees/**`, or another session's uncommitted files. Repository map:
  `docs/agents/repo-map.generated.md`; reusable playbooks: `.ai/skills/README.md`.
- Never revert others' uncommitted work; never commit unless asked. Keep
  `docs/README.md` in sync when a doc is added or removed (`pnpm audit:docs`
  enforces the ADR index and internal links).

## Read next (progressive disclosure)

| File | Load it for |
|------|-------------|
| `docs/agents/validation-and-workflow.md` | validation economy, regression protocol, all commands, CI, Playwright lease, recovery |
| `docs/agents/architecture-invariants.md` | architecture constraints, hard rules, trust boundaries, lifecycle, ADRs |
| `docs/agents/systems-render-and-platform.md` | WebGPU/WASM, canvas, crate/package map, trace, text, thumbnails, icons, signing |
| `docs/agents/systems-editing-and-ui.md` | motion, workspaces, disclosure, toolbar, popover, slider, masking, comic, presentation, collab |
| `docs/agents/agent-context-economy.md` | the five context defects, session hygiene, file-size/ignore/IPC policy |
| `docs/agents/repo-map.generated.md` | compact structure-only map (packages, crates, baseline, entry points) |
| `.ai/skills/README.md` | reusable task playbooks (add IPC command, split file, run validation, review a11y, canvas bug, concurrent worktrees, design visuals) |
| `.ai/roles/README.md` | task personas for render-pipeline, Rust IPC, and editor-UI work |
| `.ai/constitution.json` | machine-validated rule registry: every hard rule maps to real enforcement |
| `docs/quality/concurrent-agents.md` | worktree isolation, single-writer surfaces, staged validators, merge protocol, prune tooling |
| `docs/quality/visual-validation.md` | visual baseline policy: design change vs regression, budgets, `visual:update`, audit, concurrency |
| `docs/agents/session-history.md` | dated per-session development records |
| `docs/README.md` | complete documentation index |
| `docs/quality/local-validation-queue.md` | machine-wide validation admission, queued gates, receipt reuse |
| `docs/quality/file-size-policy.md` | 400-line budget, baseline lifecycle, split guidance |
| `docs/architecture/ipc-type-contract.md` | IPC seam inventory, payload rules, tauri-specta plan |
| `docs/quality/agent-context-remediation-2026-10-28.md` | five-defect status matrix and god-file split backlog |

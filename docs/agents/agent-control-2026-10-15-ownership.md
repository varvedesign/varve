# Agent control commands, CLI, JSON control and MCP — Ownership (2026-10-15)

## Scope

- `packages/automation/**` (new package, layer 4): schema, catalog, executor,
  receipts, idempotency, headless authority, revert, command families.
- `packages/scene/src/nodeResize.ts` and its test, plus the one-line export in
  `packages/scene/src/index.ts`.
- `packages/editor/src/context/sceneNodeGeometry.ts`: `resizeSceneNode` becomes
  a re-export of the `@varve/scene` function (no behavior change).
- `scripts/audit-architecture.mjs` and `scripts/security/import-boundaries.mjs`:
  register `@varve/automation` (one entry each).
- `pnpm-lock.yaml`: the `packages/automation` importer.
- Planned, not yet started: `packages/cli/**` (exec/describe/batch, MCP and
  control adapters), `apps/desktop/src-tauri/src/automation.rs`, an editor
  automation bridge and Settings surface, parity manifest and CI check.
- Docs: `docs/architecture/agent-control-system.md`,
  `docs/adr/0245-agent-control-command-service.md`,
  `docs/research/agent-control-research-2026-10-15.md`, this record.

## Owner

Single agent session, branch `feat/agent-control`, worktree
`.worktrees/agent-control`.

## Not touched (other agents' work in the main checkout)

At the start of this work the main checkout held uncommitted edits from other
sessions: rich-text layout (`packages/engine/src/richText*`,
`textLayoutSnapshot*`, `verticalTextReplay.ts`), tablet back dismiss, the
presentation schema migration (`packages/scene/src/presentation/*`), collab
sync (`packages/collab/src/syncEngine*`, `webSocketTransport.ts`), and
`crates/varve-room/`. None of these are modified, reverted, staged or
formatted by this work.

## Shared contracts consumed

- `@varve/scene` operations registry and document functions: read-only except
  the `resizeSceneNode` addition.
- `context.tsx` (76/76 imports), `Shell.tsx`, `CanvasArea.tsx`: no imports are
  added. The editor bridge will mount from a leaf and be registered through an
  existing adapter point.

## Coordination notes

- `packages/scene` typecheck currently fails in other agents' presentation
  migration tests (`schemaVersion` 1 vs 2); unrelated to this work.
- Integration route: merge sequentially toward master after the owner of the
  presentation migration lands, then re-run the affected plan on the
  integrated SHA. No push is performed from this session.

## Integration record (2026-10-16)

- **Two writers shared this worktree.** A second writer (not visible as a
  session) committed review fixes and the Rust stdio harness while this session
  committed the editor, settings, capture/save, CLI and test work. Commits were
  made with explicit path lists; the second writer committed through an isolated
  index (`GIT_INDEX_FILE`), which the repository now guards against
  (`scripts/quality/guard-index-not-stale.mjs`).
- **Commit `3d4278cef` carries the wrong message.** Its subject says "docs" and it
  is a docs commit, but a broad stage by the other writer swept this session's
  staged editor files into it: `packages/editor/src/automation/{controller,
  editorBindings,liveEditor}.ts`, the updated `livePort.ts` and its tests,
  `liveEditorIntegration.test.tsx`, the `readAutomationState()` accessor in
  `context.tsx`, and the `registerAll.ts` publish call. History was not rewritten,
  because another writer was active and rewriting shared history is out of
  bounds. The content is correct; only the message is incomplete.
- **Master was merged into the branch** (`b82095c35`) to pick up the collaboration
  work and the `bundle-assets` module; the only conflict was the docs index, where
  both rows were kept. Nothing was pushed.
- **Not touched:** `packages/automation/README.md` is the other writer's
  untracked file and was never staged by this session.

# Role playbooks

**Status:** on-demand task personas, introduced 2026-10-28. A role orients one
task; canonical policy stays in the repository docs and is never restated here.

Roles are the third layer of the loading model: [AGENTS.md](../../AGENTS.md) is
always loaded, canonical docs load when a task needs detail, and exactly one
role loads for the kind of work being done. The machine registry behind this
index, with applies_to paths and required checks, is
[.ai/constitution.json](../constitution.json). Procedures remain skills:
[.ai/skills](../skills/README.md). Task hygiene (3-File / 1-Seam, no lockfiles or
build output) comes from [agent-context-economy.md](../../docs/agents/agent-context-economy.md);
file budgets from [file-size-policy.md](../../docs/quality/file-size-policy.md).

## Loading model

1. Read [AGENTS.md](../../AGENTS.md) first; it is the always-loaded index.
2. Pick one role below by task shape and read the whole file (each is <=80 lines).
3. Load only the canonical docs a role links. If a role and a doc disagree,
   the doc wins; fix the role in the same change that changes the policy.
4. Add at most one skill when the task also has a nameable procedure shape.

## Index

| Role | Use when | Scope | Required checks |
|------|----------|-------|-----------------|
| [render-pipeline-engineer.md](./render-pipeline-engineer.md) | canvas frames, replay, compositor, render worker, shaders, render performance | `packages/compositor`, `packages/editor/src/render`, `packages/editor/src/canvas`, `crates/varve-accel` | `check:agent`, `test:agent`, `audit:filesize` |
| [rust-ipc-engineer.md](./rust-ipc-engineer.md) | Tauri commands, IPC payloads, varve-bridge serde, native engine work | `apps/desktop/src-tauri`, `crates/varve-bridge`, `crates/varve-engine`, TS adapters | `check:rust`, `audit:ipc`, `check:agent` |
| [editor-ui-engineer.md](./editor-ui-engineer.md) | editor UI/state/hubs, inspector, toolbar, popover, slider, design system | `packages/editor/src`, `packages/ui/src`, `packages/home/src` | `check:agent`, `test:agent`, `audit:tokens` |

## Choosing a role

- Route by the owning seam, not the visible symptom: a stale canvas frame is
  render-pipeline, a rejected `invoke` is rust-ipc, a token or focus bug in a
  popover is editor-ui.
- A task spanning two roles is split by 3-File / 1-Seam instead of loading both:
  name the seam, finish the Rust or render half first, then the UI half.
- Work outside these three areas uses the [skills](../skills/README.md) and
  `docs/agents/` playbooks directly.

## Checks

Run the link and ASCII checks from [.ai/README.md](../README.md) with paths under
`.ai/roles`, then:

```bash
wc -l .ai/roles/*.md
pnpm audit:constitution                             # role files and checks resolve
LC_ALL=C grep -nP '[^\x00-\x7F]' .ai/roles/*.md   # clean run prints nothing
```

## Conventions

- ASCII only, no emoji, one H1, 80 lines maximum; filenames are kebab-case
  `*-engineer.md` and match each `file` field in
  [.ai/constitution.json](../constitution.json).
- Link canonical docs or sibling skills only; name source paths in backticks and
  do not link them, so a split or rename cannot silently break a role.
- Sections, in order: Mission / Scope / Invariants that caused regressions /
  Forbidden / Required checks / Definition of done / Escalation.
- A role change updates this index and passes the checks above; broken links,
  non-ASCII, or an over-cap file is a failure.

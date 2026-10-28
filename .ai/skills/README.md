# Skill index

Short playbooks for recurring Varve task shapes. Read exactly one skill for the
task at hand, then follow the canonical docs it links. Convention, rules, and
checks: [.ai/README.md](../README.md).

## Index

| Skill | Use when | Canonical source of truth |
|-------|----------|---------------------------|
| [add-ipc-command.md](./add-ipc-command.md) | adding or renaming a `#[tauri::command]` or its TS `invoke`, or closing a known native gap | [ipc-type-contract.md](../../docs/architecture/ipc-type-contract.md) |
| [split-god-file.md](./split-god-file.md) | a file is over 400 lines, frozen in `.file-size-baseline.json`, or queued in the split backlog | [file-size-policy.md](../../docs/quality/file-size-policy.md) |
| [run-shared-validation.md](./run-shared-validation.md) | choosing or running gates, reading queue waits and receipts, escalating heavy or browser work | [local-validation-queue.md](../../docs/quality/local-validation-queue.md) |
| [review-accessibility.md](./review-accessibility.md) | reviewing a UI change for contrast, keyboard/APG semantics, forced-colors, or axe | [accessibility-validation-matrix.md](../../docs/quality/accessibility-validation-matrix.md) |
| [canvas-interaction-bug.md](./canvas-interaction-bug.md) | canvas, pointer, drag, hover, or "does not render/respond" reports | [validation-and-workflow.md](../../docs/agents/validation-and-workflow.md) |
| [concurrent-worktree.md](./concurrent-worktree.md) | concurrent tasks: one worktree per task, generated-surface ownership, staged-only checks, sequential merge and prune | [concurrent-agents.md](../../docs/quality/concurrent-agents.md) |
| [design-visual-change.md](./design-visual-change.md) | intended design changes vs regressions: scoped visual:update, diff review, determinism, single-writer baselines | [visual-validation.md](../../docs/quality/visual-validation.md) |

## How to use

1. Route by trigger: "Use `.ai/skills/<name>.md`; files: `@...`; seam: `...`;
   stop line: `...`."
2. Read the whole skill (each is <=80 lines) plus only the docs it links.
3. Follow its "Do not" list and the hard rules in [AGENTS.md](../../AGENTS.md);
   finish with verification, then report to the Lead.

## Conventions

- One recurring task shape per skill, kebab-case `.md`, ASCII only, no emoji.
- Sections, in order: When to use / Required context / Steps / Exact commands /
  Definition of done / Do not.
- Link canonical docs or sibling skills only; never duplicate policy text here.
- A skill change updates this table and the checks in
  [.ai/README.md](../README.md); broken links or a skill over 80 lines is a
  failure.

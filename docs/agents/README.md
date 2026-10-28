# AI-Assisted Development

Varve is built by a solo developer who uses AI coding assistants as a
force multiplier. This directory documents what tooling is used, how
agent instructions are structured, and which files are for humans vs
automation.

## Quick reference

| File | Audience | Purpose |
|------|----------|---------|
| `AGENTS.md` (root) | AI agents | Always-loaded index: directory map, quiet commands, hard rules, pointers (<=150 lines) |
| `docs/agents/validation-and-workflow.md` | AI agents | Validation economy, regression protocol, full command reference, CI, Playwright lease, recovery |
| `docs/quality/concurrent-agents.md` | AI agents | Concurrent-agent operating model: worktree isolation, single-writer surfaces, staged validators, merge protocol, prune tooling |
| `docs/quality/visual-validation.md` | AI agents | Visual baseline policy: design change vs regression, tolerances, scoped `visual:update`, baseline audit |
| `docs/agents/architecture-invariants.md` | AI agents | Architecture constraints, hard rules, trust boundaries, lifecycle, ADRs, session-history pointer |
| `docs/agents/systems-render-and-platform.md` | AI agents | WebGPU/WASM, canvas, crate/package map, image trace, text, thumbnails, icons, release signing |
| `docs/agents/systems-editing-and-ui.md` | AI agents | Motion, workspaces, disclosure, toolbar, popover, slider, masking, comic lettering, presentation, collaboration |
| `docs/agents/agent-context-economy.md` | Humans + AI agents | The five repository-context defects, their fixes, MCP/compact-map evaluation, and 3-File / 1-Seam task hygiene |
| `docs/agents/repo-map.generated.md` | AI agents | Generated structure-only workspace map (packages, crates, frozen baseline, entry points); checked by `pnpm audit:agent-map` and pre-commit |
| `../.ai/skills/README.md` | AI agents | Reusable task playbooks: add IPC command, split a god file, run shared validation, review accessibility, debug canvas interaction |
| `../.ai/constitution.json` | AI agents + humans | Machine-validated constitution: hard rules tied to real enforcement (not auto-loaded; AGENTS.md stays the prompt) |
| `../.ai/roles/README.md` | AI agents | On-demand task personas (render pipeline, Rust IPC, editor UI) with scope, invariants and required checks |
| `docs/agents/session-history.md` | Humans + agents | Historical record of development sessions |
| `docs/plans/archived/redesign-strategy.md` | AI agents + humans | UI redesign strategy (moved from `.opencode/plans/`) |
| `.opencode/config.json` | opencode tool | Project configuration for the opencode CLI agent |
| `.windsurf/plans/` | Windsurf IDE | Implementation plans for specific features |
| `.devin/workflows/` | Devin agent | Workflow definitions |

## Why AI tooling is tracked

AI agent configurations and plans are tracked in Git because they form part
of the project's development methodology. A solo maintainer uses
these tools to maintain velocity across a large Rust+TypeScript monorepo.

## Which files are for humans

The root `README.md`, `CONTRIBUTING.md`, and all docs under `docs/` except
`docs/agents/` are written for human contributors. The `AGENTS.md` file at
the repository root is primarily for AI agents but may contain useful
information for human developers too.

## Keeping it manageable

Agent instructions are kept concise by:
- Keeping the root `AGENTS.md` to a small always-loaded index (<=150 lines / <=9 KB)
- Loading detail from the focused files in `docs/agents/` only when a task needs it
- Moving session logs to `docs/agents/session-history.md`
- Keeping durable architecture knowledge in `docs/adr/` and `docs/architecture/`
- A generated compact repository map (`docs/agents/repo-map.generated.md`) so
  sessions start from an index instead of exploratory tree scans; it is
  drift-checked, never hand-edited
- Reusable task playbooks in `.ai/skills/` so prompts stay one sentence plus
  exact paths instead of repeating instructions
- Ignoring generated/temporary agent state via `.gitignore` plus the strict
  `.ignore`, `.dshignore`, and `.opencodeignore` search filters
- Holding source files to a 400-line budget (`docs/quality/file-size-policy.md`)
  and enforcing the Rust<->TS IPC seam (`docs/architecture/ipc-type-contract.md`)

## Tools used

- **opencode** — CLI-based agent for structured repository operations
- **Windsurf** — IDE with integrated AI agent capabilities
- **Claude Code** (`.claude/`) — Local configuration, not tracked in Git
- **Devin** — Cloud-based autonomous engineering agent

No contributor is required to use any specific AI tool.

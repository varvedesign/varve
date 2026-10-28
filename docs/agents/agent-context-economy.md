# Agent Context Economy

Why this repository is shaped this way for AI sessions, and the rules that keep
it that way. A repository's context footprint is a recurring cost on every turn,
not a one-time setup detail: large files, unfiltered search results, verbose
compiler/test output, drifting type seams, and a thousand-line instruction file
are all re-read and re-paid for every session. These are the five defects this
repository set out to fix, the enforceable guard for each, and the task hygiene
that keeps the fixes from eroding.

## What the budget pays for

Every token in a session is re-spent: instructions, file reads, tool output, and
search results all occupy the window on every subsequent turn. A session that
opens six god files or greps a build tree is not slower by a constant - it loses
room for the actual task and starts repeating reads. The fixes below are cheap
to keep and expensive to lose, which is why several are machine-enforced.

## The five defects and their fixes

| Defect | Concrete fix |
|--------|--------------|
| 1. God files | Source files are capped at 400 lines. Existing over-cap files are frozen at their current size in `.file-size-baseline.json` (shrink-only) and enforced by `pnpm audit:filesize` (`scripts/quality/audit-file-size.mjs`). Split at 350-400 lines along a real seam; never extend an over-cap file. Policy: `docs/quality/file-size-policy.md`. |
| 2. Unfiltered build artifacts and lockfiles | Root `.ignore`, `.dshignore`, `.opencodeignore` exclude `node_modules/`, `**/target/`, `dist/`-family output, `apps/desktop/public/wasm/`, generated bundles, `vendor/`, lockfiles (`pnpm-lock.yaml`, `Cargo.lock`, `package-lock.json`, `*.lock`), `*.wasm`/`*.onnx`/archives, and screenshots from search. ripgrep-based search honors `.ignore`; this DSH build's `glob` tool does not apply ignore files, so do not glob those trees either. |
| 3. Missing tight AGENTS.md | Root `AGENTS.md` is a <=150-line / <=9 KB index: directory map, quiet commands, hard rules, and pointers. Detail lives in `docs/agents/*.md` and is loaded only when needed (progressive disclosure). The harness truncates workspace instructions past its byte budget, so an oversized file is silently cut - never let it grow back. |
| 4. Verbose compiler/test output | Quiet agent commands are the default inner loop: `pnpm check:agent` (tsc, `--pretty false`), `pnpm check:rust` (cargo `--quiet --message-format=short`), `pnpm test:agent <spec>` (vitest dot reporter; do not add `--`, pnpm forwards it and vitest drops the filter), `pnpm verify:agent` (check plus `agent-surface`, `audit:filesize`, and `audit:ipc`). Gate scripts self-queue machine-wide and reuse a passed clean-tree receipt (see `docs/quality/local-validation-queue.md`). Never run `pnpm build`, a full `cargo build`, `cargo test --workspace`, full vitest, or full Playwright by default; `pnpm check:rust:workspace` is an escalation, not the inner loop. Run checks silently and report only failures. |
| 5. Weak Rust<->TS and tool type boundaries | Every TypeScript `invoke` must name a real Rust `#[tauri::command]`; `pnpm audit:ipc` (`scripts/quality/audit-ipc-contract.mjs`) enforces name parity. Payloads crossing the Rust<->TS seam (and LLM-tool seams) use one strict shared schema: no local re-declarations, no `any`, and no snake_case/camelCase drift on the wire. Seam inventory and the staged tauri-specta adoption plan: `docs/architecture/ipc-type-contract.md`. |

Defect status matrix and the ranked god-file split backlog:
`docs/quality/agent-context-remediation-2026-10-28.md`.

## Task hygiene — the 3-File / 1-Seam rule

One task touches at most **three files** plus at most **one cross-cutting seam**
(a type contract, a shared schema, or an IPC name). Bigger work is split into
separate tasks; a task that needs a fourth file usually needs a different seam.

Bad prompt: "Fix the canvas rendering issues and improve performance." It forces
the agent to read half the editor and lets it invent its own scope.

Good prompt: "Fix stale frames after zoom in `@packages/editor/src/canvas/CanvasArea.tsx`
(render branch only) and add `@tests/e2e/canvas/pan.spec.ts`. Seam: the camera
payload in `@packages/editor/src/render/workerCamera.ts`. Do not touch other
files." It names exact files, the seam, and the stop line.

More rules:

- Name exact paths in the first prompt (`@path/to/file.ts:120-180`), never a
  directory or "the canvas files".
- Read files in line ranges. Never read a whole file over 500 lines in one call;
  read the relevant 100-line window and grep for the rest.
- Never read lockfiles, build output (`target/`, `dist/`,
  `apps/desktop/dist-try/`, `apps/desktop/public/wasm/`), generated bundles,
  `node_modules/`, or `vendor/` trees.
- Start a fresh session after each completed task; keep a session under
  ~120K tokens. Context spent re-reading the repo is context not spent on the task.
- Run checks silently (`--quiet`, `--pretty false`, `--reporter=dot`) and
  report only failures.

## Compact repository representation: MCP evaluation

External code-graph MCP servers (for example project-graph-mcp) advertise a
compact or minified representation of a repository and roughly 40% fewer tokens
when an agent reads code. The maintainer evaluated them and **did not adopt one
as a default dependency**:

- an MCP server is a supply-chain and runtime dependency that parses the whole
  repository, and its output is not reviewable evidence or drift-checked;
- harness support and trust policy vary per agent, so an instruction that says
  "use this MCP server" is not portable to every session;
- the same benefit is available natively: [repo-map.generated.md](repo-map.generated.md)
  is generated from the committed tree and is **structure-only** (top-level
  layout, workspace packages, crates, the frozen file-size baseline, agent entry
  points). Ordinary edits do not change it; file additions/removals and baseline
  splits do. `pnpm audit:agent-map` fails on drift in CI and pre-commit
  (`--staged`), so it cannot silently rot. Regenerate with `pnpm agent:map`
  and stage the result; the map is generated, never hand-edited.

If an MCP server is adopted later, it must be version-pinned, sandboxed, and its
output required to agree with the generated map; it never replaces exact
file/line reads for edits, and it must not become the only way to understand the
repository.

## Editor/agent performance

The committed `.vscode/settings.json` turns off nested-repository/submodule
detection (`git.detectSubmodules: false`), disables symlink-following search,
and excludes the machine-cost trees from file watching: `.worktrees/**` (25 GB
of nested checkouts here), `node_modules`, `apps/desktop/src-tauri/target`,
Playwright artifacts, and `docs/screenshots`. This is an editor-cost fix, not a
substitute for `.ignore`: agent search tools still need the ignore files.
Hutch's `.vscode/` is intentionally untracked, so set `git.detectSubmodules:
false` locally there when nested worktrees exist.

## Constitution and role files: viability

The maintainer asked for a `constitution.json` and/or role files that fix code
style and architecture constraints so the same mistakes are not re-learned.
Viability review:

- **No harness auto-loads `constitution.json`.** OpenCode/Claude/Cursor-style
  agents load `AGENTS.md` project rules (see the OpenCode rules documentation);
  a standalone constitution file is only read if an instruction points at it.
  External tooling that compiles a "constitution" into agent instructions
  exists (for example the agent-constitution project), but it is another
  dependency and it still emits AGENTS-style files. `AGENTS.md` therefore
  remains the always-loaded system prompt.
- **A decorative JSON file would violate the no-decorative-config rule.** The
  viable form is a machine-validated registry: [.ai/constitution.json](../../.ai/constitution.json)
  maps every hard rule to real enforcement (package script, checked-in script,
  existing tests, or a manual checklist plus a reviewed doc).
  `pnpm audit:constitution` (inside `pnpm verify:agent`) fails when a rule
  loses its enforcement, a role references missing files, or a manual rule
  loses its checklist/review doc.
- **Role files are on-demand personas**, not extra system prompts:
  [.ai/roles/README.md](../../.ai/roles/README.md) selects one role for render
  pipeline, Rust IPC, or editor UI work; each role carries scope, the
  invariants that caused past regressions, forbidden patterns, required checks
  and a done definition. Load order stays: AGENTS.md -> canonical doc -> one
  role -> at most one skill.

References: https://open-code.ai/en/docs/rules (AGENTS.md project rules) and
https://github.com/Luolc/agent-constitution (external constitution compiler,
evaluated, not adopted as a dependency).
## Read next

- [validation-and-workflow.md](validation-and-workflow.md) - the full validation policy these commands implement.
- [architecture-invariants.md](architecture-invariants.md) - the hard rules a task must not break.
- [repo-map.generated.md](repo-map.generated.md) - compact generated workspace map; start here instead of exploratory tree scans.
- [`.ai/skills/README.md`](../../.ai/skills/README.md) - reusable playbooks for recurring tasks.
- [`.ai/roles/README.md`](../../.ai/roles/README.md) - on-demand task personas and their invariants.
- [`.ai/constitution.json`](../../.ai/constitution.json) - machine-validated rule registry (what is actually gated).
- [README.md](README.md) - index of agent documentation.
- [AGENTS.md](../../AGENTS.md) - the always-loaded root index.

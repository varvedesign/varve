# Varve baseline and execution environment

Recorded for the Penpot evidence program on 2026-10-19 local time.

## Source and ownership

- Repository: `varvedesign/varve`.
- Fresh worktree branch: `codex/penpot-corpus`.
- Starting remote `master` SHA: `5172718c6f0f2597466cd08d0839b53ccafefbd2`.
- The pre-existing checkout at `/home/kevina/CodingProjects/varve` remains untouched by this worktree. It had unrelated dirty changes and was 217 commits ahead / 87 behind its cached remote before refreshing `origin/master`.
- Active branch rules protect `master` and release tags; deletion and non-fast-forward updates are disabled. Use reviewed PRs for integration.
- Open-PR searches for `variant`, `component`, and `document validation` found only dependency and marketing work; no overlapping repair was identified before implementation.
- Website push-to-master workflows can deploy the site/browser demo. This batch changes research tooling and audit records only; no website impact is expected. Application releases remain outside this authorization.

## Instructions and baseline validation

Applicable instructions: repository `AGENTS.md` (impact-based validation, dependency-aware affected checks, no default full suite, evidence report, architecture and rendering constraints); user-provided Penpot implementation plan; `feature-dev` for the engineering workflow; and `review-agent` for a separate read-only review before integration.

The original dirty checkout's planning command selected 65 lanes and a full-suite escalation because of its existing mixed changes. That plan does not apply to this isolated worktree. From the new worktree, `pnpm verify:plan` selected format/lint on touched files and docs/emoji audits, with no full-suite escalation. The remote baseline SHA has 55 recorded check runs; all non-skipped runs completed successfully and no failed or cancelled checks were returned. No local application tests were run before the baseline changes.

## Toolchain and capacity

- Linux x86_64; Node `v22.23.2`; pnpm `11.9.0`; Rust `1.97.1`; Cargo `1.97.0`; just `1.58.0`.
- Workspace dependencies were already available from the pnpm store; no tracked dependency changes were made.
- At kickoff, the worktree filesystem had about 8.2 GB free; during validation it had 7.9 GB free. RAM available was about 6.5 GB at kickoff and 5.1 GB at the later checkpoint (22 GiB total). The root filesystem was 97% used at the later checkpoint.
- Native and browser runtimes are installed per the repository toolchain record. No native build is affected by this research-only slice.

## Initial application boundary map

- Scene/document validation, codecs, and integrity recovery: `packages/scene/src/document-utils.ts`, `documentCodec.ts`, and document validation tests.
- Persistence and recovery entry points: `packages/editor/src/context/usePersistence.ts`.
- Design-token storage and collision projection: `packages/scene/src/tokens/store.ts` and `runtimeProjection.ts`.
- Token import, update, application, and export workflows: `packages/editor/src/tokenSync/`.
- UI and website: not changed by the initial research tooling batch; any later product finding must map affected UI, keyboard/clipboard/drag routes, native/WASM behavior, persistence, and published website claims before implementation.

The map above is an initial navigation map, not a claim that all adjacent routes have been exhausted.

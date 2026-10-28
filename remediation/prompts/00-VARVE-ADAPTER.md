# Varve adapter — remediation execution templates

The prompt files in this directory are a generic (Go-oriented) template set.
This adapter is the authoritative mapping for this repository. Read it before
running 01-04.

## Placeholder substitution

| Placeholder | Varve value |
|-------------|-------------|
| `{{REMEDIATION_DOC}}` | `docs/quality/agent-context-remediation-2026-10-28.md` |
| `{{BASELINE_FILE}}` | `.file-size-baseline.json` |
| `{{GODSPLIT_PLAN_TOOL}}` | `scripts/quality/godsplit-plan.mjs` |
| `{{GODSPLIT_PLAN_COMMAND}}` | `node scripts/quality/godsplit-plan.mjs` |
| `{{REFACTOR_VERIFY_COMMAND}}` | `node scripts/quality/refactor-verify.mjs` |
| `{{GATE_COMMAND}}` | `node scripts/quality/audit-file-size.mjs` (or `pnpm audit:filesize`) |
| `{{PACKAGE}}` | the affected workspace package path, e.g. `packages/editor` |
| `{{TARGET_FILE}}` | the frozen file for the current entry |
| `{{COVERING_TEST_FILE_n}}` | only the specs that directly cover the moved declarations |

## Command mapping (generic template -> Varve)

| Generic template command | Varve command |
|--------------------------|---------------|
| `go build ./...` | `pnpm check:agent` (recursive tsc through the validation queue) |
| `go vet ./...` | `pnpm check:rust` for Rust seams; biome/typecheck covers TS |
| `go test ./{{PACKAGE}}/...` | `pnpm test:agent <focused spec paths>` |
| `gofmt -w` / `goimports -w` | `pnpm exec biome check --write <changed files>` |
| `refactor_verify.py` | `node scripts/quality/refactor-verify.mjs --base <ref> --target <file> --dest <dir>` |
| `godsplit plan` | `node scripts/quality/godsplit-plan.mjs <file>` |
| `fak hygiene --gates GOD_FILE_GROWTH` | `pnpm audit:filesize` |
| baseline regeneration | `node scripts/quality/audit-file-size.mjs --update` (never `--force`) |

## Worktree base

The campaign foundation is committed on `master` (guards, baseline, docs,
agent map). Create the seam worktree from local `master`, not
`origin/main`: `origin/main` does not carry the guard scripts or the
baseline, so the worktree would have no gate.

## Verification order for a TypeScript seam

1. `node scripts/quality/godsplit-plan.mjs <target>` — inventory the blocks.
2. Write `SEAM_SPEC.md` (declaration set, destination, expected sizes, hazards).
3. `node scripts/quality/refactor-verify.mjs --base master --target <target> --dest <dest>` after extraction.
4. Focused specs before and after; record the test counts.
5. `pnpm exec biome check --write <changed files>`.
6. `pnpm check:agent` (through the validation queue).
7. `node scripts/quality/audit-file-size.mjs --update`; confirm exactly the
   intended entry left the baseline and no new over-cap file was frozen.
8. `pnpm agent:map` and stage the regenerated `docs/agents/repo-map.generated.md`.
9. `node scripts/audit-health.mjs` when a hub or complexity ceiling may move.
10. Commit only seam files + baseline + agent map; the pre-commit checkpoint
    runs the staged validation. Do not bypass it.

## Limits

- `refactor-verify` parses TypeScript/JavaScript. Rust seams are proven by the
  package test suite; there is no Rust declaration verifier.
- There is no remediation-workbench UI. The front-end necessity gate in 01
  therefore answers "no workbench exists; a seam that does not change rendered
  output does not schedule front-end work". A separate workbench task must be
  queued explicitly if the operator surface is wanted.
- Visual validation for a pure code-motion split is a zero-diff contract check
  plus the covering component tests; run 04 only when rendered output or an API
  shape consumed by UI changes.

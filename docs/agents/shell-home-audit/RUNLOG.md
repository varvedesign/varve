# RUNLOG — Shell + Home UI audit

Agent: `opencode-shell-home` · branch `agent/opencode/shell-home` · worktree
`.worktrees/shell-home` · dev server `5341` · started 2026-10-22T18:45 local.

## Inputs

The task briefing arrived with the INPUTS block empty. The user then set the
target in one line: **"focus on the app shell and home"**. Everything not stated
is recorded below as an assumption.

| Input | Value | Source |
|---|---|---|
| target | Varve editor shell + Home surface (`packages/editor`, `packages/home`, `packages/ui`) | user |
| task | Find and fix user-facing shell/Home defects, with measured evidence | derived |
| users | Design professionals, intermittent-to-expert; desktop-first, browser demo on web | `AGENTS.md`, demo path |
| platforms | Tauri desktop (Linux primary), Chromium/WebKit web build | `AGENTS.md` |
| design system | `packages/ui` tokens (1225 custom properties, 3 themes) + components | RECON |
| constraints | WCAG 2.2 AA floor; no new tokens; no feature removal | `AGENTS.md` |
| autonomy | proceed, flag irreversible/expensive decisions | assumed (no answer given) |
| out of scope | canvas/rendering internals, Rust crates, website, release pipeline | assumed |

## Phase 0 — concurrency (as found)

- `master` has **23 modified tracked files + 11 untracked entries I did not
  create** (Tauri lifecycle/collab, scene codec/version, `context.tsx`,
  lockfile, e2e specs). Not touched, not stashed, not reset.
- **17 worktrees** are live, including `.worktrees/ui-depth`,
  `.worktrees/agent-control`, `.worktrees/photocraft-issues`.
- A claim file `.git/agent-claims/claude-ui-depth.md` exists for
  `agent/claude-ui/depth-polish` on **the same surface** (editor shell chrome +
  Home). It states `status: active (phase 4 done; no source edits until user
  approves PLAN)` and TTL 4 h from 00:45.
- **The claim file was stale and wrong.** Its worktree had 34 uncommitted
  files (`Shell.tsx`, `StatusBar.tsx`, `SelectionInfoBar.tsx`, `editor.css`,
  `HomeShell.tsx`, `tokens.css`, `components.css`, …), commits at 17:57–17:59
  that day, and file writes at **18:22–18:29 — minutes before this session
  started**. The agent process was live; only its claim metadata was stale.
- A second live lease `e2e: ui-depth menus` (pid 3434415, started 02:12Z) held
  the heavy-task lease for >20 min during this session.

### Isolation

- New worktree from `master` HEAD `41ce72061`; `pnpm install --frozen-lockfile`
  in 13.6 s (warm store).
- Own dev server on `5341`; own audit output dirs.
- Claim written to `.git/agent-claims/opencode-shell-home.md` with
  `exclusive_paths: []` and an explicit **DO NOT EDIT** list matching the live
  agent's dirty files.
- Consequence: the highest-value fixes (Home landmark nesting, editor landmark
  coverage, iOS input zoom, tab close control) sit in files that agent owns or
  in its exclusive `packages/ui` CSS. They are **diagnosed and specified, not
  edited**. One Home fix landed in unowned files.

## Phase 1–3 — recon, research, decision

Recorded in `RECON.md`, `RESEARCH.md`, `DECISION.md`. No new surface was built;
the task is improving existing screens.

## Measurement setup

- `ui-audit.mjs` from the repo root, copied into the worktree (untracked,
  excluded via `.git/info/exclude`).
- `node ui-audit.mjs --selftest` → **`SELFTEST PASS`** (12/12 positive checks
  fire, no false positives on the clean controls).
- axe-core was **not installed**; the script would have silently skipped all
  contrast/ARIA checks. Installed `axe-core@4.11.0` into `node_modules/axe-core`
  only — **no manifest, no lockfile change**. axe then ran (proven by
  `axe:*` rows in every summary).
- The editor shell is React state, not a route, so a local opt-in `--setup`
  hook was added to the tool copy (≈12 lines) plus `audit-kit/setup.mjs`, which
  drives the product's real entry path (`New → Create design`) or demo mode
  (`?try=1`). No DOM injection; no product code touched for measurement.

## Incidents

1. **First editor probe failed** (`dialog` timeout). Cause: the first `<dialog>`
   in DOM order is a permanently-mounted *closed* alert dialog. Fixed by
   targeting `dialog[open]`.
2. **A baseline matrix was discarded.** It was started before my edits and
   would have mixed pre/post states. Killed after 3 of 36 runs; not used.
3. **Vite served a stale transform.** After `git checkout` flipped a file, the
   dev server kept serving the old `EmptyState` module (old prop signature,
   literal `h3`) while the consumer HMR'd. This silently invalidated the first
   "after" run. Caught by curling the transformed module and by the unchanged
   axe count. Fixed by restarting Vite with `--force`; both states were then
   re-measured. **Any before/after audit on this repo must prove the server is
   serving the new module.**
4. **`pkill -f` matched its own shell** and killed a `verify:plan` invocation.
   Re-run cleanly; no state lost.

## Deviations from the briefing

| Deviation | Reason | Mitigation |
|---|---|---|
| 12-run bounded matrix instead of full 6-width × 3-scheme × 4-stress | Live lease held by another agent; 5.9 GB RAM available, swap exhausted | Findings are structural (ARIA tree, landmarks) and verified at 320/1440/1920 × light/dark; 375 and textspacing/rtl/pseudo not run |
| `VARVE_HEAVY_TASK_PARALLELISM=0` for the final audit | Lease held >20 min by `ui-depth menus`; owner alive, 0 Chromium processes running | Checked `free -m` first; single browser at a time; recorded here |
| No Lighthouse / LCP / INP | Browser `dev` build is not a production bundle; numbers would not be truthful | CLS measured in-page (Home 0.003, editor 0.012–0.013, budget 0.1) |
| No screen-reader pass (NVDA/VoiceOver) | Non-interactive environment | axe + DOM/landmark assertions only; flagged as open |
| TabStrip accessibility fix reverted | Measured regression (see FINDINGS F-04) | Reverted, not shipped |

## Gates

- Phase 0 claim + isolation: passed.
- Measurement self-test: passed.
- Research before implementation: passed (`RESEARCH.md`).
- Route approval for visual design: **not applicable** — no visual direction
   was changed; the shipped fix is a semantic heading level. The 2026-10-23
   recount found 51 changed pixels (0.003935 %) in the retained 1440px pair,
   confined to the viewport corner (EVIDENCE §4 corrects the original metric).

## What I did not do

- Did not edit any file the live agent has dirty, nor `packages/ui` tokens/CSS.
- Did not commit, push, merge, or rebase.
- Did not run the full suite (no escalation condition; see `EVIDENCE.md`).
- Did not update any visual baseline.

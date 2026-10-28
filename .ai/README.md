# .ai - reusable agent playbooks

**Status:** prompt surface, introduced 2026-10-28. Canonical policy stays in the
repository docs; this directory never replaces or restates it.

`.ai/` holds short reusable playbooks so a prompt can name one skill instead of
pasting procedure. Like the `docs/agents/` playbooks they load on demand; the
always-loaded index remains `AGENTS.md`.

## Loading model

1. [AGENTS.md](../AGENTS.md) - always loaded: directory map, quiet commands,
   hard rules.
2. Canonical docs - `docs/agents/*`, `docs/quality/*`, `docs/architecture/*` -
   loaded when a task needs detail.
3. [constitution.json](constitution.json) - machine-validated rule registry:
   every hard rule points at real enforcement. Not auto-loaded by harnesses;
   read it when you need to know what is actually gated.
4. `.ai/roles/<role>.md` - one on-demand persona for the task shape (render
   pipeline, Rust IPC, editor UI). Load one role, not all of them.
5. `.ai/skills/<name>.md` - one procedural checklist for one recurring task
   shape. Read the whole file (each is <=80 lines), then follow only the
   canonical docs it links.

If a skill and a canonical doc disagree, the doc wins; fix the skill in the same
change that changes the policy.

## Layout

| Path | Purpose |
|------|---------|
| `.ai/README.md` | this file: convention, loading order, checks |
| [constitution.json](constitution.json) | machine-validated rule registry (role list + rule list) |
| [roles/README.md](roles/README.md) | role index: task persona, scope, required checks |
| [skills/README.md](skills/README.md) | skill index: trigger and canonical doc per skill |
| [skills/add-ipc-command.md](skills/add-ipc-command.md) | Rust command plus TS adapter through the IPC seam |
| [skills/split-god-file.md](skills/split-god-file.md) | 400-line budget, baseline lifecycle, real-seam split |
| [skills/run-shared-validation.md](skills/run-shared-validation.md) | queue, receipts, heavy-lease boundary |
| [skills/review-accessibility.md](skills/review-accessibility.md) | tokens, APG, keyboard, forced-colors, axe review |
| [skills/canvas-interaction-bug.md](skills/canvas-interaction-bug.md) | canvas/pointer bug: E2E first, diagnosis, done |
| [skills/concurrent-worktree.md](skills/concurrent-worktree.md) | concurrent worktrees: isolation, single-writer surfaces, staged checks, merge and prune |
| [skills/design-visual-change.md](skills/design-visual-change.md) | intended design changes vs regressions: scoped visual:update, diff review, determinism |

## Skill rules

- One recurring task shape per skill; kebab-case filename; markdown; ASCII only,
  no emoji. Sections, in order: When to use / Required context / Steps / Exact
  commands / Definition of done / Do not. 80 lines maximum including fences.
- Steps are checklists, not policy essays. Link the canonical doc instead of
  copying it: [file-size-policy.md](../docs/quality/file-size-policy.md),
  [ipc-type-contract.md](../docs/architecture/ipc-type-contract.md),
  [local-validation-queue.md](../docs/quality/local-validation-queue.md),
  [validation-and-workflow.md](../docs/agents/validation-and-workflow.md).
- Every relative Markdown link must resolve from the skill's own directory;
  every command must exist in `package.json` or as a checked-in script.
- Prefer stable doc/script link targets. Name source paths in backticks and do
  not link them, so a split or rename cannot silently break the skill.
- Respect 3-File / 1-Seam: a skill never authorizes scope beyond its seam.
- Adding or changing a skill means: copy the six-section order, stay <=80 lines,
  link canonical docs only, then run the checks below and report file list,
  line counts, and link results.

## Checks

```bash
pnpm audit:constitution   # rule registry: every rule maps to real enforcement
wc -l .ai/README.md .ai/roles/*.md .ai/skills/*.md
python3 - <<'PY'
from pathlib import Path
import re, sys
files = [Path('.ai/README.md'), *sorted(Path('.ai/skills').glob('*.md'))]
bad = []
for f in files:
    for target in re.findall(r'\]\(([^)#]+)\)', f.read_text()):
        if '://' in target or target.startswith('mailto:'):
            continue
        if not (f.parent / target).exists():
            bad.append(f'{f} -> {target}')
print('links:', 'OK' if not bad else '\n'.join(bad))
sys.exit(1 if bad else 0)
PY
# no output below means the prompt surface is plain ASCII
LC_ALL=C grep -nP '[^\x00-\x7F]' .ai/README.md .ai/skills/*.md
```

Run these from the repository root; a clean run is the definition of done for a
skill change.

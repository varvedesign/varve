# 00 - retired Varve adapter (superseded)

Status: retired 2026-10-28. This file existed only to translate the Go-oriented
template set (`go build`, `go vet`, `gofmt`, `goimports`,
`refactor_verify.py`) to this repository. The templates are now repo-native:
`01`-`04` use the Varve commands directly, and `templates/NEXT-PROMPT.md` is
the generic handoff template. No placeholder substitution is needed before
running the prompts.

Do not treat this file as policy. Read the prompts directly:

- `remediation/prompts/01-RESEARCH-AND-GAP-ANALYSIS.md`
- `remediation/prompts/02-SEAM-EXECUTION-TEMPLATE.md`
- `remediation/prompts/03-FRONTEND-REMEDIATION-WORKBENCH.md` (bounded UI gate;
  there is no remediation workbench)
- `remediation/prompts/04-VISUAL-VALIDATION-AND-CLOSEOUT.md`

Canonical commands and rules stay in `docs/quality/file-size-policy.md`,
`docs/agents/validation-and-workflow.md`, and
`docs/quality/agent-context-remediation-2026-10-28.md`. This pointer may be
deleted in the next docs cleanup; nothing depends on it.

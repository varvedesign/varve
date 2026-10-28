# Phase 0 — Mandatory Research and Gap Analysis

## Rule
Do not plan or code yet. Research first. Write `RESEARCH.md` and `GAP_ANALYSIS.md`. Implementation is blocked until both exist.

## A. Tool and technique research
Use web search. Do not rely only on the remediation doc. Research both what works and what fails.

Required query themes:
1. `god file seam extraction hazards build tags init order aliased imports raw strings`
2. `refactor_verify dropped declaration behavior-preserving code motion`
3. `god-file ratchet baseline regeneration shrink-only`
4. `automated codemod silent failure skip files type-check` 
5. `Sourcegraph Batch Changes limitations large changesets` 
6. `refactoring engine bugs incorrect warnings failed refactorings`
7. `backlog dashboard UX complaints aging stale risk` 
8. `visual regression testing dynamic content disable animations threshold`

For each theme, record in `RESEARCH.md`:
- What the approach is supposed to do.
- At least two real failure modes reported by users or maintainers.
- The guardrail this prompt will add to prevent that failure.
- A citation or URL.

## B. Competitor and user-complaint analysis
Answer explicitly:
- What do codemod and batch-refactoring tools fail at that we must not repeat?
- What do backlog-management and refactoring dashboards fail at that our workbench must improve?
- Which complaints are realistically resolvable inside this platform, and which are out of scope?

Minimum findings to address:
- Silent skips and false-success reporting.
- Type-check failures after automated edits.
- Large-batch UI clumsiness and missing changed-line visibility.
- Dashboard count hiding stale/aging risk.
- Visual diff ambiguity and false positives.

## C. Edge-case and gap register
Before touching the target file, enumerate every applicable edge case from this list and mark `applies / does not apply / unknown`:
- per-file build tags
- `init()` ordering across files
- aliased imports
- raw string literals containing code-like text
- receiver-qualified function identity (`(*T).M` vs `T.M`)
- same-named methods in one file
- incomplete cut that drops a declaration
- test-file exemption from the ratchet
- generated files
- parse failure in the target file
- grandfathered entry inside the slack band
- entry that should be removed rather than shrunk
- baseline regeneration refusing to add an entry or raise a ceiling
- stale baseline entry whose file no longer exists
- touched grandfathered file whose ceiling must ratchet down
- concurrent worktree conflict with a peer-hot file
- rollback path if the seam fails after extraction

## D. Front-end necessity gate
Answer yes/no with evidence:
- Does this seam change anything an operator sees or does in the remediation workbench?
- Does it change an API response shape consumed by the UI?
- Does it change error, empty, loading, or permission states?
- Does it make the 964-entry queue harder to understand?

If any answer is yes, add a linked front-end task using `03-FRONTEND-REMEDIATION-WORKBENCH.md`. Do not silently fold UI work into the seam.

## E. Gaps in the remediation doc
Write `GAP_ANALYSIS.md` covering:
- Batch definitions: are A–D actually disjoint and ordered?
- Baseline regeneration procedure: who runs it, what prevents growth, how is it reviewed?
- Rollback: what happens if the seam lands but the ratchet does not go down?
- Observability: how do we know the queue is shrinking, not just changing shape?
- Front-end: is there a workbench, or only a frozen list?
- Accessibility, i18n, dark mode, empty/error/loading states if UI is touched.
- Concurrency: which entries are peer-hot, and how will worktrees avoid collisions?
- Testing: are there real-world scenarios, or only fixtures?

## Output contract
`RESEARCH.md` must contain a “Failure modes → guardrails” table. `GAP_ANALYSIS.md` must contain a “Gap → action → owner → prompt file” table. Do not proceed until both are written.
# OpenPencil issue review — 2026-10-20 (superseded)

> **Superseded.** The current record for this corpus is
> [`CORPUS-2026-10-21.md`](./CORPUS-2026-10-21.md) with its per-issue ledger
> [`issues-2026-10-21.json`](./issues-2026-10-21.json). This file is kept because
> it records the original three-range reading pass that the current review
> inherits (every frozen issue body and every comment page). Its dispositions
> are bucket-level and its deferred "candidate-verify" buckets were resolved in
> the 2026-10-21 record — do not plan work from this file.

This audit records a frozen review of the public `open-pencil/open-pencil`
issue corpus and the Varve follow-ups selected from it. The machine-readable
inventory in `issues-2026-10-20.json` assigns every issue present at the
creation cutoff exactly one disposition. Pull-request records are excluded
from issue coverage.

## Corpus and review method

- Creation cutoff: `2026-10-20T08:05:56Z`; paginated GitHub REST `state=all`
  retrieval returned 1,277 records, of which 357 were issues (75 open, 282
  closed) and the remainder were pull requests.
- Three independent range reviews covered issue numbers 5–248, 251–610, and
  613–1324: 119 issue records per range. All frozen issue bodies and every
  issue-comment page were retrieved. Comment counts were 222, 170, and 88;
  the middle range has one historical discrepancy: issue #262 had four
  comments in the frozen inventory and three in its later live endpoint.
- Range reviewers inspected Varve source and existing tests, not issue
  reproduction. Their source-only candidates are not treated as verified
  Varve defects. This task reproduced and fixed only #495 and #1166 in the
  local implementation, with targeted unit and browser validation.
- Reviewers did not exhaustively fetch linked pull-request diffs, external
  archives, or attachments. In particular, external Figma files/archives for
  #29, #36, #69, #102, #243, and #174 were not inspected; #1227's attached
  archive was also not inspected. Those omissions are preserved rather than
  silently counted as verified evidence.
- Second cutoff: `2026-10-21T06:54:23Z` (23:54:23 PDT on October 20). The
  paginated state-all inventory contained 358 issues: one new report, #1327,
  and no materially updated or missing frozen reports. Its body and one
  comment were read. The request is for OpenPencil's MCP surface; Varve has a
  page reorder command and accessible page-navigation controls but no MCP
  server/tool surface, so no Varve change was indicated.

## Implemented improvements

### [#495 — Figma direct component slots](https://github.com/open-pencil/open-pencil/issues/495)

Varve's Figma JSON conversion did not map Figma `SLOT` property definitions
and slot-content references into Varve component slot metadata. The importer
now recognizes `SLOT` nodes, maps directly-bound root slots to editable
multiple-content slots, and excludes slot definitions from generic property
controls. A nested or unbound slot remains visually imported and produces an
explicit unsupported-feature warning. Figma advisory/preferred-instance
settings remain unsupported; the import report and marketing copy do not
claim them.

Acceptance coverage checks parsed slot data, component instantiation, and
encode/decode save-reopen retention. Native `.fig` source parsing now carries
slot references into the common conversion model; the checked-in native
fixture does not itself contain a slot, so native-slot fixture coverage is a
known gap.

### [#1166 — hidden SVG content](https://github.com/open-pencil/open-pencil/issues/1166)

The SVG converter now omits elements with inline or presentation-attribute
`display="none"` and applies inherited inline/presentation visibility while
honoring descendant `visibility="visible"` overrides, including root SVG
visibility. Parser and browser-import tests cover these interactions.
Stylesheet CSS beyond the importer's documented supported subset is not
claimed as supported.

## Reviewed, not implemented

- [#1245](https://github.com/open-pencil/open-pencil/issues/1245) and
  [#1260](https://github.com/open-pencil/open-pencil/issues/1260) describe OpenPencil `.fig` writer/component-slot persistence
  failures. No equivalent Varve save/reopen failure was established; the
  #495 slot test verifies Varve's own component-slot persistence contract.
- [#829](https://github.com/open-pencil/open-pencil/issues/829)'s exact mixed
  open/closed SVG subpath reproduction imports as a compound path with two
  contours and one hole. The real browser import E2E renders the ring with an
  empty center, captured in
  `tests/e2e/canvas/file-import.spec.ts-snapshots/file-import-svg-mixed-subpath-hole-chromium-linux.png`.
  This is existing behavior, now pinned by unit and visual regression tests; no
  product change was required. The browser run reported the repository's
  pure-TS stub renderer fallback after WASM failed to load. The related #450
  report was not independently reproduced, so no broader parity claim is made.
- [#1297](https://github.com/open-pencil/open-pencil/issues/1297)'s Linux native-menu accelerator/focus interaction was not reproduced.
  No keyboard behavior change is made on a source-only hypothesis.
- Other source-only candidates, upstream-specific reports, duplicates, and
  already-covered functionality have explicit per-issue dispositions in the
  JSON inventory; they are not marked as implemented.

## User-facing documentation and website

`docs/architecture/figma-import-system.md` and
`docs/architecture/import-system.md` describe the supported import behavior
and limitations. The website's file-format guide is updated for direct Figma
component slots and SVG visibility. No marketing layout or broad product
claims were changed; the existing page design was retained. A dated second
corpus cutoff, visual inspection evidence, review findings, commit/merge
identifiers, and deployment confirmation are appended after those checks.

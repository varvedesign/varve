# Photocraft findings and implementation batches

Status: active. Research status and Varve engineering status are tracked
separately. The frozen issue inventory is not an exhaustively reviewed corpus.

## F-001 — Non-finite numeric values can corrupt document state

**Sources.** [Photocraft #6862](https://github.com/storytold/photocraft/issues/6862)
(three-party issue report with two comments); linked [PR #6863](https://github.com/storytold/photocraft/pull/6863)
was open at the source cutoff. The issue says a JSON numeric value such as
`1e39` becomes `f32` infinity and prevents subsequent save. The first comment
links the proposed fix; a bot comment suggests #1101, #5752, and #6424.
#5752 (gradient/pattern assignment) and #6424 (commands) share the overflow
symptom. Their complete discussions are reviewed: #5752 links follow-up #5753
and the bot separates angle normalization from non-finite acceptance; #6424
links #5752, #4201, and #4181. Those leads are being reconciled before closing
the recursive evidence frontier. #1101 concerns the opposite direction—
serialization of a non-finite value—and its commenter supplied a failing
engine round-trip test; that is adjacent evidence, not proof of the same root
cause. Bot links do not establish equivalence.

**Varve applicability and reproduction.** Varve previously accepted JSON
`1e309` as JavaScript `Infinity` during `DocumentCodec.decode`; a focused
regression reproduced acceptance of `opacity: 1e309`. Expression evaluation
also returned infinity for finite operands whose arithmetic overflowed. The
Inspector's `parseField` therefore had a path to write a non-finite number.

**Comparable-app complaint check.** In [Photopea #4899](https://github.com/photopea/photopea/issues/4899),
a user reported that an existing graphic could neither accept image layers nor
save, while the same image worked in a new file. The thread does not establish
the root cause or a general Photopea failure rate, so it is used only as a
failure-mode example: when document-specific content blocks both editing and
save, users need a clear error and protection against replacing the affected
file with an empty document. Varve's invalid-open and finite-number guards
address that recoverability boundary.

**Batch A implementation (focused tests and browser visual validation passed; full validation and integration remain).** Reject the first non-finite value at
the document decode boundary and return its path; reject non-finite expression
results; preserve the prior Inspector value with an accessible validation
error; refuse invalid Open requests without replacing the active document or
binding a blank fallback to the source path. Tests cover codec, expression,
field parsing, open-session preservation, and a real-browser Inspector flow.

**Engineering status:** implementation present in `codex/photocraft-source-review`,
not yet validated/reviewed/integrated. See continuation for commands and exact
status. **Research status:** #6862 body and all comments read; PR #6863 metadata
and changed files inspected, discussion not yet established as complete; #5752,
#6424, and #1101 bodies and discussions read; recursive evidence remains open.

**Visual evidence.** Playwright passed against the real Inspector field at
1440×900. The before screenshot shows width 375; after entering a 309-digit
finite value that overflows during expression evaluation, the field shows an
accessible validation message and the model value remains 375.

![Inspector value before overflow input](evidence/non-finite-before.png)

![Inspector validation after overflow input](evidence/non-finite-after.png)

**Website impact:** reviewed; no change needed until release because this is a
correctness fix and does not alter a public product claim. Architecture and
Inspector behavior docs are updated in this batch.

## F-002 — Atomic replacement could overwrite read-only files and change their mode

**Sources.** PhotoCraft's filesystem tracking issue [#6617](https://github.com/storytold/photocraft/issues/6617)
links the concrete read-only-save reproduction [#6600](https://github.com/storytold/photocraft/issues/6600).
The report demonstrates that on Linux/macOS a same-directory rename can replace
a `chmod 444` document because the operation checks directory permissions,
not the destination file's write bits. The tracking issue also separates
hard-link breakage (#6602), metadata loss (#6603), orphaned staging files
(#6604), and dangling-symlink replacement (#6605); those are independent
behaviors and are not claimed as fixed here.

**Varve applicability and reproduction.** `write_file_atomic` used sibling-temp
replacement without checking the destination's `readonly()` state. On Unix,
this permits replacing a read-only file when the parent directory is writable.
The staging file also inherited only the process umask, so replacement could
change the prior mode (for example, a 0600 document becoming 0644).

**Batch B implementation.** Refuse a read-only destination before creating a
staging file; fail closed if target metadata cannot be inspected; and copy
the existing permissions to the staged file before syncing and replacing it.
Regression tests assert that the original bytes survive a read-only write
attempt and that a writable 0640 file remains 0640. Atomic replacement and
same-filesystem staging remain intact.

**Engineering status:** focused Linux native tests passed (3 tests covering
replacement, read-only refusal, and mode preservation). Full-gate validation
for this batch remains pending because the impact planner escalated. Code
review and final integration are pending. **Research status:** #6617 and the
full discussions for #6600–#6605 were reviewed; related same-path and recovery
issues remain under Varve applicability review.

**Website impact:** no public claim describes filesystem permission or metadata
preservation, and this fix does not add a new marketed capability; no website
copy change is warranted before release.

## Source seeds that did not match the requested repository

The attachment's seed links use `storytold/pdfcraft`. In the requested
`storytold/photocraft` repository, #2516 is an unrelated brush-outline PR,
#2022 concerns preferences/recent files, #434/#787/#2970/#8 are unrelated PRs,
and #2944/#2946 concern other workflows. These IDs are not silently
substituted or treated as Photocraft issue coverage. Their relevant behavior
may be assessed later as comparative evidence only.

## Deferred classification policy

Every inventory row starts `unassessed`. Do not infer irrelevance from labels,
closed state, missing body, or bot-suggested relatedness. Record an exclusion
reason and source pointer before changing a row's relevance disposition.

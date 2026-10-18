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
replacement, read-only refusal, and mode preservation). The exact-SHA local
full gate passed formatting/lint, architecture, health, all typechecks, CI
tooling, and WASM lanes; its Vitest lane had two unrelated baseline failures
and a benchmark timing failure that passed when rerun alone under the heavy-task
lease. Code review of the complete branch and final integration are pending.
**Research status:** #6617 and the
full discussions for #6600–#6605 were reviewed; related same-path and recovery
issues remain under Varve applicability review.

**Website impact:** no public claim describes filesystem permission or metadata
preservation, and this fix does not add a new marketed capability; no website
copy change is warranted before release.

## F-003 — Save destinations can belong to another open document

**Sources.** PhotoCraft [#6597](https://github.com/storytold/photocraft/issues/6597)
reports that Save As on one tab can replace another open tab's file, leaving the
first tab looking saved while its in-memory contents are later lost. Its
discussion says the guard covers Save, Save As, and Save a Copy. The source's
linked [PR #6630](https://github.com/storytold/photocraft/pull/6630) handles
duplicate opens and path identity; [PR #6632](https://github.com/storytold/photocraft/pull/6632)
adds same-file comparison, including hard links on Unix. These are now merged
upstream. PhotoCraft #6596 separately covers external edits, which Varve already
checks for native saves with a content hash.

**Varve applicability.** The editor previously wrote a selected target before
checking whether another active session was bound to it. Exact-path open
deduplication does not protect Save As when aliases or hard links identify the
same file.

**Batch C implementation.** Before native, browser-handle, or library writes,
check the active session list for another owner. Native desktop paths compare
through the `same-file` OS identity API; browser handles use
`FileSystemFileHandle.isSameEntry`, and Varve Library destinations compare
their stable IDs. Save, Save As, and Save a Copy all refuse
the write with an actionable status message. If native identity inspection
fails, the save fails closed. Tests cover Save As and Save a Copy refusing an
aliased native target, Save refusing another session's native target, and a
Rust check for hard links plus ordinary new destinations. The regression also
found that Save a Copy cleared failure status after a refused write; failed
copies now keep the error visible.

**Engineering status:** implementation is present on the source-review branch;
focused regressions pass. The planner-required exact-SHA full gate and final
integration remain. See continuation for exact commands and results.
**Research status:** #6597 and all its comments were reviewed, as were linked
PRs #6630 and #6632; further linked issues and the broader PR census remain
open.

**Website impact:** no public claim describes multi-tab save collision handling;
this correctness behavior does not change a marketed capability, so no website
copy change is warranted before release.

## F-004 — Interrupted native saves can leave large hidden staging files

**Sources.** PhotoCraft [#6604](https://github.com/storytold/photocraft/issues/6604)
reports that killing the app during a large write leaves hidden sibling
`*.pcsave.tmp` files in the user's document folder, with later saves and
launches never removing them. Its bot link to [#3489](https://github.com/storytold/photocraft/issues/3489)
was checked: that report describes orphaned autosave bundles and abandoned
save temps, and proposes sweeping only old artifacts not belonging to an
active process. The bot link to [#203](https://github.com/storytold/photocraft/issues/203)
is adjacent: it documents the data-loss risk of in-place writes and the
importance of retaining atomic replacement.

**Varve applicability and reproduction.** `write_file_atomic` writes to a
unique sibling `.varve-write-<timestamp>.tmp`, syncs it, then atomically
replaces the target. Ordinary error returns remove the current staging file,
but process termination bypasses that cleanup and there is no stale-temp sweep.
The target remains protected, while abandoned bytes can accumulate in the
same directory indefinitely. The regression seeded aged, recent, and
non-generated names, performed a save, and verified only the stale generated
regular file was removed; a Unix test verifies a staging-shaped symlink stays
in place.

**Decision and acceptance.** Throttle sweeps to one per destination directory
every five minutes per process. New staging names include the writer PID;
remove those only after the PID is confirmed exited, and retain files when
process status is unknown. Legacy timestamp-only names are removed only after
24 hours. In both cases, remove regular files only, and leave files with live
or unknown owners, symlinks, and malformed lookalike names untouched. Treat
directory enumeration and cleanup as best-effort so cleanup cannot make a valid save fail. Keep
same-directory atomic replacement and existing destination bytes intact on
write failure.

**Batch D implementation.** Before writing the new staging file, the first
save to a directory performs a best-effort sweep no more than once every five
minutes in the process. New temp names carry their writer PID and are removed
once that process is confirmed gone; legacy temp names require a 24-hour-old
modification time. The sweep leaves live or uncertain owners, malformed
lookalike names, and symlinks alone.
Directory enumeration or unlink errors do not fail the save, and atomic
replacement remains unchanged.

**Engineering status:** implementation is present and the five focused native
`atomic_write_` tests pass, including legacy stale-file removal, dead-owner
cleanup (including recent abandoned files), live or unrepresentable-owner
retention, lookalike-name retention, and symlink retention. A final
read-only review caught and fixed the Unix case where a PID outside `pid_t`
could otherwise be treated as dead; out-of-range owner status is now unknown
and retained.
Rustfmt, documentation, emoji, and token audits pass. The planner escalates to
the full suite; its two attempts are recorded in the continuation report, and
the full gate remains incomplete.
**Research status:** #6604 body and comment, #3489 body and comment, and #203
body were reviewed from the cutoff cache. No implementation or release claim
from PhotoCraft is assumed to apply to Varve.

**Comparable-app failure checked.** Inkscape [#260](https://gitlab.com/inkscape/inkscape/-/issues/260)
reports a truncated, unusable document after a save-time crash and asks for
write-then-replace atomic saving. That is a different failure from orphaned
temp cleanup. It supports retaining Varve's atomic replacement while adding
only bounded cleanup; it is not evidence that Varve's target is corrupted.

**Website impact:** reviewed current save, recovery, and local-first pages; none
claims that native staging artifacts are automatically removed. No marketing
edit is justified for this internal cleanup behavior.

## F-005 — Atomic save can replace a symbolic link

**Source.** PhotoCraft [#6605](https://github.com/storytold/photocraft/issues/6605)
reproduces saving through `link.psd` when it points to a missing relative
target. The current file becomes a regular file and the link is lost. The issue
accepts either writing through the link target or reporting that its target
folder is unavailable. Its bot comment links #6426; that report concerns
automation-root path containment and does not share this document-save
behavior. It was reviewed and classified as unrelated.

**Varve applicability and reproduction.** `write_file_atomic` atomically
renames a sibling over the provided path. For an existing symlink, the rename
replaced the link itself; for a dangling symlink, target metadata appeared
missing and the same replacement happened. The regression first reproduced
both cases: a live link disappeared instead of updating its target, and a
dangling link was silently replaced while the target path stayed absent.

**Decision and acceptance.** Resolve a file-level symlink before choosing the
staging directory and replacement path. Saving through a live link updates the
canonical target and preserves the link. If the link target cannot be
resolved, fail with a clear error while keeping the link and not creating
missing target directories. Keep atomic replacement for the resolved target.

**Batch E implementation.** Approved user-selected native paths resolve an
existing file-level symlink before atomic replacement. The shared atomic writer
refuses an unresolved symlink with an actionable error, while app-managed
writes keep their own path policy. Two Unix regressions cover preserving a
live link through the approved resolver and refusing a relative dangling link
without changing it or creating its target directories. The full focused suite has seven passing
`atomic_write_` tests; broad verification remains required for the accumulated
branch.

**Comparable-app report checked.** Inkscape
[#9776](https://gitlab.com/inkscape/inbox/-/issues/9776) describes users whose
linked image paths break after reopening documents stored in a symlinked
folder. It is adjacent path-resolution evidence, not the same atomic-rename
failure or proof that Varve shares Inkscape's reported behavior.

**Website impact:** this is native filesystem path handling, not a released
capability claim. Reviewed save, recovery, and local-first pages; no marketing
edit is justified.

## Save-path follow-up: identity, metadata, memory, and recovery

The PhotoCraft filesystem cluster (#6602, #6603, #6607, #6611, #6615) has been
compared against Varve's implementation rather than treated as one save bug:

- **Hard links (#6602) are confirmed exposure.** Native document writes use
  `write_file_atomic` and replace the destination with a staged file. This
  preserves crash safety but changes the file identity, so other hard links
  keep the old bytes. Varve's same-file guard detects hard links for
  destination-collision checks; it does not preserve aliases during save. Do
  not change this path to in-place writes without explicitly accepting the
  crash-loss tradeoff. A safe next step needs a user-facing policy and
  platform-tested hard-link count handling.
- **Metadata loss (#6603) is confirmed on the native replacement path.** The
  staged file currently preserves permission bits, but not extended
  attributes, ACLs, creation time, or Windows named streams. macOS `copyfile`
  documents `COPYFILE_METADATA` as POSIX metadata, ACL, and xattr copying;
  Windows `ReplaceFileW` preserves several attributes, ACLs, creation time,
  and named streams. These APIs have different error and replacement
  semantics, so silently copying best-effort metadata is not an adequate
  cross-platform fix. The issue remains open for platform-specific design and
  native verification. The adjacent PdfCraft #3042 implementation is an
  unmerged proposal, not validation for Varve.
- **Save memory (#6607) is a live investigation lead.** Varve's recovery store
  serializes full-document snapshots, and file export/save has several
  serialization routes. The memory peak must be measured by format and
  backend before changing those routes; streaming is not a safe assumption
  for every encoder or atomic-save contract.
- **Malformed settings (#6611) is a partial analogue.** `loadSettings` merges
  many sections with defaults and explicitly normalizes several enum and
  numeric fields, but its broad catch can discard all settings when parsing
  or a migration throws. No reproduction of the reported exact reset behavior
  has been established in Varve. This warrants targeted malformed-field
  review, not a claim that the issue is already fixed.
- **Browser recovery (#6615) is covered in Varve's normal browser path.** The
  editor stores crash-recovery snapshots in IndexedDB and offers recovery on
  the next launch. Storage denial or quota exhaustion remain failure cases to
  assess; Varve does not promise recovery when the browser refuses durable
  storage.

No marketing-site claim currently describes hard-link, metadata, save-memory,
or crash-recovery behavior, so no website copy change is justified before an
implemented and released improvement.

## Remaining filesystem tracker dispositions (#6596–#6617)

The tracker and adjacent reports were checked against the same Varve boundary:

- #6596 is covered by Varve's external-change checks, while #6597 is covered
  by F-003's cross-session destination guard. #6598 is only partial: a second
  open may still create a second session, but the write guard prevents silent
  concurrent replacement. Open-session deduplication remains a separate UX
  decision.
- #6601 is a confirmed native-path limitation. The desktop OS-open queue and
  dialog path conversion use lossy UTF-8 before paths reach editor state. A
  correct fix needs an end-to-end path identity contract or a deliberate early
  refusal with a usable explanation; changing only the final writer would not
  repair open, Save As, and recent-file behavior together.
- #6606 matches `write_file_atomic`, which creates missing parent directories.
  This may be useful for batch destinations, so a fix should distinguish
  explicit document Save As from export and app-managed writes rather than
  changing the shared helper indiscriminately.
- #6610 is covered in Home: inaccessible desktop paths are marked missing and
  open failures update recent-file state. #6612 is partially covered: Varve's
  recovery data is outside the Linux config directory, but Tauri's
  `app_local_data_dir` resolves under XDG data, while the XDG specification
  reserves `XDG_STATE_HOME` for state data. The report's config-sync failure is
  therefore not the same Varve failure, but a migration to the canonical state
  directory may still improve placement. Review PhotoCraft PR #6941's
  migration and storage-denial policy before changing this boundary. On macOS,
  keeping recovery under Application Support avoids purging it with Caches.
- #6608/#6609 describe linked smart objects and Photoshop external-link
  records. Varve's image assets are document-owned/content-addressed and no
  equivalent linked-smart-object workflow was found; these reports do not
  establish a current Varve defect. #6617 is a tracking issue, not a separate
  failure. Export-name reports #6613/#6614 were checked against Varve's batch
  export workflow; see F-006 and the issue ledger dispositions below.

## F-006 — Duplicate batch export names can overwrite earlier outputs

**Sources.** PhotoCraft [#6613](https://github.com/storytold/photocraft/issues/6613)
reports that distinct artboards can sanitize to the same filename and the later
export silently replaces the earlier one. #6614 reports the same failure class
for generated image assets. These are distinct from the hard-link behavior in
#6602: here the application itself issues two writes in one batch.

**Varve applicability.** The Export dialog already runs job names through
`applyExportBatchPaths` and the shared collision resolver, which renames
colliding jobs. However, `ExportService.run` is also a public execution boundary
and accepted duplicate filenames from direct callers; generated multi-file
deliverables add further names after the dialog's job-level resolution. Such a
duplicate could replace a previous file depending on the configured sink.

**Implementation.** The service now uses the same output-path canonicalizer as
the folder and archive sinks, normalizes Unicode composition, reserves every
output name before writing, and reports a duplicate as a failed job with an
actionable rename message. A review regression found that `./Logo.svg` and
`Logo.svg` otherwise reached the same sanitized path; the shared canonicalizer
now catches both. It reserves before
the first write so a partially written multi-file export cannot be overwritten
by a later job. A regression first failed because the sink received both writes,
then passed after the guard. This complements the dialog's automatic renaming;
it does not alter normal unique-name exports.

**Related feature scope.** Varve does not expose PhotoCraft's named-layer
"Generate Image Assets" workflow, so #6614 is not a direct feature match. The
service guard also covers any collision among declared multi-file bundle
outputs.

**Website impact:** no marketing claim describes batch export overwrite
behavior; no site copy change is justified.

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

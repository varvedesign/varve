# DesignCraft intake ledger — 2026-10-16

Intake of the `storytold/designcraft` issue tracker into Varve: every issue gets
a disposition, the defects that could exist in Varve's surface are checked
against Varve's source, and the confirmed ones are repaired with regression
evidence.

- **Source tracker:** `storytold/designcraft` only (not PhotoCraft or the other
  storytold apps). 185 open + 221 closed = **406 issues** triaged. 143 pull
  requests in the same tracker were read for their fix/test content but are not
  counted as issues.
- **Pinned Varve state:** `32de0c41c` (plus this cycle's working tree).
- **Issue text is untrusted data.** Nothing in it was executed, copied, or
  treated as instructions. DesignCraft code was not reused: the repairs below
  are clean-room implementations of the *defect class*, not ports.
- **Related:** `docs/audits/world-script-text-repairs-2026-10-15.md` (format and
  evidence levels), `docs/quality/validation-strategy.md` (validation scope).

## Method and evidence levels

| Level | Meaning |
|---|---|
| **E1** | Reproduced in Varve: a test failed against the previous behaviour and passes after the repair (the failing run is recorded below). |
| **E2** | Source-inspected at the pinned SHA, with a file:line anchor, without a runtime reproduction. |
| **E3** | Title-level triage only: the title was classified, the body was not read, and no Varve inspection was made for that specific issue. |

Only E1 supports the word "repaired". Only E2-with-anchor supports "verified".
Everything else is a triage verdict about whether the defect *shape* can exist
in Varve's implemented surface — it is not a claim that Varve is defect-free.

Issues whose **bodies** were read: **#708, #745, #821, #920, #1031, #1050,
#1055**. Every other issue — including the evidence-class anchors #739, #741,
#744, #1048, #1049, #1085, #1145 — was triaged from its title (E3). Where a title
was too vague to classify honestly (`#166` ".", `#676` "Several issues", `#871`
".braw", `#1114` "Layers"), the class row says so instead of inventing a
disposition.

## Coverage

The 406 issues are grouped into 26 defect classes. Each issue appears in exactly
one class; before committing, a throwaway script (not kept in the repo) extracted
the id lists from the two tracker listings, resolved them against the class table,
and asserted 406 unique ids with no duplicates and no omissions.

Class verdicts use: **repaired**, **verified**, **diagnosed**, **triage**,
**n/a**, **evidence**.

---

## Repairs landed this cycle

### R1 — A single unreadable version field no longer fails the whole open

Evidence: **#1049** ("One unusable IDML CJK metric makes the whole file
unopenable"), **#739** (version narrowed before the too-new check), **#744**
(public API hardening). The transferable shape: a load boundary trusts one
field's type, and one bad value refuses or crashes the entire file.

Varve before: `parseVersion` called `.split()` on `doc.formatVersion` asserted to
be a string (`packages/scene/src/version.ts`). `DocumentCodec.decode` documents a
result contract (`ok: false` + warnings) for any bytes it is handed, but a JSON
number, boolean, array or object in `formatVersion` threw a `TypeError` out of
`decode` — the app's open path.

Repair (`packages/scene/src/version.ts`, `packages/scene/src/documentCodec.ts`):

- `resolveDocumentVersion(raw)` classifies the field as `declared` (numeric
  string), `legacy` (missing/`null`/empty → the historical `0.9` reading) or
  `unrecognized`.
- An `unrecognized` field loads the document **without running migrations** and
  stamps the current version. Guessing a vintage from a foreign value would run
  an arbitrary subset of 40 migrations over bytes of unknown vintage.
- `DocumentCodec.decode` reports `document.unrecognized-version` (severity
  `warning`, path `formatVersion`) instead of failing the open, and wraps the
  migration call so an unforeseen input shape fails that document, not the open
  path.
- `parseVersion` is total: it returns `[0, 0]` for non-strings rather than
  throwing, so the exported helpers (`isVersionLessThan`,
  `isForwardCompatible`) are safe with untrusted input.

Tests: `packages/scene/src/documentVersionIntegrity.test.ts` (13 tests: number,
boolean, array, object, a suffixed string, `null`, legacy string, and "does not
run migrations for an unrecognized version"). Failing run before the repair: all
malformed cases failed with `TypeError: v.split is not a function` escaping
`DocumentCodec.decode`.

### R2 — A save verifies that the bytes it is about to write can be loaded

Evidence: **#1050** ("A saved .designcraft file can be one the app can no longer
open"), **#1031** (audit: save writes an unloadable document), **#1085**, **#741**
("serialization-error path: `to_bytes` returns empty bytes that save treats as
success"). The class: the save path reports success for bytes it never read back.

Varve before: `DocumentCodec.encode` → `JSON.stringify`. A non-finite number
became `null` (JSON has no encoding for `Infinity`), and the reopened document
**succeeded** with `y === null` — a silently corrupted coordinate, not even a
visible failure. This was measured, not assumed:

```
probe (before repair): { wroteNull: true, decodeOk: true, effectiveY: null,
                         verification: null }
```

Repair:

- `serializeDocument` (`version.ts`) now serializes through a replacer that
  records any non-finite number with its JSON path (`nodes.n1.shape.y`) and then
  throws `NonFiniteDocumentError`. It never writes `null` over a number, and the
  path makes the failure diagnosable. No extra traversal: the check rides the
  single `JSON.stringify` pass.
- `packages/editor/src/persistence/saveTruthfulness.ts` adds
  `encodeVerifiedDocument(document)`: encode, then decode the exact text with the
  real codec, returning `{ok: true, json}` or a typed `serialization-failed`
  issue. (That `SaveIssue` category existed in `context/types.ts` but had no
  consumer; the repair gives it its first one.)
- Wired into all three write sites in `context/usePersistence.ts`
  (`performSave`, `chooseAndAdopt`, `performSaveCopy`) before any write, dirty
  patch, or recovery deletion — so a failure keeps the document dirty and keeps
  its recovery points.
- `afterPrimaryWrite` no longer re-encodes the document: it now receives the
  verified text. The old re-encode was redundant work on every save and could
  throw *after* a successful write, which would have broken the completion path.

Tests: `packages/editor/src/persistence/saveTruthfulness.test.ts` — round-trip
acceptance, non-JSON rejection, non-document rejection, diagnosable reason,
`NonFiniteDocumentError` on a non-finite coordinate, the JSON path
(`nodes.n1.shape.y`), and a control proving extreme-but-finite (`1e308`) still
saves and reopens.

**Measured cost of the read-back:** on a 5 000-node document (1.6 MB of JSON),
`DocumentCodec.encode` takes ~229 ms and the new read-back decode ~317 ms — the
verification roughly doubles the pre-write CPU cost. It runs only on explicit
saves (Save / Save As / Save a Copy); the autosave and backup services write
recovery copies through their own path, so no per-edit cost is added. The trade
is deliberate: a half-second pre-write check on a large document buys "the file
we are about to write can be opened", which is the defect being fixed.

### R3 — A browser download hand-off is not a save

Evidence: **#708** ("Web Save clears dirty state even when download initiation
fails", High) and **#1055** (recovery/crash protection silently not covering
documents). The class: the app reports "Saved" for work that never reached a
destination, and then stops protecting it.

Varve before: `chooseAndAdopt` (first Save / Save As on a browser without the
File System Access API) adopted a `download-only` target, cleared `dirty`,
patched `saveState: 'saved'`, and returned `{status: 'saved'}`. For a first save
of a document with no `fileId`, the mirror is skipped too, so **nothing was
written anywhere**. The status bar read `Saved`. Worse, the effect at
`context.tsx:3223-3227` only acknowledges a saved revision to autosave/backup when
`!dirty && saveState === 'saved'` — so the false save also **stopped recovery
protection**.

Repair (`saveTruthfulness.ts` + `usePersistence.ts`): one pure policy,
`decideSaveSuccess({durable, clean})`:

| durable | clean | marksClean | settleSaveState |
|---|---|---|---|
| false | any | false | `idle` (renders `Modified` while dirty) |
| true | true | true | `saved` |
| true | false | false | `saved` (renders `Modified` — dirty wins) |

`chooseAndAdopt` applies it; the pre-existing repeat-save download branch uses
the same function so both paths agree. A hand-off keeps dirty state, keeps
autosave/backup protecting the document, and never claims a file save. The
site's own wording already stated this contract — the code was what disagreed
(see the website section).

Tests: unit table above, plus a browser scenario:
`tests/e2e/save/save-flow.spec.ts` → "without File System Access, Save hands off
a download and never claims Saved" (real Chromium, real download event, first and
second save, screenshot artifact).

**Regression proof (E1):** with `durable` forced to `true` (the old behaviour)
the same E2E failed at the status assertion with the status bar rendering
`Saved` / `save-status--ok` and the download having occurred
(`test-results/run-1421151-1420/.../test-failed-1.png`). Restored, the spec
passes (11/11, see the validation table).

### R4 — A completed hand-off left the status bar stuck at "Saving…"

Found while proving R3 (the first `durable: false` probe made the test fail with
`Saving…` instead of `Modified`). The pre-existing repeat-save download branch
patched `lastSavedAt` but never left the service's transient `saveState:
'saving'`; any Firefox/Safari document would show "Saving…" for the rest of the
session. R3's policy now carries `settleSaveState`, and both hand-off branches
use it. Covered by the same E2E (first *and* second save assert `Modified`).

### R5 — A failed Save a Copy reported success

Found while reviewing R2's effect on the save-copy path (**pre-existing**, not
introduced by R2). The save hook restored the document's previous status after
every `save-copy`:

```ts
const outcome = await performSaveCopy(...);
patch({ saveState: prevSaveState, saveIssue: null });   // also on failure
```

So a copy whose write failed set `saveState: 'error'` + `saveIssue` inside
`performSaveCopy` and had both cleared immediately: the status bar fell back to
the *document's* status (`Saved`/`Modified`) with no failure anywhere. Same class
as #708/#1050 — a success claim for a write that did not happen. The restore is
now conditional on the copy having completed.

Test: `tests/e2e/save/save-flow.spec.ts` → "a failed Save a Copy reports the
failure instead of restoring the previous status" (fails against the previous
behaviour, where the bar read `Modified`).

---

## Diagnosed, deliberately deferred

Each of these is confirmed in Varve's source but was out of this cycle's frozen
scope. They are the next slices, in the order I would take them.

### D1 — The open path discards codec warnings and silently opens a blank document

`packages/editor/src/context.tsx:9458` (the real open path) does:

```ts
const decoded = DocumentCodec.decode(json);
doc = decoded.ok ? decoded.document : createDocument(name || 'Untitled');
```

A document that exists but cannot be decoded becomes a **blank document with the
same session identity**, and the codec's `warnings` are dropped at *every* call
site (`context.tsx:2712`, `:9458`; verified by grep: no consumer of
`DocumentCodec.decode(...).warnings` exists in the app). If the user then saves,
the source file is overwritten with an empty document. This is the same
"silently treats corruption as absence" class as **#719** and the same
"unopenable file" class as **#375 / #705 / #1085**.

Deferred because `packages/editor/src/context.tsx` is **modified by another
session's in-flight work** in this working tree (and is at its import budget, per
AGENTS.md). Editing and committing it would entangle that work. Next step: toast
the codec error, refuse to adopt the source binding on decode failure, and add a
unit test for the decision (extract the decision; do not add imports to the hub).

### D2 — Two importers unzip without budgets

`packages/import/src/sketch.ts:73` and `packages/import/src/figma/native.ts:279`
call `unzipSync` with no decompressed-byte or entry-count budget (**#710**). The
documented guard already exists in
`packages/editor/src/archive/archiveRestorer.ts:32-37` — a maximum uncompressed
size per entry checked against the ZIP **local header's declared original size**
before fflate inflates it, so a small crafted ZIP with an extreme ratio is
rejected without allocating the expanded buffer — plus an entry-count ceiling
(`:133`). Those two import sites should share one bounded-unzip helper. Next
step: extract the helper, adopt it in both importers, and add a zip-bomb fixture
test.

### D3 — EPS bounding-box parse is dead and unbounded

`packages/import/src/eps.ts:56` matches `%%BoundingBox` and assigns nothing (the
parse result is unused), with no magnitude or finiteness bound. DesignCraft
**#740** (non-finite physical dimensions) and **#1048** (TIFF preview read from
wrong offsets) are the same parser-robustness class. Next step: decide whether
the preview is supported at all; if not, delete the dead match, otherwise parse
with bounds.

### D4 — Object locks are enforced per tool, not centrally

`packages/editor/src/tools/LiquifyTool.ts:92` and
`packages/editor/src/tools/clippedPaintLayer.ts:166` check locks locally.
DesignCraft **#735** (`path.setAnchor` permits edits on a locked layer) is the
same "one entry point forgot the check" class. Next step: a single
mutation-admission helper for every tool/automation path.

### D5 — Finiteness guards at storage boundaries are not exhaustive

The save boundary is now gated (R2), but
`packages/editor/src/settings.ts:791` still writes `localStorage.setItem` without
a guard, and DesignCraft **#821** is exactly "a non-finite UI setting saves a
settings file that will not load, and the settings are lost". Next step: validate
the serialized settings blob on write (same read-back pattern as R2).

### D6 — Download blob URLs are revoked synchronously

`packages/platform/src/web-save.ts:122-130` and the fallback in
`packages/platform/src/web.ts:1252` call `URL.revokeObjectURL(url)` immediately
after `a.click()`. The browser may not have taken the blob yet. This is a
hardening candidate, not a proven user-visible failure — I did not reproduce a
failure, so it is recorded rather than changed.

### D7 — The forward-compatibility warning has no UI consumer

`detectForwardCompatWarning` runs inside `migrateDocumentDetailed`, and
`DocumentCodec.decode` maps it to `document.forward-compatibility` — but nothing
shows it (same grep as D1). The website's file-format page says older builds
"may warn that the file is newer"; **the current build computes that warning and
throws it away**. The correct repair is to surface it (after D1 unblocks the hub
file), not to weaken the claim. Recorded under the website audit below.

### D8 — History snapshots now fail loudly on a corrupt document

`packages/history/src/snapshots.ts:109` encodes the document for its canonical
text. R2 makes that encode throw on a non-finite value instead of writing a
`null`-poisoned snapshot. This is intentional (a corrupt document must not be
frozen into revision history), but it is a behaviour change in a second caller:
342 history/editor/persistence tests remain green, and the next perf cycle should
know about it.

Related, and **not** fixed: the autosave/backup services wrap their recovery
write in `try { await this.onSaveRecovery(revision) } catch {}` with the comment
"Recovery is best-effort and must not turn a successful save into a retry"
(`packages/editor/src/autoSaveService.ts:294-301`). A document that cannot be
serialized therefore stops producing recovery snapshots **silently** — the
service's `setState('error')` has no UI consumer (`AutoSaveService` state is
read nowhere; only `acknowledgeSaved` is called, `context.tsx:3226`). The primary
signal is the explicit save failing loudly, which is correct, but a persistently
unwritable recovery path deserves one visible notice. Next slice: surface a
single "recovery unavailable" notice after N consecutive failures.

---

## Verified already correct (E2)

| Finding | Varve state | Anchor |
|---|---|---|
| Presentation mode cannot be exited (**#493**, **#1189**) | Escape exits; focus returns to the opener | `packages/editor/src/components/Presentation/PresentationDeliveryLayer.tsx:508` |
| Document grid never drawn (**#530**, partial **#809**) | Grid has a real render consumer | `packages/editor/src/canvas/gridRenderer.ts:107` |
| Automation revert applies three-way (**#709** class) | Revert path is implemented and tested — verified in the in-flight `packages/automation/` work, which is untracked in this working tree and therefore not yet on `master` | `packages/automation/src/revert.ts:127` (untracked at the time of writing) |
| Cross-document paste binds foreign asset ids (**#720** class) | Foreign references are dropped on paste | `dropForeignReferences` (masking/copy path) |
| `quick-xml` RUSTSEC-2026-0194/0195 (**#714**) | Resolved `quick-xml 0.41.0` with a vendored `little_exif` patch for exactly this advisory | `Cargo.toml:34`, `Cargo.lock` |
| ZIP-bomb guard exists somewhere (**#710** class, partial) | Bounded archive restore with documented limits | `packages/editor/src/archive/archiveRestorer.ts:35` |
| Quit must not silently discard unsaved work (**#544**) | Dirty authority + `TerminationCoordinator`; native close is intercepted | `docs/architecture/lifecycle-system.md`, `packages/editor/src/lifecycle/` |
| "Saved" must mean a destination write (**#708**, **#1050**) | True after R2/R3; the codec read-back is now part of the save | this cycle |

---

## Class inventory — all 406 issues

Verdict applies to the class unless a per-issue note says otherwise.
`n/a` means Varve does not implement that surface (compare the capability matrix
in `AGENTS.md`), not that the class is unimportant.

| Class | Defect shape and verdict | Issues |
|---|---|---|
| **A** | Save/open integrity and recovery. **repaired** for the write-verification and hand-off truthfulness core (R2–R5: #708, #1050, #1085, #1145, #741, #821 class); #544 verified; #436 (in-place write atomicity), #496 (two apps overwrite recovery), #1055 (recovery lock), #715 (UID-based overwrite), #719 (silent corrupt assets) need their own slices; #439 (remote/NAS checkout) is outside the local-first scope, though `@varve/history` already provides revision history | 375, 436, 439, 544, 686, 705, 708, 715, 719, 741, 821, 1050, 1055, 1085, 1145, 141, 496 |
| **B** | Version-field and schema robustness. **repaired** (R1): a non-string `formatVersion` opens without migrations and reports `document.unrecognized-version`; #739's u32 narrowing has no Varve equivalent (versions are strings) and #744's "validate at the public boundary" is the rule R1/R2 implement | 739, 744, 1049 |
| **C** | Untrusted-input bounds and hardening. **diagnosed** for the two importers (D2) and EPS (D3) and per-tool locks (D4); **verified** for #714 (patched `quick-xml`); #720 verified for paste; #727/#728/#732/#734/#844/#851/#861/#904 need per-surface budgets (§ AGENTS.md validation economy: each is its own slice) | 707, 710, 711, 712, 713, 714, 720, 727, 728, 732, 735, 740, 844, 851, 861, 904, 1048 |
| **D** | Command/CLI/MCP contract truthfulness. **triage** — Varve's automation surface (`packages/cli`, `packages/automation`) was not slice-verified this cycle. The transferable rule (an operation must error on invalid input, never silently ignore it) is what R2 applies to saving | 61, 62, 63, 67, 68, 69, 70, 72, 113, 242, 243, 260, 386, 387, 412, 432, 651, 654, 731, 733, 749, 776, 777, 778, 1053, 1087, 1185 |
| **E** | Undo, history and session integrity. **triage** — `@varve/history` and the editor's transaction capture exist; the specific defects (#716 selection/document mixing, #717 partial-section reset, #718 cache dependencies, #729 story crossing documents, #742 panic rollback) were not reproduced. D8 records the one behaviour change R2 makes here | 406, 709, 716, 717, 718, 729, 737, 742 |
| **F1** | Typography and style system. **triage** — Varve has a text pipeline and style model (`docs/architecture/text-pipeline.md`); optical justification (#494) is *not* implemented and must not be claimed on the website | 29, 157, 169, 180, 181, 191, 320, 326, 368, 494, 531, 603, 605, 619, 621, 653, 697, 747, 896, 947 |
| **F2** | Text flow, frames and generated content. **triage** — frame linking, autoflow, columns, footnotes and TOC exist in the model; the specific defects are unverified | 140, 165, 194, 262, 352, 517, 557, 582, 596, 609, 620, 625, 646, 665, 738, 755, 886, 891, 915, 1069, 1120, 1165 |
| **F3** | Script systems and language-specific text. **triage** — BiDi/shaping/line-breaking exist (`text-pipeline.md`); Thai/Lao/Khmer/Myanmar breaking and RTL bullet attachment need a corpus, which this cycle did not build | 87, 100, 130, 431, 435, 453, 515, 535, 628, 756, 879, 916, 1008 |
| **F4** | Text editing, caret and selection. **triage** — no reproduction attempted | 23, 174, 189, 289, 401, 546, 594, 622, 981 |
| **G** | Font discovery and embedding. **triage** — Varve has a font catalog and text pipeline; the system-font/optically-sized-font cases (#261, #327, #911) need platform-specific checks | 22, 48, 86, 107, 110, 123, 161, 261, 327, 328, 332, 335, 430, 476, 547, 694, 899, 900, 911, 1032, 1112 |
| **H** | Colour, print and PDF output. **triage** — `varve-print` implements CMYK/PDF-X/ICC; #392 (RTL text layer order), #909 (validator calls an unembedded font valid) and #910 (CMYK fractions) are exactly the "output claims something the file does not have" class and deserve the next print slice | 32, 35, 71, 159, 190, 323, 392, 479, 526, 540, 684, 726, 734, 743, 873, 906, 907, 909, 910, 927, 938, 944, 945, 1005 |
| **I** | Canvas, render and shared visual state. **triage** — Varve's documented "never show pixels no fresh frame will replace" invariant is the same class as #90/#730; #848 (one object's effect recolouring others) is the shared-state-bleed shape and is worth a targeted test | 90, 186, 484, 730, 848, 943 |
| **J** | Clipboard, input, IME and placement targeting. **triage** — no reproduction; Varve's clipboard and pointer paths are covered by existing E2E but not these cases | 1, 2, 30, 89, 134, 160, 164, 185, 187, 197, 201, 212, 238, 312, 322, 348, 351, 354, 470, 492, 518, 568, 762, 781, 847, 874, 931, 953, 1051, 1082 |
| **K** | Panels, dialogs and app chrome. **triage**, and **gated**: any UI change must pass the mandatory research gate (three inspected screens from two creators) before implementation. Not attempted this cycle by design | 57, 133, 182, 183, 237, 240, 265, 267, 313, 324, 371, 437, 438, 480, 481, 549, 579, 586, 679, 681, 696, 706, 736, 750, 788, 806, 841, 898, 923, 941, 955, 1180 |
| **L** | Linked files and packaging. **triage** — Varve embeds assets in the document; the "missing link became a 0-byte file reported ok" case (#908) is the same silent-substitution class as R2/D1 and should adopt the same read-back rule | 235, 340, 391, 569, 593, 856, 908, 942, 1016 |
| **M** | Grids and layout guides. **verified** for the render consumer (#530); #644/#805/#809/#883 need a visual pass | 530, 644, 805, 809 |
| **N** | Pages, master pages and spreads. **triage** — pages/spreads/parents exist in the scene model | 198, 429, 556, 624, 652, 882, 883, 956, 1091, 1137 |
| **O** | Import/export fidelity for formats Varve does not implement. **n/a** — Varve imports SVG, Figma (REST/JSON/native `.fig`), PDF, PSD, AI, EPS, Sketch; it has no IDML/INDD/DOCX/EPUB/XLSX/Publisher/QuarkXPress/Typst path, and no liquid-layout or InDesign-script surface. The transferable lesson (silent fidelity loss must be reported, never assumed) is adopted in R2 and D1 | 21, 24, 73, 77, 91, 93, 114, 162, 179, 193, 211, 227, 256, 338, 339, 389, 390, 425, 449, 450, 451, 555, 558, 581, 587, 597, 626, 685, 700, 721, 722, 723, 725, 872, 905, 946, 950, 961, 962, 1019, 1047, 1088, 1092, 1093, 1094, 1095, 1096, 1126, 1140 |
| **P** | HTML/EPUB and non-print export. **n/a** — Varve's code export is SVG/React/Flutter/SwiftUI and its document export is PDF/PNG (plus raster slide/handout PDF); there is no EPUB book writer or HTML document export to have these defects | 314, 724, 766, 767, 768, 769, 770, 771, 772, 773, 774, 775, 790 |
| **PRES** | Presentation mode. **verified** (#493, #1189); decks, audience preview and the `present` decision point exist (`docs/architecture/presentation-system.md`) | 493, 822, 852, 1189 |
| **Q** | Startup, packaging and platform integration. **triage** — the release/signing pipeline is documented and tested (`docs/release/`); installer/window-decoration/codesign cases were not reproduced | 45, 64, 88, 92, 94, 158, 167, 192, 220, 273, 333, 334, 414, 440, 574, 612, 784, 786, 877, 890 |
| **S** | Performance. **triage** — Varve has a bench harness and a render benchmark gate; these cases need their own fixtures | 508, 566, 752, 934 |
| **T** | Tables. **triage** — `packages/scene/src/tableOps.ts` exists | 20, 163, 370, 595, 932, 1025 |
| **U** | Transform, object geometry and selection semantics. **triage** — sticky snapping and transform ops exist (`tools/snapping.ts`) | 34, 99, 188, 337, 461, 564, 842, 884, 897, 919, 1003, 1124 |
| **V** | Localization and i18n. **n/a** for UI translation (#234, #924, #1122, #1186) — Varve has a menu-label resolution boundary but no locale catalogue and no browser-language negotiation, and must not claim translation. #1142 (Esperanto as a *text* language) belongs to the text pipeline | 234, 924, 1122, 1142, 1186 |
| **W** | Docs, process and out-of-scope requests. **n/a / evidence** — #745, #920 and #1031 are the audit indexes this intake used as oracles; #166, #173, #676, #871 and #1114 are unclassifiable from their titles; mobile apps, ExtendScript hosts, LilyPond frames and generative vector art are outside Varve's scope | 59, 60, 166, 173, 232, 259, 361, 376, 405, 602, 676, 745, 871, 880, 920, 1004, 1031, 1114, 1134, 1167, 1181 |

---

## Website audit (marketing site)

The intake's user-visible repairs change what the site is allowed to say. Each
affected claim was checked against the code; "verified" means the claim was read
in the built page and matched the behaviour after the repair.

| Page | Claim | Verdict | Action |
|---|---|---|---|
| `apps/website/src/pages/docs/browser-demo.astro` | "In Firefox and Safari, Save produces a fresh snapshot download each time **and the browser-local copy is updated as well**" | **False for a first save**: `chooseAndAdopt` mirrors only `if (adopted.persistent \|\| meta?.fileId)`, so a document with no library identity is downloaded and copied nowhere | **Corrected**: the page now states that a download is not a location the demo can write to again, the document stays `Modified` until it reaches a destination it can read back, an existing library identity is also copied into browser storage, and a brand-new document is not copied until a later save |
| `apps/website/src/pages/docs/browser-demo.astro` | "A cancelled file picker changes nothing and does not mark the document saved" | True (and now strengthened) | Added: "a download the browser took over is not reported as saved either" |
| `apps/website/src/pages/docs/browser-demo.astro` | "**Saved means the write to the destination actually finished**" | Was **not** true on the download path before R3; true after | Claim verified in the built page and pinned by a test |
| `apps/website/src/pages/docs/file-formats.astro` | Older builds "may warn that the file is newer" | **Unverified**: the codec computes `document.forward-compatibility` but no open path shows it (D7) | **Not edited** — the correct repair is to surface the warning, not to weaken a correct statement; tracked as D7 |
| `apps/website/src/pages/download.astro` | "Varve runs in your browser without a desktop install" | True (browser demo exists) | No change |

The two corrected statements are pinned in
`apps/website/tests/e2e/browser-demo.spec.ts`, which asserts the guide text on
both website build variants. No layout, colour, or component change was made — this
was a factual-prose correction inside the existing design system, so the visual
research gate did not apply; the rendered result was still inspected (below).

## Visual validation

| Surface | What was run | Result |
|---|---|---|
| Editor save flow (real Chromium) | `tests/e2e/save/save-flow.spec.ts`, heavy-lease wrapped, `--workers=1` | **11/11 pass**, including the new hand-off scenario and the failed-copy scenario; screenshot `download-handoff-stays-modified.png` shows the status bar reading `Modified` after a real download |
| Editor regression proof (R3) | Same spec with the old behaviour restored (`durable: true`) | **Failed** at the status assertion: the bar rendered `Saved` (`save-status--ok`) after a download that wrote nothing durable — the #708 class reproduced with a screenshot |
| Website build | `pnpm build:website` (validate-client-env + `astro check` + build) and `pnpm build:website:pages` | Both builds succeeded, 127 pages each, search index regenerated (119 pages) |
| Website behaviour | `npx playwright test -c playwright.website.config.ts apps/website/tests/e2e/browser-demo.spec.ts` | **10/10 pass** across `ghpages` and `custom-domain` |
| Website appearance | Rendered `/docs/browser-demo` at 1280×900 @2x, screenshotted the "Saving, recovery, and what \"Saved\" means" section, and read the image | Heading and both paragraphs render as intended; no overflow, clipping, or broken emphasis; prose reads correctly in the built page |

## Validation performed

| Check | Command | Result |
|---|---|---|
| Types (`@varve/scene`) | `npx tsc --noEmit -p packages/scene/tsconfig.json` | clean |
| Types (`@varve/editor`) | `npx tsc --noEmit -p packages/editor/tsconfig.json` | clean |
| Scene package tests | `npx vitest run packages/scene/src` | 232 files / 3436 tests pass |
| Editor persistence/recovery/lifecycle + history | `npx vitest run packages/editor/src/persistence packages/editor/src/recovery packages/editor/src/lifecycle packages/history/src` | 33 files / 342 tests pass |
| Format/lint on touched files | `npx biome check --write <touched files>` | clean |
| Save E2E | see above | 11/11 |
| Website build + E2E | see above | 2 builds, 10/10 |
| Audits | `pnpm audit:docs` (clean, 1162 docs), `pnpm audit:emoji` (clean, 5468 files) | pass |
| `pnpm audit:radius` | **Fails on `master` independently of this cycle**: 10 "legacy radius consumers outside token definitions" in `Presentation/presentationDelivery.css`, `Presentation/presentationNavigator.css` and `SpecPanel/SpecPanel.css`. All three files are unmodified at HEAD and this change set contains no CSS, so the failure pre-dates it and is reported rather than absorbed | pre-existing |

Not run: the full suite (`pnpm verify:full`), the Rust workspace, and the visual
regression projects. `pnpm verify:plan` escalates to `FULL-SUITE ESCALATION: YES`
for a *workspace* change, which comes from the other session's in-flight new
package in this working tree, not from this change set; R2 changes
`serializeDocument`, which is also used by `@varve/codegen`, `@varve/cli`,
`@varve/home` and `@varve/import`, whose unit suites were run as part of the
affected closure. This is stated as a residual risk, not as coverage.

## Explicitly not claimed

- DesignCraft's issues are **not** evidence that Varve has the same defect. Where
  this ledger says `triage`, no reproduction was attempted.
- The 49 issues in class **O** are not "fixed" in any sense: Varve does not
  implement those importers/exporters. What was adopted is the reporting lesson.
- The website's file-format forward-compatibility claim (D7) is **still
  inaccurate** in the current build and is recorded as such.
- R2 verifies that the *encoded text decodes*. It does not prove the resulting
  document is pixel-identical to the one in memory; the codec is the app's real
  read-back contract, which is the strongest check available before a write.
  Note also that `DocumentCodec.decode` runs the codec's normalizing repairs, so
  "decodes" means "loads, with any repairs the codec already reports as
  warnings" — the verification deliberately does not fail a save because the
  codec repaired a minor field.
- The R2 gate covers `serializeDocument`. Paths that write document JSON without
  going through it (if any exist today) are not covered; none were found in this
  cycle beyond the recovery/backup path noted in D8.
- No claim is made that every class marked `triage` is free of defects.

## Next slices

1. **D1 + D7** (open-path truthfulness): surface codec warnings, refuse to bind a
   failed open to the source path, and make the forward-compat claim true. Blocked
   on the in-flight `context.tsx` work landing first.
2. **D2/D3/D4/D5**: bounded unzip, EPS parser decision, central lock admission,
   settings read-back. Each gets its own failing test first.
3. **Print truthfulness** (class H): #392 RTL text layer, #909 validator-vs-file,
   #910 CMYK fractions — the same "the output says something the file does not"
   rule as R2.
4. **Class E** (undo/history): reproduce #716/#717/#718 against `@varve/history`.
5. **Class D** (automation contract): invalid input must error, never be ignored.

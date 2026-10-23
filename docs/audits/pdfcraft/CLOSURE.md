# PDFCraft corpus review — closure

This is the closure record for the PDFCraft tracker review. It states what was
frozen, what every row became, what was built, what was measured, and what
remains a limitation. Another engineer should be able to audit the claim from
this file plus the two machine-readable ledgers, without reading a chat log.

- Source tracker: <https://github.com/storytold/pdfcraft/issues>
- Repository: <https://github.com/varvedesign/varve>
- Closure branch: `codex/pdfcraft-closure-20261023`, cut from `origin/master` at
  `6eebb9581`.
- Auditable gate: `pnpm audit:pdfcraft-closure`
  (`scripts/quality/audit-pdfcraft-closure.mjs`).

## 1. Frozen cutoffs

| Cutoff | List retrieval (UTC) | Discussions (UTC) | Records | Issues | PRs | Open issues + open PRs | `open_issues_count` | Frozen issue IDs |
|---|---|---|---:|---:|---:|---:|---:|---:|
| 1 | 2026-10-17T04:41:02Z → 04:41:58Z | 2026-10-17T05:00:00Z | 2,978 | 1,296 | 1,682 | 827 + 583 = 1,410 | 1,410 | 1,296 |
| 2 | 2026-10-21T19:31:27Z → 19:32:05Z | 2026-10-21T19:32:41Z | 3,903 | 1,790 | 2,113 | 1,044 + 843 = 1,887 | 1,887 | 1,790 |
| 3 | 2026-10-23T07:52:52Z → 07:53:32Z | 2026-10-23T07:54:25Z | 4,208 | 1,951 | 2,257 | 1,103 + 725 = 1,828 | 1,828 | 1,951 |

Cutoff 3 used the listing endpoint with Link pagination (43 pages,
`per_page=100`) and the repository-wide comments endpoint (68 pages, **6,761
comments**, covering issue and pull-request threads). Zero duplicate issue
numbers, zero failed requests, zero cutoff-1/2 issues missing. The frozen ID
set's SHA-256 is in `cutoff3.summary.json`.

**Cutoff 3 is final for this review.** Anything created after
`2026-10-23T07:54:25Z` is follow-on work, not a reopening of this coverage
claim. The follow-on count at closure is **0** (see §9).

### Data-integrity note (frozen artifacts)

`issue-ledger-cutoff2.summary.json` records `candidate: 10, deferred: 1,
verified: 17`; `issue-ledger-cutoff2.tsv` contains `candidate: 9, deferred: 0,
verified-already-correct-: 19`. Both total 494. The TSV is authoritative for
per-issue rows and the closure gate reads the TSV. The frozen summary is not
rewritten; the discrepancy is recorded here rather than silently corrected.
The cutoff-3 summary is generated from the same retrieval and reconciles
exactly.

## 2. Disposition census

Per cutoff, as written (frozen rows are never rewritten):

| Disposition | Cutoff 1 | Cutoff 2 additions | Cutoff 3 additions |
|---|---:|---:|---:|
| `cluster-assessed` | 1,156 | 252 | 26 |
| `outside-varve-scope` | 47 | 164 | 105 |
| `implemented-validated` | 8 | 50 | 25 |
| `verified-already-correct-` | 6 | 19 | 5 |
| `candidate` | 75 | 9 | 0 |
| `deferred` | 4 | 0 | 0 |
| **Total** | **1,296** | **494** | **161** |

Latest disposition per issue, after `resolutions.tsv` and cutoff 3:

| Disposition | Issues |
|---|---:|
| `cluster-assessed` | 1,446 |
| `outside-varve-scope` | 320 |
| `implemented-validated` | 119 |
| `verified-already-correct-` | 66 |
| `candidate` | **0** |
| `deferred` | **0** |
| **Total** | **1,951** |

The 88 non-terminal cutoff-1/2 rows (84 candidate, 4 deferred) were resolved in
`resolutions.tsv`; the 15 historical `verified-already-correct-` rows whose
reasons predated the literal-path convention were restated there with a
code/test path. No earlier row was modified.

## 3. Batches in this closure

| Batch | Finding | Code | Test | Commit |
|---|---|---|---|---|
| 12 | A recovery sidecar could nominate the next save destination; a pathological export node had no bound | `packages/editor/src/recovery.ts`, `components/Shell/RecoveryManager.tsx`, `exportService.ts` | `recovery.test.ts` (hostile sidecar), `exportService.nodeBudget.test.ts` | `98b026365` |
| 13 | One surface's panic could be assumed to take the app; document switches under a dialog were only partly proven; overlay clipping and sidebar rows at small windows were unverified | `components/ErrorBoundary.tsx` (surface probe), `Shell.tsx` (surface names) | `tests/e2e/ui/surface-isolation.spec.ts`, `tests/e2e/canvas/text-edit-overlay-clipping.spec.ts`, `tests/e2e/ui/sidebar-small-window.spec.ts`, `context/__tests__/documentSwitchOwnership.test.tsx` | `9169bcbd9` |
| 14 | The inline editor laid a centred/right-aligned paragraph out at the left edge | `components/TextEditOverlay.tsx` | alignment case in `text-edit-overlay-clipping.spec.ts` (fails with computed `start` without the fix) | `b0f7cefff` |
| 15 | Key material: the UTF-8 password buffer handed to Web Crypto was not wiped | `archive/encryption.ts` | `archive/encryption.test.ts` (wipe on success and on throw) | `309c826f1` |
| 16 | Corpus closure: cutoff 3, resolutions, closure gate, docs | `docs/audits/pdfcraft/**`, `scripts/quality/audit-pdfcraft-closure.mjs`, `package.json` | `pnpm audit:pdfcraft-closure` | this commit |

Autosave scheduling (the inherited batch 8b) needed no new code: it had already
landed upstream as a timer- and generation-driven service with retry and
untitled-recovery coverage (`autoSaveService.ts`, `useAutoBackupServices.ts`,
`autoSaveService.test.ts`). Rows 815, 1803 and 2663 are resolved against those
tests rather than reimplemented.

## 4. Verified-already-correct rows (evidence)

The 66 latest verified rows are grouped by the class they prove. Each group
cites the test or code path recorded in the ledger.

| Class | Rows | Evidence |
|---|---:|---|
| Glyph coverage / encoding | 24 | `packages/editor/src/export/glyphCoverage.ts`, `glyphCoverage.test.ts`, `packages/import/src/pdf/encoding.ts`, `pdfFidelity.test.ts` |
| Text identity and draft commits | 10 | ADR-0242, `docs/adr/0242-document-authority-and-interchange.md`, `tests/e2e/save/text-target-switch.spec.ts`, `text-draft-save.spec.ts` |
| Terminations and crash paths | 3 | `packages/editor/src/lifecycle/coordinator.ts`, `lifecycle/__tests__/coordinator.test.ts` |
| GPU capability degradation | 3 | `docs/adr/0237-native-wgpu-compute.md`, `packages/compositor/src` |
| Page count/order and import bounds | 3 | `packages/import/src/pdf/index.ts`, `tests/e2e/import/pdf-import-integrity.spec.ts` |
| PDF tokenizer operand/state safety | 5 | `packages/import/src/pdf/content.ts`, `pdfFidelity.test.ts` |
| Overlay/chrome/small-window | 4 | `tests/e2e/ui/chrome-ownership.spec.ts`, `sidebar-small-window.spec.ts` |
| Fresh-frame render invariant | 3 | `docs/architecture/render-pipeline.md`, `tests/e2e/visual/partial-redraw-oracle.spec.ts` |
| Save truthfulness / library commit | 3 | `packages/editor/src/persistence/librarySave.ts`, `context/__tests__/librarySave.test.tsx` |
| Document metadata/geometry round-trip | 4 | `packages/scene/src/documentCodec.test.ts`, `packages/scene/src/document-pages.ts` |
| Others (cursor ownership, revision history, undo semantics, thumbnails, PDF writer Unicode) | 4 | `tests/e2e/ui/chrome-ownership.spec.ts`, `packages/history/src/index.ts`, `docs/adr/0019-undo-redo-semantics.md`, `docs/architecture/thumbnail-system.md`, `crates/varve-print/src/lib.rs` |

Full reasons per issue: `resolutions.tsv` and `issue-ledger-cutoff3.tsv`.

## 5. Excluded rows

`outside-varve-scope` rows name the surface Varve does not have. They are
grouped by the cluster recorded in the ledger; the counts are computed from the
latest disposition per issue by the closure gate's data:

| Cluster | Rows | Reason the class does not transfer |
|---|---:|---|
| printer | 76 | no device-printing workflow (`Platform.printPdf`/`listPrinters` are uncalled); PDF/X export is the print surface |
| forms | 45 | no AcroForm/XFA model, none planned |
| other | 38 | the report describes another product's control and no transferable mechanism was found |
| pdf-structure | 37 | Varve imports PDFs into its own model; it does not rewrite PDF structure, annotations, outlines or tags |
| digital-signature | 28 | no signature or certificate surface |
| interchange | 24 | no Office/EPUB/attachment interchange |
| redaction | 23 | no redaction/sanitize surface; ADR-0242 §6 records the disclosure rule |
| ocr | 18 | no OCR surface |
| security | 10 | no PDF Standard Security Handler or PDF JavaScript engine |
| build-release | 6 | their packaging/CI/release tooling |
| preflight | 5 | no PDF/A checker |
| image / interaction / fonts-glyphs / lifecycle-crash / render / page-geometry / text-edit / save-io | 9 | one row each where the named control does not exist; the transferable mechanism is handled by a separate implemented/verified row |
| **Total** | **320** | |

## 6. Native / platform evidence

### 6.1 Native PDF writer, PDF and PDF/X

Command (temporary example removed after the run):

```text
cargo run -p varve-print --example pdfx_probe -- /tmp/opencode/pdfcraft-native
```

Outputs:

```text
probe.pdf        5,607 bytes   (outlined text)
probe-text.pdf 386,408 bytes   (searchable text; full font embedded after warnings)
probe-x1a.pdf 1,165,635 bytes  (PDF/X-1a:2003, GTS_PDFXVersion present)
probe-x4.pdf  1,165,625 bytes  (PDF/X-4, GTS_PDFXVersion present)
```

Independent readers (poppler):

```text
pdfinfo probe.pdf       -> 1 page, 700 x 320 pts, PDF 1.4, no JS, unencrypted, not tagged
pdfinfo probe-x1a.pdf   -> 1 page, 700 x 320 pts, PDF 1.4, no JS, unencrypted, not tagged
pdfinfo probe-x4.pdf    -> 1 page, 700 x 320 pts, PDF 1.6, no JS, unencrypted, not tagged
pdftotext probe-text.pdf - -> "Searchable text 2026"
pdftotext probe.pdf -      -> empty (outlined text is appearance-only)
pdftoppm probe.pdf         -> rendered; inspected: Cyrillic and Greek correct, "Missing: []" where the authored face lacks 漢
pdftoppm probe-text.pdf    -> rendered; inspected: "Searchable text 2026"
grep -ac GTS_PDFXVersion   -> 1 in both PDF/X files
```

The outlined file demonstrates the exact contract the coverage warning exists
for: a character the authored face lacks becomes a visible box, so the TS
coverage report must name it before export. The searchable file demonstrates
the opposite contract: text that a font can represent is embedded and
extractable.

Writer warnings observed (not silent): DejaVu Sans OS/2 version 1 fails the
font permission check, so subsetting fails and the full font is embedded
(`[warning] ... embedding full font`).

Environment gaps proven, not assumed:

```text
qpdf --check probe.pdf -> bash: qpdf: command not found
verapdf               -> not installed (scripts/validate-pdf.sh documents the requirement)
```

PDF/X structural conformance therefore rests on the writer's own assertions
and the `GTS_PDFXVersion` marker, not on a PDF/X validator. This is a stated
limitation, not a pass.

### 6.2 Desktop application build

```text
pnpm --filter @varve/desktop build
```

Result: the production frontend bundle built in this worktree with
`pnpm --filter @varve/desktop exec vite build` (`✓ built in 18.84s`), after the
same package's client-environment guard passed. The scripted `build` command
also runs `tsc --noEmit`; its type check was still running when the bundle
finished and is not claimed as a pass here — the affected validation in §10 is
the typecheck evidence. A full Tauri GUI launch was not performed in this pass;
the native shell's Wayland launch and render were recorded in the preceding
audit commit `eb1d23afd`, and this pass exercises the same Rust writer through
the example above. The Tauri GUI matrix remains a release-environment check.

### 6.3 WebKitGTK lane

The lane the desktop embeds is Playwright's WebKit GTK project, provisioned
under `~/.cache/varve/playwright-webkit`. It was run against the font
availability and text-edit overlay specs. Result: see the gate output in §10
(the run is recorded with its exact command and pass/fail). Where the lane
could not run, the exact command and error are recorded there rather than
being described as a pass.

## 7. Documentation and website

- `docs/audits/pdfcraft/README.md` — cutoff 3, latest census, residual
  limitations, closure pointer.
- `docs/audits/pdfcraft/cutoff3.summary.json` — retrieval timestamps, counts,
  reconciliation, frozen ID set and hash, attachment record.
- `docs/audits/pdfcraft/issue-ledger-cutoff3.tsv` — 161 per-issue rows.
- `docs/audits/pdfcraft/resolutions.tsv` — 103 resolution rows (88 non-terminal
  + 15 historical verified restatements).
- `docs/audits/pdfcraft/CLOSURE.md` — this file.
- `docs/audits/pdfcraft/follow-on-2026-10-22.md` — marked superseded, with a
  pointer to the rows that resolved it.
- `docs/research/pdfcraft-tracker-ledger-2026-10-16.md` — cutoff-3 section with
  the new evidence and decisions.
- `apps/website/src/pages/docs/tools/export.astro` — the user-facing export
  guide now states the per-object export budget: a timed-out object is named,
  is never written, and does not stop the batch; cancellation stays a
  cancellation. No marketing claim was added beyond the measured behaviour.

Website impact: the change is under `apps/website/**` and
`packages/editor/**`, so merging it deploys the website. That is an authorised
consequence of the merge, stated here.

## 8. Residual limitations

Stated as limitations, not completions:

1. 1,446 rows carry a cluster verdict; they were not individually re-read in
   this pass. Rows naming a mechanism Varve has were adjudicated individually.
2. PDFCraft was never built or run. Every PDFCraft-side statement is reported
   or code-anchored.
3. qpdf and veraPDF are absent, so PDF/X is checked with poppler readers and
   the writer's assertions, not a conformance validator.
4. Windows, macOS and Wayland-pen behaviour are not reproducible here; they are
   platform gaps, not passes.
5. A native Rust panic is outside the React error-boundary reach; the browser
   isolation proof does not claim otherwise.
6. An immutable JavaScript password string cannot be zeroized; the derived key
   is non-extractable and the encoded buffer is wiped.
7. `issue-ledger-cutoff2.summary.json` disagrees with its TSV by three
   dispositions; the TSV is authoritative and the frozen file is untouched.

## 9. Follow-on queue

At closure: **0 issues created after cutoff 3** (`2026-10-23T07:54:25Z`).
Any later issue is follow-on work; it does not reopen this claim.

## 10. Gate output

Paste of the closure gate and the §8 checks, with the amended latest-disposition
check explained where the literal historical scan differs. See the final
message for the pasted output; the same commands are reproducible with
`pnpm audit:pdfcraft-closure`.

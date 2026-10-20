# Findings and implementation batches

## C1 issues #2137–#2160

This frozen page has 23 returned records: two issues and 21 PRs; #2143 is
absent. Both issue bodies and all five issue comments were read. The page ETag
and checksum are recorded in the C1 ledger and raw cache. No PR in this range
is explicitly linked to either issue.

- **#2141 multiexport download stalls:** the closed report describes a
  self-hosted Docker/WSL deployment whose follow-up download request never
  starts. A clean upstream Docker reproduction succeeded. Varve's batch export
  and local ZIP save adapters do not use that hosted two-request route, so no
  Varve change is indicated. The linked screenshot/video and Taiga #3666 remain
  unavailable.
- **#2146 invisible SVG text after drag-and-drop:** the only comment points to
  Taiga #3962 and the report has no source SVG. Varve's importer creates text
  nodes and preserves inline family, size, weight, and anchor styles, but the
  reported invisible render has not been reproduced in a real browser. Nested
  `tspan` styling/positioning remains a separate text-fidelity limitation. The
  issue stays open as a reproduction and fixture lead; inline-style support is
  not treated as proof that this report is fixed.

The 21 PR records remain distinct from issue coverage. Taiga references from
PR descriptions do not establish resolution for #2141 or #2146.

## C1 issues #2161–#2184

This range spans two frozen pages with all 24 records present: 14 PRs and ten
issues. All ten issue bodies and 43 comments were reviewed; PR records remain
separate. #2163 still needs a direct check that the editor exposes frame-to-
component conversion; #2164 is an offline-help/template product opportunity;
#2165's selection-handle recalculation and the commenter's pivot control are
distinct feature decisions; #2166 is localization investment; and #2167's
fixed-prototype-object behavior has no matching Varve feature route. #2170
concerns hosted sign-in labels absent from Varve. #2177's middle-click image
paste crash remains an exact browser reproduction lead, while #2178's core
crop route already exists and its remaining ask is discoverability; preserve
the separate JPEG-background comment. #2179's per-screen after-delay
navigation is already served by Varve's prototype trigger.

**#2183 is a concrete input feature candidate:** the shared Varve numeric
expression tokenizer only accepts ASCII digits, so Persian and Arabic-Indic
digits are rejected in artboard/shape numeric fields. Normalize Unicode
decimal digits at a parsing boundary and cover expression signs/decimals with
baseline-failing tests before deciding the repair scope. Taiga #4008 and the
linked screenshot are unavailable. Other unresolved recordings and Taiga
references remain individually listed in the issue ledger/frontier.

The first group established two bounded Varve defects. The initial issue bodies
and linked fix history were read against Varve SHA
`5172718c6f0f2597466cd08d0839b53ccafefbd2` on 2026-10-19. Their full issue
records still enter the C1 paginated inventory.

## C1 issues #1801–#1848: theme metadata, editing interactions, and file routes

The two completed research assignments covered 45 page records: 31 PR records
and 14 issue reports. All 14 issue bodies and 33 issue comments were read. The frozen
inventory has no record for #1810, #1821, or #1842; these gaps are retained in
the frontier. The 14 issue threads contain 33 comments. Taiga pages
#3226, #3233, #3237, #3259, and #3072, as well as
several linked images and videos, remain inaccessible.

#1803 identifies a real website polish opportunity: the browser `theme-color`
metadata was selected only by the device color preference, even when a visitor
had explicitly chosen the opposite Varve theme. The site now updates its
Safari-facing metadata from the same pre-paint theme state and on theme changes,
while preserving media-based behavior when JavaScript is unavailable. This is
covered by a website browser regression; Safari's visible browser chrome still
requires a Safari-specific visual check.

#1793's import-progress enhancement is in implementation: File reads and
parser/import work are distinct stages, counts describe completed files, the
latest completed filename is labeled, and no unsupported ETA is shown. Focused
unit tests pass; the real-browser preparation screenshot and artwork import
check are queued through the heavy-task lease.

Other reports were assessed individually. #1806, #1809, #1811, and #1829 are
substantially handled by existing Varve routes; #1802 and #1848 concern external
server installations/identity; #1817 and #1830 are localization product
decisions; #1808 is a specialized SVG mesh-gradient support decision; #1818's
Shift-vertex crash remains unreproduced and is distinct from any future
additive-marquee interaction; #1831's touch scrub discoverability needs an
interaction decision; #1837's PDF/component scale request is a distinct feature
decision; and #1838 concerns Penpot's native `.penpot` round-trip, which Varve
does not implement. No issue was excluded solely by title or label.

For #10572, Penpot's open umbrella tracks variant referential-integrity errors
that block later saves and have no repair path. The invalid `variant-id`
reference case maps to Varve's `FrameNode.variant`, although Penpot's
`Property=Value` naming/container contract does not map to Varve. Varve's
`setVariantForInstance` accepted unknown IDs, document validation did not flag
them, and rendering silently resolved the component defaults. A regression
test failed on the baseline with `validateDocument(...).valid === true` for a
missing variant ID. The bounded repair clears only the invalid instance
selection, preserving the component and instance; malformed variant
collections are sanitized, while valid entries and selections remain intact.
PR #11983 and the other linked Penpot work were inspected as source
history, not treated as Varve implementation requirements.

Acceptance is that an unknown instance variant is rejected at the mutation
helper, flagged by document validation, and cleared during decode; the
component/master and property defaults remain intact, and a save/reopen keeps
the recovered document valid. No schema or wire-format migration is needed.
Validation adds a variant lookup only for component instances, with no render
hot-path change. The website has no claim about corrupt-file recovery to update;
the browser demo will receive the shared editor fix through the normal verified
master deployment.

For #9816, Penpot chose to keep imported/legacy token collisions visible as
broken and block unsafe references rather than reject or migrate the whole
library. Varve rejects exact duplicate paths at storage, blocks prefix/group
collisions during import and update planning, applies merge plans transactionally,
and reports export collisions instead of overwriting an existing value. The
focused route tests passed. This Penpot migration choice does not establish a
Varve defect; no product change is justified by the evidence inspected.

| Finding | Penpot evidence | Varve behavior/reproduction | Priority | Owner | Engineering status | Validation / review / integration |
|---|---|---|---|---|---|---|
| Dangling component variant selection | #10572, #10606, PR #11983 | Baseline accepted an unknown `FrameNode.variant`; open silently fell back to defaults; repair now removes the stale selection. Penpot name/container rules do not map to Varve. | P2 data integrity | Coordinator | Implemented; independent review clear; affected validation incomplete because `@varve/editor` unit lane is terminated before downstream package unit lanes | Baseline regression failed; recovery and codec save/reopen tests pass; scene suite 3,354 tests pass |
| Component definition with a missing or non-frame master root | #12186 | Varve validation did not check `ComponentDefinition.masterRootId`; instance creation throws for a non-frame/missing root, while propagation silently skips it. A decode/repair regression is now added; final validation is pending. | P2 data integrity | Coordinator | Implemented; independent review clear; affected validation incomplete because `@varve/editor` unit lane is terminated before downstream package unit lanes | Repair removes the unusable definition and clears instance links while preserving scene nodes; no schema migration; scene suite 3,354 tests pass |
| Imported token-name collisions | #9816, #9584, PRs #9034, #9799, #9950 | Storage, import, update, apply, and export routes reject/block/report collision cases; no unsafe overwrite reproduced. | — | Coordinator | No Varve change indicated by inspected evidence | Five-file focused suite passed; broader corpus review remains |

## C1 issues #409–#480: contributor setup, component handling, and historical reports

Actual issues #413 and #463 were read with all comments. #413 documents a
broken Penpot test-environment compose setup that was replaced; related PR
#415 confirms the environment refactor, although the exact Redis failure cause
is not stated. #463's reporter later said the compose worked as-is and
suspected local setup. Varve has no server-backed Docker Compose contributor
environment or Java backend, so neither report establishes a Varve product
defect. All other returned records in these number ranges are PRs, not
standalone issue assessments. PR comments #427, #432, and #473 and the four
number gaps #458, #459, #462, and #475 remain explicit frontier items; direct
GETs for the gaps returned 404, which does not prove deletion.

The paginated C1 listing omitted issue #437 even though a direct GET after the
crawl returned it with `updated_at` in 2023, before the C1 cutoff. The complete
body and three comments are retained as a supplemental assessment, outside the
page-derived census so the pagination record remains auditable. Varve already
supports locally installed Wasm plugins with permission checks and undoable
writes; first-class Python/JavaScript authoring remains a product decision.
The issue's closing link to Discussion #462 appears unrelated and remains in
the evidence frontier. This omission is a coverage anomaly to investigate,
not evidence that the issue was created after C1.

## C1 issues #481–#696: import, editing, rendering, and hosted-workflow reports

The page-derived ledger now contains 148 individually reviewed issues through
#696; all issue bodies and captured comment pages were read. The separately
recovered #437 brings the unique assessed issue IDs to 149. PR records remain
excluded from issue coverage totals. Numeric gaps and inaccessible or
unreviewed linked evidence are recorded in `frontier.ndjson`.

Several cross-cutting candidates need direct Varve repros before any repair:

- Text entry: #656 (CJK IME), #669 (French ê/ë dead-key), and #688 (Firefox
  circumflex) remain separate input conditions. Varve has composition
  lifecycle protections, but no real browser/OS tests establish each route.
- Canvas rendering and transforms: #539 (shadow after zoom), #551 (held-arrow
  disappearance), #644 (shape shadow spread), #659 (canvas blur versus crisp
  export), #671 (masked image during keyboard nudge), and #646 (grid snap after
  page duplication) are candidate regressions, not confirmed Varve defects.
  Pixel-reuse cases require the full-redraw hash oracle; visual parity cases
  need actual browser renders.
- SVG and export: #546/#1532 preserve external-editor clipboard and complex
  SVG-text conditions; #613 needs a representative heavy SVG; #673 combines
  export errors, output validity, and handoff discovery, with its source file
  unavailable. No export defect has been reproduced in Varve.
- Persistence and history: #623's Penpot mask fixture was lost and its failure
  occurred in a server autosave path absent from Varve. Varve's local unmask,
  transaction, save/reopen, and recovery route is adjacent and merits a
  resilience check. #649's undo-before-closing-color-picker case also needs a
  live transaction check.
- Other bounded candidates include #543 proportional downscale, #594 thumbnail
  text alignment, #621 path size lock, #689 short-viewport tool reachability,
  and #693 making imported document images reusable. Each remains unverified or
  a product decision in the issue ledger.

Many historical reports are already served by Varve workflows: #545 local
document backup/import/export, #547/#676 moving files between projects, #563
per-corner radii, #589 SVG file import, #609 image aspect lock, #620 icon
packs, #634 architecture docs, #692 crop, and #670 plus/equal zoom input.
Hosted identity, email, team permissions, LDAP, and deployment reports have no
matching local-first product route. Feature requests such as palette file UI
(#601), cross-page paste-in-place (#617), local font registration (#582),
primitive-to-path editing (#658), and public libraries/templates (#562/#630/
#690) are recorded as product decisions rather than defects.

## C1 issues #35–#96: early product and interaction reports

The first three chronological batches after the seeds cover 60 actual issues
from C1 (PR records #78 and #83 are retained as linked evidence, not counted as
standalone issues). Every issue body and all recorded comments were checked
against the C1 cache. Their per-issue assessments and separate engineering
states are in `snapshots/C1/issues.ndjson`; no issue is marked reviewed by an
automatic classifier.

- #35–#43, #45, #52, #62–#63, #65–#67, #77, #84–#86, #89–#92, and #95 concern
  Penpot's historical Docker development environment, hosted backend, login,
  or account flows. Varve's local-first editor has no corresponding user route.
  #77 also contains a separate 2021 minified runtime error that needs its own
  Penpot report and is not folded into the original 2017 preflight issue.
- #44's reverse rectangle/text drag was already handled in baseline by
  `BaseTool.computeDragRect`; #46's project-dialog close action is covered by
  the shared Dialog close contract; #47/#79/#80 grid snapping and per-document
  visibility/snap settings exist; #48/#50 ruler reports describe Penpot's
  measurement/ruler semantics, while Varve separates those controls; #61/#64
  use Varve's deliberate Shift constraint and signed-drag normalization; #68
  uses the same page order in editor and presentation; #71's no-fill semantics
  exist; and #72's ungroup action is present. No corresponding Varve defect was
  reproduced. Several Penpot screenshots/GIFs remain uninspected; see the
  frontier ledger rather than treating them as verified.
- #49 is a confirmed browser-compatibility defect in the baseline shortcut
  map. Chrome and Edge reserve Ctrl+Shift+O for bookmarks/favorites and Cmd+
  Shift+H for Home; Firefox reserves Ctrl/Cmd+Shift+H for History and
  Ctrl+Shift+O for bookmarks. Varve assigned those chords to Home and Outline
  Mode and omitted them from its reserved list. The fix moves Varve to
  Ctrl/Cmd+Alt+Shift+F/O (avoiding Windows' Alt+Shift input-layout switch)
  and rejects the conflicting bindings in browser keymap capture and import
  while preserving native desktop overrides. The live-browser
  regression and affected validation remain pending. Primary references:
  [Chrome](https://support.google.com/chrome/answer/157179?hl=en),
  [Firefox](https://support.mozilla.org/en-US/kb/keyboard-shortcuts-perform-firefox-tasks-quickly),
  [Edge](https://support.microsoft.com/en-us/edge/keyboard-shortcuts-in-microsoft-edge),
  and [Windows input-layout shortcuts](https://support.microsoft.com/en-us/office/languages/switch-between-languages-using-the-language-bar).
- #51 says whole-project HTML export was absent upstream. Varve exports design
  artifacts and motion CSS/Lottie; a full HTML site export is outside its
  current document-delivery workflow. Treat this as a product-scope decision,
  not a defect or automatic parity request.
- #55's skipped Penpot revision numbers reflect monotonic saves, while
  Varve's visible history uses semantic labels. #56 explicitly describes
  restore-as-new-revision semantics, which Varve should preserve.
- #57, #59, #60, #70, #74, #75, and #88 concern tool naming/affordances,
  positioning, path provenance, text opacity, measurement-label contrast, or
  reusable assets. Varve already covers the relevant core route for #57/#60/
  #88; #59, #74, and #75 retain targeted visual/accessibility or text-opacity
  reproduction edges; #70 does not establish a need to preserve creation
  provenance. Those open edges are not represented as confirmed defects.
- #81/#87/#93/#94/#96 are already covered by Varve's Pages terminology, zoom
  control order, release lifecycle, GitHub Actions, and setup documentation.

The attachments and links not yet inspected are recorded explicitly in
`frontier.ndjson`, including the browser shortcut references for #49, the
related #50 edge from #82, the inaccessible #89 images, and legacy screenshots
or GIFs whose detailed repro is visual. C1 remains partial and C2 is unfrozen.

## C1 issues #97–#192: setup and project-workflow reports

Number ranges are not issue counts because GitHub's issue endpoint also
returns PR records. Independent reviewers checked the complete bodies and
captured discussion for the actual issues in these ranges: #99, #126, #132,
#139, and #182. The remaining records in the reviewed intervals were PRs and
remain available as linked evidence rather than standalone issue assessments.

- #99 is a historical Penpot backend secret-hashing startup failure. Its
  comments point to a supported Docker development startup path, but do not
  confirm that the reported `lein` failure was reproduced or fixed. Varve has
  no corresponding Clojure backend or account-secret path.
- #126's empty builtin icon list was explained upstream as an intentionally
  unbundled sample collection; Varve's local icon cache likewise starts empty,
  with a bundled starter pack that users explicitly install. No data loss or
  missing import route was established. A first-run auto-install would be a
  separate product/licensing choice.
- #132 (donations) and #139 (Mastodon presence) are project funding and
  communication requests, not editor defects. Varve's existing sponsorship
  and social-surface plans already hold these changes for a project-owner
  decision and verified channel ownership.
- #182 asks how to run Penpot locally. Varve's README and development setup
  guide already provide prerequisites and native/browser run commands.

No additional implementation batch is justified by those reports. Their
body/comment checks, route comparisons, and the still-unavailable #126 image
references are recorded in the per-issue and evidence-frontier ledgers.

## C1 issues #289–#408: deployment and project identity

Independent issue-by-issue review found five actual issues in these ranges:
#296, #301, #302, #307, and #377. All other records in the reviewed intervals
were PRs, kept distinct in the source inventory. Each issue body and captured
comment thread was complete.

- #296 requests runtime deployment configuration for Penpot. Its discussion
  describes a Penpot deployment/build concern; Varve has no backend server or
  deployment-config endpoint, so it does not expose the reported route.
- #301 and #307 describe Penpot's old development Docker environment and
  distinguish it from production images. Varve's supported development setup
  is pnpm/just/Rust with Tauri and a static browser demo; no equivalent Docker
  path is promised. #307 links PR #310, which introduces a test environment,
  though the discussion does not show that every original error was fixed.
- #302 preserves two different conditions: a question about bare-metal
  FreeBSD support and a later FreeBSD/Chromium/AMD GPU zoom crash. FreeBSD is
  outside Varve's declared Linux/macOS/Windows packaging matrix; no platform
  claim or Varve defect is established.
- #377 is a naming opinion without defect conditions or software acceptance
  criteria. Varve naming already follows its brand and product documentation.

No application change follows from these reports. Unavailable PR attachments,
reviews, and external tracker links are tracked only where they could become
evidence for an issue; a PR number alone does not establish a related issue.

## Related component-integrity evidence and open reproductions

The linked C1 component reports were individually read with their available
comments. They describe distinct failure triggers and are not collapsed into
one generic “variant” case. Upstream fix history informed the reproduction
candidates but does not establish a Varve defect. Their current evidence and
engineering states are in `snapshots/C1/issues.ndjson`; the exact next
operation for each unresolved route is in `frontier.ndjson`.

- #10588 reports a text override lost after duplicating and switching variants
  before a master edit. Upstream commit
  [f0698e3](https://github.com/penpot/penpot/commit/f0698e388fbef6273586079d92f984fe28b528db)
  preserves granular “touched” text groups. Varve's duplicate/switch/master
  sync route still needs a direct reproduction. Its linked video and community
  report were not inspected.
- #10109 reports a rotated copy losing rotation after a master geometry edit.
  Penpot's fix is [4ea56e0](https://github.com/penpot/penpot/commit/4ea56e0b8900bc4860d5ae0be2021b278212a373).
  Varve already includes root rotation in component sync and has a rotation
  override regression; parity across a child geometry propagation remains to
  be checked. The linked video was not inspected.
- #10611 concerns plugin mutations; its linked Google technical note was not
  accessible, and Varve has no equivalent plugin API. #10704 and #12197 depend
  on Penpot team/library file identity, which Varve does not model; their
  attached reports were inspected, with adjacent clipboard dependency behavior
  still to be tested.
- #10615 reports an inspector crash for copies with differing variant-property
  counts. Penpot fixed indexed access in
  [47a3158](https://github.com/penpot/penpot/commit/47a3158602099c55f84bb820984d93084c00fefe).
  Varve's multi-selection inspector behavior remains to be exercised.
- #11417 reports child-order reversal after flex-to-grid master changes. The
  Varve propagation path retains stored child order; placement parity through
  save/reopen remains unverified.
- #11656 reports reset behavior for a swapped nested copy inside groups.
  Penpot's nested reset fix is
  [45b8320](https://github.com/penpot/penpot/commit/45b8320ac7321092efc63c57889b37102c635d4d).
  Varve's reset/swap semantics for grouped nested instances remain unverified;
  the linked replay video was not inspected.
- #12144, #12289, and #12364 report Penpot `:missing-slot` failures during
  component swap, clipboard paste, and autosaved duplication respectively.
  Varve represents `instanceSwap` through component identity and has no
  `swap-slot` field, so valid Varve slot mapping, clipboard, and autosave
  behavior must be checked on its own contracts.
- #12186 reports a missing/invalid component main. The linked source file was
  unavailable. Varve's `ComponentDefinition.masterRootId` was not checked by
  document validation, although instance creation throws for a root that is
  absent or not a frame. A decode/repair regression now removes unusable
  component definitions and clears their instance links while keeping scene
  nodes; independent review is clear, but the affected check is incomplete due
  to the editor unit-lane termination described in the continuation checkpoint.

These issues are assessed at the source-evidence level, not completed at the
Varve-applicability level. Their unresolved reproduction edges prevent C1's
relevant frontier from being considered exhausted, so C2 remains unfrozen.

## C1 issues #697–#744: text input, prototype, and editor interactions

All returned records in #697–#744 were classified as issues or PRs separately;
27 actual issue bodies and complete comment threads were reviewed across
#697–#744, with PR records retained as evidence. The issue-level ledger holds
the individual disposition and Varve route. Several reports need direct
browser reproduction before any repair decision:

- Text input keeps three distinct conditions: #701 literal `é` on Ubuntu /
  Firefox, #711 Mac French circumflex dead key, and #688's separate Firefox
  dead-key report. No Varve failure has yet been reproduced.
- Export #705 combines a frame timeout/error and corrupt shape SVG, and is
  linked to #673; verify both exports with an independent renderer before
  treating them as one finding.
- Canvas and prototype candidates include #708 group detachment across frame
  bounds, #715 selection bounds for a flipped mask, #717 zero-distance middle
  button pan, and #718 masked-image overlap hiding a visible hotspot. #718 is
  distinct from #727's code-copy discoverability request.
- #741 may expose a rotation-step wrap bug: NumberField's min clamp appears to
  prevent PositionSizeSection's modulo logic from receiving a negative step at
  0°. This is still a hypothesis; reproduce 0°→359°, 359°→0°, manual edits,
  and undo/redo before implementing.
- Product decisions remain open for independent underline color (#703),
  project movement (#706), keyboard asset insertion (#712), ligature icon fonts
  (#713), document scripting/portability boundaries (#714), and localization
  (#725). Prototype target hints (#721) and scroll/hover integration (#724)
  also need product scope. Varve already provides group opacity (#729) and has
  explicit icon replacement (#723); color-name propagation (#730) and batch
  export (#719) need route-level confirmation.

PR #742 directly addresses Penpot #737 and #741, but does not by itself prove
Varve behavior. Upstream work is evidence for what to test, not an automatic
acceptance contract. Taiga stories, screenshots, and design attachments that
could change these dispositions remain in `frontier.ndjson`.

## C1 issues #745–#816: component state, packaged workflows, and offline behavior

All actual issue records through #816 in the reviewed ranges were read with
complete captured issue discussions; PR entries remain separate records. Their
individual assessment and engineering states are in the C1 ledger. No new Varve
defect is confirmed in this group.

- #745, #764, and #736 depend on Penpot's hosted comment/share viewer, which
  Varve does not provide. Any public feedback or shared annotation system is a
  product and permission decision. #727's code-copy discovery is a separate
  hosted-view request.
- #746, #795, #803, #805, #806, #810, and #812 concern Penpot's exporter
  container, website TLS, hosted registration, self-hosted environment flags,
  OIDC, or license policy; no corresponding Varve runtime route exists.
- #767 mixes standalone Penpot server deployment with desktop package formats.
  Varve already packages AppImage, deb/rpm, NSIS, and dmg; Flatpak remains
  documented as deferred and unvalidated.
- #768's broad component-variant capability already exists in Varve. The
  narrowed hover/focus-to-variant behavior is still a feature candidate: check
  instance text overrides and restoration on leave/blur. #769 describes
  component microinteraction states and must remain distinct from screen
  overlays. PR/title records alone do not prove a fix.
- #771's artboard presets and #797's SVG path editing are already represented
  in Varve. #774's Shift-drag constraint and #775's Enter-on-frame behavior
  still need browser interaction coverage despite matching source mechanisms.
  #776 asks whether global undo should remove an in-progress path point; Varve
  has an explicit undo-anchor action, so this is an interaction/product choice.
- #786 asks for continued editing after a SaaS internet outage. Varve promises
  offline-first editing, but loaded browser-session behavior, cold offline boot,
  and native persistence must be checked separately before closing the evidence.
- #811's Space+drag pan report has an explicit Varve spring-loaded Hand route;
  a Firefox/WebKit interaction regression remains a candidate if that boundary
  is touched. #798's eyedropper report does not establish a wrong-color bug in
  Varve; its browser API path and numeric fallback need separate UX assessment.
- #770 requests curated starter assets; Varve's installed libraries and offline
  icon cache do not establish that a starter design library is present in Home.

Linked external assets, Taiga stories, and PR discussions that remain useful
are retained as unresolved frontier entries. C1 is still in progress.

## C1 issues #817–#864: layout input, import boundaries, and view workflows

The 48-number range contains 26 actual issue records; each issue body and
captured discussion was reviewed, and all PR records remain separate. The
per-issue ledger records full dispositions. Several candidates are useful for
focused Varve validation:

- #823 may expose a real Shift-axis drag gap: SelectTool consumes the raw drag
delta and the `axisLock` state appears to have no production reader. A browser
pointer test must assert constrained world movement at ordinary and rotated
camera angles before deciding on a fix.
- #826 asks about SVGs with a DOCTYPE. Varve strips DOCTYPE before parsing;
confirm a representative Material Design Icons file still imports while
external entities remain blocked. #832 separately concerns preserving common
viewBox whitespace for imported assets.
- #837's blend-plus-shadow rendering report needs a real source fixture and
Canvas2D/native/WASM/export comparison. #838's SVG clipboard handler supports
multi-selection in unit coverage, but actual browser/OS paste behavior remains
unverified.
- #849's Sketch importer is explicitly partial; bitmap placeholders and
approximated symbols, overrides, styles, and constraints are a meaningful
migration limitation. Choose acceptance using representative archives before
expanding it.
- #855 is a public sharing/discoverability request and Varve has no public
viewer/link route. #853 MFA and #858 social previews similarly rely on hosted
identity or server metadata that Varve does not provide.
- #856/#857 have viewport-aware and scroll-anchored Varve menu infrastructure,
but the Penpot screenshots were unavailable. #863's group bounds appear to be
used as prototype hotspots; verify the blank group area with a real pointer
interaction before closing.
- #841 requests current-value arithmetic beyond Varve's absolute math
expressions; #824 is broader application localization. Both are product
choices rather than defects.

Thumbnail selection (#818), device artboard presets (#771), SVG path editing
(#797), rounded image corners (#861), and major opacity behavior (#729) already
have comparable Varve workflows. Upstream PR titles are not treated as proof
that a Varve behavior is correct.

## C1 issues #817–#840: thumbnails, input constraints, and SVG paths

The 24-number range contains 11 issues and 9 PRs; four numeric gaps (#820,
#821, #827, #828) have no C1 record and remain unresolved. Every actual issue
body/comment thread was read. Varve applicability from source inspection:

- #818 frame-to-thumbnail selection is already available in Layers and the
  thumbnail source picker.
- #822 auto-layout exists, but copy-change text hugging needs a focused
  reproduction. #823 is a likely Shift-axis drag gap: SelectTool does not
  constrain raw drag delta although axis-lock state exists. This needs a real
  pointer test, including rotated camera, before repair.
- #826 DOCTYPE removal appears to address safe icon import; validate a real
  Material Design Icon file and ensure hostile entity content remains rejected.
  #832 is a distinct viewBox whitespace preservation question.
- #849 is an actual migration-fidelity gap in the partial Sketch importer:
  bitmap layers become placeholders and symbols/overrides/styles/constraints
  are approximated. Choose improvements against representative archives.
- #837 blend plus shadow needs cross-backend and export evidence; #838 needs
  actual OS clipboard validation for multiple selected SVG objects despite
  handler tests that already cover composition.
- #830/#855/#858 depend on public SaaS sharing or server-side social metadata
  absent from Varve. #824 asks for full localization; #825 asks for keyboard
  library access and is distinct from #712 asset insertion.

The complete #838 comments and linked #546/#6514 were read to keep outbound SVG
copy separate from incoming SVG paste and browser MIME behavior. No relevant
PR title was treated as proof of an issue relationship or fix.

## C1 issues #841–#864: inspector arithmetic, Sketch import, and menus

All 15 actual issues in the contiguous range were read with their complete
comments; the remaining records are PRs. #841 distinguishes current-relative
arithmetic from separate directional/anchored sizing syntax. Varve's NumberField
supports absolute expressions, so relative operations remain a product choice.
#849's Sketch support is explicitly partial and needs a representative archive
set before a fidelity target is chosen. #823/#837/#838 remain the higher-value
interaction/render/clipboard candidates from adjacent ranges.

Varve already provides the core routes for #818 thumbnail selection, #771
artboard sizes, #797 path editing, #861 rounded image corners, and much of
#856/#857 menu placement/anchoring. The home menu and scrolled page menu still
need direct browser validation if modified. #863 group-bounds prototype target
also merits a pointer regression for blank space in nested/transformed groups.
Account MFA, hosted team settings/invitations, and public share previews have
no matching Varve routes. #855 sharing discoverability is a product question
only if a public link flow is chosen.

## C1 issues #769–#816: component states, desktop packages, and offline use

The two reviewed ranges contain 16 actual issue records; every issue body and
captured discussion was read. #768/#769 are now separate: #768 already has
broad component variants in Varve but lacks a variant-switch action for
hover/focus, while #769 asks for named component microinteraction states. Both
are feature candidates. #771 device sizes and #797 SVG path editing are already
present in Varve. #774 Shift constraints and #775 Enter on a selected frame
need browser interaction checks; #776 asks whether undo should consume an
unfinished path anchor before document history.

#786 is particularly relevant to Varve's offline-first promise. The Penpot
report concerns SaaS internet loss; verify a loaded browser session, cold
browser boot, document persistence/reopen, and native desktop separately before
claiming complete parity. #767 is a server-deployment request distinct from
Varve's packages: AppImage/deb/rpm/NSIS/dmg are present, Flatpak remains
explicitly deferred. Hosted registration, OIDC, team comments, and share-link
reports have no current Varve route. C1 gaps #779/#789/#790 remain unclassified.

## C1 issues #793–#816: import, menus, and renderer behavior

The interval has 9 issues and 13 PRs. #795/#803/#805/#806/#810/#812 are website,
hosted auth, self-hosted config, or policy reports without a matching Varve
route. #797's SVG path editing is supported; #861 from a later range confirms
rounded image corners are also available.

#822 auto-layout needs a text-hugging reproduction. #823 is the clearest likely
interaction gap so far: SelectTool applies the raw drag delta although axis-lock
state appears unused. Verify with real pointer input and a rotated camera.
#826's DOCTYPE route strips declarations before parse, but should be checked
with the cited MDI asset and hostile entity input. #832 has a distinct viewBox
whitespace import behavior. #837 needs blend-plus-shadow canvas/native/WASM/
export comparisons. #838's SVG copy path combines multi-selection in unit
tests; actual clipboard paste into Inkscape or a code editor remains unverified.
#849 is a product-level Sketch import fidelity limitation, not an accidental
claim of full support. #856/#857 menu placement and #863 group hotspot bounds
are source-covered but still need browser verification when those routes are
changed.

## C1 issues #865–#888: image storage, components, and text shortcuts

The interval contains 9 issues and 13 PRs, with gaps #874/#875 unresolved. All
issue bodies and full comment threads were read. #867's original self-hosted
asset URI/mount problem and later permission/thumbnail failures are separate
Penpot service conditions; Varve's image assets are local document media. #868,
#869, and #873 are hosted administration, signup, and reverse-proxy reports
without Varve server routes. #881 asks for linked cohorts of selected component
instances, beyond normal component reuse; #882 suggests Windows/WSL contributor
onboarding documentation. #887's author traced their text disappearance to an
experimental Chromium flag, not a confirmed Varve defect.

#886 is the strongest actionable shortcut candidate: the `textBold` action
exists but has no default binding; Ctrl+B currently toggles the left panel,
while context-aware help advertises bold with a no-op. Reproduce in browser
before changing it, and preserve panel behavior outside text editing. Include
selected text range, on/off, undo/redo, and save/reopen. #888's SegmentedControl
buttons are at least 24px high by source CSS, but actual target geometry should
be measured before an accessibility disposition. C1 gaps #820/#821/#827/#828,
#874, and #875 remain explicitly unknown.

## C1 issues #889–#912: libraries, viewport, and color controls

All 13 issue bodies and complete comments in this range were read; 9 other
records are PRs. #890 live text naming is already tested in Varve. #891 points
to a real library-workflow boundary: Varve installs library snapshots and has
no source-refresh operation, so manual update versus live dependency semantics
need a product decision. #894 requests direct hex entry outside the picker,
while the picker itself already accepts hex. #896 Shift additive path-node
selection exists; Ctrl behavior needs a canvas check. #908's initial fit/race
recovery is unverified, and #899's browser-specific rendering report later
became unreproducible upstream. #910 is a toolbar/palette persistence request,
not the same UI as Varve's document/recent palettes.

Varve menus include viewport collision and anchored scrolling support (#856,
#857), group transforms invalidate bounds caches (#895), and offline editing
is a documented goal (#786). These routes still merit targeted browser checks
if changed, but source structure alone is not treated as reproduction evidence.
Hosted member invitations, team settings, and marketing login have no matching
Varve route. Gaps #892/#893 remain unclassified.

## C1 issues #913–#936: SVG editing, path tools, and small-screen controls

All 12 actual issues and their complete captured comment threads were read; the
other 12 records are PRs. Four translation offers/requests and the glossary
thread (#913–#915, #920–#922, #927) have no Varve localization route today and
remain upstream translation work. #933's OIDC name-scope issue is likewise
specific to server identity.

#917 is an SVG import/path-edit/exit crash report; Penpot reproduced and fixed
it, but the source SVG was not supplied. Varve's import→NodeEditTool→history
path is adjacent and needs a real fixture before a defect can be stated. #923
reports Delete asserting while the Path tool has no geometry. Varve's empty
PenTool state should be tested as a harmless no-op with real keyboard input.
#928 requests ellipse arcs/slices and a later comment separately asks for an
opened ring with ratio; both are feature ideas, not bugs.

#931 contains two conditions: an unsupported SaaS signup/footer overlap and a
relevant editor palette control hidden at 1366×768. Test the floating toolbar
at that viewport and keep its related issue #941 pending. No other report in
this range establishes a Varve defect. External recording, screenshots, and
Taiga #1672/#1696/#1249 remain unavailable.

## C1 issues #937–#960: fonts, aspect ratios, and pixel-aligned paths

Ten issue bodies and full comment threads were reviewed in this range, alongside
11 distinct PR records. #940's multiword “Exo 2” font fallback has a specific
React upstream explanation; Varve needs a create/select/save/reopen browser test
for a font family containing spaces. #953's documented Shift consistency is
already reflected in Varve shape creation and ratio-preserving resize; its
linked PR #957 diff confirms the intended modifier. #954 combines two
feature-level requests: a dedicated crisp line tool and snapping stroke edges
or path nodes to pixels/half-pixels. No visual mismatch has been reproduced in
Varve, so neither is classified as a defect.

#941 is a related hosted registration layout issue to #931 and has no Varve
registration route. #947 is specific to Penpot's development Docker/tmux setup;
#943/#948/#951/#952 are translation contributions in an i18n workflow Varve
currently lacks; #958's whitelist configuration is also an account-registration
backend concern. Direct GETs for #942/#959/#960 returned 404 during the range
review, but the frozen page has no records for those IDs, so keep the gaps
explicitly unreconciled. Screenshots, config attachments, and #1693/#1697
tracker stories remain unresolved frontier evidence.

## C1 issues #985–#1008: duplication, export fonts, and panning

The frozen C1 cache contains 8 issues and 11 PRs through #1007. Absent slots
#992/#993/#1001/#1002 and #1008 have no cached record; they remain unknown
rather than being inferred deleted. #986's artboard-duplicate report was
unreproducible for Penpot maintainers; Varve page-duplicate tests do not cover
frame duplication. #990 asks for an operation Varve does not currently expose
(merge/join selected path nodes), so it is a feature decision. #994 combines a
2021 font-render report said fixed, a 2022 reopen, and separate 2025 browser/font
reports; keep them distinct and validate Varve PNG/SVG/PDF/native routes with
exact fonts before classifying. #995 desktop support is already served by
Varve's Tauri app; #996 device frame presets and #1007 Space-held drag pan are
also represented by current workflows. French translation (#985) and LDAP
identity (#1003) have no current Varve route.

## C1 issues #1008–#1032: text editing, panning, and rendering performance

The frozen cache has 5 issues and 15 PRs in this numeric range. Gaps #1008,
#1009, #1018, #1019, and #1030 remain unclassified. #1014's long discussion
contains several separate performance conditions: very high-zoom shadow/blur
cost, later gradient/blur slowdown at ordinary zoom, and a separate zoom-cap
request. Varve has render-path benchmarks but no matching effect-heavy pan/zoom
measurement yet. #1015's Shift axis-lock request overlaps #823's movement
constraint evidence but preserves its own trigger/expected behavior; modifier
conflicts require an explicit interaction choice before implementation.

#1021 requests language-specific text sets for design handoff, not application
translation. #1025 preserves four independent text-edit cases: fill reset after
delete/retype, empty-text blur/Escape handling, Chinese IME preedit on blur,
and undo granularity. Varve has explicit buffering/IME/undo boundaries, but
none of these conditions has been reproduced as a Varve failure. #1029's center
resize is already available through Alt/fromCenter behavior.

## C1 issues #1033–#1056: fonts, transforms, and export controls

Nine issue records and 15 PR records were separated in this numeric range; all
nine issue bodies and complete comments were read. #1035 concerns team-level
custom-font relinking, which has no exact identity/storage equivalent in
Varve; portable custom-font workflows remain a product question. #1036 is a
server font-upload dependency issue. #1040 has a linked upstream fix (#1043);
Varve's flip→node-edit→resize path needs a focused geometry/history check. #1042
lacks a fixture for its text-export error. #1045 requests text-box scaling
semantics, while #1047 asks for decimal/font-size modifier improvements; both
need workflow decisions. #1049's eyedropper offset is a browser/font candidate.
#1050 concerns Penpot's Docker exporter and does not reproduce a Varve failure;
#1051 is a Weblate translation contribution. #1040's Taiga story and report
video, #1049's screen recording/Taiga story, and #1050's Docker file/video
remain unresolved frontier evidence.

## C1 issues #1057–#1080: pointer buttons, PDF, and shared-library workflows

Five issue records and 19 PR records were separated; all five issue bodies and
comment threads were read. #1060 is a high-priority Varve candidate: its report
says middle/right mouse input can resize a selected object. `SelectionOverlay`
currently starts a resize transaction on pointerdown without checking the
button. This is not yet a confirmed defect; verify real pointer events,
context-menu/Escape and cancellation, geometry, and history before changing it.
PR #1077 explicitly closes #1060 and #1063; its diff and the Taiga reports for
#1060/#1063 remain unavailable. #1063 appears covered by Varve's authored
visibility scope and snap-target filtering. #1061 requests focus movement from
Inspector fields after Enter/Escape and merits a product decision. #1062's
single-object selectable-text PDF route is already present; clickable links,
multi-artboard pages, and hidden-layer selection are distinct feature gaps.
#1071 is an authenticated shared-cloud redirect with no equivalent Varve route.
The #1060 GIF, #1062 PDF help/article references, #1063 screenshot, and Taiga
#1866–#1868 remain unresolved evidence.

## C1 issues #1081–#1104: selection tolerance, export bounds, and prototyping

Twelve issue records and nine PR records were separated; every issue body and
captured discussion was read. #1081's primary invisible-text report was traced
to matching foreground/background colors in the supplied design; its separate
eyedropper claim and referenced export/screenshots remain unresolved. #1082's
manual repeat grid and later CSV data-fill request are separate product ideas.
#1089's Docker ARM64 blocker concerns Penpot's server exporter. #1091's
selection-area report needs a measured CSS-pixel/zoom browser test; intended
screen-space tolerance must remain usable for thin geometry. #1092 has distinct
canvas stroke-clipping and multi-format export-bound reports; Taiga #1897 and
videos are unavailable. #1097's union/subtract workflow is present in Varve's
Boolean inspector/export routes pending end-to-end confirmation. #1098's
prototype user-input controls are a product decision. #1101 duplicates #1223's
clipped component menu report and needs a viewport test. #1102 duplicates #724;
Varve has transition runtime directions, but the inspector's direction control
and specific modal/page behavior require verification. #1103 is an upstream
self-hosted Puppeteer export timeout reported fixed, with no equivalent Varve
remote exporter. #1104's physical plus alias already works with Varve's Ctrl+=;
unmodified aliases remain a shortcut product decision. #1085–#1087 returned
404 on direct GitHub issue lookups and have no frozen inventory records; keep
them as unknown gaps. Live Penpot file links, screenshots/videos, Taiga items,
and some external product references remain frontier edges.

## C1 issues #1105–#1128: font fidelity, field focus, and prototype controls

Fifteen issue records and nine PR records were separated; all issue bodies and
cached comment pages were read. #1105 requests Escape to move focus from an
input to the viewport; #1106 is a screenshot-based constraint-state visual
report that needs theme/contrast inspection. #1107's searchable Quick Actions
is partly represented in Varve, while shortcut discovery/result labels may be
follow-ups. #1108, #1110, and #1124 are separate custom-font reports: multi-
family export fallback, installed-font glyph changes in Firefox, and Linux
uploaded-font failures versus a later Windows MIME diagnosis. Each needs its
own font/browser reproduction. #1111's Alt-centered resize maps to Varve's
existing modifier path, pending direct interaction confirmation. #1125 asks for
a configurable prototype background. #1127 requests subpixel dimensions;
inspector input allows fractional values while interactive resize has a 1px
floor, so save/render/export must be checked separately. #1062 is not repeated
here; PDF links/multipage are separate feature gaps already recorded. NextCloud
OIDC, Weblate translation, hosted registration/feedback, and Penpot
multi-container storage reports have no corresponding Varve service route.
PR #1117, #1121, and #1128 are topical leads only; no issue linkage was inferred
without reading the PR diffs. Taiga, screenshot, font binaries, and console
traces listed by the issues remain unavailable frontier evidence.

## C1 issues #1129–#1176: persistence, SVG import, fonts, and input devices

Twenty-one issue records and 25 PR records were separated in this sampled
range; all issue bodies and cached comment pages were read. #1134's Lucide SVG
component preview mismatch and #1135's three distinct legacy SVG/Code Mode
crash reports map to Varve import/preview/editing routes, but attachments and
exact source files are missing. #1139 preserves separate slow autosave,
stale View-mode output, and manual-save preference conditions. #1142 separates
grouped text scaling from uniform effect/stroke scaling. #1153's thick-stroke
shadow clipping report needs a real pixel oracle; #1155 RAWGraphs SVG import has
no fixture. #1158's Safari 15 beta eyedropper crash is upstream-resolved, but
Varve Safari fallback needs verification. #1161 keeps trackpad and Apple Mouse
zoom sensitivity evidence separate; Varve has a dedicated wheel classifier but
no Mac hardware validation. #1171 asks about recent and named swatch discoverability;
#1173 nested artboards map to Varve's nested frames but parent movement still
needs confirmation. #1136 stroke caps are already present; #1156 server upload
size configuration differs from bounded local import; #1159 zoom-to-layer is
available in row actions but direct double-click remains a discoverability
question. Cloud drafts, account recovery, LDAP, translation access, and
multi-tenant telemetry storage have no equivalent Varve service route. PR
#1129/#1150/#1152/#1162/#1163/#1164/#1166/#1167/#1172 are topical evidence
leads only; no links or outcomes are inferred from titles. Taiga stories,
YouTube/GIF attachments, SVG/font files, screenshots, and PR diffs remain
unresolved frontier items.

## C1 issues #1177–#1200: path text, blur, clipboard, and SVG previews

Fifteen issue records and nine PR records were separated; all issue bodies and
cached comment threads were read. Varve already has path text/textPath export
(#1177), case-insensitive font search (#1180), shorthand hex input (#1184),
and layer/background blur controls (#1185), pending parity checks. #1181's path
anchor grid snapping and #1186's nested-component context-menu action need
interaction verification. #1187 is a low-confidence typography submenu
usability report with no exact Varve equivalent established. #1192 needs a
real keyboard tool-switch check against the action registry. #1193 preserves
insecure-context system clipboard failure separately from app clipboard/stale
paste behavior. #1195 custom per-frame tags is a product decision; #1196's
collaborative comments are a different feature from Varve spec annotations.
#1197's team Shared Library upload is outside Varve's current library model.
#1199 imported-SVG drag preview is a high-priority rendering candidate: test
intermediate frames and release using the full-redraw pixel hash oracle. Taiga
#2018/#2021/#2022/#2023/#2026/#2027/#2029, Penpot PR #8656/#2084/#1363, and
referenced videos, fonts, archives, screenshots, and external community guidance
remain unresolved evidence edges.

## C1 issues #1201–#1224: clipboard, wheel input, and floating menus

Fifteen issue records and four PR records were separated; all issue bodies and
cached comment threads were read. #1202's hide-editor-chrome request needs a
Varve workflow comparison; #1203 concerns Penpot Home project IA. #1208's Space
pan report changes from an alleged missing click to a preference, so reproduce
the actual Space+drag sequence before deciding. #1209 preserves Safari OS
clipboard permission denial, stale prior clipboard identity, and shortcut vs
context-menu conditions separately. #1212 fractional stroke widths and #1221
negative letter spacing appear available in NumberField, but scrub/arrow/save/
export must be verified. #1213's V select shortcut is present. #1216 is a
short-viewport Stroke dropdown clipping plus shadow-popover stacking report;
#1217 Shift+wheel horizontal pan maps to Varve's wheel-action branch but needs
real browser input. #1220 text-baseline guides are distinct from box-bound
guides and need product scope. #1223 duplicates #1101 at the menu-clipping level,
but its searched component panel / Windows Chrome conditions remain distinct
from #1101's direct option / Ubuntu Brave report until one shared cause is
reproduced. #1224 asks to navigate to and select a source component. Hosted
exporter and collaborative comment failures have no equivalent Varve service.
Taiga #2030/#2035/#2039/#2040/#2043/#2044/#2053, discussion #517, and the
screenshots/GIFs remain uninspected frontier edges.

## C1 issues #1249–#1272: prototype sharing, navigation, and style libraries

Ten issue records and 11 PR records were separated; all issue bodies/comments
were read. #1249's author realized Get link was required; #1254 remains a
separate report where the author says they did click it, despite maintainers
being unable to reproduce. Both concern hosted sharing, absent from Varve's
local presentation route. #1252's draggable page panel is an IA/space-management
comparison with Varve's PageNav and workspace docks. #1253's text color control
is present in Varve's Typography section. #1257 asks for multi-page prototype
navigation and has separate already-shipped vs later discoverability conditions;
Varve's multi-page playback flow still needs verification. #1268's reusable
effect styles appear covered, while reusable grid configuration is unresolved.
Server demo-user flags, custom S3 endpoints, translation access, and SimpleIcons
catalog inclusion have no corresponding Varve service workflow. #1263's body
explicitly closes #1216, #1186, #1219, #1230 and #1231 and mentions fixes for
#1184/#1180; those are linked upstream evidence, but the PR diff/review still
needs inspection before using it to close related research edges. Gaps #1259–
#1261 returned no frozen records. Taiga #2014/#1822, short link/video, S3 config
references and PR #1263 remain evidence-frontier items.

## C1 issues #1225–#1248: text shortcuts, style history, and viewer masks

Eleven issue records, ten PR records, and two GitHub Discussions were separated;
all 11 issue bodies and captured comments were read. #1226 self-hosted and
#1228 SaaS project rename failures are duplicate reports of a hosted backend
error, not a Varve cloud-service defect. #1227/#1504 request variable gradient
stops; Varve GradientEditor already supports and tests three or more stops.
#1229 is a high-value keyboard candidate: Cmd/Ctrl+B/I/U on a selected text
range remained unavailable for some Penpot users after an upstream “fixed”
comment. Varve has formatting controls and context hints but no global bindings;
reproduce selected-range bold/italic/underline plus undo/redo and preserve
Ctrl+B's panel toggle outside text editing. #1230's typeface asset selector
stale after undo needs shared style/history and reopen checks. #1231 keeps
Cormorant italic editor overhang separate from Red Hat Display export-only crop
and red-X export failure. #1232 includes conflicting fractional-geometry needs;
do not round imported/subpixel content globally. #1238's viewer mask issue was
fixed upstream by scoping SVG IDs to render-id in PR #1239; verify duplicate
mask identifiers in Varve's player. #1245 needs artboard spacing-guide drag
validation; common zoom/ungroup actions in #1244 exist with different platform
aliases. #1242 SMTP signup is a hosted account route. #1236/#1243 are Discussions,
not issues; #1235 returns 404. Taiga #2049/#326/#2055/#2054/#1848/#2290/#2144,
PR #1263/#1292 diffs, font files, screenshots, recordings, and the #1244 help
page remain evidence-frontier items.

## C1 issues #1273–#1296: font field identity and dropdown placement

Six issue records and 14 PR records were separated; all issue bodies and
comments were read. #1273's zoom dropdown clipped at Firefox/Fedora's right
edge and was marked fixed upstream; Varve still needs an edge-viewport check.
#1274 reports a state-identity bug when changing text selection and arrow
stepping font size; reproduce A then B and check undo/redo/save before changing
Varve's NumberField/typography state. Keep it separate from PR #1292's related
but unconfirmed “stuck input” condition. #1275's intermittent internal error
remains unresolved because no operation, document, stack, or stable trigger
was provided; do not exclude it. #1278 Hebrew translation access and #1287
LDAP group filtering have no Varve route. #1284's missing default Docker assets
was resolved as a misunderstanding; Varve already bundles icon/mockup starting
content, though first-project discoverability can be reviewed separately.
PR #1263 body links #1273 to a zoom-menu fix, but viewer context menu vs editor
zoom dropdown may be different surfaces. Gaps #1285 and #1294–#1296 have no
frozen records; Taiga #2041/#2166, PR #1263/#1292, and cited deployment docs
remain uninspected.

## C1 issues #1297–#1320: SVG/text export, viewer overlays, and account cookies

Eight issue records and nine PR records were separated; all issue bodies and
cached comment threads were read. #1298 reports standalone text disappearing
from SVG when filled with an opaque gradient; PR #1314 is topical, so Varve's
SVG gradient/text serialization needs a verified output fixture. #1305's long
Roboto export wrapping mismatch is separate from the mirrored/missing emoji
report subsequently filed as #1348 (Safari/macOS character picker); do not
merge these conditions. PR #1326 body reports a text export fix for #1305 and
label ellipsis for #1311, though its diff remains uninspected. #1311's long
German translated label should be checked in a cramped Inspector against
Varve's real label/input association. #1303's shared comments-mode toolbar
interception is outside Varve's local presentation model. #1299 translation
access, #1310 LAN Secure-cookie auth, #1312 hosted prototype link start, and
#1313 account creation/login are hosted services Varve does not provide; #1313
partially duplicates #1310 while preserving its distinct PostgreSQL/account
creation path. Gaps #1297/#1307–#1309/#1315–#1317 have no frozen issue records.
Taiga #2200/#2222/#2223/#2224/#2225, PR #1314/#1326 diffs and reviews, #1348
comments/screenshots, and linked deployment evidence remain frontier work.

## C1 issues #1321–#1344: PDF merge, export snapshots, and local workflows

Eleven issue records, ten PR records, and two Discussions were separated; all
issue bodies and comment threads were read. #1321's 1px inside stroke was fixed
upstream in linked PR #1322; Varve supports inside alignment but needs a render
and export fixture. #1323 asks for persistent standalone browser storage, which
is not equivalent to Varve's local-first desktop support and needs a product
decision. #1324 is a high-priority multi-artboard PDF merge report: two pages
in a 16-artboard Roboto file had text/kerning errors while individual-page
exports worked. Its private fixture is unavailable; verify browser/native PDF
routes, structure, and independent rendering separately from #1305. #1332's
immediate second export after text edits may capture a stale snapshot; exercise
rapid edit→export independent of autosave. #1333's team/library/version/webhook
API is a product/API contract decision. #1335's mobile shared prototype lacks
a public reproduction; only local player viewport behavior maps to Varve. #1336
frame presets while drawing already exist; #1342 text-to-outline conversion
exists and needs output/undo confirmation. #1338 requires real Font Awesome
font files to assess face mapping. #1341 local no-account work is supported in
Varve desktop, while standalone persistent web and hosted collaboration remain
separate. #1329/#1330 are Discussions (tiled fills and negative tracking); #1328
was absent from the frozen listing and direct fetch errored. Taiga
#2234/#2266/#2223, PR #1314/#1326 diffs, private PDF/video/font fixtures and the
external #3884 reference remain frontier work.

## C1 issues #1369–#1392: preview bounds, page persistence, and large-document recovery

Twelve issue records, eight PR records, three Discussions, and one missing
numeric slot were separated. All issue bodies and cached comments were read.
#1369 duplicates #1267's Minio/S3 server configuration request and is not a
Varve service route. #1373's clipped component-library preview for tall,
masked/Boolean content is applicable to Varve thumbnail/containerPreview bounds
but has no available private fixture. #1374's deep layer-tree naming/highlight/
scroll problem has a later claimed fix; Varve layer-tree accessibility and
virtualization need a browser comparison. #1377's duplicated page with Auto
grid values saved with an error then lost edits on reload is a direct persistence
candidate. #1379's nested NAV group selection crash is a separate, file-specific
selection robustness case. #1391 is a distinct large image-rich document report
where edits to text/font/position/nudge appeared Saved but reopened stale; keep
separate from #1377's Auto grid trigger. #1380's non-root base URL support only
maps to Varve if hosting the editor below a subpath is supported. #1381 inline
text hyperlinks in PDF require a rich-text schema/product decision; shape and
prototype links are distinct. Layered fills/strokes (#1389) appear supported;
server deployment, Nginx upload, and Podman user-admin routes are not Varve
workflows. #1371/#1372/#1388 are Discussions, not issues; #1387 returns no
frozen record. PR #1326's upstream layer-label fix and #1363's import failure
fix are separate from the above seeds. Taiga #2345/#4334/#2359, private files,
PR #1363/#1459 details and screenshots remain frontier evidence.

## C1 issues #1393–#1416: component sync, mobile views, and malformed archives

Eighteen issue records and two PR records were separated; all issue bodies and
comments were read. #1393's component sync concern maps to Varve's per-property
override baseline and requires a master-color update while instance text/font
are overridden. #1396 and #1397 share mobile view-mode bottom-strip symptoms but
preserve white vs fullscreen-black conditions; Penpot could not reproduce and
Varve needs mobile browser emulation. #1398's anonymous read-only workspace is
a hosted sharing/security feature separate from local prototype playback.
#1399's list styles appear in Varve TextNode/Inspector/render routes. #1400's
multi-weight behavior depends on no selection versus active collapsed caret;
reproduce before changing transient text-format state. #1405 canvas artboard
label rename and #1406 catalog rename are UX features; #1411 stale Inspector
values need artboard→artboard and object→object browser cases. #1412 is a
high-priority malformed archive candidate: a linked-library `.penpot.zip`
failed on malformed geometry while a corrected file imported with one shape
missing. Test partial recovery and actionable diagnostics before deciding
whether to change import semantics; source archives are unavailable. #1408
matches Varve's raster-locked/SVG-unlocked resize distinction; #1413 numeric
gradient rotation exists but its text fill route remains unverified. Hosted
export outages, auth/session settings, Docker login and service availability
are not Varve backend routes. Gaps #1394/#1407/#1414/#1415 have no frozen
records. Taiga #2379/#1056/#2387/#5733/#2390/#2393/#2394, private screenshots,
archives and PR #1395/#1401 patches remain frontier evidence.

## C1 issues #1705–#1728: SVG compatibility and hosted workspace requests

The returned range contains 24 records: 7 issues and 17 PRs. All seven issue
bodies and captured comments were reviewed; the ledger preserves PR records as
linked evidence rather than issue coverage. #1706/#1688's simple SVG text case
is already supported, while complex text runs need the unavailable source SVG
before fidelity can be judged. #1720's transparent-space report maps to a
concrete compatibility opportunity: preserve blank SVG viewBox/canvas bounds
through Varve import and paste. Penpot PR #1898 (merged as `92d7521`) retains
the root bounds with an invisible rectangle. Varve's parser applies viewBox
transforms, but the reported SVG fixture is unavailable and no defect is
confirmed; reproduce with a faithful inset-geometry fixture before changing
import behavior. #1714's project search already exists; a no-preview list view
remains a product decision. Team permissions and LDAP invites (#1709, #1710,
#1723) have no matching local-first server route. #1724 was resolved upstream
by storage configuration. Attachments, Taiga references, and remaining linked
issue records stay in the frontier or inventory for separate assessment.


## C1 issues #1729–#1752: component workflows and editor interactions

The returned range contained 21 records: 11 issues and 10 PRs; numeric slots #1745–#1747 had no records. All 11 issue bodies and their 26 comments across 11 threads were reviewed. #1730 zoom shortcuts, #1735 fixed-gap distribution, and #1738 component swapping map to existing Varve workflows. #1733 modifier forwarding exists in SelectTool/InteractionContext, but its shared Shift-axis behavior remains tied to #823 browser verification. #1732 grid snapping during component drag needs reproduction. #1734 nearby object measurements overlap MeasureOverlay/SpecPanel but the always-visible presentation is unverified. #1731 asks specifically for a reusable effects library; the EffectStyle model exists without a user-facing save/browse/apply workflow. #1736 asks for reverse instance-to-master synchronization, while #1737 requests quick master navigation and clean-instance editing; both are component workflow opportunities and need explicit override/conflict semantics. #1742 concerns a sign-in screen absent from Varve. #1749 asks for external video in prototypes, which remains a product decision with remote-media behavior implications. Taiga #1822, #3137, and #3138 remain uninspected; related PR records are retained separately.


## C1 issue #1679: delete guides on matching ruler drop

The complete issue body says the expected action is to drag a guide onto its matching ruler to delete it, while retaining the existing outside-canvas deletion route. Its one complete comment confirms the behavior is a bug and links Taiga #3035, which was not accessible during review. Varve lacked a matching-ruler drop action. The implementation and vertical browser/undo regression are in progress. Real-browser validation also uncovered an adjacent Varve defect: a 24px vertical dock-splitter hit target straddled the canvas edge and intercepted left-ruler drags. The split target has been moved to the panel side; re-run horizontal guide creation/deletion and inspect screenshots before closing this finding.

## C1 issues #1753–#1776: collaboration, identity, branding, and theme reports

The 24-slot chronological range contains five issues and 19 PR records. All five issue bodies and all 33 comments were read. PR records remain inventory evidence and do not count as individual issue assessments. #1753 requests team member mentions and email notifications; Varve has no document-comment or account backend, so this is a collaboration product decision. #1766 requests trusted reverse-proxy identity headers for SAML; Varve has no server authentication route, and the feature needs a security/product decision. #1775 is a self-hosted Docker login/configuration failure with no matching Varve server route. Its linked Gist, video, and screenshots remain inaccessible.

#1758 concerns a Penpot marketing image whose format was mislabeled; it does not establish a Varve website claim defect, and its attachment remains unavailable. #1769 requests dark mode in Penpot project and canvas menus; Varve already supports Light, Dark, High Contrast, and System themes through the shared theme runtime. The linked Taiga #2287 and referenced screenshots remain unresolved. None of these reports justifies a Varve application or marketing change on current evidence.

## C1 issues #1849–#1872: clipboard context, PDF output, and hosted workflows

The reviewer covered all 24 numeric slots as 16 PR records and eight issues, reading every issue body and all 22 issue comments. #1853 and #1854 are duplicate self-hosted backend-log questions; #1855 and #1868 concern OIDC/team invitations; #1862 is a translation contribution request; and #1869 requests upstream multi-tab navigation. None maps to a current Varve server or editor defect. #1871 describes an old Penpot PDF-text regression resolved by a subsequent release and softer raster images tied to downsampling; no current Varve defect is established. #1870 explicitly attributes its clipboard failure to direct HTTP access. Varve already fell back across event/API/native transports, but its async read failure was silently collapsed into an empty clipboard result. A focused improvement now preserves the distinction between insecure origin, denied, unavailable, and empty clipboard states for the explicit plain-text paste command. Website marketing claims do not change; the clipboard system doc now records the host requirement. Taiga #2266 and linked attachments remain frontier evidence.

## C1 issues #1873–#1896: text export, text styles, and browser history

The reviewer covered 24 contiguous records: four issues and 20 PRs, with all 13 issue comments read. #1876 is a resolved upstream PDF-text regression; Varve already has PDF text capability handling, though stronger structural/rendered-output assertions remain a useful adjacent validation opportunity. #1879's Penpot text-style save error was not reproduced upstream and its private file evidence remains unavailable. #1882 was confirmed by the reporter as a Cloudflare SSL configuration issue. #1891 reports MacOS/Brave Magic Mouse horizontal swipes navigating back out of the editor; Varve has overscroll and overflow protections, but the exact hardware/browser behavior and preservation of canvas panning remain unverified. PR-linked Taiga tasks, PR discussions/reviews/commits, and the reported platform case remain in the frontier.

## C1 issues #1777–#1800: invitation workflows, import progress, and localization

The chronological interval contains 23 returned records (19 PRs and four issues); #1781 is absent from the frozen inventory and remains a numeric-gap frontier item. All four issue bodies and all 15 comments were read. #1784 and #1785 concern self-hosted account verification and team invitation email/JWT behavior, which have no Varve server identity route. #1795 is a volunteer offer to localize Penpot into Italian; adding a localization pipeline is a product and infrastructure decision. Their attachments remain unresolved where unavailable.

#1793 is a product-improvement candidate, not a reproduced Varve defect. Penpot reports unclear import stages, weak progress visibility, and delayed license context. Varve already exposes nonblocking batch progress, filenames, cancellation, and per-file failures. A worthwhile bounded enhancement is truthful stage and per-file progress for long multi-file/library imports, with no estimated completion time unless supported by measured work. Licensing guidance only applies if licensed library installation becomes a Varve workflow. Taiga #3223 and the screencast remain unresolved; #12340 and PR #12192 are separate C1 records to review individually. No current marketing claim needs correction; website guidance can change if the progress enhancement ships.

## C1 issues #1897–#1920: security contact, PDF image quality, and uploads

This chronological range has five issues and 19 PR records; all five issue
bodies and 73 issue comments were reviewed. #1897 asks for a public security
contact and does not disclose a vulnerability; Varve already documents
coordinated disclosure. #1899 reports blurry raster images in large-artboard
PDFs. Varve has output-PPI controls and effective raster-PPI diagnostics, so
the report is a validation lead, not a confirmed defect. Validate browser and
native output at representative page sizes and densities before changing
quality behavior. #1905 reports Penpot SVG exporter buffer failure and a later
6x PNG timeout that was subsequently resolved; the attached reproduction was
not available for inspection. Large, complex Varve exports remain a useful
targeted validation opportunity. #1917 concerns self-hosted upload and NGINX
asset-path configuration, with no matching Varve hosted-upload route. #1918
was a Penpot UI typography decision and does not establish a Varve legibility
problem. Linked PR #1915's discussion and referenced Penpot PR #1996 remain
uninspected; Taiga #3220/#3422 and the private security report remain
inaccessible.

## C1 issues #1921–#1944 and linked #2011: SVG color and guide workflows

This range has six issues and 17 PR records; all six issue bodies and 27
comments were reviewed. #1922 was traced to the reporter's Chrome minimum-font
setting; #1925 was unreleased Docker image timing. #1930's guide deletion had
already shipped upstream and Varve now supports deletion through selection,
context menu, keyboard, and ruler drop. Its separate guide-to-scene snapping
idea remains a product candidate. #1935 overlaps Varve's existing centered
resize behavior but still needs browser reproduction. #1938 is a localization
infrastructure decision.

#1936 contains three distinct conditions. Its old private Penpot document
imported several artboards at 0.01×0.01 and was reported fixed upstream; the
source file is inaccessible. Its external SVG style-shift report lacks a
source fixture. Separately, commenters connected faint imported SVG lines to
`fill`/`stroke="currentColor"`. Varve's `parseSvgColor` currently returns null
for `currentColor`, and SVG import does not resolve the inherited `color`
property. This is a standards-backed compatibility candidate to reproduce
with controlled fixtures; the source SVG is unavailable. Keep it separate
from linked #2011, whose drawn pen-tool path/round-cap edge artifact has a
separate, unresolved reproduction. PR #1924 and #1940 separately document
upstream component-integrity repairs and are useful comparative evidence for
Varve's earlier document-recovery batch. Taiga #3447/#3645, screenshots, and
the private file remain in the frontier where inaccessible or unresolved.


## C1 issues #1945–#1968: hierarchy, mobile use, and localization

The frozen inventory contains 23 records: six issues and 17 PRs; #1964 is an absent numeric slot. All six issue bodies and their 23 comments were reviewed. #1946 reports loss of grouping when pasting Figma multi-selection SVG. Varve preserves explicit SVG `<g>` hierarchy, but the original clipboard SVG is unavailable, so no loss in Varve is established; add real clipboard fixtures if a source representation becomes available. #1952 narrows a broad mobile-editor request to clipping/unscrollable content and a possible read-only share view. Varve already has responsive workspace behavior and prototype device previews; a public share route would be new product and hosting scope. #1953 requests Portuguese translation corrections and contributor tooling; Varve has no established localization workflow, so this is a product decision. #1959 concerns Java SMTP trust configuration, #1967 a self-hosted S3/NGINX deployment configuration, and #1968 backend notification-email templates; none has a matching Varve server route. Related Taiga #3452, #3455, #3478, and #3502 were inaccessible and remain unresolved frontier edges. The #1946 screenshots were linked but not visually exposed; its source SVG is unavailable.


## C1 issues #1969–#1992: snapping, orientation, and SVG text fidelity

This page range contains 23 records: 10 issues and 13 PRs; #1974 is absent. All ten issue bodies and 49 issue comments were reviewed, plus the one PR conversation comment on #1976. #1990 is a concrete improvement candidate: the attached 1,086,776-byte SVG has 523 text nodes, 966 font-family declarations, and 11 unique family values. The source fixture reproduced lost inline family, size, weight, and anchor styling because Varve read only direct attributes. A bounded parser fix and minimal unit regression are in place; inspector and browser-rendered visual confirmation remain queued. The source fixture checksum is recorded in the frontier. #1971's offscreen snap-target behavior overlaps but remains distinct from #1930 guide-to-scene snapping. #1982 requests a new batch orientation workflow and needs product acceptance. #1989 is substantially served by existing image replacement. #1992 provides only a generic backend error and inaccessible source workspace/logs. Authentication/configuration reports #1979/#1980 and translation contribution issues #1983/#1986 have no matching Varve route. Relevant Taiga tasks and unavailable screenshots/workspaces remain unresolved in the frontier.


## C1 issues #1993–#2016: prototype branching and coordinate semantics

The frozen page contains 24 slots: 16 PR records, seven issues, and absent #2010. All seven issue bodies and all 55 comments were reviewed. #1994 is an authorized product-improvement candidate: Varve's runtime already evaluates boolean conditions and variable-setting actions, but the inspector cannot author variable IDs/values or conditional branches. Implement after verifying playback state reset, persistence, undo, and keyboard/visual behavior; keep #1098 text-entry controls as a separate feature. #2007's upstream PR #2121 applies block formatting to every inserted block; Varve's text replacement currently preserves node-level alignment, but paste-while-editing needs a browser regression. #2008's screenshots show a nested child coordinate mismatch in Penpot, while Varve's inspector labels positions Artboard-relative but reads parent-local transforms; reproduce nested groups and rotated/scaled parents before repair. #2011's private file is unavailable and its separate round-cap hairline was not reproduced upstream; retain it as distinct from #1936 currentColor. #2009 exporter/Redis, #2012 LDAP, and #2013 OIDC reports resolve to self-hosted deployment configuration with no matching Varve service route. PR #2000 is adjacent transform-model context, not linked proof for #2008. Taiga #3630/#3645 and other referenced stories remain inaccessible beyond the unauthenticated app shell.


## C1 issues #2017–#2040: stroke style, crop, and vector snapping

The cached page contains 23 records: 17 PRs, six issues, and absent slot #2024. All six issue bodies and 28 comments were read. #2020 requests an editable hand-drawn appearance for ordinary vector shapes; Varve has freehand drawing and a raster sketch brush, but no general low-fidelity stroke style. This is a feature opportunity requiring acceptance around presentation-scale clarity and editability; keep the separate starter-kit discoverability concern distinct. Its image attachment and Taiga #3643 remain unavailable. #2022's Penpot context-menu crash was fixed upstream; Varve already has a text-style data model but no editor manager for creating, renaming, or deleting styles, a separate product opportunity rather than a reproduced crash. #2031's image-cropping request is covered by the existing non-destructive CropTool and history workflow; its linked demonstration was not cached. #2032 shared-link comments and #2036 MinIO setup have no matching Varve service/deployment route. #2040 reports inaccurate vector snapping, but its pointer conditions are underspecified and the linked video is unavailable. Varve's NodeEditTool does not use shared snapping while pixel-grid snapping exists for object transforms. Reproduce anchor movement across zoom levels and snap settings before considering a node-edit snapping feature; retain reported random drift separately from pixel-grid snapping. Linked PRs #2023/#2030/#2037, Taiga #3056/#3643, source commit `4d2de63374280814d5177ac64196d0dcdcfe00f7`, and unavailable videos remain explicit frontier edges.


## C1 issues #2041–#2064: path hit areas, variable fonts, and resize previews

The C1 page contains all 24 slots: 14 PRs and ten issues. All ten issue bodies and 27 comments were read. #2041 reports path hit-zone asymmetry, which Penpot later marked fixed; Varve's path-distance test is already symmetric, but the supplied video is unavailable, so no browser reproduction is claimed. #2042's fractional nudge route is supported directly by configured numeric increments and tests. #2043 initially requested snapping rendered center-stroke edges, but later said its full/half-pixel snapping behavior had been fixed upstream; a separate Varve stroke-edge target remains only a feature lead, with source images unavailable. #2044's position/size controls and path-corner-radius route, #2047's nested frame structure, and #2049's font metadata handling cover their requests without a reproduced defect. #2045's comments specifically identify Fontsource-installed variable fonts; verify a real variable font through installation, axis selection, rendering, and export before asserting a gap. #2048 is a product/localization decision for Persian/Arabic UI fonts. #2050's alleged viewport-overlay interception and #2061's temporary stroke-width scaling during mouse resize need real browser interaction regressions before repair. Taiga #3690/#3689/#2956/#3109/#3416/#3686/#3687/#3701/#4016 and the supplied images/videos remain unavailable. PR #2056 is adjacent to #2061 but not linked as a resolution; PR #2064 reports one discussion comment whose cache is missing.

## C1 issues #2065–#2088: typography grouping, group reparenting, and rotated gradients

The frozen issue pages contain 21 records in this numeric interval: 17 PRs
and four issues; #2069, #2085, and #2086 have no census record. All four issue
bodies and all eight comments were read. #2073's hosted typography-grouping
bug was fixed upstream; linked PR #2074 inspected the path/name update and
stable React keys, and its thread points to a cherry-pick in #2070. Varve has
local text styles but no published shared-library grouping workflow, so any
style organization UI is a feature decision, not a parity defect. #2078 is a
macOS 12.4/Firefox 102 native emoji-picker crash that Penpot later marked
fixed; Varve's text entry has IME protections, but the platform-specific path
has not been reproduced. #2081 is a Windows 10/Chrome 103 freeze while moving
a child out of a group. Varve has guarded, world-preserving reparenting routes,
but the exact context-menu path needs a live browser reproduction and history
check. #2082's screenshots show a linear gradient visually unchanged after
an exact 180-degree shape rotation; Varve transforms gradient endpoints and
bakes transform matrices, but lacks a targeted 0/90/180-degree rendering
regression. This remains a high-priority visual candidate: compare canvas,
undo/redo, save/reopen, and export before changing the transform path.

The other 17 records are PRs, kept separate from issue coverage. PR #2074
links the upstream typography grouping fix; #2070 is an unmerged backport
whose discussion indicates a cherry-pick; PR #2088's nested-frame auto-layout
feature is already substantially covered by Varve's tested auto-layout
system. The remaining PRs describe upstream library, auth, binary import,
font, hosted collaboration, and UI work without establishing a Varve defect.
Taiga #3712/#3685/#3844/#3855/#3832 returned only the generic application
shell; issue screenshots were reachable, but only #2082's pair supplied a
clear visual comparison. Platform reproduction for #2078 and #2081, the
unmerged #2070 details, and numeric gaps #2069/#2085/#2086 remain in the
evidence frontier.

## C1 issues #2089–#2112: custom font names, stylus input, and layer feedback

This frozen page range contains 21 records: 16 PRs and five issues; #2104,
#2105, and #2106 have no census record. All five issue bodies and all nine
comments were reviewed. #2098's grouped typography asset disappearance was
fixed upstream in PR #2097 by normalizing asset paths before grouping and
editing the stored name; this is distinct from #2073's grouping-creation
failure. Varve has local document text styles but no matching shared Asset
Library grouping surface, so a local style organizer remains a product
decision. #2100 is a corrupted OCI container-ID failure in Penpot's server
compose stack, outside Varve's local app route. #2101's report about apostrophes
in uploaded font names is standards-relevant: CSS Fonts permits a quoted
`<string>` family name. Varve's font-loading and canvas text paths quote and
escape family names, but a browser regression with an apostrophe fixture is
still useful hardening; no source defect is established. #2102 is an iPad
Apple Pencil support request. Varve routes pen pointer events through its
input pipeline and has touch-action handling, but physical iPadOS/Pencil
dispatch, pressure, palm rejection, and Scribble behavior remain unverified.
#2103 concerns a team-avatar upload route Varve does not have; Varve's local
avatar picker already has an explicit accessible label.

PR #2107 was superseded by merged PR #2114 (merge commit
`aa951148606355939a5b9a58bebb05cdfa74dfb6`). Both provide a layer-hover
canvas-outline demonstration; Varve has no equivalent layer-row hover-to-canvas
outline route. This is a concrete improvement to the existing layer workflow
and will be implemented as a separate feature batch with pointer, keyboard,
accessibility, and visual checks. PR #2111 closes #1159's layer-icon
double-click zoom request, which Varve already implements through the
accessible layer icon and `revealSelection({ fit: true })`; its two PR comments
say it works as expected, and its GIF was inspected. A real Varve UI check is
still required before marking the linked workflow verified. Taiga
#3763/#3918/#3954/#3919 and #3929 returned generic application shells; #2103's
primary image was inaccessible, while an alternative menu mock was retrieved
and inspected. Numeric gaps #2104–#2106 remain explicit census gaps.

## C1 issues #2113–#2136: grid workflows, component inheritance, and pointer behavior

The page contains 24 records: 16 PRs and eight issues, with no absent numeric
slots. All eight issue bodies and all 21 comments were read. #2115's F2 layer
rename request is already implemented by Varve's Layers keyboard handler and
batch rename; verify the real UI path before closure. #2117's per-grid-cell
alignment and #2118's split export across grid cells are distinct feature
opportunities with product details still needed for cell semantics, bleed,
constraints, filenames, formats, and resource limits. #2120 reports two-level
component fill inheritance after a main component update; the supplied ZIP is
missing from the frozen attachment cache, so Varve's instance override model
has not been tested against the reported fixture. #2126 is a localization
investment decision. #2127's configurable font API is a possible self-hosted
provider feature, but would change network trust and needs explicit provider,
permission, cache, and failure contracts. #2134's round and bevel joins are
already represented in Varve's scene type, inspector, renderer, imports,
exports, and tests. #2136 asks for hosted demo-user work retention; Varve has
no accounts or hosted demo-user route, and local recovery is a different
workflow.

PR #2114 confirms and merges the layer-row hover outline first shown in #2107;
the Varve feature batch is tracked separately from bug fixes. PR #2111's
comments and recorded GIF confirm the layer-icon double-click zoom behavior,
which Varve already implements. PR #2113 concerns copied frames removing
guides and is comparative evidence for the guide-ruler/copy workflows. PR
#2122's four discussion comments end with confirmation that moving a grouped
shape outside its frame should remove it from the group, then identify PR
#2131 as the superseding fix. Its attached video was retrieved and inspected;
preserve this intentional frame-boundary behavior as distinct from #2081's
reported Windows/Chrome reparent freeze. PR #2121 points back to clipboard
alignment issue #2007, and PR #2128 points to upstream Taiga #1617. Taiga
#3955/#3956/#3957/#3958/#3932/#3629/#1617, the nested-component ZIP, and other
unavailable source evidence remain explicit frontier items. PR #2111's two
comments and PR #2122's four comments are cached outside normal source history
with response metadata and checksums.

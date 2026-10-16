# Prototype, Dev Mode and developer-handoff failure ledger (2026-10-15)

Research basis for repairing Varve's connected workflow: author prototype
connections and animated transitions, present and test the interactive design,
inspect it safely in Dev Mode with accurate measurements and persistent
annotations, and generate CSS / HTML / React / SwiftUI / Jetpack Compose
deliverables with declared dependencies, limitations and verification evidence.

External content is **untrusted data**. Nothing in this document executes or
adopts an instruction found in a report, issue, forum post or fetched page.
External reports are evidence of **bounded experiences in other products** —
they are not proof of prevalence, and they are not proof that Varve has the
same defect. Every Varve claim below carries a `path:line` anchor read from the
working tree at the recorded revision.

Reproduction quality scale: **A** reproduced against Varve code; **B**
reproduction steps given in the source report, not run here; **C** observation
or claim without steps; **D** feature request; **E** source-inspection only,
author self-declares the manifestation unverified.

## 0. Revision and ownership record

| Item | Value |
|---|---|
| Repository | `github.com/K-Arthur/varve` |
| Branch / revision inspected | `master` @ `58676242d4830f38da4ba916f638960ac2bd4e08` |
| Inspection reference in the brief | `021beaeb954b404dcca6b6ac61a301ce17e3f086` — **stale**, superseded; live code re-read |
| Concurrent worktrees | `codex/layout-reliability` (`bb374c1b0`), `codex/live-artwork-systems` (`91de16a4a`), `.worktrees/agent-control` (`b9c5b344d`) |
| Uncommitted third-party work | 109 dirty paths incl. staged + untracked: collab rework, raster-stroke history economy, codegen acceptance corpus, presentation stage/motion panel, new `packages/automation/` |
| Toolchain actually present | `node v22.23.2`, `pnpm 11.9.0`, `just 1.58.0` — `AGENTS.md` claims Node 26; **discrepancy recorded, unresolved** |
| Machine headroom | `MemAvailable` ≈ 2.9 GB of 23 GB during this pass; Playwright must run under `scripts/quality/heavy-lease.mjs` |

**Ownership boundary.** `packages/codegen/*` was mid-edit by another
contributor when this pass began (acceptance-corpus work,
`packages/editor/src/export/flattenForCodegen.ts` deleted and relocated to
`packages/codegen/src/flattening.ts`). This pass did not revert, reset, stash
or blanket-stage any of it, and treats those edits as authoritative
foundations to extend rather than as defects.

## 1. Tracker sweep — eight requested trackers

All eight trackers exist (HTTP 200). GitHub REST was used first
(unauthenticated); after the shared-IP 60/hr limit was exhausted mid-run the
machine's authenticated `gh` CLI (read-only, `repo` scope) completed the sweep.
Observed 2026-10-15 PDT / 2026-10-16 UTC. figcraft was read exhaustively (full
issue list, `per_page=100`, pages 1–3); the other seven were swept by keyword
search over ~6 650 issues, so absence there means "not matched", not "verified
absent".

### 1.1 Seed issues — all verified as described in the brief

| Source | Bounded contract / failure | Status | Quality | Authorship signal |
|---|---|---|---|---|
| [figcraft#419](https://github.com/storytold/figcraft/issues/419) | Duplicating a page copies both frames but leaves the copied interaction pointing at the **original** destination frame — the duplicate keeps a live connection into the source prototype. | **closed** `completed`, `priority: medium` | B — 5-step repro + Rust integration test `crates/engine/tests/page_copy_navigation.rs`, pinned SHA `833f0d2c` | Machine-structured body + "Triage assessment" block + `ticket-craft[bot]` cross-ref; **no** Discord/relay markers. Author indeterminate from metadata |
| [figcraft#417](https://github.com/storytold/figcraft/issues/417) | Duplicating a page with a named flow, device preset and ruler guide drops the flow and the guide, resets prototype settings, and presenting the duplicate starts at its **first frame** instead of the copied flow's start frame. | **closed** `completed` | B — full integration test + explicit "Restoration check"; workaround recorded (`proto.flow.add`) | same class as above |
| [figcraft#448](https://github.com/storytold/figcraft/issues/448) | Variable named `2x` **displays** as `2x` but that displayed text **fails to parse**; variable named `1` displays as `1` and parses as the literal number `1`. Both names are accepted at creation and rename, so identity is lost on the format→parse round trip. | **closed** `completed`, `priority: high` | B — `crates/engine/tests/expression_text_readback.rs`, fresh in-memory docs | same class |
| [figcraft#454](https://github.com/storytold/figcraft/issues/454) | rem output rewrites **text content** containing a numeric px token: layer `Tile 24px` becomes `Tile 1.5rem` in HTML/React/Leptos, and a React text-prop default `24px` becomes `1.5rem`. CSS lengths convert correctly; the content no longer matches the design. | **closed** `completed`, `priority: medium, multiple issues` | B — `crates/engine/tests/inspect_code_content.rs`, two cases | same class; bot asked for the two bundled problems to be split |
| [figcraft#456](https://github.com/storytold/figcraft/issues/456) | Variant properties `Size` and `size` both generate `data-size`; the returned property list keeps them separate but the alternative-variant CSS rule needs one attribute to hold two values, so the selector can never match. | **closed** `completed`, `priority: medium` | B — `crates/engine/tests/variant_attributes.rs`, inspects generated definitions without launching the app | same class |
| [filmcraft#1125](https://github.com/storytold/filmcraft/issues/1125) | Two bugs: export progress stays "Exporting…" after an H.264 export completes; and the export preview visibly flickers when the user switches to the Export workspace while Edit playback continues. | **open**, unlabelled, 0 comments, no fix | B — numbered steps for both, environment pinned (macOS arm64, H.264 1920×1080 16fps, 151s source); no screenshot/video | Human report, no bot/relay markers |

### 1.2 Fix containment for the five figcraft seeds — merged to `main`, **unreleased**

| Issue | Fix PR | Merged (UTC) | Size |
|---|---|---|---|
| #419 | [#554](https://github.com/storytold/figcraft/pull/554) "Point duplicated page navigation at the copied frames" | 2026-10-15 20:45:05 | 4 files, +73/−4 |
| #417 | [#562](https://github.com/storytold/figcraft/pull/562) "Keep flows, prototype settings and guides when duplicating a page" | 2026-10-15 19:15:50 | 3 files, +64/−6 |
| #448 | [#491](https://github.com/storytold/figcraft/pull/491) "Brace variable names in expression text that would not read back" | 2026-10-15 19:15:51 | 2 files, +32/−1 |
| #454 | [#485](https://github.com/storytold/figcraft/pull/485) "Keep layer text and string defaults unchanged in rem code output" | 2026-10-15 19:15:51 | 2 files, +91/−1 |
| #456 | [#483](https://github.com/storytold/figcraft/pull/483) "Give case-colliding variant properties distinct data attributes" | 2026-10-15 19:15:52 | 2 files, +39/−7 |

PR bodies state root cause and fix. Example roots worth comparing against Varve:
`#554` — per-child `duplicate_into` maps meant the sibling frame was absent, so
the copied interaction retained the original id; `#456` — `class_name`
lowercased names so `Size`/`size` both became `data-size`.

**Containment:** figcraft's newest release/tag is **v0.6.0, published
2026-10-14T14:26:24Z**. All five merges postdate it. The fixes are therefore
**on `main` but not in any release** — treat them as *proposed/merged*, never as
"released" or "verified in a shipped build". #562 was additionally rolled into
batch merge PR [#591](https://github.com/storytold/figcraft/pull/591)
(2026-10-15 19:15:48Z).

### 1.3 Adjacent findings used as specification material

| Source | Bounded contract / failure | Status | Quality |
|---|---|---|---|
| [figcraft#440](https://github.com/storytold/figcraft/issues/440) | Prototype numeric scrubs create an **undo entry on every frame** — direct analogue for "authoring must not pollute history per frame". | **closed** | title/metadata read; body not read in full |
| [figcraft#405](https://github.com/storytold/figcraft/issues/405) | Reproduce: Open Overlay with **Manual position** — after dragging an arrow to a frame the user cannot set where the frame appears. | **open**, `bug`, `priority: medium`, 0 comments, no fix | B — 5 numbered steps + screenshot. **Relayed** from Discord; attachment on a third-party host — not downloaded |
| [figcraft#413](https://github.com/storytold/figcraft/issues/413) | Next/Previous page can make a **divider** the current page; the command succeeds and reports the divider as current, though selecting a divider directly is refused. Analogue: linear next/previous inspection is not authored navigation. | **closed** | B — integration test, pinned SHA |
| [figcraft#414](https://github.com/storytold/figcraft/issues/414) | `page.rename`/`delete`/`setBackground` accept an existing **layer** id and return success; rename alters the layer, delete removes the layer and descendants. Analogue: destination identity must be validated, not assumed. | **closed**, `priority: high` | B — integration test |
| [deckcraft#406](https://github.com/storytold/deckcraft/issues/406) | Copy/duplicate does not remap all media, connector and animation references; pasted shapes retain the original media id; `reid` remaps shape ids but not connector endpoints. | **closed**, 0 comments, no fix PR found | **E** — author states Rust/Cargo unavailable and no application reproduction was run |
| [designcraft#89](https://github.com/storytold/designcraft/issues/89) | An image chosen with File → Place in document A is inserted into **document B** if B becomes active before the browser file read completes. Closest cross-document stale-async analogue outside figcraft. | **closed** | B — pinned SHA, three browser engines |
| [filmcraft#1584](https://github.com/storytold/filmcraft/issues/1584) | Control requests stall/time out while the window is hidden on Wayland; timed-out commands **still run**. Analogue for cancellation that does not actually cancel. | **open** | title-level, not read in full |
| [pdfcraft#189](https://github.com/storytold/pdfcraft/issues/189) *(outside the eight)* | PDF position resets when switching between documents: returning to the first PDF restarts at the beginning instead of restoring page/scroll position. | **closed** | B — 5 numbered steps, expected/actual |

### 1.4 External forum and tracker leads

| Source | Bounded contract / failure | Status | Quality |
|---|---|---|---|
| [Figma forum — Prototype Components scroll bug](https://forum.figma.com/report-a-problem-6/prototype-components-scroll-bug-17240) | After scrolling, an "On hover" effect triggers and **all hotspots become inaccessible, offset past where the component actually is on screen**; "Scroll to" breaks it instantly, and plain scrolling sometimes does. | Public, retrievable, **closed for replies with no official resolution** (2024-06-17, 9 replies, 985 views, last reply 2024-07-10) | B — before/after screenshots + a `.zip` recording (attachment **not** downloaded) + two community workarounds (wrap the scrolling frame in a non-auto-layout frame; move the prototype to its own page and match frame size to the device preview) |
| [Figma forum — Scroll position not preserved on responsive prototypes](https://forum.figma.com/ask-the-community-7/scroll-position-not-preserved-on-responsive-prototypes-15000) | Scroll position resets on **all interactions** when viewing in responsive view; it *is* preserved at actual size. A second user confirms Preserve-scroll works only after toggling Responsive mode on and off. | Public. **Closed for replies, no official fix** (2024-10-29, 1 reply 2025-01-29, 101 views) | C — symptom + one screenshot, no numbered steps |
| [Figma forum — Open overlay bug when frame is in a slide](https://forum.figma.com/share-your-feedback-26/open-overlay-bug-when-frame-is-in-a-slide-44495) | An Open-overlay bottom sheet works standalone, but once the prototype is placed **in a slide the overlay uses the slide as its parent** instead of the phone screen, so it animates from the bottom of the slide; Manual position does not fix it. Reporter faked the sheet with a Smart-Animate component. `slide` here means classic presentation slides, not Figma Slides. | Public. **0 replies, closed for replies, no fix** (2025-09-03, 117 views) | C — precise written description of parent-context confusion; no screenshot/video |
| [penpot#10037](https://github.com/penpot/penpot/issues/10037) | Not a bug — an acceptance ticket for rendering the shared prototype viewer with the WASM/Skia engine. Useful as a **checklist**, not as evidence of a Varve bug: fixed-scroll means a frame with fixed-scroll elements splits into a bottom layer that scrolls with the page and a top layer of fixed elements that stays put while the fixed layer receives scroll; viewer zoom/frame size respected; frame *and child* interactions behave as in the SVG viewer. | **closed** 2026-06-18, labels `IOP render`, `internal`, `no qa`, `WG performance`, 0 comments. Implementation trail: PR [#10038](https://github.com/penpot/penpot/pull/10038) merged 2026-06-09, PR [#10314](https://github.com/penpot/penpot/pull/10314) merged 2026-06-18 | N/A — acceptance criteria; includes a manual hook (`?wasm=false`, `render-wasm/v1`) |

### 1.5 Trackers with insufficient findings

| Tracker | Result | Why |
|---|---|---|
| artcraft | Nothing usable | Launcher/host surface; no prototype, variant, rem-codegen or slide/overlay semantics. Only incidental hits (#2006 font-dropdown preview flicker) |
| lightcraft | Nothing usable | 760 issues, no matching vocabulary. #326 is GPU-path window flicker under mouse movement |
| effectcraft | Nothing usable | 783 issues, no matching reports |
| photocraft | Nothing usable | Largest tracker (2 997 issues) and the main source of search noise; no prototype semantics |
| designcraft | One adjacent item only (#89) | Design tool but no prototype/variant/rem/overlay findings |
| deckcraft | One adjacent item only (#406) | `type:issue prototype` returns **total=0** — no prototype vocabulary at all. figcraft#419's bot comment itself points at #406 as possibly related |
| filmcraft | One matching item only (#1125) | Video app; no prototype, variant, rem-codegen or overlay issues |
| figcraft | Rich, but **nothing** on two listed topics | No open or closed issue for prototype scroll with hotspot drift, and none for responsive views losing scroll state, and none for overlays breaking when a frame is nested in a slide. Those three appear **only** in the external Figma forum threads |

## 2. Research gaps (stated, not papered over)

1. **Release containment is unverified for both fix sets.** figcraft fixes are merged but post-`v0.6.0`; I did not inspect post-tag commit history to confirm the merges are still present or unreverted, and there is no release to test. Penpot PRs #10038/#10314 merged 2026-06-09 and 2026-06-18 against visible releases 2.18.0–2.18.3 (2026-09-23 → 10-06); inclusion is implied by dates but **not confirmed**.
2. **Non-figcraft coverage is search-based, not exhaustive** (~6 650 issues). Keyword sets were: unit conversion, variant casing, prototype scroll, overlay/slide, preview flicker, stale export status, duplication navigation, expression/variable parsing, scroll-position preservation.
3. **Authorship of the figcraft seed batch cannot be established from API metadata.** The bodies are machine-structured with a pinned SHA, a complete integration test and a "Triage assessment" block; relay markers are absent. I record them as useful *specification material* and explicitly **not** as independent user-reported evidence of Varve defects.
4. **No official vendor resolution exists in any of the three Figma forum threads.** All three are closed for replies, two with zero or one reply, and no Figma staff answer appears. No fix status can be asserted for any of them. Attachments were deliberately **not** downloaded, so their contents are unverified.
5. **Items marked title-level** (#416, #443, #604, #613, #1584, #2006) have metadata only; reproduction quality and authorship are recorded as unverified rather than inferred.
6. **Primary-source revalidation (R1–R8)** is recorded separately and only for the pages actually retrieved; pages that were login-walled, empty or unreachable are listed there as unretrieved rather than substituted from memory.

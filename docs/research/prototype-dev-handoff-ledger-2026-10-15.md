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
6. **Primary-source revalidation (R1–R8)**: see §3. Pages that were login-walled, empty or unreachable are listed as unretrieved rather than substituted from memory.

## 3. Primary-source revalidation (R1–R8), accessed 2026-10-15

Only what was actually retrieved is recorded. Facts that changed an
implementation decision are marked **(decision)**.

| Source | What it actually says | Effect |
|---|---|---|
| [Figma — Guide to prototyping](https://help.figma.com/hc/en-us/articles/360040314193-Guide-to-prototyping-in-Figma) | Duration is selectable **1 ms – 10000 ms**; a destination **must be a top-level frame, not an object within a frame**; a frame may belong to several flows but has one starting point. | **(decision)** Transition duration bounds and destination validation. Confirms §5's "not every nested frame is a navigable top-level screen". |
| [Figma — Connect your prototype](https://help.figma.com/hc/en-us/articles/360040315773-Connect-your-prototype) | Interaction = trigger + action; details expose **Add action** for more actions on one trigger. Cardinality per object: **any number** of Keyboard/Gamepad, On drag, When video hits; **one of each** On click/tap, While hovering, While pressing, Mouse enter, Mouse leave, Mouse down/up, After delay. On click/tap cannot combine with While hovering. | **(decision)** Grounds the §6 requirement to expose conflicts with reasons. |
| [Figma — Triggers](https://help.figma.com/hc/en-us/articles/360040035834-Prototype-triggers) | Documented triggers: On click/tap, On drag, While hovering, While pressing, Keyboard/Gamepad, Mouse enter, Mouse leave, Mouse down, Mouse up, After delay, When video hits, When video ends. While hovering/pressing return to the original frame on release. "Mouse move inside/outside" were renamed Mouse enter/leave on **2023-11-16** and can no longer be created. | Declared trigger matrix; note Varve's `onMediaQuery`/`onLoad` are beyond the documented set. |
| [Figma — Actions](https://help.figma.com/hc/en-us/articles/360040035874-Prototype-actions) | Navigate to, Back, Set variable, Set variable mode, Conditional, Scroll to, Open link, Open overlay, Close overlay, Swap overlay, Change to (variant switching), video/time actions. Scroll to is the one destination allowed inside the same frame. | Declared action matrix. **Change to** (component state) is absent from Varve's `ActionKind`. |
| [Figma — Multiple actions and conditionals](https://help.figma.com/hc/en-us/articles/15253220891799-Multiple-actions-and-conditionals) | "Every prototype interaction has a trigger and one or more actions"; **unlimited** actions per trigger; "Actions run in the order in which they're listed, from top to bottom"; multiple animations run **sequentially**. | **(decision)** Ordered action execution and visible ordering. |
| [Figma — Scroll and overflow behaviour](https://help.figma.com/hc/en-us/articles/360039818734-Prototype-scroll-and-overflow-behavior) | Overflow: No scrolling / Horizontal / Vertical / Both. Per-object Position: Scroll with parent / **Fixed** / **Sticky**. Fixed objects are moved above other layers and cannot sit under scrolling layers; Sticky is bounded by its direct parent. **Preserve scroll position** vs **Reset scroll position** is a per-frame setting and "a type of prototype state management". | **(decision)** Scroll reset is authored per frame, not a global policy; fixed/sticky have paint-order consequences. |
| [Figma — Create overlays](https://help.figma.com/hc/en-us/articles/360039818254-Create-overlays-in-your-prototypes) | Overlay settings are applied **to the overlay itself, not the connection**, so they are reusable: Position relative to the original frame (seven presets or manual), **Close when clicking outside**, background colour+opacity, transition. **Swap overlay** keeps existing settings, "you can't set a different position for the new overlay", and **is not recorded in prototype history**, so Back returns to the previous screen. Nesting/stacking is **not documented** here. | **(decision)** Divergence recorded: Varve stores position/closeOnBackdrop on the action and discarded them at runtime. Swap-overlay Back semantics pinned. |
| [Figma — Smart animate](https://help.figma.com/hc/en-us/articles/360039818874-Smart-animate-layers-between-frames) | Matching takes into account **both the layer's name and where it sits in the hierarchy**. Interpolates Scale, Position, Opacity, Rotation, Fill. Unmatched destination layers **dissolve in**; unchanged properties are not animated; unsupported cases (drop/inner shadow, layer-to-shape, non-identical texture/noise) fall back to **dissolve**. Overlays do not support Smart animate except swap-between-overlays with matching layers; matched **fixed** layers get no transition. Text-content differences are **not addressed**. | **(decision)** Varve's `matchLayersByName` is **weaker than the primary source** (name only, no hierarchy position) — a defect against §8's "names alone are ambiguous". |
| [Penpot — Prototyping](https://help.penpot.app/user-guide/prototyping-testing/prototyping/) | Triggers: On click, Mouse enter, Mouse leave, After delay (delay only on boards). Actions: Navigate to, Open overlay, Toggle overlay, Close overlay, Previous screen, Open URL. Overlay presets or **Manual** placement, "Close when clicking outside", background overlay black 20%, and a **"relative to"** field opening the overlay relative to the triggering element. Animations: Dissolve, Slide, Push. **Fix when scrolling** lives in Constraints. | Confirms overlay reference-space as an explicit authored choice (the Figma forum overlay-in-slide report is the same axis). |
| [Penpot — Testing view mode](https://help.penpot.app/user-guide/prototyping-testing/testing-view-mode/) | Only boards and their contents are shown; arrow-key/button navigation; **interaction cue** setting (always / on click / don't show); zoom; fullscreen; inspect mode; share link with per-link permissions. No statement about scroll preservation. | **(decision)** Hotspot-hints control and the distinction between prototype-view, inspect and share permissions. |
| [Figma — Dev Mode](https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode-in-Figma) | Inspect shows layout/spacing, properties "as a list or as code", colours, applied prototype interactions, styles/variables, assets, exports. "You can select the language and units to view **in the canvas and generated code**." | **(decision)** Units are one setting affecting canvas and code, not two independent ones. |
| [Figma — Code snippets in Dev Mode](https://help.figma.com/hc/en-us/articles/15023202277399-Use-code-snippets-in-Dev-Mode) | Languages: CSS (Web), SwiftUI/UIKit (iOS), **Compose**/XML (Android). Unit scale is configured via Inspect → "Set unit scale…": **a root font size for CSS rems** or a scale factor for iOS points. Documented units — CSS: `px`, `rem` ("1rem = 16px by default"); iOS: px, pt; **Android: px, dp, sp**. | **(decision)** §9's typed unit model is exactly px / rem (+ root font size) / pt / dp / sp. Compose is a first-class documented target. |
| [Figma — Measurements and annotations](https://help.figma.com/hc/en-us/articles/20774752502935-Add-measurements-and-annotate-designs) | Shift-M measurement is **persistent, visible and shareable**; the Alt-hover measurement "can't be saved and shared". Annotations attach text or layer properties and "stay up-to-date and accurate" when the design changes; preset categories Development/Interaction/Accessibility/Content; visible in Dev Mode by default, hideable. The article says **nothing about exports**. | **(decision)** §10's split between live bound readouts and frozen captured values. Export exclusion is **NOT ESTABLISHED** by the primary source — Varve's policy is therefore stated as its own, not as parity. |
| [Penpot — Dev tools](https://help.penpot.app/user-guide/dev-tools/) | Inspect mode in View mode and Workspace; distances to layers and board edges on hover; per-property copy; Copy as CSS / Copy as CSS (nested); Code tab gives markup (SVG, HTML) and styles (CSS only); export presets. **No unit system or rem-base setting is documented.** | Varve's unit model is ahead of Penpot's; do not treat Penpot as the bar. |
| [React — rendering lists](https://react.dev/learn/rendering-lists) | Elements produced by `map()` need keys; unique among siblings, reusable across arrays; "**Keys must not change… Don't generate them while rendering**"; index-as-key breaks on reorder and React uses the index when no key is given. | **(decision)** Generated React uses stable node-derived keys, never indices. |
| [React — preserving and resetting state](https://react.dev/learn/preserving-and-resetting-state) | State is kept while the same component renders at the same position; discarded when removed or when a **different component type** occupies that position (which resets the subtree); `key` is a positional identity override, "not just for lists". | **(decision)** §12's "preserve local interactive state per instance" requires stable keys, not remounting. |
| [React — purity rules](https://react.dev/reference/rules/components-and-hooks-must-be-pure) | Must be idempotent and side-effect-free in render; no `new Date()`/`Math.random()` in render; props/state/hook arguments immutable after passing; local mutation is fine. | **(decision)** Generated code must not call time/random during render. |
| [SwiftUI — accessibilityReduceMotion](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion) | `var accessibilityReduceMotion: Bool`; "If this property's value is true, UI should avoid large animations, especially those that simulate the third dimension." Availability iOS/tvOS 13, macOS 10.15, visionOS 1, watchOS 6. | **(caveat)** The HTML page is an **empty JS shell**; this came from Apple's own documentation data endpoint for the same symbol. Recorded as retrieved-by-alternate-path. |
| [Compose — semantics](https://developer.android.com/develop/ui/compose/accessibility/semantics) · [api-defaults](https://developer.android.com/develop/ui/compose/accessibility/api-defaults) · [merging](https://developer.android.com/develop/ui/compose/accessibility/merging-clearing) · [testing](https://developer.android.com/develop/ui/compose/testing/semantics) | Standard composables carry built-in semantics; **48dp** minimum touch target, applied by Material components only when they can receive user actions, and Compose **expands the touch target outside the composable's bounds** (use `sizeIn` to avoid overlap); `clickable`/`toggleable` **merge descendants' semantics by default**; `clearAndSetSemantics {}` removes an element and its descendants from the tree; tests assert through semantics. | **(decision)** Compose emitter must emit `sizeIn(minWidth = 48.dp, minHeight = 48.dp)` on generated controls and must not add a redundant `contentDescription` where a text label already merges. |
| [Compose UI releases](https://developer.android.com/jetpack/androidx/releases/compose-ui) · [compiler](https://developer.android.com/develop/ui/compose/compiler) · [setup](https://developer.android.com/develop/ui/compose/setup) | Page header: **Stable 1.12.1**, Beta 1.13.0-beta01 (2026-10-07); 1.13.0-beta01 notes say libraries target **Kotlin 2.2** and require kotlinc 2.2. Compiler page examples use Kotlin **2.4.10** with "this version matches your Kotlin version" and BOM **2026.09.00**. Setup says minimum API level **21 or higher**; 1.10.0-alpha01 notes record moving the default minSdk from **21 to 23**. | **(decision + gap)** Pin Compose 1.12.1 with BOM 2026.09.00 and the Compose Compiler Gradle plugin. **Stable 1.12.1's own minimum Kotlin is NOT ESTABLISHED**, and minSdk is **contradictory (21 vs 23)** in the official pages — a generated project must declare its choice and say it was not derived from an unambiguous source. |
| [MDN — iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) | An empty `sandbox` applies **all** restrictions; without `allow-same-origin` the resource is a **special origin that always fails same-origin checks**. `allow-same-origin` **without** `allow-scripts` still lets a same-origin parent reach the iframe's DOM. "**strongly discouraged to use both allow-scripts and allow-same-origin**" because the embedded document can then remove the sandbox attribute. Sandboxing is useless if the content can be opened outside the frame. | **(decision)** Preview isolation must be a sandboxed frame **without** `allow-same-origin`, so the preview is an opaque origin that cannot reach the editor origin or Tauri IPC. |
| [MDN — CSP sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox) | Same value vocabulary as the attribute; a **document directive**, not supported in `<meta>` or Report-Only. | **(decision)** The sandbox directive must be delivered as a header, not a meta tag. |
| [MDN — Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy) | Origin = scheme/host/port; cross-origin **writes** and **embedding** are typically allowed, **reads** typically disallowed but leaked by embedding; `document.domain` relaxation is deprecated. | Scopes what a preview can and cannot be trusted with. |

### 3.1 Not retrieved from primary sources

- Figma's stance on whether annotations appear in exports — **not stated** in the retrieved article.
- Figma overlay nesting/stacking — **not stated** in the retrieved article.
- Compose stable 1.12.1's minimum Kotlin version; and the minSdk contradiction above.
- The SwiftUI page's own HTML (retrieved via Apple's documentation data endpoint instead).

## 4. Delegated recon runs and retained evidence

Two `workflow` MCP runs of `opencode-v2` workers were executed. No worker had
write access (`mode: "plan"`, read-only), no nested agents or workflows were
launched, and no worker touched the tree.

| Run | Vertex | Workers | Cost | Evidence |
|---|---|---|---|---|
| `mvaewz1n-ui9wr2` | `opencode-v2/opencode-go/deepseek-v4.1-flash`, `plan`, `effort: high`, 4 calls, concurrency 2, 0 retries | `recon:prototype-runtime`, `recon:devmode-codegen`, `recon:annotations-persistence`, `recon:preview-security` | US$0.192 | Result 54 745 B at `workflow://runs/mvaewz1n-ui9wr2/result`; script at `/home/kevina/.local/share/opencode/workflow-mcp/runs/projects/varve-450b1e5bf073/runs/mvaewz1n-ui9wr2.script.js` |

Each worker reported `Findings` / `Contract map` / `Not determined` sections as
requested. **These findings are commissioned but not yet integrated into
implementation** — they are the input to the remaining slices below, and their
`path:line` anchors were taken against working-tree content that has since moved
(this pass landed one commit), so each anchor must be re-read before use.

Also completed: an external-research subagent that produced the tracker sweep in
§1 and the primary-source table in §3.

## 5. Remaining dependency-ordered work

Delivered in this pass: **slice A**, below. Ordered by dependency; each item
names the evidence that would close it.

1. **A — Prototype activation and session isolation.** *Delivered and verified.*
   See §6.
2. **B — Dev Mode measurement and unit soundness.** Axis-correct percentage
   reference; rotated-AABB versus layout box; typed px/rem/pt/dp/sp with a
   configured root font size applied only to numeric lengths; the FigCraft #454
   contract (`Tile 24px` unchanged) as a regression. Closes §9.
3. **C — Durable annotations.** A canonical model in `packages/scene`, stable
   IDs, node-relative anchors, orphan detection on anchor deletion, undo
   integration, one remap point for duplicate/paste, exclusion from artwork,
   prototype and generated output. Closes §10.
4. **D — One codegen path, honest labels, Compose.** Collapse `CodePanel` and
   `CodeGenView` onto the `GeneratedBundle` contract; correct the `css` target's
   "HTML/CSS" label; add Kotlin/Compose through every registry point the devmode
   worker enumerated, emitting resources, semantics, `sizeIn` touch targets and
   a declared verification tier. Closes §11–§12.
5. **E — Reachable authoring and presentation.** Un-gate the `prototype-flow`
   section (`sectionRegistry.ts` gates it on `prototypeMode`, which has no UI
   toggle); connection authoring; the viewer's flow selector, fit/actual,
   fullscreen with a windowed fallback, and hotspot-hint control. **Gated:** the
   new drawn affordances require the AGENTS.md online-research pass and route
   approval before implementation.
6. **F — Preview isolation and adversarial input hardening.** Sandbox without
   `allow-same-origin`, CSP `sandbox` as a header, path/name/escaping safety, and
   the sink inventory from the preview-security worker. Closes §13.

Cross-cutting, not yet started: trigger/action conflict rules with reasons (§6),
overlay placement/backdrop/reference space at runtime (§7), delayed-action
execution (see §6.2), scroll preserve/reset as an authored per-frame setting
(§7), and the ten-fixture acceptance corpus (§15).

## 6. Slice A — delivered

Commit `4a32fbfc0` on `master` (16 files, +1973/−188, 4 new).

### 6.1 Root cause

Hotspot geometry and the screen raster were two independent derivations of one
geometry. `PrototypeScreenView` placed a hotspot from
`node.transform[4..5] + nodeLocalBounds(node)` — the node's own parent-space
translation plus its *local* rect, with no ancestor composition — while the image
came from `generateThumbnail` with `fit: 'fill'`, whose `computeScale` returns
`1`, so the raster was 1 scene-unit-per-pixel of the *content bounds* and was then
stretched into the frame box by `object-fit: fill`. A click was resolved by
passing *element-relative CSS pixels* to `editor.hitTestNode`, which documents and
implements **world** coordinates and additionally folded in the editor's `zoom`
and isolation state, running a document-wide hit test over hidden screens and
other pages. Activation fired on `pointerdown`, so a cancelled drag or a scroll
gesture navigated, and a focusable `<button>` was emitted for every enumerated
immediate child whether or not it had an interaction.

### 6.2 Additional defects found while reading the runtime (not yet repaired)

These are recorded because they are in the same feature and were confirmed by
reading code; they are **not** fixed by slice A:

- **Delayed actions never run.** `applyActionResult` accepts a `delay`, and when
  given one it discards the `ActionResult` and pushes a placeholder
  `interactionId: 'delayed'`. `processInteractions` never passes the action's own
  `delay`, and the presentation poll calls `processDelays` and **discards its
  return value**. `afterDelay` triggers expect a `timeout` event that no caller
  produces. The whole delayed-action path is unwired.
- **Overlay placement and backdrop are dropped at runtime.** `ActionResult`
  carries `position` and `closeOnBackdrop` (and the Figma primary source says
  overlay settings belong to the overlay), but `applyActionResult` stores only the
  target id in a flat array. `dismiss` clears the *whole* stack rather than the
  top overlay.
- **`scrollTo` ignores its target.** It always writes `{x: 0, y: offset ?? 0}`,
  only when `containerId` is present, and discards `behavior`; scroll positions
  are never reset on navigation.
- **`onScroll` triggers match any scroll** — `matchTrigger` returns `true` for
  every `onScroll` interaction regardless of `targetId`, `amount` or
  `visibility`, so one node's scroll fires every scroll interaction in the
  document. `onKeyPress` likewise ignores `nodeId`.
- **Ordering, coercion and bounds.** `processInteractions` returns results in
  document-map order with no priority concept and no per-tick bound; condition
  evaluation returns `false` silently for an unknown variable and mixes strict
  `===` equality with `Number()` coercion; `setVariable` with an `expression`
  builds a variable table containing only the target variable and silently
  yields `0` on failure.
- **Wall-clock timing.** Trigger debounce and pending delays use `Date.now()`.
  §7 asks for a monotonic clock.
- **`PrototypePlayer.tsx` is dead** — exported, referenced nowhere.

### 6.3 Verified

Commands actually run, all at commit `6cae5f7a5`+working tree / `4a32fbfc0`:

| Command | Result |
|---|---|
| `npx vitest run --project node packages/prototype` | **262 passed** (16 files), includes the new 17-test `screenGeometry.test.ts` |
| `npx vitest run --project jsdom packages/editor/src/components/Prototype packages/editor/src/motion/smartAnimateBridge.test.ts packages/editor/src/__tests__/prototypeMode.test.tsx` | **67 passed** (9 files) |
| `tsc --noEmit` in `packages/prototype` and `packages/editor` | **clean** |
| `biome check` over the 16 touched files | **clean** |
| `scripts/audit-emoji.mjs` | clean (5 415 files) |
| `scripts/audit-docs.mjs` | clean (1 149 docs, 822 links, 181 ADRs) |
| `pnpm --filter @varve/ui audit:tokens` | **all 324 pairs pass across 3 themes** |
| `audit-token-usage.mjs` | clean (602 custom properties) |
| pre-commit checkpoint (`.githooks/pre-commit`) | passed; 52 focused tests in the hook |

**Red→green evidence.** `PrototypeScreenView.test.tsx` was written first and ran
**9/9 failing** against the pre-repair implementation; after the repair the full
Prototype suite is 55/55. Two pre-existing tests encoded the defect and were
rewritten as contract corrections, stated explicitly in the commit: the
`PrototypePresenter` test asserted that a bare `pointerdown` forwarded to
`onEvent`, and `smartAnimateBridge.test.ts` supplied a *local* rect to a helper
that was adding the node's own translation to it.

### 6.4 Not verified / skipped

- **Browser E2E was not run.** The planner escalates to a full gate on causes that
  belong to other contributors' changes (`pnpm-lock.yaml`, `scripts/quality/*`,
  a toolchain/dependency upgrade), not to this slice. The escalation is therefore
  recorded, not satisfied: `FULL-SUITE ESCALATION: YES` with reason
  "workspace/toolchain/validation-infrastructure change". No `pnpm verify:full`
  was run and no release certification is claimed.
- **No browser or native rendering was inspected.** The geometry is verified by
  unit and component tests only; `tests/e2e/prototype/prototype-clickthrough.spec.ts`
  drives no hotspot, overlay, scroll target or transition, so it provides no
  coverage either way. A rendered-pixel check that the drawn region matches the
  painted artwork at several scroll offsets, fit modes and fractional DPR remains
  to be written.
- **`packages/codegen` does not typecheck**, on account of
  `packages/codegen/src/svgTextLayout.ts`, which is **untracked** in the working
  tree (another contributor's in-progress file, present in no commit). It was
  not modified.
- The four worker reports have not been integrated (see §4).


## 7. Slice D (part 1) — Compose target and honest labels

Commit pending on `master`, 9 files.

### 7.1 Delivered

- **`packages/codegen/src/compose.ts`** — Android Jetpack Compose (Kotlin)
  emitter through the shared contracts: `composeTargetGaps`, a `GeneratedBundle`
  emitter, and a single-string adapter over it.
  - Units follow the documented Android mapping: **dp** for lengths, **sp** for
    type.
  - A clickable root gets `sizeIn(minWidth = 48.dp, minHeight = 48.dp)`
    *before* `.clickable`, because the documented minimum touch target is 48dp
    and Compose grows the target outside the composable's bounds.
  - `contentDescription` is emitted **only** when the clickable has no text
    descendant, because `clickable` already merges a descendant label.
  - Token aliases are preserved: a fill bound to a design token emits a
    reference into a generated `Tokens` object rather than a flattened colour
    copy, so the alias survives into the target with one place to change.
  - `$` is escaped in Kotlin string literals. This matters more than it looks:
    Kotlin treats `$` as template interpolation, so an unescaped sigil in an
    authored layer name either fails to compile or silently substitutes an
    identifier. The backslash is escaped first so no `\$` can be re-formed.
  - Shapes with no Compose primitive (polygon, star, arrow, line, free path),
    non-shadow effects, horizontal shadow offsets and rotation are reported as
    gaps with fallbacks rather than approximated silently.
  - A nested tap interaction is **not** given an inert handler: only the root
    receives `onClick`, and the nested case is reported with a fallback. This is
    the §11 rule that unsupported interactions are listed, not replaced by an
    inert click handler behind a success badge.
- **Registry**: `GeneratedFileLanguage` gained `kotlin` with
  `text/x-kotlin`; `CodeExportFormat` gained `compose` with its gap function;
  `packages/codegen/src/index.ts` exports the target.
- **`BundleDiagnostic.fallback`** is now a first-class optional field, matching
  `TargetGap.fallback`. Six diagnostic sites in the new emitter previously
  smuggled a fallback through an object spread plus a cast; a diagnostic that
  only reports a limitation is half a handoff, so the actionable half is typed.
- **Reachability**: the Compose target appears in **both** code panels
  (`CodeGenView` and `CodePanel`), and `syntax.ts` loads Prism's Kotlin grammar
  so the output is highlighted as Kotlin rather than falling through to CSS.
- **Label correction**: `CodePanel` labelled its `css` target "HTML/CSS" while
  calling `exportNodeToCss`, which emits a stylesheet with no markup. Both the
  tab label and the readiness copy ("can be exported as native HTML/CSS") are
  now "CSS". `CodeGenView` already had this right; the two panels disagreed.

### 7.2 Pinned toolchain and its provenance

`COMPOSE_TOOLCHAIN` pins Compose UI **1.12.1**, Compose BOM **2026.09.00**,
Kotlin **2.2.0**, minSdk **23**. Provenance: the Compose UI releases page states
stable 1.12.1 and that the 1.13.0-beta01 line targets Kotlin 2.2; the compiler
page pairs Kotlin 2.4.10 with the Compose Compiler Gradle plugin and recommends
the latest BOM. **Stable 1.12.1's own minimum Kotlin is not stated on that
page**, so the Kotlin pin is a declared choice, not a documented floor. The
minSdk choice is disclosed in the bundle's own setup steps, because the official
pages contradict each other (setup says API 21+, the 1.10.0-alpha01 notes record
the move from 21 to 23).

### 7.3 Verification tier — emitted and statically checked, **not compiled**

`kotlinc`, Gradle and the Android SDK are all absent from this machine, and no
Kotlin image is cached for the container engine that is present. Pulling one is a
network/spend decision that was not authorised, so it was not taken. Nothing in
this increment is claimed as compiled or rendered; the bundle says so in its own
diagnostics and setup steps.

What the tests do assert: escaping of `$`, backslash-before-quote ordering,
newline/tab escaping, keyword-safe identifiers, dp/sp formatting, `0xAARRGGBB`
colours, the 48dp modifier order, the semantics-merging rule, the absence of an
inert nested handler, gap reporting for non-primitive shapes, and a resolvable
file (every `Tokens.` reference has a `Tokens.kt`).

**Remaining for a real Compose guarantee:** a compile check with a JDK + Kotlin
toolchain, and a rendered comparison. Both are unverified.

### 7.4 Still open in slice D

`CodePanel` and `CodeGenView` still keep separate target lists and separate
generation switches. This increment makes them *agree* on labels and adds the
new target to both, but it does not yet collapse them onto one registry — the
duplication that allowed the mislabel to exist is reduced, not removed.
`exportIrToHtml` is not yet exposed as an HTML target, so the CSS target remains
a stylesheet fragment and says so.

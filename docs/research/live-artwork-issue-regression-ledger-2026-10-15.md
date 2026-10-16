# Live artwork issue-to-regression ledger (2026-10-15)

Issue trackers were reviewed on 2026-10-15, including maintainer replies and
relevant closed reports. These are evidence about reported behavior in other
products, not findings about Varve. Status and explanations can change; recheck
them before implementation work relies on a fix. Repost or thin reports are
kept separate from reproduced causes.

| Source | Report and verified status | Varve regression target |
|---|---|---|
| [FigCraft #255](https://github.com/storytold/figcraft/issues/255) | Open report: background blur plus drop shadow gives incorrect alpha behavior; changing settings may distort the shadow. | Exercise transparent content, backdrop blur, shadow order, parameter edits, and export parity. |
| [FigCraft #251](https://github.com/storytold/figcraft/issues/251) | Closed as completed in #265: slice preview showed only a checkerboard while PNG/SVG/PDF export was correct; report attributed this to previewing a non-painting slice node. | Preview and export the same page contents and bounds; assert both pixels and clipping. |
| [FigCraft #278](https://github.com/storytold/figcraft/issues/278) | Closed with activity pointing to #280, but the linked drag fix does not explain the report that entering text edit reverted prior edits. Treat the resolution as uncertain. | Interleave geometry edits and text editing; verify transactional history, save/reopen, and recovery. |
| [FigCraft #289](https://github.com/storytold/figcraft/issues/289) | Closed after a maintainer identified missing macOS open-document event handling; a commit registered the handler. File Picker open still worked. | Test save/reopen through in-app open and OS file association on supported platforms. |
| [ArtCraft #2085](https://github.com/storytold/artcraft/issues/2085) | Open Linux crash report while scaling an image beneath keyed video. Maintainer could not reproduce; suspected prior queue-growth fix in EffectCraft 0.8.0 needs reporter confirmation. | Stress concurrent transform/keying/effect renders; bound and cancel superseded jobs. |
| [LightCraft #1145](https://github.com/storytold/lightcraft/issues/1145) | Open measured report: mask-heavy adjustments took 176–332 ms versus about 27 ms without masks; maintainer fix was not visible in the inspected report. | Measure interactive edits with multiple unchanged masks and account for actual cache memory. |
| [LightCraft #8](https://github.com/storytold/lightcraft/issues/8) | Closed in #17: export dialog grew horizontally due to a self-sizing loop; maintainer reproduced and fixed it with remaining-width layout and a stability test. | Check settings/export panel width stability at representative platform scales and font metrics. |
| [VectorCraft #1559](https://github.com/storytold/vectorcraft/issues/1559) | Open report of mirror-axis gap and missing on-canvas editing. Maintainer clarified numeric Options exist for mirror, radial, and grid; double-click editing and handles do not. | Edit all repeat kinds with handles and fields; verify axis, spacing, endpoint rules, and source preservation. |
| [VectorCraft #2066](https://github.com/storytold/vectorcraft/issues/2066) | Open report that some meshes become flat gray; no reproduction details or cause were provided. | Use contrasting point and patch colors; test edits, reload, undo/redo, DPR/zoom, and all export targets. |
| [VectorCraft #1676](https://github.com/storytold/vectorcraft/issues/1676) | Open image-to-mesh report. Maintainer clarified that mesh creation currently accepts filled vector paths only; image conversion is missing. Workaround: mesh rectangle plus eyedropper sampling. | Distinguish unsupported sources from renderer failures; supported creation must visibly change pixels. |
| [VectorCraft #734](https://github.com/storytold/vectorcraft/issues/734) | Fixed in #791: prior crop acted on the artboard, so an image already inside it appeared unchanged; a crop box and numeric controls were added. | Crop images inside and across artboard bounds; test apply/cancel, source restoration, reload, and export. |
| [PhotoCraft #2312](https://github.com/storytold/photocraft/issues/2312) | Open report of blocky/clipped text shadows and streaking. A contributor could not reproduce from the screenshot and requested the document and device details. Cause remains unverified. | Compare live and export alpha on glyph counters, thin strokes, transparent edges, and multiple resolutions. |
| [PhotoCraft #761](https://github.com/storytold/photocraft/issues/761) | Reported drag slowdown with shadows, including when disabled. A map-move optimization reportedly roughly doubled drag speed, but some slowdown remained. | Measure drag latency with effects on/off and overhanging bounds; disabling must stop unnecessary effect work. |
| [PhotoCraft #5719](https://github.com/storytold/photocraft/issues/5719) | Detailed flatten-effects report: default global-light direction, missing pattern content, and effect-inflated gradient bounds. Fix commit referenced; issue remained open when inspected. | Compare flattened output using non-default light, patterns, and gradient fills against the unflattened composite. |
| [DesignCraft #653](https://github.com/storytold/designcraft/issues/653) and [#389](https://github.com/storytold/designcraft/issues/389) | Reports of shadows omitted from object-style creation/application and inherited IDML styles. A PR was reported in progress for #653. | Save, apply, edit, duplicate, and export shared appearance with inherited shadow and explicit local override. |
| [DesignCraft #848](https://github.com/storytold/designcraft/issues/848) | Open measured report: adding one shadow changes other colors across a spread. A partial integration-branch fix limited some blend-view conversion but did not cover all cases. | Shadow one object and assert distant pixels are unchanged across blend/proof modes and transparent parents. |
| [EffectCraft #941](https://github.com/storytold/effectcraft/issues/941) / [#1599](https://github.com/storytold/effectcraft/issues/1599) | Open, reproduced control failure: A/B midpoint changes produced bit-identical output on flat-luminance subjects; a proposed fix remained under parity review. | Sweep midpoint on uniform-color text and shapes; assert live pixels change on CPU/WASM/worker and after reload. |
| [EffectCraft #1595](https://github.com/storytold/effectcraft/issues/1595) | Open export-fidelity report with reference measurements showing a large composed-effect difference despite successful export. | Compare deterministic reference images and structured output, not encoder success alone. |
| [FilmCraft #2142](https://github.com/storytold/filmcraft/issues/2142) and [#2115](https://github.com/storytold/filmcraft/issues/2115) | Reports of missing color metadata on some exports and unresolved Windows ICC preview behavior; control wiring and format-specific status differ. | Inspect exported profile metadata; verify display-profile controls change preview on supported platforms. |
| [FilmCraft #1724](https://github.com/storytold/filmcraft/issues/1724) | Open intermittent near-black frames in repeated Windows hardware-decoded exports; cause not established. | Compare per-frame output across repeated CPU/GPU runs; reject average-only checks that hide missing content. |
| [PDFCraft #645](https://github.com/storytold/pdfcraft/issues/645) | Closed via a fix for PDF export losing soft masks and producing white/black cutouts; some mask formats remained unsupported. | Check alpha edges, masks, and matte handling through export and independent reopen. |
| [PDFCraft #773](https://github.com/storytold/pdfcraft/issues/773) | Closed with fixes for fake table borders and watermark layout, while broader font/vector fidelity remained partial. | Validate actual output geometry in a target viewer and document the remaining fidelity boundary. |
| [DeckCraft #335](https://github.com/storytold/deckcraft/issues/335) and [#282](https://github.com/storytold/deckcraft/issues/282) | #335 fixed silent loss of embedded chart workbooks on save; #282 remains an unverified report of text layout differing from PowerPoint. | Verify source relationships after round trip and compare text wrapping with controlled fonts and widths. |

## Research interpretation

- A report, reproduction, proposed fix, merged commit, and released fix are
  different evidence levels; the table records those distinctions.
- Most actionable failures involve invisible or stale controls, lost source or
  context, preview/export mismatch, color/alpha changes outside the target, and
  unbounded render work. The Varve regressions above target those mechanisms
  without asserting they are current Varve defects.
- The outer-glow alpha regression in `packages/engine/src/effects-shadow.test.ts`
  is a Varve contract check derived from the requested brief. A separate
  gradient-stop assertion checks that different blurred-alpha positions produce
  different outer-glow pixels. EffectCraft #941/#1599 concern its A/B midpoint
  control on flat-luminance subjects; Varve does not expose that same parameter,
  so these checks do not claim to reproduce or resolve that exact defect.
- Product documentation establishes intended interaction semantics, not proof
  of output fidelity. Verify each target format in its own consumer.

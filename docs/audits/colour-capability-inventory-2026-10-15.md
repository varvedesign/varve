# Colour capability inventory — real ICC proofing and document precision

Date: 2026-10-15
Commit inspected: `6cae5f7a5` (working tree, with concurrent agent changes present)
Environment: Linux (CachyOS), Rust 1.97 / cargo 1.97, Node 26, tintbox 0.4.0, wasm-pack 0.13.1

This document records what the colour pipeline **actually does**, established by
inspecting code and executing probes rather than by reading the architecture
description. It exists because several capabilities were documented as complete
while nothing in the application exercised them.

## 1. Method

Three kinds of evidence are used, and they are kept separate:

| Evidence | Meaning |
|---|---|
| **Executed** | A command was run and its output recorded. |
| **Read** | Source was inspected; no runtime confirmation. |
| **Claimed** | Documentation asserts it; not verified here. |

Depths named as "8/16/32-bit" below mean **bits per colour channel**.

## 2. What the colour pipeline actually does

### 2.1 Document model — real, and separate from real-space publishing

`packages/scene/src/colorManagement.ts` defines a genuine `ManagedColor` union:
RGB, CMYK, Gray, Lab, LCH, spot, registration and unresolved variants, each
carrying an optional `bitDepth` and an optional `profileFingerprint`. Assign and
convert are distinct, explicitly named operations
(`assignDocumentColorMode`, `convertDocumentColors`) with a deprecated ambiguous
alias. **This part is honest and is the right foundation.**

`packages/scene/src/colorMode.ts` labels its conversion algorithm, emits an
`icc-unavailable` warning when ICC is requested without a converter, and never
silently degrades to formulas. **This is the correct discipline.**

### 2.2 The analytical path is presented as ICC, and disagrees with the real transform

`crates/varve-colour/src/conversions.rs::rgb_to_cmyk_icc` is exported to
TypeScript as `wasm_rgb_to_cmyk_icc` and reached through
`packages/engine/src/colour/colourLoader.ts`. The name says ICC. The function
contains no ICC data: it dispatches on a profile name to **hard-coded** GCR
strengths and TAC limits, applies a 1.3× saturation multiply for the saturation
intent, and derives K from a luminance term plus `0.8 × k_base`.

**Executed measurement** (`crates/varve-colour/tests/analytical_vs_icc_gap.rs`,
6³ = 216-colour grid, annotated SDR primaries, relative colorimetric):

```
analytical vs real ICC over 6^3 grid (0-255 channel scale)
  max channel error : 216 at rgb(0, 0, 0)
  icc=[216, 198, 186, 242]  analytical=[0, 0, 0, 255]
  mean channel error: 43.61
```

Pure black is the worst case and the most damaging: the analytical path emits
**K-only (0,0,0,255)**, while the real FOGRA39 profile emits **rich black
(216,198,186,242)**. K-only black under a press is a visibly flat dark grey. A
user who converts a document through the path labelled "icc" and then converts
the same document through the real engine gets materially different separations,
with no signal that the first was an approximation.

The bundled press profile is genuinely ISO Coated v2 (FOGRA39) — its `desc` tag
reads `ISO Coated v2 (basICColor)`, with real `A2B0/A2B1/A2B2/B2A0/B2A1/B2A2`,
`gamt` and `targ` tables. So the real transform is trustworthy; the problem is
that a second, differently-labelled path exists beside it.

**Also note:** the TAC constants (`300%` for FOGRA39) are policy numbers, not
the profile's own limit. **Executed:** `tintbox::gamut::detect_tac` on the
bundled profile returns **324.86%**. Reporting a house limit as if it were the
printing condition's detected TAC misstates the condition.

### 2.3 Soft proofing did not work at all

Four independent gaps, any one of which alone would have disabled the feature:

1. **No proof converter was ever registered.** `registerProfileProofConverter`
   and `registerProfileProofConverterNormalized` have **zero production
   callers**. `applyProofToRgba` / `applyProofToNormalized` therefore always
   returned `{ kind: 'unavailable' }` in every runtime.
2. **The main-thread render path never called the proof walker.**
   `applyProofToIr` was called only from `renderWorker.ts` and from tests. The
   three `drawVectorItems(ir, …)` sites in `renderPipeline.ts` passed unproofed
   IR.
3. **The configuration did not reach the computation.**
   `proofTransform.ts` folded profile id, intent, BPC and paper flags into a
   cache key, then invoked a callback that received **only** the colour. Since
   the converter map is keyed by profile id alone, changing intent or paper on
   the same profile could not change the result by construction.
4. **The overlay rendered nothing.** `SoftProofOverlay` renders a fixed,
   full-viewport `div` with `mixBlendMode: 'saturation'` and an empty background
   over a transparent area, plus a `display: none` canvas whose CMYK preview
   loops analytically and is never displayed. A saturation blend of nothing is
   nothing.

A contributing semantic error: `isColorOutOfProofGamut` decided gamut status by
"did the proofed value move more than 1.5/255". That is not a gamut test. An
in-gamut colour legitimately moves under paper simulation or a different
rendering intent, and an out-of-gamut colour can be mapped perceptually to almost
the same numbers.

### 2.4 The raster colour infrastructure is complete and unwired

`packages/engine/src/rasterColor/` contains real pixel descriptors
(`rgba8/rgba16/rgba16f/rgba32f`, `cmyka8/cmyka16/cmyka16f/cmyka32f`), byte-exact
allocation with a budget, format conversion, 16-bit and half-float codecs,
premultiply/unpremultiply, ICC header parsing, and an analytic transform
descriptor.

**Executed:** grepping for consumers of `convertPixelBufferFormat`,
`allocatePixelBuffer`, `createAnalyticRgbTransform`, `transformDescriptor`,
`buildMatrixProfile` and `parseIccHeader` outside `packages/engine/src/rasterColor/`
returns **zero hits**. The module is re-exported from `@varve/engine` and has no
external consumer.

Conclusion: high-depth raster *representations* exist as library code.
`packages/scene`'s typed `bitDepth` model exists as data. Neither is a statement
that decoding, painting, effects, compositing or encoding carry 16-bit or float
precision end to end — and no test currently makes that claim either way.

### 2.5 Display management is not implemented, and is not claimed

There is no monitor-profile path: no display-profile discovery, no OS display
API use, no `colorSpace` tagging of the canvas surface. The canvas is an
untagged sRGB surface. The architecture document describes display conversion as
an aspiration; the code does not attempt it. This is recorded as **absent**, not
as broken, and the proof provider now targets sRGB explicitly so its assumption
is stated rather than implied.

## 3. Verified capability now available

### 3.1 Real ICC proofing engine (Rust, native and WASM)

`crates/varve-colour/src/proof.rs` builds a genuine proofing chain via
`tintbox::transform::Transform::new_proofing` (lcms2
`cmsCreateProofingTransform`): `device → proof → proof → display`, intents
`[nIntent, nIntent, REL_COL, proofing_intent]`, BPC `[do_bpc, do_bpc, 0, 0]`.

**Executed** (Node, real `wasm-pack` build of the crate):

```
srgb bytes 480        fingerprint 5eb2838d373d239f
cmyk bytes 1052608    fingerprint 585ed57d7c27584b
TAC 324.8584899902344
simulation support [intent,bpc,paper,ink]: [1, 1, 1, 0]
proofed red  [0.9005, 0.2219, 0.1439]      (sRGB red, relative, no paper)
proofed grey [0.5000, 0.5006, 0.5007]
red out of gamut?  true
grey out of gamut? false
paper white plain [1.0000, 1.0000, 1.0000]
paper white sim   [0.9381, 0.9438, 0.9586]
```

Identity is a **content fingerprint** over the profile bytes, never a path or a
display name, so two profiles sharing a name cannot collide and replacing bytes
at one path cannot serve a stale transform. A rejected replacement leaves the
working profile and its transforms intact; retained bytes are bounded by what is
registered (the previous `Box::leak` in `IccEngine::load_bytes` leaked every
custom profile for the process lifetime, and one WASM entry point called it once
per invocation).

### 3.2 Honest support reporting

`simulation_support` reports which requested simulations reach the transform.
Black-ink simulation is **not** expressible with this transform family and is
reported `false` rather than silently mapped onto ink limiting. Rendering
intent, BPC and paper simulation are all `true` and are covered by tests that
fail if the configuration stops changing the output.

## 4. Capability matrix (12 model × depth cells)

"Document data" = the typed value model. "Raster path" = decode/edit/encode.

| Model | uint8 | uint16 | float32 |
|---|---|---|---|
| RGB | Model yes; raster path unproven | Model yes; raster path unproven | Model yes; raster path unproven |
| CMYK | Model yes; raster path unproven | Model yes; raster path unproven | Model yes; raster path unproven |
| Lab | Model yes (float-native channels) | n/a — Lab channels are float by definition | Model yes (float-native) |
| Gray | Model yes; raster path unproven | Model yes; raster path unproven | Model yes; raster path unproven |

Every cell above is a **model-level** statement. No cell has been verified for
end-to-end raster precision (decode → edit → filter → composite → save →
reopen → export). Treating the table as complete would repeat the mistake this
audit exists to correct.

## 5. Known gaps, stated plainly

1. **One output condition only.** Only FOGRA39 (ISO Coated v2) is bundled. The
   proof-profile menu offers six press conditions; the provider now **refuses**
   the other five with a named reason rather than proofing them against FOGRA39.
2. **False capability labels.** `CMYK_PROFILES` advertises `fogra51`,
   `gracol2006`, `swop-coated`, `swop-uncoated`, `japan-color-2011` although no
   such profile ships. `PrintProfile::icc_bytes()` returns the **same**
   `bundled_cmyk()` bytes for all three of its variants.
3. **The analytical ICC path is still reachable** and still produces the
   divergence in §2.2. It has not been removed, because other callers may
   depend on its output and because removing it is a behaviour change that
   needs its own migration decision.
4. **No display management.** See §2.5.
5. **High-depth raster path unproven.** See §2.4 and §4.
6. **Black-ink simulation unsupported.** Reported, not faked.

## 6. Validation performed

```
cargo test -p varve-colour               77 lib + 11 + 1 + 21 + 4 passed
cargo clippy -p varve-colour --all-targets    0 warnings
cargo check -p varve-colour --target wasm32-unknown-unknown --features wasm   0 warnings
cargo check -p varve-print -p varve-wasm      clean
wasm-pack build (proof bindings)              produced a loadable module
Node probe against the real WASM build        results in §3.1
tsc --noEmit @varve/shared                    0 errors
tsc --noEmit @varve/editor                    0 errors (in colour files)
tsc --noEmit @varve/ui                        0 errors
vitest proof + render suites                  28 passed
```

### Not run, and why

- **Browser E2E for the proof toggle.** The heavy-task lease was held by a
  concurrent agent's Playwright run for the whole window. Bypassing the lease is
  prohibited, and running a second Chromium alongside it would reproduce exactly
  the memory-pressure failures the lease exists to prevent. The main-thread
  proof wiring is therefore verified by typecheck and unit tests only, not by a
  real browser interaction.
- **Full suite.** `pnpm verify:plan` reported `FULL-SUITE ESCALATION: YES`, but
  its stated reasons derive from **concurrent agents'** changes in the working
  tree (`packages/automation/`, `packages/collab/src/protocol.ts`, `varve-room`,
  presentation migration tests), not from this work. Those changes are not mine
  to validate or commit.
- **Physical monitor or print verification.** No hardware, no calibrated
  display, no controlled viewing conditions. No claim is made about physical
  colour accuracy.

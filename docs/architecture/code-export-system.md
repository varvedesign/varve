# Code Export System

Canonical contract for Varve's design-to-code pipeline: the acceptance
corpus, the bundle and asset contract, per-target lowering and its verified
limits, preview isolation, regeneration ownership, and the real-toolchain
verification gates. Research basis and the external failure classes this
design answers: `docs/research/design-to-code-gap-research-2026-10-15.md`.

Status: implemented and verified unless a section says otherwise. The two
known open workstreams are at the end.

## Pipeline

One pipeline, from the document to the delivered files:

```text
Document revision + selection
  → resolved layout / text / components / tokens
  → codegen IR (sceneToIR) or direct scene walk (css/tailwind/svg)
  → capability + fallback plan (compositor boundary, flattening reasons)
  → GeneratedBundle { files, assets, dependencies, setup, diagnostics }
    + varve-codegen.manifest.json
  → validation (unit + harness + E2E)
  → delivery (snippet copy, ZIP bundle, folder flow)
```

There is no second scene graph and no bespoke renderer for code targets.
Raster fallbacks come from the production compositor
(`packages/editor/src/export/compositor.ts`), which runs the canonical
`flattenSceneToEngine → buildIr → replayStructuredScene` chain with effect
expansion padding and pixel budgets.

Key modules:

| Area | Module |
|---|---|
| Bundle + asset types | `packages/codegen/src/types.ts` (`GeneratedBundle`, `BundleAsset`) |
| Asset plumbing | `packages/codegen/src/bundle-assets.ts` (content-addressed paths, dedupe) |
| CSS-family emitters | `packages/codegen/src/css.ts`, `tailwind.ts`, `css-modules.ts` |
| SVG emitter + measured text | `packages/codegen/src/svg.ts`, `svgTextLayout.ts` |
| HTML emitter + text | `packages/codegen/src/html.ts`, `html-text.ts` |
| Widget emitters | `packages/codegen/src/flutter.ts`, `swiftui.ts` |
| Regeneration ownership | `packages/codegen/src/regeneration.ts` |
| Raster fallback boundaries | `packages/editor/src/export/compositor.ts` (`CAPABILITY['css'|'flutter'|'swiftui']`) |
| Export wiring + fail-loud | `packages/editor/src/exportService.ts` |
| Preview isolation | `packages/editor/src/components/SpecPanel/preview.ts` |
| Acceptance corpus | `packages/codegen/src/__tests__/helpers/corpus.ts` |
| Verification harnesses | `scripts/codegen-verify/` |

## Bundle and asset contract

A code export is a multi-file unit, not a string: `GeneratedBundle` carries
`files[]` (relative POSIX paths, MIME, entry flag) and optionally
`assets[]`. Two emission profiles exist:

- **Inline (snippets):** raster fallbacks and image fills embed as data
  URLs. Self-contained; the Copy/Code panel path.
- **Files (bundles):** raster bytes are decoded once, hashed (SHA-256), and
  written to `assets/<hash16>.<ext>`; the code references the relative path.
  Content-addressing makes regeneration deterministic — unchanged art
  produces the same path.

Metadata must describe the bytes: MIME comes from the decoded data URL, pixel
dimensions from the compositor, CSS placement dimensions separately.
Deduplication is by decoded content, so identical art ships once. A data URL
that cannot be decoded is reported as a failed asset (`failedNodeIds`) — the
bundle never contains a dangling reference.

**Failure semantics:** when a node needs a rasterized fallback and the
compositor cannot produce one (pixel budget, surface, encode failure), the
export job fails with a node-attributable message
(`assertRasterCompositionComplete`). Checkerboards are editor diagnostics,
never shipped output.

## Per-target profiles

Capabilities live in the compositor's `CAPABILITY` table per target
(`svg`, `pdf`, `raster`, `css`, `flutter`, `swiftui`); the emitter and the
boundary finder read the same table, so what rasterizes matches what the
emitter can paint.

| Feature | CSS / Tailwind / Modules | HTML | SVG | Flutter | SwiftUI |
|---|---|---|---|---|---|
| Flex/grid layout | flow classes | flex CSS | n/a (absolute) | Row/Column | H/VStack |
| Linear/radial gradients | native (arbitrary values / CSS) | native | native | native | native |
| Angular gradients | conic-gradient (renderer geometry) | linear approximation | raster | raster + gap | AngularGradient |
| Diamond gradients | raster | raster | raster | raster + gap | raster + gap |
| Drop shadow (spread) | native | native | n/a | BoxShadow (spread native) | .shadow (spread is a gap) |
| Inner shadow | inset box-shadow | raster | raster | raster + gap | raster + gap |
| Layer/background blur | filter / backdrop-filter | same | raster | raster + gap | raster + gap |
| Rich text runs | styled spans, literal classes | `<p>/<span>` delta styles | measured tspans | Text.rich | concatenated Text |
| Measured wrapping | n/a (browser wraps) | browser wraps | engine layout | n/a (Flutter wraps) | n/a (SwiftUI wraps) |
| Masks / adjustments / complex blends | raster boundary | raster boundary | native subset | raster boundary | raster boundary |

Filled cells in "native" columns are emitted as real code; "raster" means the
compositor's smallest isolating boundary is rendered and embedded (with the
effect-expansion padding contract: content anchored at `(left, top)` inside
the padded box).

### SVG text portability profile

Browsers do not ship SVG2 automatic text wrapping, and `foreignObject` is a
portability liability — so the SVG target uses **measured placement**:
`svgTextLayout.ts` shapes each run (per-run formats) and line-breaks with the
engine's `layoutText`, then emits explicit `tspan` geometry from the same
metrics the canvas renders with. Alignment offsets come from measured line
widths; RTL runs carry `direction`; overset content is disclosed as a
comment. Without a metrics provider (snippets), area text keeps authored
newlines and the file discloses `area text exported without font metrics`.
Export always settles fonts first (`awaitExportsReady`) so breaks are not
measured from fallback fonts.

## Preview isolation

The code panel previews SVG and HTML — the two targets a browser renders
without a runtime — inside `<iframe sandbox="" srcDoc>`: opaque origin, no
scripts, no same-origin access, no forms, popups, or top navigation, and no
messaging. The preview renders the generated bytes exactly; there are no
editor CSS patches and no asset substitution. Hostile-but-harmless payloads
(`script`, handlers, storage access) are inert by sandbox construction; the
E2E suite asserts the attribute and parent-DOM canaries
(`tests/e2e/codegen/`). Targets that would need a build runtime get an
explicit "download and build" disclosure instead of a transformed fake.

Desktop note: the sandbox denies web-platform capabilities; Tauri IPC is not
exposed to sandboxed frames by the app's origin/capability model, and no
preview path grants it. This is a configuration contract, not a runtime
assertion, and is labeled accordingly.

## Regeneration ownership

Every bundle embeds `varve-codegen.manifest.json`: generator identity,
target, source fingerprint, dependencies, and a SHA-256 per emitted file.
`planRegeneration` compares that manifest plus the destination's current
bytes and proposes one action per path:

- `update` — generated, unchanged since the manifest hash.
- `conflict` — generated, but edited since (expected + current hashes;
  never silently overwritten; there is no overwrite-all).
- `preserve` — unclaimed destination files (a "generated" comment proves
  nothing).
- `stale` — previously owned, no longer emitted; reported, never deleted.

The planner only reads. The remaining work is the interactive desktop
folder flow that applies the plan with per-file resolution and
manifest-written-last commit ordering; today every export is a fresh,
self-contained bundle, which cannot destroy anything.

## Verification gates

Status table (honest, machine-checked):

| Target | Gate | Status on the 2026-10-16 dev machine |
|---|---|---|
| React + Tailwind | `scripts/codegen-verify/verify-web.mjs` — pinned consumer project, `tsc --noEmit`, `vite build`, real Tailwind PostCSS generation, asset/portability checks | **PASS** (pnpm 11.9, vite 5.4.11, tailwindcss 3.4.15, react 18.3.1; 8 KB generated CSS incl. emitted conic/linear arbitrary utilities) |
| Flutter | `scripts/codegen-verify/verify-flutter.mjs` | **UNVERIFIED** — no Flutter SDK installed; generated Dart has not been analyzed or compiled |
| SwiftUI | `scripts/codegen-verify/verify-swiftui.mjs` | **UNVERIFIED** — no Apple SDK; generated Swift has not been compiled against SwiftUI |
| SVG / HTML / CSS | unit parity (engine layout ↔ emitted breaks), browser E2E + preview screenshots | **Verified** via `tests/e2e/codegen/` |

A gate exit code 2 means UNVERIFIED — never read it as a pass, and do not
upgrade claims in docs or the website beyond this table.

## Open workstreams

1. **Authored responsive conditions** (designed, not implemented): a
   `Document.responsive.conditions[]` model (named max/min-width conditions,
   viewport or container scope) with per-node `responsiveOverrides[]`
   (layout sizing/direction/gap/wrap/padding/align/justify, visibility, font
   size), additive schema migration, undoable ops with deterministic
   array-order evaluation, validation of duplicate/conflicting/stale
   conditions, an Inspector authoring section with inherited-value
   indicators and reset, emission as `@media`/`@container` (CSS/Modules) and
   literal arbitrary variants (`max-[640px]:flex-col`, Tailwind), and
   preview at custom widths through the sandboxed preview. Fluid layout
   without breakpoints already works and is covered by the responsive-page
   corpus. Deferred deliberately: the scene schema files were under
   concurrent migration while this work ran, and a rushed additive
   migration on a hot schema is the exact silent-loss class this system
   refuses.
2. **Component extraction and production mapping** (designed, not
   implemented): populate `IRDocument.components` from `Document.components`
   with the variant/override effective overlay; emit per-definition
   component files and instance usage in React-family bundles; a validated
   mapping contract (import specifier, export name, property map — never
   guessed, never executed) persisted document-owned; stale/broken mappings
   degrade to generated-local emission with diagnostics. The regeneration
   manifest and harness above are its prerequisites and are in place.

# Visual Regression Harness

Protects `packages/engine/src/replay.ts`'s `replayIr` — the render path's primitive-painting
function — with real pixel comparison. Complements `packages/engine/src/__goldens__/drawCallSequence.test.ts`,
a faster, non-pixel structural signal for the same function (see that file's header for why both
exist).

## Why this exists instead of extending `__goldens__/goldenReplay.test.ts`

That file hashes `canvas.getImageData()` output and asserts hash stability. Verified directly in
this repo's actual jsdom setup: a real `fillRect()` followed by `getImageData()` returns an
**all-zero buffer** — jsdom's canvas does not rasterize. That test only proves calling `replayIr`
twice with the same input is deterministic; it proves nothing about what's actually drawn. This
harness uses a real browser (Playwright, already a dependency in this repo) instead.

## How it works

1. `apps/desktop/visual-harness.html` + `apps/desktop/src/visual-harness-main.ts` — a minimal
   page (not the full app) that imports `replayIr` directly and exposes
   `window.__renderFixture(items, width, height)` and the fixed-time motion
   variant. Image sources are decoded through the real `ImageCache` before the
   frame is painted, so an image fixture cannot accidentally snapshot a loading
   placeholder.
2. `tests/e2e/visual/fixtures.ts` — the fixture corpus (`RenderItem[]` scenes).
3. `tests/e2e/visual/replay.spec.ts` — for each fixture, navigates to the harness page, calls
   `__renderFixture`, and asserts `toHaveScreenshot()` against a stored baseline with a
   per-fixture `maxDiffPixels` tolerance. Chromium 1x, 2x, and 3x projects are
   all part of the default visual gate; the DPR label is derived from the
   project name so each tier has its own reviewed baseline.
4. On failure, `scripts/build-visual-diff-manifest.mjs` collects baseline/current/diff PNGs into
   `visual-diff-report/` + a `manifest.json`. CI uploads this directory as an artifact.
5. `tests/e2e/visual/review.html` — static page, no server, no build step. Point it at a
   downloaded `visual-diff-report/manifest.json` (or a local one after running the script
   yourself) to see every failing fixture with baseline/current/diff side by side, zoom-and-pan
   per pane, and an "Accept" button that reveals the exact `--update-snapshots` command to run
   locally (a static page can't write files for you — this is the honest version of "accept").

## Scope: coverage boundaries

This harness tests `replayIr` (the primitive-painting layer). The companion
`tests/e2e/canvas/visual-compositing.spec.ts` mounts the actual editor and
covers the `CanvasArea.tsx`/`replaySubtreeToCtx` orchestration layer: nested
group isolation, container compositing, and clip-mask output. Keeping those
two layers separate makes a failing image identify the renderer or the scene
orchestration that changed.

**Shipped replay fixtures**: multiple node types (rect/circle/ellipse/text),
multilingual text covering RTL, script fallback, combining marks, ligatures,
and ZWJ emoji, opacity, four blend modes, translated/rotated linear and radial
gradients, angular/conic and diamond gradients, image fills (fill/fit/crop/tile)
and transform variants, CSS and software adjustment filters including a LUT,
all line caps, joined/dashed strokes, a fixed-time motion/bound-property
sample, and a 1,500-item pathological scene.

**Shipped editor-compositing coverage**: nested groups with group opacity and
isolation, real clip-mask raster output, and a canvas/layers snapshot of the
resulting user-visible state. Existing interaction specs continue to cover
mask editing, feather/density/invert, persistence, and adjustment targeting.

**Runtime coverage**: Chromium 1x/2x/3x is the default gate. A GPU-backed
Chromium visual project has a separate snapshot namespace and is available via
`pnpm e2e:visual:gpu`. The Firefox replay project runs via
`pnpm e2e:visual:cross-runtime` and its baselines are complete and enforced by
`pnpm audit:visual-baselines`. WebKit is **opt-in on a prepared host**
(`pnpm e2e:visual:webkit`, requires `VARVE_VISUAL_WEBKIT=1` and
`pnpm webkit:prepare`) and has no committed baselines yet; the project is gated
so the default cross-runtime lane cannot fail on a missing WebKit baseline.
Playwright snapshot names include the runtime and host platform, so Linux,
macOS, and Windows baselines cannot overwrite one another. New platform
baselines must be generated and reviewed on that platform before enabling that
platform as a required gate.

## Font determinism

The visual harness imports and awaits the bundled IBM Plex Sans Variable face before it paints, and
the deterministic text fixtures name that face explicitly. If the face cannot be loaded, the
harness fails instead of silently accepting a fallback. The multilingual fixture also exercises
script fallback (Arabic, Hebrew, Devanagari, Japanese, and emoji); those glyphs intentionally retain
runtime-specific baselines because the repository does not bundle every fallback script face. The
Linux CI image is the canonical text-rendering environment, while Firefox/WebKit and other
platform projects keep separate baselines rather than hiding font changes behind a large tolerance.

## Running locally

```bash
pnpm e2e:visual
pnpm e2e:visual:gpu                 # separate GPU/driver snapshot namespace
pnpm e2e:visual:cross-runtime        # Firefox replay project (complete baselines)
pnpm e2e:visual:webkit               # opt-in WebKit project (prepared host; generate baselines first)
node scripts/build-visual-diff-manifest.mjs   # only needed after a failure, to build the review report
# then open tests/e2e/visual/review.html directly in a browser and point it at visual-diff-report/manifest.json
```

To update baselines after an **intended** rendering change, use the scoped,
reviewed wrapper instead of a broad `--update-snapshots` run:
```bash
pnpm visual:update --spec tests/e2e/visual/replay.spec.ts --project chromium-visual-1x --reason "renderer change: <what and why>"
pnpm visual:update --spec tests/e2e/canvas/upscale-dialog-visual.spec.ts --project chromium --reason "Enhance dialog spacing per design review"
```
The wrapper runs one spec/project through the heavy-task lease with
`--update-snapshots=changed`, records a local review artifact under
`reports/visual-baseline-updates/`, and prints the exact baseline diff to
review. Global screenshot defaults disable animations and hide the caret.

Design-surface baselines are review artifacts, not exact-render contracts: a
real design change *must* update them, and a text-raster-only delta inside a
documented budget is environment drift, not a design change. The full decision
tree, tolerance and concurrency rules are in
[`docs/quality/visual-validation.md`](../../../docs/quality/visual-validation.md).

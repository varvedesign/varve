/**
 * Capture runner: the entry point calls it only after the metadata-only mode
 * dispatches, so importing it starts no browser, server, or capture.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { sourceSceneProvenance } from '../capture-safety.mjs';
import { analyseImage } from '../lib/image-analysis.mjs';
import { SOURCE_SCENES } from '../source-scenes.mjs';
import { GPU_ARGS, warmUp } from './browser-session.mjs';
import {
  CANONICAL_DIR,
  DEBUG_DIR,
  MANIFEST_PATH,
  OUT_DIR,
  OUTPUT_DIRS,
  OUTPUT_MANIFEST,
  onlyScenes,
  reviewDir,
  strict,
} from './config.mjs';
import { SEED_FIRST_RUN_STATE } from './editor.mjs';
import { sceneKind } from './manifest-sync.mjs';
import {
  computeSourceIdentity,
  manifestDigestAtStart,
  playwrightVersion,
  pngSize,
  sha256Hex,
  writeFileAtomicSync,
} from './provenance.mjs';
import { freshSourceSceneCapture, SCENES, sourceScenePath } from './scenes/index.mjs';
import { startServer, stopServer } from './server.mjs';
import { clipFromLocator, settle } from './settle.mjs';
import { manifest, recordFailure, runId, skippedThisRun, sourceIdentity } from './state.mjs';
import { openVariantSupport } from './variants.mjs';

export let browser, server, variantSupport;
export let ranThisRun = 0;
export let capturedThisRun = 0;
export let optedOut = 0;
export async function runCapture() {
  browser = await chromium.launch(process.env.VARVE_SHOT_MODELS ? { args: GPU_ARGS } : {});
  server = await startServer();
  await warmUp(browser);
  variantSupport = await openVariantSupport();
  try {
    for (const scene of SCENES) {
      if (onlyScenes.size > 0 && !onlyScenes.has(scene.id)) continue;
      // Scenes that need on-device inference are opt-in. Their models are a
      // local prerequisite (gitignored), and the optional INT8 model runs on CPU
      // through WASM even though model-mode Chromium enables Vulkan. A default
      // run must neither block on them nor fail --strict for skipping them.
      // Opting out drops the manifest entry entirely rather than leaving a
      // permanent "skipped" record behind.
      if (scene.requiresEnv && !process.env[scene.requiresEnv]) {
        if (manifest.scenes[scene.id]) {
          const stale = manifest.scenes[scene.id];
          if (stale.file) {
            for (const dir of OUTPUT_DIRS) rmSync(join(dir, stale.file), { force: true });
          }
          delete manifest.scenes[scene.id];
        }
        optedOut++;
        console.log(`skipping ${scene.id} (set ${scene.requiresEnv}=1 to capture it)`);
        continue;
      }
      // SCENES is the source of truth for what exists; the manifest is a
      // generated view of it, so a newly added scene seeds its own entry
      // rather than requiring a hand-edit of a file marked "do not hand-edit".
      manifest.scenes[scene.id] ??= {};
      const entry = manifest.scenes[scene.id];
      ranThisRun++;
      const ctx = await browser.newContext({
        viewport: scene.viewport ?? { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        ...(scene.hasTouch ? { hasTouch: true } : {}),
      });
      await ctx.addInitScript(SEED_FIRST_RUN_STATE);
      const page = await ctx.newPage();
      // A scene that stalls (inference in particular) reports only the UI text
      // it got stuck on, which cannot distinguish "still working" from "threw
      // and the spinner never cleared". VARVE_SHOT_DEBUG surfaces the console.
      if (process.env.VARVE_SHOT_DEBUG) {
        page.on('console', async (msg) => {
          const values = await Promise.all(
            msg
              .args()
              .map((arg) =>
                arg
                  .evaluate((value) =>
                    value instanceof Error
                      ? { name: value.name, message: value.message, stack: value.stack }
                      : String(value),
                  )
                  .catch(() => '[unserializable console value]'),
              ),
          );
          const serialized = JSON.stringify(values);
          console.log(
            `  [${scene.id}:${msg.type()}] ${
              msg.type() === 'error' ? serialized.slice(0, 8000) : serialized.slice(0, 1200)
            }`,
          );
        });
        page.on('pageerror', (err) =>
          console.log(`  [${scene.id}:pageerror] ${String(err).slice(0, 300)}`),
        );
        // Inference runs in a Web Worker, and a worker's console does not reach
        // the page's console event — so the one place an ONNX failure reports
        // itself was invisible to every run above.
        page.on('worker', (worker) => {
          console.log(`  [${scene.id}:worker] started ${worker.url().split('/').pop()}`);
          worker.on('close', () => console.log(`  [${scene.id}:worker] closed`));
        });
      }
      try {
        await page.emulateMedia({
          colorScheme: scene.theme,
          reducedMotion: 'reduce',
          forcedColors: 'none',
        });
        await scene.run(page);
        await settle(page, scene);
        await scene.verify?.(page);
        if (computeSourceIdentity().sourceDigest !== sourceIdentity.sourceDigest) {
          throw new Error('Capture source changed during this run; retry from a stable tree');
        }
        // Detail scenes are cropped at capture time so the website can show
        // them small without scaling a full window down to an unreadable smear.
        // A scene with `clipFrom` measures its own window from the real
        // container now that panels, fonts and selection have settled.
        const clip = scene.clipFrom ? await clipFromLocator(page, scene.clipFrom) : scene.clip;
        const shot = await page.screenshot(clip ? { clip } : undefined);
        if (computeSourceIdentity().sourceDigest !== sourceIdentity.sourceDigest) {
          throw new Error('Capture source changed during the screenshot; retry from a stable tree');
        }
        const dims = pngSize(shot);
        // Full frames are 1440x900; cropped details are smaller but must still
        // match the clip they asked for, which catches a mis-laid-out capture.
        const expected = clip ?? scene.viewport ?? { width: 1440, height: 900 };
        if (!dims || dims.width !== expected.width || dims.height !== expected.height) {
          throw new Error(
            `screenshot malformed: got ${JSON.stringify(dims)}, expected ${expected.width}x${expected.height}`,
          );
        }
        // A valid PNG is not proof of a valid screenshot: a blank canvas, a
        // uniform panel and a broken render all encode to a perfectly legal
        // file. Reject obviously empty output before it can be published.
        const analysis = analyseImage(shot);
        if (!analysis.valid) {
          throw new Error(`capture does not decode cleanly: ${analysis.errors.join('; ')}`);
        }
        for (const dir of OUTPUT_DIRS) {
          // Temp + rename: a website build (or another agent) reading the
          // published directory must never observe a partially written image.
          writeFileAtomicSync(join(dir, scene.file), shot);
        }
        entry.sha256 = sha256Hex(shot);
        entry.file = scene.file;
        entry.alt = scene.alt;
        entry.caption = scene.caption;
        entry.feature = scene.feature;
        entry.theme = scene.theme;
        entry.kind = sceneKind({ ...scene, clip: scene.clip ?? clip });
        entry.width = dims.width;
        entry.height = dims.height;
        const capturedVariants = await variantSupport.writeSceneVariants(entry, shot, OUTPUT_DIRS);
        if (capturedVariants) {
          entry.variants = capturedVariants;
        } else if (entry.variants) {
          variantSupport.removeSceneVariants(entry, OUTPUT_DIRS);
          entry.variants = undefined;
        }
        entry.status = 'captured';
        entry.reason = undefined;
        entry.source = undefined;
        entry.crop = clip ? { ...clip } : undefined;
        entry.viewport =
          scene.viewport && (scene.viewport.width !== 1440 || scene.viewport.height !== 900)
            ? { ...scene.viewport }
            : undefined;
        entry.scale = 1;
        entry.capturedAt = new Date().toISOString();
        entry.provenanceUnknown = false;
        entry.provenance = {
          ...sourceIdentity,
          runId,
          runtime: 'chromium-headless (web)',
          captureTool: `Playwright ${playwrightVersion()} / Chromium ${browser.version()}`,
          viewport: scene.viewport ?? { width: 1440, height: 900 },
          deviceScaleFactor: 1,
          theme: scene.theme,
        };
        // The revision this image is evidence about. Previously written as a
        // permanent null, which made the field meaningless.
        entry.lastValidatedAgainst = sourceIdentity.sourceRevision;
        capturedThisRun++;
        console.log(
          `captured ${scene.id} -> ${join(OUT_DIR, scene.file)} (${dims.width}x${dims.height}, ${entry.kind})`,
        );
      } catch (err) {
        // Descriptive fields are written on the failure path too: a skipped
        // scene still has to carry its file name, alt text and feature so the
        // manifest stays a complete inventory rather than a bare error stub.
        entry.file = scene.file;
        entry.alt = scene.alt;
        entry.caption = scene.caption;
        entry.feature = scene.feature;
        entry.theme = scene.theme;
        entry.status = 'skipped';
        entry.reason = String(err instanceof Error ? err.message : err).slice(0, 400);
        entry.lastValidatedAgainst = null;
        entry.sha256 = undefined;
        entry.width = undefined;
        entry.height = undefined;
        entry.capturedAt = undefined;
        // Delete any previous output for this scene. A skipped scene must not
        // leave a stale screenshot behind for the site to keep serving — that
        // is exactly the silent substitution this pipeline exists to prevent.
        for (const dir of OUTPUT_DIRS) {
          rmSync(join(dir, scene.file), { force: true });
        }
        variantSupport.removeSceneVariants(entry, OUTPUT_DIRS);
        entry.variants = undefined;
        console.error(`SKIPPED ${scene.id}: ${entry.reason}`);
        // A skip reports the text it gave up on, which is rarely enough to tell
        // what the UI was actually showing. Keep the frame under VARVE_SHOT_DEBUG
        // so a failure can be looked at rather than only read about — but never
        // in a screenshot output directory, where it would sit beside published
        // captures and be mistaken for one.
        if (process.env.VARVE_SHOT_DEBUG) {
          const layout = await page
            .evaluate(() => {
              const describe = (selector) => {
                const element = document.querySelector(selector);
                if (!(element instanceof HTMLElement)) return null;
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                  rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                  display: style.display,
                  visibility: style.visibility,
                  pointerEvents: style.pointerEvents,
                  transform: style.transform,
                  inlineStyle: element.getAttribute('style'),
                  dataVisible: element.getAttribute('data-visible'),
                };
              };
              return {
                viewport: { width: innerWidth, height: innerHeight },
                layoutMode: document.documentElement.dataset.layoutMode,
                shell: describe('.editor-shell'),
                dock: describe('.editor-shell__canvas-dock'),
                inspector: describe('.editor__inspector-panel'),
                launcher: describe('.editor__fab--inspector'),
                toolbar: describe('[data-testid="toolbar"]'),
                moreTools: describe('[data-testid="toolbar-more-tools"]'),
                pageTool: describe('[data-testid="toolbar"] [data-tool="page"]'),
                backdrop: describe('.editor__panel-backdrop'),
              };
            })
            .catch(() => null);
          console.error(`  layout: ${JSON.stringify(layout)}`);
          mkdirSync(DEBUG_DIR, { recursive: true });
          const debugPath = join(DEBUG_DIR, `${runId}-${scene.id}.png`);
          await page
            .screenshot({ path: debugPath })
            .then(() => console.error(`  wrote ${debugPath}`))
            .catch(() => undefined);
        }
        if (strict) recordFailure();
        skippedThisRun.push(scene.id);
      } finally {
        await ctx.close();
      }
    }
    // Drop manifest entries whose scene no longer exists. Only safe on a full
    // run — a --scenes run intentionally leaves the other entries untouched.
    if (onlyScenes.size === 0) {
      const live = new Set(SCENES.map((s) => s.id));
      for (const id of Object.keys(manifest.scenes)) {
        if (live.has(id) || manifest.scenes[id]?.source) continue;
        const stale = manifest.scenes[id];
        if (stale?.file) {
          for (const dir of OUTPUT_DIRS) rmSync(join(dir, stale.file), { force: true });
          for (const variant of stale.variants ?? []) {
            for (const dir of OUTPUT_DIRS) rmSync(join(dir, variant.file), { force: true });
          }
        }
        delete manifest.scenes[id];
        console.log(`pruned removed scene ${id}`);
      }
    }

    // E2E-produced scenes: real captures whose producer is a Playwright spec and
    // whose bytes are already committed to public/screenshots. They are not
    // recaptured here, but they must still be first-class manifest entries —
    // otherwise the only trace of them is a hardcoded path in a page and an
    // orphan file the validator rejects.
    for (const source of SOURCE_SCENES) {
      if (onlyScenes.size > 0 && !onlyScenes.has(source.id)) continue;
      const capturePath = sourceScenePath(source);
      if (!existsSync(capturePath)) {
        console.warn(`skipping source scene ${source.id} (no producer capture at ${capturePath})`);
        continue;
      }
      const bytes = readFileSync(capturePath);
      const analysis = analyseImage(bytes);
      if (!analysis.valid) {
        throw new Error(
          `source scene ${source.id}: ${source.file} does not decode: ${analysis.errors.join('; ')}`,
        );
      }
      const previous = manifest.scenes[source.id] ?? {};
      const sourceHash = sha256Hex(bytes);
      const provenance = sourceSceneProvenance(
        previous,
        sourceHash,
        freshSourceSceneCapture(source, capturePath),
      );
      if (reviewDir) {
        writeFileAtomicSync(join(OUT_DIR, source.file), bytes);
      } else {
        writeFileAtomicSync(join(CANONICAL_DIR, source.file), bytes);
      }
      const nextSource = {
        ...previous,
        file: source.file,
        alt: source.alt,
        caption: source.caption,
        feature: source.feature,
        theme: source.theme,
        kind: source.kind,
        width: analysis.width,
        height: analysis.height,
        status: 'captured',
        reason: undefined,
        sha256: sourceHash,
        source: source.producer,
        // The measured frame, so the geometry check holds for a capture whose
        // frame differs from the 1440x900 default (a phone-sized or taller one).
        viewport: source.viewport ? { ...source.viewport } : undefined,
        ...provenance,
      };
      const sourceVariants = await variantSupport.writeSceneVariants(
        nextSource,
        bytes,
        reviewDir ? [OUT_DIR] : OUTPUT_DIRS,
      );
      if (sourceVariants) nextSource.variants = sourceVariants;
      manifest.scenes[source.id] = nextSource;
    }

    // Concurrency guard: this process read the manifest once, at startup, and a
    // capture run can take many minutes. If another writer (a second capture, a
    // concurrent agent) changed it in the meantime, writing our snapshot would
    // silently discard their scenes. Refuse instead of clobbering.
    const manifestBytesNow = readFileSync(MANIFEST_PATH);
    if (
      OUTPUT_MANIFEST === MANIFEST_PATH &&
      sha256Hex(manifestBytesNow) !== manifestDigestAtStart
    ) {
      throw new Error(
        'the screenshot manifest changed while this run was capturing — refusing to overwrite it. ' +
          'Re-run the capture; use --review-dir to capture without touching published state.',
      );
    }

    manifest.schemaVersion = 2;
    manifest.generatedAt = new Date().toISOString();
    manifest.provenance = {
      runId,
      runtime: 'chromium-headless (web)',
      captureTool: `playwright ${playwrightVersion()} / chromium ${browser.version()}`,
      sourceRevision: sourceIdentity.sourceRevision,
      sourceDirty: sourceIdentity.sourceDirty,
      sourceDigest: sourceIdentity.sourceDigest,
      viewport: { width: 1440, height: 900 },
      scale: 1,
      reducedMotion: true,
    };
    // Top-level identity fields are what the validator checks; `provenance` is
    // the detailed record. Content identity (sha256 per scene) never contains a
    // timestamp; `generatedAt` is volatile and lives only here.
    manifest.sourceRevision = sourceIdentity.sourceRevision;
    manifest.sourceDigest = sourceIdentity.sourceDigest;
    manifest.captureTool = manifest.provenance.captureTool;
    if (reviewDir) manifest.reviewedAgainst = manifestDigestAtStart;
    writeFileAtomicSync(OUTPUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`manifest written: ${OUTPUT_MANIFEST}`);
  } finally {
    await variantSupport.close();
    await stopServer(server);
    await browser.close();
  }
}

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname as pathDirname, resolve as pathResolve } from 'node:path';

import { chromium } from '@playwright/test';

import { fixtureDragPoint } from '../workloadGeometry.mjs';
import {
  ALLOW_DEV,
  args,
  DIST,
  DPR,
  DUPLICATIONS,
  FIXTURE,
  FIXTURE_DRAG,
  fail,
  HEADLESS,
  PREFLIGHT_ONLY,
  PREVIEW_QUALITY,
  RENDERER_MODE,
  SNAPSHOT,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
} from './cli.mjs';
import {
  contentCanvasDigest,
  hashDirectory,
  inspectRendererMode,
  readChromiumGpuDiagnostics,
  readScriptResourceState,
  rendererModeUrl,
} from './evidence.mjs';
import {
  buildScene,
  openEditorCanvas,
  openFixtureEditor,
  resolveDragTarget,
} from './scenarios.mjs';

export let browser = null;

export async function openMeasurementSession({ partial, BASE }) {
  browser = await chromium.launch({
    headless: HEADLESS,
    // Exposed GC is required for the forced-heap samples and is explicitly a
    // benchmark-only flag; production never runs with it.
    args: ['--js-flags=--expose-gc'],
  });
  partial.webglRuntimeEvidence = await readChromiumGpuDiagnostics(browser);
  const page = await browser.newPage({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: DPR,
  });
  await page.addInitScript(
    ({ mode, previewQuality }) => {
      if (location.origin === 'null') return;
      let current = {};
      try {
        current = JSON.parse(localStorage.getItem('varve-editor-settings') ?? '{}');
      } catch {
        current = {};
      }
      const render = current.render ?? {};
      const renderer = mode === 'webgl2' ? 'webgl2' : 'canvas2d';
      localStorage.setItem(
        'varve-editor-settings',
        JSON.stringify({
          ...current,
          render: { ...render, renderer, interactivePreview: previewQuality },
        }),
      );
      localStorage.setItem('varve.renderWorker', mode === 'canvas2d-worker' ? 'on' : 'off');
      const stats = { trusted: 0, untrusted: 0, types: {} };
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) {
        addEventListener(
          type,
          (event) => {
            if (event.isTrusted) stats.trusted++;
            else stats.untrusted++;
            stats.types[type] = (stats.types[type] ?? 0) + 1;
          },
          true,
        );
      }
      window.__varveQualificationInput = stats;
    },
    { mode: RENDERER_MODE, previewQuality: PREVIEW_QUALITY },
  );
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const location = msg.location();
    const message = msg.text();
    partial.errors.push(message);
    partial.runtimeErrors.push({
      source: 'console',
      message,
      url: location.url || null,
      lineNumber: location.lineNumber ?? null,
      columnNumber: location.columnNumber ?? null,
    });
  });
  page.on('pageerror', (error) => {
    const message = error.stack ?? error.message;
    partial.errors.push(message);
    partial.runtimeErrors.push({ source: 'pageerror', message });
  });

  await page.goto(rendererModeUrl(BASE, RENDERER_MODE), {
    timeout: 60_000,
    waitUntil: 'domcontentloaded',
  });

  // Refuse to attribute production numbers to a bundle that is actually a dev
  // build — the check is on the artifact, not on our own intent.
  const looksDev = await page.evaluate(
    () =>
      Boolean(window.__vite_plugin_react_preamble_installed__) ||
      Boolean(window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size),
  );
  partial.devBuildSignalsDetected = looksDev;
  if (looksDev && !ALLOW_DEV) {
    fail('the served bundle shows development-build signals; refusing to record it as production');
  }
  partial.homeBundleCost = await readScriptResourceState(page);

  // The perf handle is installed by CanvasArea on mount, so it cannot exist on
  // the home screen — the document has to be open before it is waited on.
  let box;
  let scene;
  if (PREFLIGHT_ONLY) {
    // A preflight only needs the renderer mounted on a live editor canvas.
    // Avoid fixture generation, asset materialization, and drag-target
    // resolution so an unavailable renderer can be diagnosed cheaply. Draw
    // one trusted rectangle so WebGL2 path attribution observes a real GPU
    // submission instead of mistaking an empty scene for an unavailable path.
    box = await openEditorCanvas(page);
    if (!box) fail('the editor canvas has no visible bounds during renderer preflight');
    await page.waitForFunction(() => Boolean(window.__varvePerf), undefined, { timeout: 30_000 });
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 60, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 130);
    await page.mouse.up();
    await page.getByRole('treeitem').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.keyboard.press('v');
    partial.sceneNodeCount = 1;
    scene = {};
  } else if (FIXTURE) {
    const opened = await openFixtureEditor(page, FIXTURE);
    box = opened.box;
    await page.waitForFunction(() => Boolean(window.__varvePerf), undefined, { timeout: 30_000 });
    partial.fixture = {
      id: FIXTURE,
      documentId: opened.seeded?.id,
      nodeCount: opened.seeded?.nodeCount,
      fixtureChecksum: opened.seeded?.fixtureChecksum,
      assets: opened.seeded?.assets ?? null,
    };
    const explicitDragPoint = FIXTURE_DRAG === 'auto' ? null : FIXTURE_DRAG.split(',').map(Number);
    const camera = await page.evaluate(
      () => window.__varvePerf?.getFrames?.(1)?.at(-1)?.camera ?? null,
    );
    if (!camera) fail('fixture frame did not expose a camera for its drag target');
    const seedPoint =
      explicitDragPoint?.length === 2 && explicitDragPoint.every(Number.isFinite)
        ? { x: explicitDragPoint[0] + box.x, y: explicitDragPoint[1] + box.y }
        : fixtureDragPoint(opened.seeded, box, camera);
    partial.fixtureDragPoint = seedPoint;
    const resolved = await resolveDragTarget(page, seedPoint);
    partial.fixtureDragTarget = resolved;
    scene = { dragTarget: resolved };
    partial.sceneNodeCount = opened.seeded?.nodeCount ?? null;
    console.log(`Fixture opened: ${FIXTURE} (${opened.seeded?.nodeCount} nodes)`);
  } else {
    box = await openEditorCanvas(page);
    await page.waitForFunction(() => Boolean(window.__varvePerf), undefined, { timeout: 30_000 });
    partial.sceneSpread = args.get('no-spread') !== 'true';
    scene = await buildScene(page, box, DUPLICATIONS, partial.sceneSpread);
    partial.sceneNodeCount = scene.nodeCount;
    console.log(`Scene built: ${scene.nodeCount} nodes`);
  }

  await page.waitForTimeout(1_500);
  partial.rendererQualification = await inspectRendererMode(page, RENDERER_MODE);
  const editorResourceState = await readScriptResourceState(page);
  const initialResources = new Map(
    (partial.homeBundleCost?.resources ?? []).map((resource) => [resource.resource, resource]),
  );
  const addedResources = editorResourceState.resources.filter((resource) => {
    const initial = initialResources.get(resource.resource);
    return !initial || initial.encodedBytes !== resource.encodedBytes;
  });
  const navigation = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0];
    return entry
      ? {
          responseStartMs: entry.responseStart,
          domContentLoadedMs: entry.domContentLoadedEventEnd,
          loadMs: entry.loadEventEnd,
        }
      : null;
  });
  partial.startupAndBundleCost = {
    startup: navigation,
    homeHeapBytes: partial.homeBundleCost?.heapBytes ?? null,
    editorOpenHeapBytes: editorResourceState.heapBytes,
    homeScriptEncodedBytes: (partial.homeBundleCost?.resources ?? []).reduce(
      (sum, resource) => sum + (resource.encodedBytes ?? 0),
      0,
    ),
    editorAddedScriptEncodedBytes: addedResources.reduce(
      (sum, resource) => sum + (resource.encodedBytes ?? 0),
      0,
    ),
    editorAddedScriptDecodedBytes: addedResources.reduce(
      (sum, resource) => sum + (resource.decodedBytes ?? 0),
      0,
    ),
    likelyRendererChunks: addedResources.filter((resource) =>
      /webgl|compositor/i.test(resource.resource),
    ),
    addedResources,
  };
  partial.sourceArtifact = {
    commit: partial.identity.commit,
    dirty: partial.identity.dirty,
    appBundleSha256: existsSync(DIST) ? hashDirectory(DIST) : null,
    host: 'chromium-browser',
  };
  partial.environment = await page.evaluate(
    (webglEvidence) => ({
      userAgent: navigator.userAgent,
      dpr: window.devicePixelRatio,
      theme:
        document.documentElement.dataset.theme ??
        document.body.dataset.theme ??
        getComputedStyle(document.documentElement).colorScheme,
      trustedInputDriver: 'Playwright CDP browser input',
      webglHardwareExecution: webglEvidence?.hardwareExecution ?? 'unknown',
      navigation: (() => {
        const nav = performance.getEntriesByType('navigation')[0];
        return nav
          ? {
              responseStartMs: nav.responseStart,
              domContentLoadedMs: nav.domContentLoadedEventEnd,
              loadMs: nav.loadEventEnd,
            }
          : null;
      })(),
      scriptResources: performance
        .getEntriesByType('resource')
        .filter((entry) => entry.initiatorType === 'script' || /\.js(?:\?|$)/.test(entry.name))
        .map((entry) => ({
          resource: new URL(entry.name).pathname,
          encodedBytes: entry.encodedBodySize || null,
          decodedBytes: entry.decodedBodySize || null,
        })),
    }),
    partial.webglRuntimeEvidence,
  );

  return { page, box, scene };
}

export async function prepareBaseline({ page, partial, rendererAvailable }) {
  const baselineCamera = rendererAvailable
    ? await page.evaluate(() => {
        const frame = window.__varvePerf?.getFrames?.(1)?.at(-1);
        return frame?.camera
          ? {
              zoom: frame.camera.zoom,
              pan: { x: frame.camera.panX, y: frame.camera.panY },
              rotation: frame.camera.rotation,
            }
          : null;
      })
    : null;
  partial.baselineCamera = baselineCamera;
  if (rendererAvailable && !baselineCamera) fail('renderer frame did not expose a baseline camera');
  const restoreBaselineCamera = async () => {
    const cameraSet = await page.evaluate((camera) => {
      const perf = window.__varvePerf;
      const frameCamera = perf?.getFrames?.(1)?.at(-1)?.camera;
      const alreadyAtBaseline = Boolean(
        frameCamera &&
          frameCamera.zoom === camera.zoom &&
          frameCamera.panX === camera.pan.x &&
          frameCamera.panY === camera.pan.y &&
          frameCamera.rotation === (camera.rotation ?? 0),
      );
      if (alreadyAtBaseline) return true;
      return perf?.camera?.setState?.(camera) === true;
    }, baselineCamera);
    if (!cameraSet) throw new Error('cannot reset the benchmark camera through the perf handle');
    await page.waitForFunction(
      (camera) => {
        const frame = window.__varvePerf?.getFrames?.(1)?.at(-1);
        return Boolean(
          frame?.camera &&
            frame.camera.zoom === camera.zoom &&
            frame.camera.panX === camera.pan.x &&
            frame.camera.panY === camera.pan.y &&
            frame.camera.rotation === (camera.rotation ?? 0),
        );
      },
      baselineCamera,
      { timeout: 3_000, polling: 'raf' },
    );
    const oracle = await page.evaluate(async () => window.__varvePerf?.forceFullRedraw?.());
    if (oracle?.authoritative !== true)
      throw new Error('camera reset did not produce an authoritative full redraw');
  };
  let baselineSceneFingerprint = null;
  if (rendererAvailable) {
    await restoreBaselineCamera();
    baselineSceneFingerprint = await contentCanvasDigest(page);
  }
  partial.scenePixelsSha256 = baselineSceneFingerprint;
  if (SNAPSHOT) {
    const snapshotPath = pathResolve(SNAPSHOT);
    mkdirSync(pathDirname(snapshotPath), { recursive: true });
    const snapshot = await page.locator('canvas.editor-canvas__content-layer').screenshot({
      path: snapshotPath,
      animations: 'disabled',
    });
    partial.scenePngSha256 = createHash('sha256').update(snapshot).digest('hex');
    partial.scenePngPath = snapshotPath;
  }

  return { restoreBaselineCamera, baselineSceneFingerprint };
}

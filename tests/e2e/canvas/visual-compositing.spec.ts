/**
 * Full-editor visual coverage for the orchestration layer above replayIr.
 *
 * The replay visual harness intentionally stays flat. These tests exercise
 * the real CanvasArea/replaySubtreeToCtx path so group isolation, container
 * opacity, and structural clipping cannot regress while the primitive replay
 * snapshots remain green.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { dropImageOnCanvas } from '../helpers/editor-helpers';
import { navigateToCleanEditor } from '../helpers/nav';
import { dragOnCanvas } from '../shared';

const CANVAS = 'canvas.editor-canvas__content-layer';
const requireFromEngine = createRequire(join(process.cwd(), 'packages', 'engine', 'package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

async function exportCurrentPng(
  page: import('@playwright/test').Page,
): Promise<{ width: number; height: number; data: Buffer }> {
  const exportTab = page.locator('[role="tablist"] button[role="tab"]', { hasText: /^export$/i });
  if (await exportTab.isVisible().catch(() => false)) {
    await exportTab.click();
  } else {
    await page.getByRole('button', { name: /^More inspector tabs/ }).click();
    await page
      .getByRole('menu', { name: 'More inspector tabs' })
      .getByRole('menuitem', { name: 'Export', exact: true })
      .click();
  }
  await page
    .locator('.spec-export__group')
    .getByRole('radio', { name: 'PNG', exact: true })
    .click();
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.getByRole('button', { name: /download/i }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('PNG export did not produce a file');
  const { readFile } = await import('node:fs/promises');
  return PNG.sync.read(await readFile(path));
}

async function createRect(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<void> {
  await page.keyboard.press('r');
  await dragOnCanvas(page, x, y, x + w, y + h);
  await page.keyboard.press('v');
}

async function waitForArtwork(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    (selector) => {
      const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255) return true;
      }
      return false;
    },
    CANVAS,
    { timeout: 15000 },
  );
}

/**
 * Commit an authoritative full frame before a canvas capture.
 *
 * Partial (dirty-rect) redraw and the camera-only worker path can leave a
 * previous frame on the surface; the clip-mask composite has been observed to
 * alternate between a fully-decoded frame and a partly-composited one. The
 * oracle redraws the current camera from IR, so the capture is deterministic.
 * Requires `?perf=1`.
 */
async function forceAuthoritativeCanvasFrame(page: import('@playwright/test').Page): Promise<void> {
  const result = (await page.evaluate(async () => {
    const perf = (
      window as unknown as {
        __varvePerf?: { forceFullRedraw?: () => Promise<{ authoritative: boolean }> };
      }
    ).__varvePerf;
    return (await perf?.forceFullRedraw?.()) ?? null;
  })) as { authoritative: boolean } | null;
  expect(result, 'full-redraw oracle must be installed (?perf=1)').toBeTruthy();
  expect(result?.authoritative, 'oracle must commit a fresh full frame').toBe(true);
}

async function canvasPixelHash(page: import('@playwright/test').Page): Promise<number> {
  return page.locator(CANVAS).evaluate((element) => {
    const { data } = (element as HTMLCanvasElement)
      .getContext('2d')!
      .getImageData(
        0,
        0,
        (element as HTMLCanvasElement).width,
        (element as HTMLCanvasElement).height,
      );
    let hash = 2166136261;
    for (let index = 0; index < data.length; index++) {
      hash = Math.imul(hash ^ data[index]!, 16777619);
    }
    return hash >>> 0;
  });
}

async function compositionCacheDiagnostics(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const cache = (
      window as Window & {
        __varvePerf?: {
          compositionCache?: {
            diagnostics: () => {
              hits: number;
              misses: number;
              residentBytes: number;
              budgetBytes: number;
              avoidedShapeLeaves: number;
              detailed: null | {
                trackedGroupKeys: number;
                retainedBypassRecords: number;
                bypasses: Array<{ reason: string; groupId?: string; dependencyPath?: string[] }>;
                timings: {
                  keyBuildAverageMs: number;
                  lookupAverageMs: number;
                  compositionAverageMs: number;
                };
                quality: { generation: number; backend: string };
              };
            };
            setEnabled: (enabled: boolean) => void;
            resetDiagnostics: () => void;
          };
        };
      }
    ).__varvePerf?.compositionCache;
    return cache?.diagnostics() ?? null;
  });
}

async function forceRedrawReplayMs(page: import('@playwright/test').Page): Promise<number> {
  const frame = await page.evaluate(async () => {
    const perf = (
      window as unknown as {
        __varvePerf?: {
          forceFullRedraw?: () => Promise<{ authoritative: boolean }>;
          getLast?: () => { replayMs?: number } | null;
        };
      }
    ).__varvePerf;
    const result = await perf?.forceFullRedraw?.();
    return result?.authoritative ? (perf?.getLast?.()?.replayMs ?? null) : null;
  });
  expect(frame, 'each sample must be an authoritative frame').not.toBeNull();
  return frame as number;
}

/**
 * Wait until the content canvas stops changing. The dropped JPEG decodes
 * asynchronously, so the first painted frame can be a partial image; a full
 * redraw alone cannot advance past that, it just redraws the current IR. Poll
 * a content hash until two samples ~400ms apart agree.
 */
async function waitForStableCanvas(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    (selector) => {
      const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
      const context = canvas.getContext('2d');
      if (!context) return false;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let hash = 2166136261;
      for (let offset = 0; offset < data.length; offset += 4) {
        hash = Math.imul(hash ^ (data[offset] ?? 0), 16777619);
        hash = Math.imul(hash ^ (data[offset + 1] ?? 0), 16777619);
        hash = Math.imul(hash ^ (data[offset + 2] ?? 0), 16777619);
        hash = Math.imul(hash ^ (data[offset + 3] ?? 0), 16777619);
      }
      const state = window as Window & {
        __varveCanvasHash?: number;
        __varveCanvasStableSince?: number;
      };
      const now = Date.now();
      if (state.__varveCanvasHash !== hash) {
        state.__varveCanvasHash = hash;
        state.__varveCanvasStableSince = now;
        return false;
      }
      return now - (state.__varveCanvasStableSince ?? now) > 400;
    },
    CANVAS,
    { timeout: 20000 },
  );
}

async function hideEditorChromeForCanvasCapture(
  page: import('@playwright/test').Page,
): Promise<void> {
  // Playwright element screenshots capture the canvas' page rectangle. The
  // production selection overlay, floating toolbar, and contextual hint can
  // overlap that rectangle without being pixels in the content canvas. Hide
  // only those presentation layers so this assertion is about compositor
  // output; the layers-panel screenshot below still covers the user-visible
  // hierarchy and selection state.
  await page.addStyleTag({
    content: `
      .editor-canvas__grid-layer,
      .editor-canvas__pixel-grid,
      .editor-canvas__overlay-layer,
      .editor-canvas__color-blindness,
      .editor-canvas__zoom-indicator,
      .editor-canvas svg[role="presentation"],
      .micro-hint,
      .floating-toolbar,
      .selection-breadcrumb { visibility: hidden !important; }
    `,
  });
}

async function callEditor(
  page: import('@playwright/test').Page,
  method: string,
  ...args: unknown[]
): Promise<unknown> {
  return page.evaluate(
    ({ method, args }) => {
      const root = document.getElementById('root');
      if (!root) return null;
      const key = Object.keys(root).find(
        (candidate) =>
          candidate.startsWith('__reactFiber$') || candidate.startsWith('__reactContainer$'),
      );
      if (!key) return null;
      function find(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const value = (props as Record<string, unknown> | undefined)?.value;
          if (value && typeof value === 'object' && 'serializeDocument' in value) {
            return value as Record<string, unknown>;
          }
        }
        return (
          find(fiber.child as Record<string, unknown> | null) ||
          find(fiber.sibling as Record<string, unknown> | null)
        );
      }
      const context = find(
        (root as unknown as Record<string, unknown>)[key] as Record<string, unknown> | null,
      );
      const fn = context?.[method] as ((...values: unknown[]) => unknown) | undefined;
      return typeof fn === 'function' ? fn(...(args as unknown[])) : null;
    },
    { method, args },
  );
}

test.describe('full-editor visual compositing', () => {
  // Each case opens its own editor; keep failures from skipping the rest of
  // the compositing visual suite.
  test.describe.configure({ mode: 'default' });

  test('nested groups preserve isolated opacity and container compositing', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('varve.renderWorker', 'off'));
    await navigateToCleanEditor(page, '?perf=1');

    // Overlap the three shapes so group opacity is observable as one isolated
    // surface instead of three independent child alpha operations.
    await createRect(page, 100, 100, 180, 120);
    await createRect(page, 160, 140, 180, 120);
    await createRect(page, 220, 180, 180, 120);
    await expect(page.getByRole('treeitem')).toHaveCount(3, { timeout: 10000 });

    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    expect(await callEditor(page, 'groupSelected')).not.toBeNull();
    const group = page
      .getByRole('treeitem')
      .filter({ hasText: /^Group\b/ })
      .first();
    await expect(group).toBeVisible();

    // Select the new group and the remaining top-level rectangle, then group
    // again. This creates the nested container path that the flat harness
    // cannot represent.
    await group.click();
    await page
      .getByRole('treeitem')
      .filter({ hasText: /^Rectangle\b/ })
      .last()
      .click({ modifiers: ['Control'] });
    expect(await callEditor(page, 'groupSelected')).not.toBeNull();
    const outerGroup = page
      .getByRole('treeitem')
      .filter({ hasText: /^Group\b/ })
      .first();
    await expect(outerGroup).toBeVisible();
    await outerGroup.click();
    expect(await callEditor(page, 'setSelectedOpacity', 0.72)).not.toBeNull();

    await waitForArtwork(page);
    await waitForStableCanvas(page);
    await hideEditorChromeForCanvasCapture(page);
    await forceAuthoritativeCanvasFrame(page);
    const canvas = page.locator(CANVAS);
    await expect(canvas).toHaveScreenshot('nested-groups-isolated-opacity.png', {
      maxDiffPixels: 350,
    });
    const layersPanel = page.getByTestId('layers-panel');
    // At the 720px E2E viewport the Layers rail itself scrolls to keep the
    // tree usable. Clicking a lower selected row can scroll that outer rail,
    // which otherwise makes this panel golden depend on the selection's
    // reveal position rather than the panel's canonical top-of-rail layout.
    await layersPanel.evaluate((panel) => {
      panel.scrollTop = 0;
      const tree = panel.querySelector<HTMLElement>('.layers-panel__tree');
      if (tree) tree.scrollTop = 0;
    });
    await expect
      .poll(async () =>
        layersPanel.evaluate((panel) => ({
          rail: panel.scrollTop,
          tree: panel.querySelector<HTMLElement>('.layers-panel__tree')?.scrollTop ?? 0,
        })),
      )
      .toEqual({ rail: 0, tree: 0 });
    await expect(layersPanel).toHaveScreenshot('nested-groups-layer-tree.png', {
      maxDiffPixels: 180,
    });
  });

  test('reuses an independent isolated group and matches a cache-bypassed composition', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('varve.renderWorker', 'off'));
    await navigateToCleanEditor(page, '?perf=1');
    const contentCanvas = page.locator(CANVAS);
    if ((await contentCanvas.count()) === 0) {
      // Some Home startup paths create the untitled document in Recent without
      // entering it. Open that saved draft before driving real canvas input.
      await page.getByText('Untitled 1', { exact: true }).dblclick();
    }
    await contentCanvas.waitFor({ state: 'attached', timeout: 30000 });
    for (let index = 0; index < 12; index++) {
      const col = index % 4;
      const row = Math.floor(index / 4);
      await createRect(page, 80 + col * 95, 85 + row * 90, 74, 66);
    }
    await createRect(page, 520, 390, 90, 80);
    await expect(page.getByRole('treeitem')).toHaveCount(13, { timeout: 10000 });

    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    for (let index = 1; index < 12; index++) {
      await rows.nth(index).click({ modifiers: ['Control'] });
    }
    expect(await callEditor(page, 'groupSelected')).not.toBeNull();
    await page
      .getByRole('treeitem')
      .filter({ hasText: /^Group\b/ })
      .first()
      .click();
    expect(await callEditor(page, 'setSelectedOpacity', 0.7)).not.toBeNull();
    await waitForStableCanvas(page);

    await page.evaluate(() => {
      const cache = (
        window as Window & {
          __varvePerf?: { compositionCache?: { resetDiagnostics: () => void } };
        }
      ).__varvePerf?.compositionCache;
      cache?.resetDiagnostics();
    });
    await forceAuthoritativeCanvasFrame(page);
    const firstWarm = await compositionCacheDiagnostics(page);
    expect(
      firstWarm?.hits,
      'a repeated authoritative frame must use retained group pixels',
    ).toBeGreaterThan(0);
    expect(firstWarm?.avoidedShapeLeaves).toBeGreaterThan(0);
    const cachedHash = await canvasPixelHash(page);

    // Change the separate top-level shape. The isolated group's child IR and
    // ordered dependency identities remain unchanged, so it should still hit.
    await page
      .getByRole('treeitem')
      .filter({ hasText: /^Rectangle\b/ })
      .first()
      .click();
    expect(await callEditor(page, 'setSelectedOpacity', 0.45)).not.toBeNull();
    await waitForStableCanvas(page);
    await forceAuthoritativeCanvasFrame(page);
    const afterIndependentEdit = await compositionCacheDiagnostics(page);
    expect(afterIndependentEdit?.hits).toBeGreaterThan(firstWarm?.hits ?? 0);
    expect(afterIndependentEdit?.avoidedShapeLeaves).toBeGreaterThan(
      firstWarm?.avoidedShapeLeaves ?? 0,
    );
    const independentEditHash = await canvasPixelHash(page);
    const cachedReplaySamples: number[] = [];
    for (let index = 0; index < 7; index++) {
      cachedReplaySamples.push(await forceRedrawReplayMs(page));
    }
    await hideEditorChromeForCanvasCapture(page);
    await page.locator(CANVAS).screenshot({ path: '/tmp/varve-composition-cache-hit.png' });

    await page.evaluate(() => {
      const cache = (
        window as Window & {
          __varvePerf?: { compositionCache?: { setEnabled: (enabled: boolean) => void } };
        }
      ).__varvePerf?.compositionCache;
      cache?.setEnabled(false);
    });
    const freshReplaySamples: number[] = [];
    for (let index = 0; index < 7; index++) {
      freshReplaySamples.push(await forceRedrawReplayMs(page));
    }
    const freshHash = await canvasPixelHash(page);
    expect(freshHash, 'the retained source canvas must match uncached subtree composition').toBe(
      independentEditHash,
    );
    expect(freshHash).not.toBe(cachedHash);
    await page.locator(CANVAS).screenshot({ path: '/tmp/varve-composition-cache-fresh.png' });
    await test.info().attach('composition-cache-replay-samples.json', {
      body: Buffer.from(JSON.stringify({ cachedReplaySamples, freshReplaySamples }, null, 2)),
      contentType: 'application/json',
    });
    console.log(
      'composition-cache-replay-samples',
      JSON.stringify({ cachedReplaySamples, freshReplaySamples }),
    );
    console.log('composition-cache-residency', JSON.stringify({ firstWarm, afterIndependentEdit }));
  });

  test('keeps a real poster fixture group fresh across an independent edit', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('varve.renderWorker', 'off');
      localStorage.setItem(
        'varve-editor-settings',
        JSON.stringify({ render: { memoryBudget: 'low' } }),
      );
    });
    await navigateToCleanEditor(page, '?perf=1');
    const contentCanvas = page.locator(CANVAS);
    if ((await contentCanvas.count()) === 0) {
      await page.getByText('Untitled 1', { exact: true }).dblclick();
    }
    await contentCanvas.waitFor({ state: 'attached', timeout: 30000 });

    // This repository-owned Varve document includes curved paths, transparency,
    // gradient ground, typography, and a multiply-blended disc.
    await page.setInputFiles('#file-open-input', 'scripts/screenshots/fixtures/poster.varve');
    await expect(
      page.locator('.editor-tabs__tab').filter({ hasText: 'poster.varve' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: /fit all to viewport/i })
      .first()
      .click();
    await waitForStableCanvas(page);

    const layers = page.getByRole('treeitem');
    const bands = [
      layers.filter({ hasText: 'Layer — teal' }),
      layers.filter({ hasText: 'Layer — sandstone' }),
      layers.filter({ hasText: 'Layer — terracotta' }),
    ];
    for (const band of bands) await expect(band).toHaveCount(1);
    await bands[0]!.click();
    await bands[1]!.click({ modifiers: ['Control'] });
    await bands[2]!.click({ modifiers: ['Control'] });
    expect(await callEditor(page, 'groupSelected')).not.toBeNull();

    const group = page
      .getByRole('treeitem')
      .filter({ hasText: /^Group\b/ })
      .first();
    await expect(group).toBeVisible();
    await group.click();
    expect(await callEditor(page, 'setSelectedOpacity', 0.7)).not.toBeNull();
    await waitForStableCanvas(page);

    await page.evaluate(() => {
      const cache = (
        window as Window & {
          __varvePerf?: { compositionCache?: { resetDiagnostics: () => void } };
        }
      ).__varvePerf?.compositionCache;
      cache?.resetDiagnostics();
    });
    await forceAuthoritativeCanvasFrame(page);
    const warm = await compositionCacheDiagnostics(page);
    expect(warm?.hits).toBeGreaterThan(0);
    expect(warm?.avoidedShapeLeaves).toBeGreaterThanOrEqual(3);
    expect(warm?.budgetBytes).toBeLessThanOrEqual(8 * 1024 * 1024);

    const cachedHash = await canvasPixelHash(page);
    const cachedCapture = await contentCanvas.screenshot();
    await testInfo.attach('poster-with-retained-group', {
      body: cachedCapture,
      contentType: 'image/png',
    });

    // The multiply-blended disc is outside the retained group. Its opacity
    // changes the document while the three path dependencies remain stable.
    const disc = page.getByRole('treeitem', { name: /^Disc, Vector ellipse/ });
    await expect(disc).toHaveCount(1);
    await disc.click();
    expect(await callEditor(page, 'setSelectedOpacity', 0.72)).not.toBeNull();
    await waitForStableCanvas(page);
    await forceAuthoritativeCanvasFrame(page);
    const afterIndependentEdit = await compositionCacheDiagnostics(page);
    expect(afterIndependentEdit?.hits).toBeGreaterThan(warm?.hits ?? 0);
    expect(afterIndependentEdit?.avoidedShapeLeaves).toBeGreaterThan(warm?.avoidedShapeLeaves ?? 0);
    const editedCachedHash = await canvasPixelHash(page);
    expect(editedCachedHash).not.toBe(cachedHash);

    await page.evaluate(() => {
      const cache = (
        window as Window & {
          __varvePerf?: { compositionCache?: { setEnabled: (enabled: boolean) => void } };
        }
      ).__varvePerf?.compositionCache;
      cache?.setEnabled(false);
    });
    await forceAuthoritativeCanvasFrame(page);
    const bypassedHash = await canvasPixelHash(page);
    const bypassedCapture = await contentCanvas.screenshot();
    await testInfo.attach('poster-cache-bypassed-after-independent-edit', {
      body: bypassedCapture,
      contentType: 'image/png',
    });
    expect(bypassedHash).toBe(editedCachedHash);

    await page.evaluate(() => {
      const cache = (
        window as Window & {
          __varvePerf?: {
            compositionCache?: {
              setEnabled: (enabled: boolean) => void;
              resetDiagnostics: () => void;
            };
          };
        }
      ).__varvePerf?.compositionCache;
      cache?.setEnabled(true);
      cache?.resetDiagnostics();
    });
    await forceAuthoritativeCanvasFrame(page);
    const repopulatedAfterBypass = await compositionCacheDiagnostics(page);
    expect(repopulatedAfterBypass?.misses).toBeGreaterThan(0);
    await forceAuthoritativeCanvasFrame(page);
    const warmedAfterBypass = await compositionCacheDiagnostics(page);
    expect(warmedAfterBypass?.hits).toBeGreaterThan(0);

    // Editing a cached dependency must invalidate that group's retained pixels.
    const groupedBand = page.getByRole('treeitem', { name: /^Layer — teal, Vector path/ });
    await expect(groupedBand).toHaveCount(1);
    await groupedBand.click();
    const exportBeforeGroupedChildEdit = await exportCurrentPng(page);
    expect(await callEditor(page, 'setSelectedOpacity', 0.6)).not.toBeNull();
    await waitForStableCanvas(page);
    const exportAfterGroupedChildEdit = await exportCurrentPng(page);
    expect(exportAfterGroupedChildEdit.width).toBe(exportBeforeGroupedChildEdit.width);
    expect(exportAfterGroupedChildEdit.height).toBe(exportBeforeGroupedChildEdit.height);
    expect(exportAfterGroupedChildEdit.data.equals(exportBeforeGroupedChildEdit.data)).toBe(false);
    await forceAuthoritativeCanvasFrame(page);
    const afterGroupedChildEdit = await compositionCacheDiagnostics(page);
    expect(afterGroupedChildEdit?.misses).toBeGreaterThan(warmedAfterBypass?.misses ?? 0);
    expect(
      afterGroupedChildEdit?.detailed?.bypasses.some(
        (record) => record.reason === 'dependency-key-changed',
      ),
    ).toBe(true);
    expect(afterGroupedChildEdit?.detailed?.timings.keyBuildAverageMs).toBeGreaterThanOrEqual(0);
    expect(afterGroupedChildEdit?.detailed?.timings.lookupAverageMs).toBeGreaterThanOrEqual(0);
    expect(afterGroupedChildEdit?.detailed?.timings.compositionAverageMs).toBeGreaterThanOrEqual(0);
    expect(afterGroupedChildEdit?.detailed?.quality.backend).toBe('canvas-2d');
    const childEditedCachedHash = await canvasPixelHash(page);
    expect(childEditedCachedHash).not.toBe(editedCachedHash);
    const childEditedCachedCapture = await contentCanvas.screenshot({
      path: 'docs/screenshots/dependency-aware-composition/poster-grouped-child-cached.png',
    });
    await testInfo.attach('poster-cache-enabled-after-grouped-child-edit', {
      body: childEditedCachedCapture,
      contentType: 'image/png',
    });

    await page.evaluate(() => {
      const cache = (
        window as Window & {
          __varvePerf?: { compositionCache?: { setEnabled: (enabled: boolean) => void } };
        }
      ).__varvePerf?.compositionCache;
      cache?.setEnabled(false);
    });
    await forceAuthoritativeCanvasFrame(page);
    const childEditedBypassedHash = await canvasPixelHash(page);
    const childEditedBypassedCapture = await contentCanvas.screenshot({
      path: 'docs/screenshots/dependency-aware-composition/poster-grouped-child-bypassed.png',
    });
    await testInfo.attach('poster-cache-bypassed-after-grouped-child-edit', {
      body: childEditedBypassedCapture,
      contentType: 'image/png',
    });
    expect(childEditedBypassedHash).toBe(childEditedCachedHash);
  });

  test('clip mask is visible in the real canvas and layer hierarchy', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('varve.renderWorker', 'off'));
    await navigateToCleanEditor(page, '?perf=1');
    await dropImageOnCanvas(page, 'photo-fixture.jpg', 380, 120);
    await createRect(page, 100, 100, 260, 240);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+7');
    await expect(page.getByRole('treeitem').filter({ hasText: /clip/i }).first()).toBeVisible({
      timeout: 10000,
    });
    await waitForArtwork(page);

    await waitForStableCanvas(page);
    await hideEditorChromeForCanvasCapture(page);
    await forceAuthoritativeCanvasFrame(page);
    const canvas = page.locator(CANVAS);
    await expect(canvas).toHaveScreenshot('clip-mask-canvas-output.png', {
      // The clip-mask composite alternates between two authoritative frames on
      // the runner (a ~1564px / max-channel-194 difference in the masked image
      // region) even with the render worker pinned off and an oracle full
      // redraw, so no single baseline satisfies both. The bound covers the
      // measured variance while still failing on any larger compositing
      // regression.
      maxDiffPixels: 2500,
    });
    await expect(page.getByTestId('layers-panel')).toHaveScreenshot(
      'clip-mask-layer-hierarchy.png',
      {
        // The document thumbnail composites the same clip-mask result as the
        // canvas above, so it inherits the same two-state alternation: the
        // masked edge rasterizes ~600px (0.01) apart between the two
        // authoritative frames (607 locally, 595 on the runner) with the
        // render worker pinned off. No single baseline satisfies both; the
        // bound covers the measured variance while still failing on any larger
        // compositing regression in the panel.
        maxDiffPixels: 900,
      },
    );
  });
});

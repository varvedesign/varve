/**
 * Observational edit-to-correct-frame profile for an authored grid.
 * It records the first content frame and updated grid overlay after each
 * inspector edit, then checks the final live canvas against a full redraw.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test('grid track edits reach a correct content and overlay frame', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page, '/?perf=1');

  await page.keyboard.press('f');
  await dragOnCanvas(page, 24, 24, 248, 168);
  await page.getByRole('treeitem').first().click();
  const mode = page.getByRole('combobox', { name: 'Layout mode' });
  await mode.click();
  await page.getByRole('option', { name: 'Grid', exact: true }).click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await dragOnCanvas(page, 60, 60, 132, 108);
  await page.locator('[role="treeitem"][data-layer-type="frame"]').first().click();
  const add = page.getByRole('button', { name: 'Add column', exact: true });
  await expect(add).toBeVisible();
  await add.click();

  const samples: number[] = [];
  for (let index = 0; index < 8; index++) {
    const start = await page.evaluate(() => {
      const perf = (
        window as unknown as {
          __varvePerf?: {
            getLast: () => { frameIndex?: number } | null;
            getFrames: (
              count: number,
            ) => Array<{ frameIndex?: number; frameDecision?: string; committedAt?: number }>;
          };
        }
      ).__varvePerf;
      if (!perf) throw new Error('performance diagnostics are unavailable');
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas.editor-canvas__overlay-layer',
      );
      const context = canvas?.getContext('2d');
      if (!canvas || !context) throw new Error('grid overlay is unavailable');
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (let offset = 3; offset < pixels.length; offset += 4) {
        hash = Math.imul(hash ^ pixels[offset]!, 16777619);
      }
      const target = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === 'Add column',
      );
      if (!target) throw new Error('add-column control is unavailable');
      const marker = {
        startedAt: 0,
        previousFrame: perf.getLast()?.frameIndex ?? -1,
        overlayHash: hash >>> 0,
      };
      const completed = new Promise<number>((resolve, reject) => {
        target.addEventListener(
          'click',
          () => {
            marker.startedAt = performance.now();
            const deadline = marker.startedAt + 5_000;
            const inspect = () => {
              try {
                if (performance.now() >= deadline) {
                  reject(new Error('layout edit did not reach a new content and overlay frame'));
                  return;
                }
                const frame = perf
                  .getFrames(32)
                  .find(
                    (entry) =>
                      (entry.frameIndex ?? -1) > marker.previousFrame &&
                      entry.frameDecision === 'content' &&
                      (entry.committedAt ?? 0) >= marker.startedAt,
                  );
                const overlay = document.querySelector<HTMLCanvasElement>(
                  'canvas.editor-canvas__overlay-layer',
                );
                const overlayContext = overlay?.getContext('2d');
                if (frame && overlay && overlayContext) {
                  const nextPixels = overlayContext.getImageData(
                    0,
                    0,
                    overlay.width,
                    overlay.height,
                  ).data;
                  let nextHash = 2166136261;
                  for (let offset = 3; offset < nextPixels.length; offset += 4) {
                    nextHash = Math.imul(nextHash ^ nextPixels[offset]!, 16777619);
                  }
                  if (nextHash >>> 0 !== marker.overlayHash) {
                    resolve(performance.now() - marker.startedAt);
                    return;
                  }
                }
                requestAnimationFrame(inspect);
              } catch (error) {
                reject(error);
              }
            };
            requestAnimationFrame(inspect);
          },
          { capture: true, once: true },
        );
      });
      (window as unknown as { __layoutFramePromise?: Promise<number> }).__layoutFramePromise =
        completed;
      return { previousFrame: marker.previousFrame };
    });
    expect(start.previousFrame).toBeGreaterThanOrEqual(0);
    await add.click();
    const elapsed = await page.evaluate(() => {
      const completed = (window as unknown as { __layoutFramePromise?: Promise<number> })
        .__layoutFramePromise;
      if (!completed) throw new Error('layout edit marker is unavailable');
      return completed;
    });
    expect(elapsed).toBeGreaterThan(0);
    samples.push(elapsed);
  }

  const hash = async () =>
    page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!pixels) throw new Error('content canvas is unavailable');
      let value = 2166136261;
      for (let offset = 0; offset < pixels.length; offset++) {
        value = Math.imul(value ^ pixels[offset]!, 16777619);
      }
      return value >>> 0;
    });
  const live = await hash();
  const oracle = await page.evaluate(() =>
    (
      window as unknown as {
        __varvePerf?: { forceFullRedraw: () => Promise<{ authoritative: boolean }> };
      }
    ).__varvePerf?.forceFullRedraw(),
  );
  expect(oracle?.authoritative).toBe(true);
  expect(await hash()).toBe(live);

  const sorted = [...samples].sort((a, b) => a - b);
  const result = {
    corpus: 'two-card-grid/add-column',
    viewport: { width: 1280, height: 800 },
    samples,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
  console.log(JSON.stringify(result));
  await info.attach('layout-frame-latency.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});

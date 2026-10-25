import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function createRulerGuide(page: import('@playwright/test').Page) {
  const ruler = page.locator('.ruler-canvas--top');
  await expect(ruler).toBeVisible();
  const bounds = await ruler.boundingBox();
  if (!bounds) throw new Error('top ruler not found');
  await page.mouse.move(bounds.x + 120, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 160, bounds.y + bounds.height / 2, { steps: 4 });
  await page.mouse.up();
}

async function contentHash(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!data) throw new Error('content canvas is unavailable');
    let hash = 2166136261;
    for (const byte of data) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return `${canvas.width}x${canvas.height}:${hash >>> 0}`;
  });
}

/**
 * Right-click the guide itself. An SVG <line> with x1 === x2 has a zero-width
 * bounding box, which Playwright reads as "not visible" and refuses to click —
 * and the old "canvas origin + x1" arithmetic only lands on the line while the
 * viewBox maps 1:1 to CSS pixels (true at the original size, false after a
 * resize). Read the line's real screen rect, then scan it for a point whose
 * hit test is the guide itself (at narrow sizes the guide can sit under the
 * left ruler canvas, which covers part of the overlay's x range).
 */
async function rightClickGuideLine(
  page: import('@playwright/test').Page,
  guideLine: import('@playwright/test').Locator,
) {
  const probe = await guideLine.evaluate((element) => {
    const line = element as SVGLineElement;
    const rect = line.getBoundingClientRect();
    const ruler = document.querySelector('.ruler-canvas--left')?.getBoundingClientRect() ?? null;
    const surface =
      document.querySelector('canvas.editor-canvas__content-layer')?.getBoundingClientRect() ??
      null;
    const describe = (el: Element | null) =>
      el ? `${el.tagName}.${String(el.getAttribute('class') ?? '')}` : 'none';
    const samples: string[] = [];
    let pick: { x: number; y: number; probe: string } | null = null;
    const yStart = Math.max(rect.top, 1);
    const yEnd = Math.min(rect.bottom, window.innerHeight - 1);
    for (let y = yStart + 4; y < yEnd - 4 && !pick; y += 14) {
      for (const dx of [0, -1, 1, -2, 2]) {
        const hit = document.elementFromPoint(rect.x + dx, y);
        const tag = describe(hit);
        if (tag.includes('guide-overlay')) {
          pick = { x: rect.x + dx, y, probe: tag };
          break;
        }
      }
      samples.push(`${Math.round(y)}:${describe(document.elementFromPoint(rect.x, y))}`);
    }
    return {
      x: pick?.x ?? rect.x,
      y: pick?.y ?? (yStart + yEnd) / 2,
      probe: pick?.probe ?? `NOT-FOUND samples=${samples.join(' ')}`,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      ruler: ruler ? { x: ruler.x, w: ruler.width } : null,
      surface: surface ? { x: surface.x, w: surface.width } : null,
      x1: Number(line.getAttribute('x1')),
    };
  });
  console.info(
    `[two-point] pick=(${probe.x.toFixed(1)},${probe.y.toFixed(1)}) probe=${probe.probe} lineRect=${JSON.stringify(probe.rect)} ruler=${JSON.stringify(probe.ruler)} surface=${JSON.stringify(probe.surface)} x1=${probe.x1}`,
  );
  if (probe.probe.startsWith('NOT-FOUND')) {
    throw new Error(`no hittable point on the guide line: ${probe.probe}`);
  }
  await page.mouse.click(probe.x, probe.y, { button: 'right' });
}

test('two-point perspective assistance stays a draggable view overlay', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await createRulerGuide(page);
  const guideLine = page.locator('.guide-overlay__line').first();
  await expect(page.locator('.guide-overlay__line')).toHaveCount(1);
  const canvas = page.locator('.editor-canvas');
  if (!(await canvas.boundingBox())) throw new Error('canvas was not found');

  const before = await contentHash(page);
  await rightClickGuideLine(page, guideLine);
  const menu = page.getByRole('menu', { name: 'Guide context menu' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Show two-point perspective guide' }).click();

  const overlay = page.locator('.perspective-guide-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.perspective-guide-overlay__ray')).toHaveCount(14);
  await expect(overlay.locator('.perspective-guide-overlay__vertical')).toHaveCount(7);
  const leftHandle = page.getByRole('button', { name: 'Left vanishing point' });
  const leftBefore = Number(await leftHandle.getAttribute('data-screen-x'));
  const handleBounds = await leftHandle.boundingBox();
  if (!handleBounds) throw new Error('left vanishing point handle was not found');
  await page.mouse.move(
    handleBounds.x + handleBounds.width / 2,
    handleBounds.y + handleBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBounds.x + handleBounds.width / 2 + 48,
    handleBounds.y + handleBounds.height / 2 + 24,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await leftHandle.getAttribute('data-screen-x')))
    .toBeGreaterThan(leftBefore + 30);
  expect(await contentHash(page)).toBe(before);

  const toolbar = page.getByTestId('toolbar');
  await toolbar.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const blockInCanvas = await canvas.boundingBox();
  if (!blockInCanvas) throw new Error('canvas was not found for perspective block-in');
  const blockInBefore = await contentHash(page);
  await page.mouse.move(
    blockInCanvas.x + blockInCanvas.width * 0.28,
    blockInCanvas.y + blockInCanvas.height * 0.12,
  );
  await page.mouse.down();
  await page.mouse.move(
    blockInCanvas.x + blockInCanvas.width * 0.43,
    blockInCanvas.y + blockInCanvas.height * 0.28,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.getByRole('treeitem', { name: /Rectangle 1/ })).toBeVisible();
  await expect.poll(() => contentHash(page)).not.toBe(blockInBefore);

  await page.screenshot({ path: testInfo.outputPath('perspective-guide-light-desktop.png') });
  await canvas.screenshot({ path: testInfo.outputPath('perspective-guide-light-closeup.png') });
  for (const theme of ['dark', 'high-contrast'] as const) {
    await page.evaluate((nextTheme) => {
      document.documentElement.setAttribute('data-theme', nextTheme);
    }, theme);
    await page.screenshot({ path: testInfo.outputPath(`perspective-guide-${theme}-desktop.png`) });
    await canvas.screenshot({
      path: testInfo.outputPath(`perspective-guide-${theme}-closeup.png`),
    });
  }

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({
    path: testInfo.outputPath('perspective-guide-high-contrast-narrow.png'),
  });
  await canvas.screenshot({ path: testInfo.outputPath('perspective-guide-narrow-closeup.png') });
  const narrowContentBeforeHide = await contentHash(page);

  await rightClickGuideLine(page, guideLine);
  const hideMenu = page.getByRole('menu', { name: 'Guide context menu' });
  await hideMenu.getByRole('menuitem', { name: 'Hide two-point perspective guide' }).click();
  await expect(overlay).toHaveCount(0);
  expect(await contentHash(page)).toBe(narrowContentBeforeHide);
});

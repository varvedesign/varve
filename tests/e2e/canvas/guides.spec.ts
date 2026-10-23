import { expect, test } from '@playwright/test';

import { navigateToEditor } from '../shared';

test.describe('Canvas guides', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('dragging from a ruler creates one movable guide, not one guide per pointer move', async ({
    page,
  }) => {
    const topRuler = page.locator('.ruler-canvas--top');
    await expect(topRuler).toBeVisible();
    const box = await topRuler.boundingBox();
    if (!box) throw new Error('top ruler not found');

    await page.mouse.move(box.x + 100, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + box.height / 2);
    await page.mouse.move(box.x + 180, box.y + box.height / 2);
    await page.mouse.up();

    const guideLines = page.locator('.guide-overlay__line');
    await expect(guideLines).toHaveCount(1);
    await expect(guideLines.first()).toHaveAttribute('x1', /^(179|180|181)(\.\d+)?$/);
  });

  test('creating and re-dragging a guide snaps it onto an object edge', async ({
    page,
  }, testInfo) => {
    const canvas = page.locator('.editor-canvas');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('canvas not found');

    await page.keyboard.press('r');
    await page.mouse.move(canvasBox.x + 300, canvasBox.y + 220);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 380, canvasBox.y + 300, { steps: 4 });
    await page.mouse.up();

    const line = page.locator('.guide-overlay__line').first();
    // Overlays are inset into the same canvas container, so the selection
    // overlay measures the coordinate origin the guide line uses.
    const overlayBox = await page.locator('svg:has(.selection-overlay__dim)').first().boundingBox();
    if (!overlayBox) throw new Error('canvas overlay origin not found');
    // The rectangle's left edge is at canvasBox.x + 300 in overlay coordinates.
    const edgeX = canvasBox.x + 300 - overlayBox.x;

    // Creating the guide from the ruler is the primary route. Press and
    // release without moving: the creation sample itself must land on the edge
    // 3px away, which is what the pre-fix build failed to do.
    const topRuler = page.locator('.ruler-canvas--top');
    const rulerBox = await topRuler.boundingBox();
    if (!rulerBox) throw new Error('top ruler not found');
    await page.mouse.move(canvasBox.x + 303, rulerBox.y + rulerBox.height / 2);
    await page.mouse.down();
    await page.mouse.up();

    await expect(line).toHaveCount(1);
    const created = Number(await line.getAttribute('x1'));
    expect(created).toBeCloseTo(edgeX, 0);
    expect(Math.abs(created - (canvasBox.x + 303 - overlayBox.x))).toBeGreaterThan(1);

    // Re-dragging the existing guide must snap too, and releasing 5px past the
    // same edge must land on it rather than 2px away from the previous release.
    const dragGuideTo = async (screenX: number, beforeRelease?: () => Promise<void>) => {
      const current = Number(await line.getAttribute('x1'));
      const y = overlayBox.y + 80;
      await page.mouse.move(overlayBox.x + current, y);
      await page.mouse.down();
      await page.mouse.move(screenX, y, { steps: 5 });
      await beforeRelease?.();
      await page.mouse.up();
    };

    await dragGuideTo(canvasBox.x + 303, async () => {
      await testInfo.attach('guide-held-on-object-edge', {
        body: await canvas.screenshot({
          path: testInfo.outputPath('guide-held-on-object-edge.png'),
        }),
        contentType: 'image/png',
      });
    });
    const first = Number(await line.getAttribute('x1'));
    await dragGuideTo(canvasBox.x + 305);
    const second = Number(await line.getAttribute('x1'));

    expect(second).toBeCloseTo(first, 5);
    expect(Math.abs(second - (canvasBox.x + 305 - overlayBox.x))).toBeGreaterThan(1);
  });

  test('Ctrl+; toggles guide visibility without deleting guides', async ({ page }) => {
    const topRuler = page.locator('.ruler-canvas--top');
    const box = await topRuler.boundingBox();
    if (!box) throw new Error('top ruler not found');

    await page.mouse.move(box.x + 120, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + box.height / 2);
    await page.mouse.up();

    const guideLines = page.locator('.guide-overlay__line');
    await expect(guideLines).toHaveCount(1);

    await page.keyboard.press('Control+;');
    await expect(guideLines).toHaveCount(0);

    await page.keyboard.press('Control+;');
    await expect(guideLines).toHaveCount(1);
  });

  test('clicking a guide then arrow keys nudge its position', async ({ page }) => {
    const topRuler = page.locator('.ruler-canvas--top');
    const box = await topRuler.boundingBox();
    if (!box) throw new Error('top ruler not found');

    await page.mouse.move(box.x + 100, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + box.height / 2);
    await page.mouse.up();

    const guideLine = page.locator('.guide-overlay svg line').first();
    const xBefore = await guideLine.getAttribute('x1');
    expect(xBefore).not.toBeNull();

    const canvas = page.locator('.editor-canvas');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('canvas not found');

    const guideX = Number.parseFloat(xBefore ?? '0');
    await page.mouse.click(canvasBox.x + guideX, canvasBox.y + 40);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    const xAfter = await guideLine.getAttribute('x1');
    expect(Number.parseFloat(xAfter ?? '0')).toBeGreaterThan(guideX);
  });
});

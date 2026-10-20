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

  test('dragging a vertical guide back onto the top ruler removes it and is undoable', async ({
    page,
  }) => {
    const topRuler = page.locator('.ruler-canvas--top');
    const rulerBox = await topRuler.boundingBox();
    if (!rulerBox) throw new Error('top ruler not found');

    await page.mouse.move(rulerBox.x + 120, rulerBox.y + rulerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(rulerBox.x + 160, rulerBox.y + rulerBox.height / 2, { steps: 4 });
    await page.mouse.up();

    const guides = page.locator('.guide-overlay__line');
    await expect(guides).toHaveCount(1);
    const guideX = Number(await guides.first().getAttribute('x1'));
    const canvasBox = await page.locator('.editor-canvas').boundingBox();
    if (!canvasBox) throw new Error('editor canvas not found');

    await page.mouse.move(canvasBox.x + guideX, canvasBox.y + 100);
    await page.mouse.down();
    await page.mouse.move(rulerBox.x + guideX, rulerBox.y + rulerBox.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(guides).toHaveCount(0);

    await page.keyboard.press('Control+z');
    await expect(guides).toHaveCount(1);
    await page.keyboard.press('Control+Shift+z');
    await expect(guides).toHaveCount(0);
  });

  test('dragging a horizontal guide back onto the left ruler removes it', async ({ page }) => {
    const leftRuler = page.locator('.ruler-canvas--left');
    const rulerBox = await leftRuler.boundingBox();
    if (!rulerBox) throw new Error('left ruler not found');
    await page.mouse.move(rulerBox.x + rulerBox.width / 2, rulerBox.y + 120);
    await page.mouse.down();
    await page.mouse.move(rulerBox.x + rulerBox.width / 2, rulerBox.y + 160, { steps: 4 });
    await page.mouse.up();

    const guides = page.locator('.guide-overlay__line');
    await expect(guides).toHaveCount(1);
    const guideY = Number(await guides.first().getAttribute('y1'));
    const canvasBox = await page.locator('.editor-canvas').boundingBox();
    if (!canvasBox) throw new Error('editor canvas not found');

    await page.mouse.move(canvasBox.x + 100, canvasBox.y + guideY);
    await page.mouse.down();
    await page.mouse.move(rulerBox.x + rulerBox.width / 2, rulerBox.y + guideY, { steps: 5 });
    await page.mouse.up();

    await expect(guides).toHaveCount(0);
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

import { expect, test } from '@playwright/test';

import { navigateToEditor } from '../shared';

test.describe('Canvas guides', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page, '/?perf=1');
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

  test('middle-button drag over a guide pans the canvas without moving the guide', async ({
    page,
  }, testInfo) => {
    const topRuler = page.locator('.ruler-canvas--top');
    const rulerBox = await topRuler.boundingBox();
    if (!rulerBox) throw new Error('top ruler not found');

    await page.mouse.move(rulerBox.x + 400, rulerBox.y + rulerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(rulerBox.x + 440, rulerBox.y + rulerBox.height / 2, { steps: 4 });
    await page.mouse.up();

    const guide = page.locator('.guide-overlay__line').first();
    await expect(guide).toHaveCount(1);
    const cameraX = async () =>
      page.evaluate(() => {
        const perf = (
          window as typeof window & {
            __varvePerf?: { getLast: () => { camera?: { panX: number } } | null };
          }
        ).__varvePerf;
        return perf?.getLast()?.camera?.panX ?? null;
      });
    const panBefore = await cameraX();
    if (panBefore === null) throw new Error('render camera was not available');
    const guideXBefore = Number(await guide.getAttribute('x1'));
    const canvasShell = page.locator('.editor-canvas');
    await testInfo.attach('middle-button-guide-pan-before', {
      body: await canvasShell.screenshot({
        path: testInfo.outputPath('middle-button-pan-before.png'),
      }),
      contentType: 'image/png',
    });

    const overlay = page.locator('.guide-overlay');
    const overlayBox = await overlay.boundingBox();
    if (!overlayBox) throw new Error('guide overlay has no bounds');
    const guideX = Number(await guide.getAttribute('x1'));
    const x = overlayBox.x + guideX;
    const y = overlayBox.y + overlayBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(x - 90, y - 55, {
      steps: 5,
    });
    await page.mouse.up({ button: 'middle' });

    await expect.poll(cameraX).not.toBe(panBefore);
    const synchronizedPan = async () => {
      const pan = await cameraX();
      const guideScreenX = Number(await guide.getAttribute('x1'));
      return pan === null ? null : Math.abs(guideScreenX - guideXBefore - (pan - panBefore));
    };
    await expect.poll(synchronizedPan).toBeLessThan(2);
    const panAfter = await cameraX();
    if (panAfter === null) throw new Error('render camera was not available after panning');
    const guideScreenXAfter = Number(await guide.getAttribute('x1'));
    expect(guideScreenXAfter).toBeGreaterThan(0);
    expect(guideScreenXAfter).toBeLessThan(overlayBox.width);
    await testInfo.attach('middle-button-guide-pan-after', {
      body: await canvasShell.screenshot({
        path: testInfo.outputPath('middle-button-pan-after.png'),
      }),
      contentType: 'image/png',
    });
    await expect(page.locator('dialog:visible')).toHaveCount(0);
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

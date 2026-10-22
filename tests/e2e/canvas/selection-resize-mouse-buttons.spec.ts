import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function createSelectedRectangle(page: Page) {
  await navigateToEditor(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('editor canvas has no screen bounds');
  await page.mouse.move(canvasBox.x + 180, canvasBox.y + 180);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 360, canvasBox.y + 300, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('v');
  const layer = page.getByRole('treeitem').first();
  await expect(layer).toHaveCount(1);
  await layer.click();
  const outline = page.locator('svg:has(.selection-overlay__dim) > rect').first();
  await expect(outline).toBeAttached();
  return outline;
}

async function box(locator: ReturnType<Page['locator']>) {
  const result = await locator.boundingBox();
  if (!result) throw new Error('selection geometry has no screen bounds');
  return { x: result.x, y: result.y, width: result.width, height: result.height };
}

test.describe('selection resize mouse buttons', () => {
  test('middle-button movement over a resize handle leaves selection geometry unchanged', async ({
    page,
  }) => {
    const outline = await createSelectedRectangle(page);
    const primaryHandle = await page
      .getByLabel('Right resize handle', { exact: true })
      .boundingBox();
    if (!primaryHandle) throw new Error('right resize handle has no bounds');
    const before = await box(outline);
    await test.info().attach('middle-button-resize-before', {
      body: await page.locator('canvas.editor-canvas__content-layer').screenshot(),
      contentType: 'image/png',
    });
    const handle = primaryHandle;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + handle.height / 2, {
      steps: 4,
    });
    await page.mouse.up({ button: 'middle' });
    await expect(outline).toBeAttached();
    expect(await box(outline)).toEqual(before);
    await test.info().attach('middle-button-resize-after', {
      body: await page.locator('canvas.editor-canvas__content-layer').screenshot(),
      contentType: 'image/png',
    });
  });

  test('right-button movement over a resize handle leaves geometry unchanged after Escape', async ({
    page,
  }) => {
    const outline = await createSelectedRectangle(page);
    const before = await box(outline);
    await test.info().attach('right-button-resize-before', {
      body: await page.locator('canvas.editor-canvas__content-layer').screenshot(),
      contentType: 'image/png',
    });
    const handle = await page.getByLabel('Right resize handle', { exact: true }).boundingBox();
    if (!handle) throw new Error('right resize handle has no bounds');

    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + handle.height / 2, {
      steps: 4,
    });
    await page.mouse.up({ button: 'right' });
    await page.keyboard.press('Escape');
    await expect(outline).toBeAttached();
    expect(await box(outline)).toEqual(before);
    await test.info().attach('right-button-resize-after', {
      body: await page.locator('canvas.editor-canvas__content-layer').screenshot(),
      contentType: 'image/png',
    });
  });
});

import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test('a canvas marquee ends when pointerup crosses into the inspector', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);

  await page.keyboard.press('r');
  await dragOnCanvas(page, 180, 150, 300, 250);
  await page.keyboard.press('v');
  await page.getByRole('treeitem').first().click();

  const opacity = page.getByRole('spinbutton', { name: 'Opacity (%)', exact: true });
  await expect(opacity).toBeVisible();
  const opacityBox = await opacity.boundingBox();
  const canvasBox = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
  expect(opacityBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();

  // Start on empty canvas, cross the canvas edge while the marquee is active,
  // then release over the inspector control as in the reported interaction.
  const start = {
    x: canvasBox!.x + canvasBox!.width - 80,
    y: canvasBox!.y + canvasBox!.height / 2,
  };
  const end = {
    x: opacityBox!.x + opacityBox!.width / 2,
    y: opacityBox!.y + opacityBox!.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 24, start.y + 3, { steps: 2 });
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(canvasBox!.x + 100, canvasBox!.y + 100);

  await testInfo.attach('after-pointerup-over-inspector', {
    body: await page.getByTestId('editor-canvas').screenshot(),
    contentType: 'image/png',
  });
  await expect(opacity).toHaveCount(0);
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.locator('canvas.editor-canvas__content-layer')).toBeVisible();
});

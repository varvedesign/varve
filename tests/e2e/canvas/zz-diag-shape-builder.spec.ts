import { test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('diagnose second rectangle creation', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');

  const box1 = await canvas.boundingBox();
  console.log('BOX before first draw', JSON.stringify(box1));
  await page.keyboard.press('r');
  await page.mouse.move(box1!.x + 120, box1!.y + 140);
  await page.mouse.down();
  await page.mouse.move(box1!.x + 260, box1!.y + 240, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('v');
  await page.waitForTimeout(500);
  console.log('treeitems after first', await page.getByRole('treeitem').count());

  const box2 = await canvas.boundingBox();
  console.log('BOX before second draw', JSON.stringify(box2));
  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  console.log(
    'toolbar shape tool pressed state',
    await page.getByTestId('toolbar').getByRole('button', { name: 'Rectangle', exact: true }).getAttribute('aria-pressed'),
  );
  await page.mouse.move(box2!.x + 200, box2!.y + 180);
  await page.mouse.down();
  await page.mouse.move(box2!.x + 340, box2!.y + 280, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('v');
  await page.waitForTimeout(800);
  console.log('treeitems after second', await page.getByRole('treeitem').count());
  const box3 = await canvas.boundingBox();
  console.log('BOX after second', JSON.stringify(box3));
  await page.screenshot({ path: '/tmp/diag-shape-builder.png', fullPage: true });
});

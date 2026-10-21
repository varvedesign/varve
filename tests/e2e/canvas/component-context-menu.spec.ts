import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('creates a component from a selected frame through its canvas context menu', async ({
  page,
}) => {
  await navigateToEditor(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');

  await page.keyboard.press('f');
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 250);
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 200, box.y + 185);

  await canvas.click({ button: 'right', position: { x: 200, y: 185 } });
  const menu = page.getByRole('menu', { name: 'Canvas context menu' });
  await expect(menu.getByRole('menuitem', { name: 'Create Component' })).toBeVisible();
  await page.screenshot({
    path: 'test-results/component-context-menu.png',
    animations: 'disabled',
  });
  await menu.getByRole('menuitem', { name: 'Create Component' }).click();

  const frame = page.locator('[role="treeitem"][data-layer-subtype="component-definition"]');
  await expect(frame).toHaveCount(1);
  await expect(frame).toContainText('Frame');

  await page.keyboard.press('Control+z');
  await expect(page.locator('[role="treeitem"][data-layer-subtype="frame"]')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(frame).toHaveCount(1);
});

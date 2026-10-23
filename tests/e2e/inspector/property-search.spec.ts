import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function drawRect(page: import('@playwright/test').Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.waitForTimeout(100);
  await page.mouse.move(box.x + 180, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 340, { steps: 4 });
  await page.mouse.up();
  await page.getByRole('treeitem').first().waitFor({ timeout: 5000 });
  await page.keyboard.press('v');
}

test('finds a property, reveals its owning section, and restores the stack on clear', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await drawRect(page);
  await page.getByRole('tab', { name: 'Design' }).click();

  const inspector = page.getByRole('region', { name: 'Inspector' });
  const search = inspector.getByRole('searchbox', { name: 'Find a property in the Inspector' });
  await expect(search).toBeVisible();
  await search.fill('opacity');

  await expect(inspector.getByRole('button', { name: 'Appearance' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(inspector.getByRole('spinbutton', { name: /Opacity/ })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Fill' })).toHaveCount(0);

  await search.fill('');
  await expect(inspector.getByRole('button', { name: 'Fill' })).toBeVisible();
});

test('explains a zero-result search instead of leaving an empty Inspector', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await drawRect(page);

  await page
    .getByRole('searchbox', { name: 'Find a property in the Inspector' })
    .fill('property-that-does-not-exist');

  await expect(page.getByRole('status').filter({ hasText: 'No properties match' })).toBeVisible();
});

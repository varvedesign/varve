import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/**
 * Offset Path: bounded work, correct joins, real editor path
 * (vectorcraft#1028).
 *
 * The engine unit tests pin the geometry. This drives the actual menu action,
 * prompt dialog and canvas replay, and asserts the resulting object dimensions
 * rather than only that something changed — a wrong offset still changes
 * pixels.
 */
test.use({ viewport: { width: 1440, height: 1000 } });

async function applyOffset(page: Page, distance: string): Promise<void> {
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  // Offset Path lives in the Object > Path submenu, not at the top level.
  await page.getByRole('menuitem', { name: 'Path', exact: true }).hover();
  await page
    .getByRole('menu', { name: 'Path' })
    .getByRole('menuitem', { name: /offset path/i })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 5000 });
  const field = dialog.getByRole('textbox').last();
  await field.fill(distance);
  await field.press('Enter');
  await expect(dialog).toBeHidden({ timeout: 10000 });
  // Close any menu that re-opened and leave the object selected but unedited.
  await page.keyboard.press('Escape');
}

async function readSize(page: Page): Promise<{ w: number; h: number }> {
  const w = Number(await page.getByLabel('W', { exact: true }).inputValue());
  const h = Number(await page.getByLabel('H', { exact: true }).inputValue());
  return { w, h };
}

test.describe('Offset Path — bounded and rounded', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('an outward offset grows the object and completes promptly', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 240, 240, 740, 640);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const before = await readSize(page);
    expect(before.w).toBeGreaterThan(400);
    expect(before.h).toBeGreaterThan(300);

    const startedAt = Date.now();
    // Distance large enough that a distance-proportional step count would emit
    // thousands of points per vertex.
    await applyOffset(page, '200');
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(15000);

    const after = await readSize(page);
    // An outward offset of 200 adds 400 to each dimension.
    expect(after.w).toBeGreaterThan(before.w + 380);
    expect(after.h).toBeGreaterThan(before.h + 380);

    const canvas = page.locator('.editor-canvas canvas').first();
    await canvas.screenshot({ path: 'reports/vectorcraft/offset-path-round.png' });
  });

  test('an inward offset shrinks the object and completes', async ({ page }) => {
    await page.keyboard.press('o');
    await dragOnCanvas(page, 300, 300, 720, 620);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const before = await readSize(page);

    await applyOffset(page, '-60');
    const after = await readSize(page);

    // Inward offset removes 120 from each dimension.
    expect(after.w).toBeLessThan(before.w - 100);
    expect(after.h).toBeLessThan(before.h - 100);
    expect(after.w).toBeGreaterThan(0);
    expect(after.h).toBeGreaterThan(0);

    const canvas = page.locator('.editor-canvas canvas').first();
    await canvas.screenshot({ path: 'reports/vectorcraft/offset-path-inward.png' });
  });
});

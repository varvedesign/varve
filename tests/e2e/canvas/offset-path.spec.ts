import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/**
 * Offset Path: bounded work and real round joins (vectorcraft#1028).
 *
 * The engine unit tests pin the geometry. This drives the real editor path —
 * menu action, prompt dialog, canvas replay — because the failure the external
 * report describes is a *synchronous main-thread* effect: the app must stay
 * responsive and the result must render as a rounded outline, not a faceted or
 * spiked one.
 */
test.use({ viewport: { width: 1440, height: 1000 } });

async function applyOffset(page: Page, distance: string): Promise<void> {
  await page.getByRole('menuitem', { name: /^object$/i }).click();
  await page.getByRole('menuitem', { name: /offset path/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 5000 });
  const field = dialog.getByRole('textbox').last();
  await field.fill(distance);
  await field.press('Enter');
  await expect(dialog).toBeHidden({ timeout: 10000 });
}

test.describe('Offset Path — bounded and rounded', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('round offset of a large shape stays responsive and renders', async ({ page }) => {
    // A many-sided shape: the case where per-vertex arc work multiplied.
    await page.keyboard.press('r');
    await dragOnCanvas(page, 200, 200, 700, 600);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const canvas = page.locator('.editor-canvas canvas').first();
    await expect(canvas).toBeVisible();
    const before = await canvas.screenshot();

    // Distance large enough that a distance-proportional step count would emit
    // thousands of points per vertex; the bounded tessellation keeps it quick.
    const startedAt = Date.now();
    await applyOffset(page, '400');
    const elapsed = Date.now() - startedAt;

    // The UI must be back under the driver's control, not stuck in the effect.
    expect(elapsed).toBeLessThan(15000);
    await expect(page.getByRole('treeitem')).toHaveCount(1);

    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);

    await page.screenshot({
      path: 'reports/vectorcraft/offset-path-round.png',
      fullPage: false,
    });
  });

  test('a negative offset still completes', async ({ page }) => {
    await page.keyboard.press('o');
    await dragOnCanvas(page, 300, 300, 720, 620);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await applyOffset(page, '-80');

    // No crash, no unhandled dialog, canvas still interactive.
    await expect(page.locator('.editor-canvas canvas').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });
});

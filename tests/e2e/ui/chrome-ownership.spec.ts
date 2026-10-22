/**
 * E2E: the chrome owns its own pointer and layer state.
 *
 * Three reported classes from the corpus, each verified against Varve's own
 * contracts rather than assumed:
 *
 * - the cursor over the toolbars follows the canvas underneath (PDFCraft 3001,
 *   3871): a tool cursor is a property of the canvas, not of the application;
 * - a second context menu opens on top of the first, leaving both usable-looking
 *   (3190): one overlay registry should own this;
 * - a dialog or panel is clipped in a small window with no way to reach its
 *   content (3097, 3557, 3559): small-window layout is correctness, not polish.
 *
 * These are assertions about the real UI. A passing run means the class is
 * absent in Varve today; a failing run is a defect to fix, not a test to relax.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('chrome ownership', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('a canvas tool cursor does not follow the pointer onto the chrome', async ({ page }) => {
    // The hand tool asks for `grab` on the canvas; the menubar must not inherit
    // it when the pointer leaves the artwork.
    await page.keyboard.press('h');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const onCanvas = await page.evaluate(() => {
      const el = document.querySelector('canvas.editor-canvas__content-layer');
      return el ? getComputedStyle(el).cursor : null;
    });

    await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).hover();
    const onMenubar = await page.evaluate(() => {
      const el = document.querySelector('[role="menubar"] [role="menuitem"]');
      return el ? getComputedStyle(el).cursor : null;
    });
    expect(onCanvas).not.toBeNull();
    // Whatever the canvas asks for, the menubar keeps a normal pointer.
    expect(onMenubar).not.toBe(onCanvas);
    expect(['auto', 'default', 'pointer']).toContain(onMenubar);
  });

  test('opening a second menu leaves exactly one menu open', async ({ page }) => {
    await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click();
    await expect(page.getByRole('menu')).toHaveCount(1);
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('menu')).toHaveCount(1);
    // Escape closes the survivor and returns focus to its trigger.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('the inspector stays reachable and unclipped in a small window', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      const inspector = document.querySelector('[aria-label="Inspector"]');
      return {
        page: root.scrollWidth - root.clientWidth,
        inspector: inspector ? inspector.scrollWidth - inspector.clientWidth : 0,
        inspectorVisible: Boolean(inspector && inspector.getBoundingClientRect().width > 0),
      };
    });
    expect(overflow.inspectorVisible).toBe(true);
    // A few pixels of scrollbar rounding are tolerated; a clipped panel is not.
    expect(overflow.page).toBeLessThanOrEqual(2);
    expect(overflow.inspector).toBeLessThanOrEqual(2);

    // The Export tab is the one that moves into an overflow menu at this width;
    // it must still be reachable through the real control.
    const exportTab = page.locator('[role="tablist"] button[role="tab"]', { hasText: /^export$/i });
    if (!(await exportTab.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /^More inspector tabs/ }).click();
      await expect(
        page.getByRole('menu', { name: 'More inspector tabs' }).getByRole('menuitem', {
          name: 'Export',
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
    }
  });
});

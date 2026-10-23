/**
 * The canvas context menu fits its commands on one line (F-07, shell audit
 * 2026-10-21). At a fixed 15rem, six of seventeen commands wrapped onto two or
 * three lines ("Create Mockup Template from Selection…" took three), which
 * also stretched the menu to nearly the full window height.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function openMenuOnRect(page: Page) {
  const box = await page.locator('.editor-canvas').boundingBox();
  if (!box) throw new Error('canvas not laid out');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 160, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 250, { steps: 4 });
  await page.mouse.up();
  await page.mouse.click(box.x + 220, box.y + 200, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Canvas context menu' });
  await expect(menu).toBeVisible();
  return menu;
}

test.describe('canvas context menu width', () => {
  test('no command wraps at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    const menu = await openMenuOnRect(page);
    const wrapped = await menu.evaluate((element) =>
      [...element.querySelectorAll('.varve-menu__item-label')]
        .filter((label) => {
          const lineHeight = Number.parseFloat(getComputedStyle(label).lineHeight) || 20;
          return label.getBoundingClientRect().height > lineHeight * 1.5;
        })
        .map((label) => label.textContent?.trim()),
    );
    expect(wrapped).toEqual([]);
  });

  test('stays inside a 900x600 window', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 600 });
    await navigateToEditor(page);
    const menu = await openMenuOnRect(page);
    const rect = await menu.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(900);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(600);
  });
});

/**
 * New text takes an ink that reads against what it is typed onto (F-09, shell
 * audit 2026-10-21). It used to be near-black everywhere, so text typed onto
 * the dark-theme board was effectively invisible until recoloured.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const LIGHT_INK = '#eceef3';
const DARK_INK = '#10151f';

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
  await page.waitForTimeout(100);
}

async function canvasBounds(page: Page) {
  const bounds = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
  if (!bounds) throw new Error('canvas not found');
  return bounds;
}

async function typeTextAt(page: Page, x: number, y: number) {
  await page.keyboard.press('t');
  await page.mouse.click(x, y);
  await page.keyboard.type('Default ink');
  await page.keyboard.press('Escape');
  await expect(page.locator('.typography-controls')).toBeVisible({ timeout: 10_000 });
}

async function textColour(page: Page) {
  const trigger = page.locator('.typography-controls').getByRole('button', { name: 'Text colour' });
  return ((await trigger.locator('.insp-swatch__value').textContent()) ?? '').trim().toLowerCase();
}

test.describe('default text ink', () => {
  test('text typed on the dark board is light', async ({ page }) => {
    await navigateToEditor(page);
    await setTheme(page, 'dark');
    const b = await canvasBounds(page);
    await typeTextAt(page, b.x + 220, b.y + 260);
    expect(await textColour(page)).toBe(LIGHT_INK);
  });

  test('text typed on the light board is dark', async ({ page }) => {
    await navigateToEditor(page);
    await setTheme(page, 'light');
    const b = await canvasBounds(page);
    await typeTextAt(page, b.x + 220, b.y + 260);
    expect(await textColour(page)).toBe(DARK_INK);
  });

  test('text typed into a light frame stays dark on the dark board', async ({ page }) => {
    await navigateToEditor(page);
    await setTheme(page, 'dark');
    const b = await canvasBounds(page);
    await page.keyboard.press('f');
    await page.mouse.move(b.x + 120, b.y + 120);
    await page.mouse.down();
    await page.mouse.move(b.x + 420, b.y + 360, { steps: 6 });
    await page.mouse.up();
    await typeTextAt(page, b.x + 200, b.y + 220);
    expect(await textColour(page)).toBe(DARK_INK);
  });
});

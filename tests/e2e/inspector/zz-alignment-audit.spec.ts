/**
 * Throwaway visual audit — NOT a regression test, not committed.
 * Captures full-height screenshots of the Inspector panel for several real
 * node types so field-row alignment can be compared across sections.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const DIR = resolve(__dirname, '../../../reports/inspector-alignment-audit');
mkdirSync(DIR, { recursive: true });

test('capture Inspector for rect, text, frame, and multi-select', async ({ page }) => {
  await navigateToEditor(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  // Rectangle
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 220);
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.locator('.insp-panel[role="tabpanel"]').first().screenshot({
    path: resolve(DIR, '01-rect.png'),
  });

  // Text
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 350, box.y + 150);
  await page.keyboard.type('Sample heading');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('.insp-panel[role="tabpanel"]').first().screenshot({
    path: resolve(DIR, '02-text.png'),
  });

  // Frame
  await page.keyboard.press('f');
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 600, box.y + 460);
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.locator('.insp-panel[role="tabpanel"]').first().screenshot({
    path: resolve(DIR, '03-frame.png'),
  });

  // Multi-select (rect + text)
  const rows = page.getByRole('treeitem');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  await page.waitForTimeout(200);
  await page.locator('.insp-panel[role="tabpanel"]').first().screenshot({
    path: resolve(DIR, '04-multiselect.png'),
  });

  expect(true).toBe(true);
});

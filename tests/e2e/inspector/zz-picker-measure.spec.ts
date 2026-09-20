/**
 * Throwaway visual review — NOT a regression test, not committed.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const DIR = resolve(__dirname, '../../../reports/spacing-review');
mkdirSync(DIR, { recursive: true });

test('break down the colour picker children and capture it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 260);
  await page.mouse.up();
  await page.waitForTimeout(300);

  await page.locator('.insp-swatch').first().click();
  await page.waitForTimeout(600);

  const children = await page.evaluate(() => {
    const picker = document.querySelector('.color-picker');
    if (!picker) return { error: 'no .color-picker' };
    const describe = (el: Element, depth: number) => {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        depth,
        tag: el.tagName.toLowerCase(),
        cls: el.className?.toString().slice(0, 46) ?? '',
        h: Math.round(rect.height),
        w: Math.round(rect.width),
        gap: cs.rowGap,
      };
    };
    const out = [describe(picker, 0)];
    for (const child of picker.children) {
      out.push(describe(child, 1));
      for (const grand of child.children) out.push(describe(grand, 2));
    }
    return { out, pickerClass: picker.className, dialogClass: document.querySelector('.insp-picker-dialog')?.className };
  });
  console.log(JSON.stringify(children, null, 2));

  await page.locator('.color-picker').screenshot({ path: resolve(DIR, '08-color-picker-element.png') });
  await page.locator('.insp-picker-popover').screenshot({ path: resolve(DIR, '09-color-popover.png') });
});

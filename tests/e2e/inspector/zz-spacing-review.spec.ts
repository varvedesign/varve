/**
 * Throwaway visual review — NOT a regression test, not committed.
 *
 * Captures the surfaces this pass changed so the result can be inspected
 * directly: the Inspector field grammar at normal and narrow rail widths, the
 * colour picker's own namespaces (field rows + slider track/thumb), the shell
 * panels migrated onto the ladder, and both density modes.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const DIR = resolve(__dirname, '../../../reports/spacing-review');
mkdirSync(DIR, { recursive: true });

async function drawRect(page: import('@playwright/test').Page) {
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
}

test('capture Inspector spacing at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await drawRect(page);
  await page.locator('.editor-inspector').screenshot({ path: resolve(DIR, '01-inspector-1440.png') });
  await page.screenshot({ path: resolve(DIR, '02-shell-1440.png') });
});

test('capture Inspector spacing at narrow rail', async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 700 });
  await navigateToEditor(page);
  await drawRect(page);
  await page.locator('.editor-inspector').screenshot({ path: resolve(DIR, '03-inspector-1120.png') });
});

test('capture the colour picker field rows and slider', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await drawRect(page);
  const swatch = page.locator('.insp-swatch').first();
  await swatch.click();
  await page.waitForTimeout(400);
  const dialog = page.locator('.insp-picker-dialog').first();
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.screenshot({ path: resolve(DIR, '04-color-picker.png') });
  }
  await page.screenshot({ path: resolve(DIR, '05-color-picker-context.png') });
});

test('capture compact density', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await drawRect(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-density', 'compact'));
  await page.waitForTimeout(300);
  await page.locator('.editor-inspector').screenshot({ path: resolve(DIR, '06-inspector-compact.png') });
});

/**
 * Structural measurement: the Inspector's vertical rhythm is owned by several
 * rules in two stylesheets, so print the computed spacing of every direct
 * child of the scrolling panel and of every section boundary. Measurements
 * locate inconsistencies; they do not replace looking at the capture.
 */
test('measure Inspector vertical rhythm', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await drawRect(page);
  const data = await page.evaluate(() => {
    const panel = document.querySelector('.editor-inspector .insp-panel');
    if (!panel) return { error: 'panel not found' };
    const rows = [];
    for (const child of panel.children) {
      const el = child;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      rows.push({
        tag: el.tagName.toLowerCase(),
        cls: el.className,
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48),
        height: Math.round(rect.height * 10) / 10,
        marginTop: cs.marginTop,
        marginBottom: cs.marginBottom,
        paddingTop: cs.paddingTop,
        paddingBottom: cs.paddingBottom,
        rowGap: cs.rowGap,
        borderBottom: cs.borderBottomWidth,
        boxShadow: cs.boxShadow.slice(0, 40),
      });
    }
    const sections = [...document.querySelectorAll('.insp-disclosure')].map((el) => {
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const header = el.querySelector('.insp-disclosure__header');
      const content = el.querySelector('.insp-disclosure__content');
      const headerCs = header ? getComputedStyle(header) : null;
      const contentCs = content ? getComputedStyle(content) : null;
      return {
        title: (el.querySelector('.insp-disclosure__trigger')?.textContent ?? '').trim().slice(0, 32),
        height: Math.round(rect.height * 10) / 10,
        sectionMarginBottom: cs.marginBottom,
        sectionBorderBottom: cs.borderBottomWidth,
        headerPaddingBlock: headerCs ? `${headerCs.paddingTop} / ${headerCs.paddingBottom}` : null,
        headerBoxShadow: headerCs ? headerCs.boxShadow.slice(0, 40) : null,
        contentPaddingBlock: contentCs ? `${contentCs.paddingTop} / ${contentCs.paddingBottom}` : null,
        contentGap: contentCs ? contentCs.rowGap : null,
      };
    });
    return { rows, sections };
  });
  console.log(JSON.stringify(data, null, 2));
});


test('capture dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await drawRect(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(DIR, '07-shell-dark.png') });
});

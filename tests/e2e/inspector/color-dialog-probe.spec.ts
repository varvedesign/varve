/**
 * Colour picker dialog probe — measures the surface shown when a fill swatch
 * is opened.
 *
 * The dialog shells a rich body (SV pad, channel fields, swatches) inside a
 * fixed header and a per-paint row. This records the invariants that keep it
 * usable: exactly one vertical scroll owner, no silently clipped horizontal
 * content, and a header and paint row that stay on screen while the body
 * scrolls.
 *
 * Evidence lands in the git-ignored `reports/inspector-system/`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const OUT_DIR = path.resolve('reports/inspector-system');

interface DialogMetrics {
  dialog: { width: number; height: number; scrollHeight: number; clientHeight: number };
  portal: { overflowY: string; scrollHeight: number; clientHeight: number };
  verticalScrollers: Array<{ label: string; scrollHeight: number; clientHeight: number }>;
  horizontalOverflow: Array<{ label: string; scrollWidth: number; clientWidth: number }>;
  swatches: {
    count: number;
    rows: number;
    fullyInsideBody: number;
    clipped: number;
  };
  hexInput: { width: number; textAlign: string; value: string };
  headerVisible: boolean;
  paintRowVisible: boolean;
  footerActions: number;
}

async function openFillPicker(page: Page) {
  const swatch = page.getByRole('button', { name: /^Fill colou?r$/ }).first();
  await expect(swatch).toBeVisible({ timeout: 10000 });
  await swatch.click();
  const dialog = page.locator('[data-insp-color-dialog]');
  await expect(dialog).toBeVisible({ timeout: 10000 });
  return { swatch, dialog };
}

function readMetrics(page: Page): Promise<DialogMetrics> {
  return page.evaluate(() => {
    const dialog = document.querySelector('[data-insp-color-dialog]') as HTMLElement | null;
    if (!dialog) throw new Error('picker dialog not mounted');
    const body = dialog.querySelector('.insp-picker-dialog__body') as HTMLElement | null;
    const portal = dialog.parentElement as HTMLElement | null;

    const label = (element: Element) =>
      `${element.tagName.toLowerCase()}.${(element.className ?? '').toString().split(' ')[0]}`;

    const verticalScrollers: DialogMetrics['verticalScrollers'] = [];
    const horizontalOverflow: DialogMetrics['horizontalOverflow'] = [];
    for (const element of Array.from(dialog.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(element);
      const scrollsY =
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        element.scrollHeight > element.clientHeight + 1;
      if (scrollsY) {
        verticalScrollers.push({
          label: label(element),
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        });
      }
      // Hidden overflow with content wider than the box silently loses
      // content (the classic clipped last swatch).
      if (
        (style.overflowX === 'hidden' || style.overflowX === 'clip') &&
        element.scrollWidth > element.clientWidth + 1
      ) {
        horizontalOverflow.push({
          label: label(element),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        });
      }
    }

    const swatchElements = Array.from(
      dialog.querySelectorAll<HTMLElement>('.swatch-palette__swatch'),
    );
    const bodyRect = body?.getBoundingClientRect() ?? dialog.getBoundingClientRect();
    let fullyInsideBody = 0;
    let clipped = 0;
    const rowTops = new Set<number>();
    for (const swatch of swatchElements) {
      const rect = swatch.getBoundingClientRect();
      rowTops.add(Math.round(rect.top));
      const inside =
        rect.left >= bodyRect.left - 1 &&
        rect.right <= bodyRect.right + 1 &&
        rect.top >= bodyRect.top - 1;
      if (inside) fullyInsideBody += 1;
      else clipped += 1;
    }

    const hexInput = dialog.querySelector<HTMLInputElement>('input[aria-label="Hex color"]');
    const hexStyle = hexInput ? getComputedStyle(hexInput) : null;
    const header = dialog.querySelector('.insp-picker-dialog__header') as HTMLElement | null;
    const paintRow = dialog.querySelector('.insp-picker-dialog__paint') as HTMLElement | null;
    const viewportHeight = window.innerHeight;
    const withinViewport = (element: HTMLElement | null) => {
      if (!element) return true;
      const rect = element.getBoundingClientRect();
      return rect.top >= -1 && rect.bottom <= viewportHeight + 1;
    };

    return {
      dialog: {
        width: Math.round(dialog.getBoundingClientRect().width),
        height: Math.round(dialog.getBoundingClientRect().height),
        scrollHeight: dialog.scrollHeight,
        clientHeight: dialog.clientHeight,
      },
      portal: {
        overflowY: portal ? getComputedStyle(portal).overflowY : 'none',
        scrollHeight: portal?.scrollHeight ?? 0,
        clientHeight: portal?.clientHeight ?? 0,
      },
      verticalScrollers,
      horizontalOverflow,
      swatches: {
        count: swatchElements.length,
        rows: rowTops.size,
        fullyInsideBody,
        clipped,
      },
      hexInput: {
        width: hexInput ? Math.round(hexInput.getBoundingClientRect().width) : 0,
        textAlign: hexStyle?.textAlign ?? '',
        value: hexInput?.value ?? '',
      },
      headerVisible: withinViewport(header),
      paintRowVisible: withinViewport(paintRow),
      footerActions: dialog.querySelectorAll(
        '.insp-picker-dialog__footer button, [data-color-dialog-action]',
      ).length,
    };
  });
}

test.describe('Colour picker dialog probe', () => {
  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  test('records the dialog at a desktop viewport', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);

    // Draw a shape so the Fill section (and its swatch) exists.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 180, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 420, box.y + 340, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press('v');
    await page.getByRole('tab', { name: 'Design' }).click();

    const { dialog } = await openFillPicker(page);
    const metrics = await readMetrics(page);
    writeFileSync(path.join(OUT_DIR, 'color-dialog.json'), JSON.stringify(metrics, null, 2));

    await dialog.screenshot({ path: testInfo.outputPath('color-dialog-dark.png') });
    await dialog.screenshot({ path: path.join(OUT_DIR, 'color-dialog-dark.png') });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await dialog.screenshot({ path: path.join(OUT_DIR, 'color-dialog-light.png') });

    // One scroll owner: the body. A second scroller on the portal nested two
    // scrollbars and let the outer one scroll the title and paint row away.
    expect(metrics.portal.overflowY, 'portal must not scroll').toBe('visible');
    expect(metrics.verticalScrollers.length, 'exactly one vertical scroller').toBeLessThanOrEqual(
      1,
    );
    expect(metrics.headerVisible).toBe(true);
    expect(metrics.paintRowVisible).toBe(true);
    // No silently clipped content.
    expect(metrics.horizontalOverflow, 'clipped horizontal content').toEqual([]);
    expect(metrics.swatches.clipped, 'swatches clipped by their container').toBe(0);
  });
});

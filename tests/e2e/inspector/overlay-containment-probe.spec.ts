/**
 * Overlay containment probe — menus and listboxes must stay inside the
 * window and remain reachable when their trigger sits low on screen.
 *
 * The reported failure is a blend-mode listbox that opened downward past the
 * bottom of a narrow window, showing its last rows off-screen with no scroll.
 * That is container handling, not styling: every floating layer must either
 * flip, clamp and scroll, or both.
 *
 * Evidence lands in the git-ignored `reports/inspector-system/`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const OUT_DIR = path.resolve('reports/inspector-system');

interface OverlayMetrics {
  viewport: { width: number; height: number };
  box: { top: number; bottom: number; left: number; right: number; height: number };
  fitsVertically: boolean;
  fitsHorizontally: boolean;
  scroll: {
    overflowY: string;
    scrollHeight: number;
    clientHeight: number;
    scrollable: boolean;
  };
  optionCount: number;
  lastOptionVisible: boolean;
}

async function measure(overlay: Locator): Promise<OverlayMetrics> {
  return overlay.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const options = Array.from(
      element.querySelectorAll<HTMLElement>(
        '[role="option"], [role="menuitem"], [role="menuitemradio"]',
      ),
    );
    const last = options.at(-1);
    const lastRect = last?.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      box: {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        height: Math.round(rect.height),
      },
      fitsVertically: rect.top >= -1 && rect.bottom <= window.innerHeight + 1,
      fitsHorizontally: rect.left >= -1 && rect.right <= window.innerWidth + 1,
      scroll: {
        overflowY: style.overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        scrollable: element.scrollHeight > element.clientHeight + 1 && style.overflowY === 'auto',
      },
      optionCount: options.length,
      lastOptionVisible: lastRect
        ? lastRect.bottom <= window.innerHeight + 1 && lastRect.top >= -1
        : false,
    };
  });
}

/** Draw a rectangle so the Appearance (blend mode) section has a subject. */
async function drawShape(page: Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 60, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 260, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('v');
}

async function openBlendListbox(page: Page) {
  await page.getByRole('tab', { name: 'Design' }).click();

  const appearance = page.getByRole('button', { name: 'Appearance' });
  await appearance.scrollIntoViewIfNeeded();
  if ((await appearance.getAttribute('aria-expanded')) === 'false') {
    await appearance.click();
  }

  const trigger = page.locator('button[aria-haspopup="listbox"]').first();
  await trigger.scrollIntoViewIfNeeded();
  await expect(trigger).toBeVisible({ timeout: 10000 });
  await trigger.click();
  const listbox = page.locator('[role="listbox"]').first();
  await expect(listbox).toBeVisible({ timeout: 10000 });
  return { trigger, listbox };
}

test.describe('Overlay containment', () => {
  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const viewport of [
    { width: 455, height: 1024, label: 'narrow' },
    { width: 1280, height: 800, label: 'desktop' },
  ]) {
    test(`blend-mode listbox stays reachable at ${viewport.label} size`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await navigateToEditor(page);
      await drawShape(page);

      const { listbox } = await openBlendListbox(page);
      const metrics = await measure(listbox);
      writeFileSync(
        path.join(OUT_DIR, `blend-listbox-${viewport.label}.json`),
        JSON.stringify(metrics, null, 2),
      );

      expect(metrics.box.height, 'listbox must be height-capped').toBeLessThan(
        viewport.height - 40,
      );
      expect(metrics.fitsVertically, 'listbox must stay inside the window').toBe(true);
      expect(metrics.fitsHorizontally, 'listbox must stay inside the window').toBe(true);
      expect(metrics.lastOptionVisible, 'the last blend mode must be reachable').toBe(true);
      // If all options cannot fit, the cap must be scrollable rather than
      // silently clipped.
      if (metrics.optionCount > 0 && metrics.scroll.scrollHeight > metrics.scroll.clientHeight) {
        expect(metrics.scroll.scrollable, 'capped listbox must scroll').toBe(true);
      }
    });
  }
});

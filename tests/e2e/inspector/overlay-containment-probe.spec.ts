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
  return overlay.evaluate((content) => {
    // Containment is a contract of the floating layer — the fixed,
    // height-capped element that owns scrolling — not of the content div
    // inside it. The inner listbox keeps its full content height by design,
    // so measuring that div reports overflow the user cannot see.
    let layer = content.parentElement as HTMLElement | null;
    while (layer && getComputedStyle(layer).position !== 'fixed') {
      layer = layer.parentElement;
    }
    if (!layer) throw new Error('listbox is not inside a fixed floating layer');
    const floating = layer;

    const options = Array.from(
      content.querySelectorAll<HTMLElement>(
        '[role="option"], [role="menuitem"], [role="menuitemradio"]',
      ),
    );
    const last = options.at(-1);
    // Reachability: scrolling the layer must be able to bring the final
    // option into the window. scrollIntoView with block:nearest scrolls the
    // layer's own overflow first and does not move the fixed layer itself.
    let lastOptionVisible = false;
    if (last) {
      last.scrollIntoView({ block: 'nearest' });
      const lastRect = last.getBoundingClientRect();
      lastOptionVisible =
        lastRect.height > 0 && lastRect.bottom <= window.innerHeight + 1 && lastRect.top >= -1;
    }

    const rect = floating.getBoundingClientRect();
    const style = getComputedStyle(floating);
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
        scrollHeight: floating.scrollHeight,
        clientHeight: floating.clientHeight,
        scrollable:
          floating.scrollHeight > floating.clientHeight + 1 &&
          (style.overflowY === 'auto' || style.overflowY === 'scroll'),
      },
      optionCount: options.length,
      lastOptionVisible,
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
  // At compact widths the Inspector lives in a modal drawer; its launcher is
  // the only route in.
  const showInspector = page.getByRole('button', { name: 'Show inspector panel' });
  if (await showInspector.isVisible().catch(() => false)) {
    await showInspector.click();
  }

  const inspector = page.getByRole('region', { name: 'Inspector' });
  await inspector.getByRole('tab', { name: 'Design' }).click();

  const appearance = inspector.getByRole('button', { name: 'Appearance' });
  await appearance.scrollIntoViewIfNeeded();
  if ((await appearance.getAttribute('aria-expanded')) === 'false') {
    await appearance.click();
  }

  // The blend-mode Select lives inside the expanded Appearance panel. A
  // global haspopup locator matches hidden controls elsewhere in the shell.
  const panelId = await appearance.getAttribute('aria-controls');
  if (!panelId) throw new Error('Appearance section did not expand');
  const trigger = page.locator(`[id="${panelId}"]`).getByRole('combobox').first();
  await trigger.scrollIntoViewIfNeeded();
  await expect(trigger).toBeVisible({ timeout: 10000 });
  await trigger.click();
  // The combobox exposes aria-controls only while open, which pins the exact
  // listbox; a global locator also matches hidden leftovers (the Home
  // workspace filter keeps its listbox in the DOM).
  const listboxId = await trigger.getAttribute('aria-controls');
  if (!listboxId) throw new Error('blend-mode listbox did not open');
  const listbox = page.locator(`[id="${listboxId}"]`);
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

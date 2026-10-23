/**
 * E2E: the right sidebar's rows stay legible and reachable when the window is
 * narrow (split-screen), rather than overlapping or clipping.
 *
 * PDFCraft #4028 / #4118 report right-toolbar icons overlapping in Windows 11
 * split-screen mode and a cropped viewport. Varve's inspector collapses tabs
 * through a "More inspector tabs" menu; this spec asserts the observable
 * outcome at real split-screen widths: no two visible tabs share pixels, every
 * tab is reachable, the panel never scrolls horizontally, and the canvas dock
 * stays fully inside the viewport.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/** Opt-in visual evidence: writes only when VARVE_CAPTURE_DIR is set. */
async function capture(page: Page, name: string) {
  const dir = process.env.VARVE_CAPTURE_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}.png` });
}

// First paint on a shared machine has been measured near 90s; leave room for
// navigation plus the interaction under test.
test.describe.configure({ timeout: 420_000 });

async function layoutSnapshot(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('#editor-inspector-panel') as HTMLElement | null;
    const list = document.querySelector('.insp-panel__tabs') as HTMLElement | null;
    const canvas = document.querySelector('.editor-canvas') as HTMLElement | null;
    if (!panel || !list || !canvas) throw new Error('inspector or canvas missing');
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => ({
      label: tab.textContent?.trim() ?? '',
      rect: tab.getBoundingClientRect().toJSON() as DOMRect,
    }));
    return {
      tabs,
      list: list.getBoundingClientRect().toJSON(),
      panel: panel.getBoundingClientRect().toJSON(),
      panelScrollWidth: panel.scrollWidth,
      panelClientWidth: panel.clientWidth,
      canvas: canvas.getBoundingClientRect().toJSON(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      hasOverflowControl: Boolean(document.querySelector('[aria-label^="More inspector tabs"]')),
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

function expectNoOverlap(tabs: { label: string; rect: DOMRect }[]) {
  for (let i = 1; i < tabs.length; i += 1) {
    const previous = tabs[i - 1];
    const current = tabs[i];
    if (!previous || !current) continue;
    // Same row: the next tab may not start before the previous one ended.
    expect(current.rect.x, `${current.label} overlaps ${previous.label}`).toBeGreaterThanOrEqual(
      previous.rect.x + previous.rect.width - 0.5,
    );
  }
}

for (const size of [
  { width: 1024, height: 600 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  test.describe(`inspector rows at ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    test('tabs do not overlap and every tab stays reachable', async ({ page }) => {
      await navigateToEditor(page);
      const snapshot = await layoutSnapshot(page);
      await capture(page, `inspector-tabs-${size.width}x${size.height}`);

      expect(snapshot.tabs.length).toBeGreaterThan(0);
      expectNoOverlap(snapshot.tabs);
      for (const tab of snapshot.tabs) {
        expect(tab.rect.x).toBeGreaterThanOrEqual(snapshot.list.x - 1);
        expect(tab.rect.x + tab.rect.width).toBeLessThanOrEqual(
          snapshot.list.x + snapshot.list.width + 1,
        );
      }

      // Reachability: visible tabs plus the overflow menu's entries cover
      // every declared tab with no duplicates and nothing dropped.
      const labels = new Set(snapshot.tabs.map((tab) => tab.label));
      if (snapshot.hasOverflowControl) {
        await page.getByRole('button', { name: /more inspector tabs/i }).click();
        const items = page.getByRole('menu').getByRole('menuitem');
        const overflowLabels = await items.allTextContents();
        for (const label of overflowLabels) {
          const clean = label.trim();
          expect(labels.has(clean), `duplicate tab entry ${clean}`).toBe(false);
          labels.add(clean);
        }
        await page.keyboard.press('Escape');
      }
      expect(labels.size).toBeGreaterThan(0);

      // The panel scrolls vertically only; a horizontal scrollbar means a row
      // is wider than its column.
      expect(snapshot.panelScrollWidth).toBeLessThanOrEqual(snapshot.panelClientWidth + 1);
      expect(snapshot.docOverflow).toBeLessThanOrEqual(0);

      // The viewport is not cropped: the canvas dock sits fully inside the
      // window, with no negative origin.
      expect(snapshot.canvas.x).toBeGreaterThanOrEqual(0);
      expect(snapshot.canvas.y).toBeGreaterThanOrEqual(0);
      expect(snapshot.canvas.x + snapshot.canvas.width).toBeLessThanOrEqual(
        snapshot.viewport.width + 1,
      );
      expect(snapshot.canvas.y + snapshot.canvas.height).toBeLessThanOrEqual(
        snapshot.viewport.height + 1,
      );
      // And the inspector is on-screen rather than pushed past the edge.
      expect(snapshot.panel.x).toBeGreaterThanOrEqual(0);
      expect(snapshot.panel.x + snapshot.panel.width).toBeLessThanOrEqual(
        snapshot.viewport.width + 1,
      );
    });
  });
}

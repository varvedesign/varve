/**
 * Blend-mode backdrop fidelity.
 *
 * A separable blend mode over an area where nothing has been drawn yet must
 * blend with the transparent backdrop, not with white paper: `screen` green
 * over nothing is green, `difference` green over nothing is green. An
 * implementation that composites against an opaque white surface produces
 * white and magenta respectively — the failure reported against another PDF
 * application (storytold/pdfcraft#2970, a regression where `screen` green
 * came out white and `difference` green came out magenta) and the reason this
 * is pinned against a real browser canvas rather than only in unit maths.
 *
 * The harness (`apps/desktop/visual-harness-main.ts`) clears its canvas before
 * replay, so a fixture rendered through `__renderFixture` sits on a genuinely
 * transparent surface, and `getImageData` reports the surface's own alpha —
 * unlike the editor board, whose opaque pasteboard is an intentional and
 * documented product decision.
 */

import { expect, test } from '@playwright/test';
import type { RenderItem } from '@varve/engine';

const WIDTH = 240;
const HEIGHT = 160;
const RED = { space: 'rgb' as const, r: 220, g: 30, b: 30, a: 255 };
const GREEN = { space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 };

function rectItem(
  x: number,
  y: number,
  w: number,
  h: number,
  overrides: Partial<RenderItem> = {},
): RenderItem {
  return {
    transform: [1, 0, 0, 1, x, y],
    fill: GREEN,
    primitive: { kind: 'rect', x: 0, y: 0, w, h },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
    ...overrides,
  };
}

async function openHarness(page: import('@playwright/test').Page) {
  await page.goto('/visual-harness.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true,
    { timeout: 15000 },
  );
}

async function renderFixture(page: import('@playwright/test').Page, items: RenderItem[]) {
  await page.evaluate(
    async ({ items: itemsArg, width, height }) => {
      await (
        window as unknown as {
          __renderFixture: (items: unknown[], w: number, h: number) => Promise<void>;
        }
      ).__renderFixture(itemsArg, width, height);
    },
    { items, width: WIDTH, height: HEIGHT },
  );
}

async function pixelAt(page: import('@playwright/test').Page, x: number, y: number) {
  return page.evaluate(
    ({ x: px, y: py }) => {
      const canvas = document.getElementById('harness-canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D context unavailable');
      const data = ctx.getImageData(px, py, 1, 1).data;
      return [data[0], data[1], data[2], data[3]] as [number, number, number, number];
    },
    { x, y },
  );
}

const CENTRE = { x: 120, y: 80 };

test.describe('blend over an empty transparent area', () => {
  for (const mode of ['screen', 'difference', 'lighten', 'overlay'] as const) {
    test(`${mode} keeps the source colour where nothing is drawn`, async ({ page }) => {
      await openHarness(page);
      await renderFixture(page, [rectItem(40, 30, 160, 100, { blendMode: mode })]);

      const [r, g, b, a] = await pixelAt(page, CENTRE.x, CENTRE.y);
      // The empty area outside the rectangle must still be transparent: if it
      // is opaque, the surface was filled and the test below proves nothing.
      const outside = await pixelAt(page, 5, 5);
      expect(outside[3], 'harness surface should be transparent').toBe(0);

      expect(a, `${mode} should paint an opaque source`).toBe(255);
      expect(g, `${mode} green over nothing must stay green`).toBeGreaterThan(240);
      expect(r, `${mode} green over nothing must not pull toward white`).toBeLessThan(20);
      expect(b, `${mode} green over nothing must not turn magenta`).toBeLessThan(20);
    });
  }

  test('the mode still blends once a backdrop exists', async ({ page }) => {
    await openHarness(page);
    // Red backdrop, then a green `screen` rectangle half over it. The overlap
    // must turn yellow; the part over nothing must stay green. A pass on the
    // "over nothing" half alone would be vacuous if the mode were ignored.
    await renderFixture(page, [
      rectItem(20, 30, 100, 100, { fill: RED }),
      rectItem(70, 30, 140, 100, { blendMode: 'screen' }),
    ]);

    const [or_, og, ob] = await pixelAt(page, 40, 80);
    expect([or_, og, ob], 'red backdrop alone').toEqual([220, 30, 30]);

    const [mr, mg, mb] = await pixelAt(page, 110, 80);
    expect(mr, 'screen(red, green) red channel').toBeGreaterThan(200);
    expect(mg, 'screen(red, green) green channel').toBeGreaterThan(200);
    expect(mb, 'screen(red, green) blue channel').toBeLessThan(40);

    const [er, eg, eb] = await pixelAt(page, 200, 80);
    expect([er, eg, eb], 'green over nothing stays green').toEqual([0, 255, 0]);
  });
});

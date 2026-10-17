import { expect, test } from '@playwright/test';

import { navigateToEditor } from '../shared';

/**
 * Vector ink: what the Pencil and Pen actually put on the canvas.
 *
 * These are pixel oracles on the real artwork layer, not assertions that a
 * toolbar button lit up or that a node exists in the layer list. Both of the
 * defects they cover shipped with a "successful" node:
 *
 *   - a Pencil tap created a node whose path had zero points, so the layer
 *     appeared in the list and nothing was ever drawn;
 *   - Pencil paths carried no stroke, so the renderer closed and filled them —
 *     a straight stroke is a zero-area polygon and vanished, and a curved one
 *     came out as a teal fill rather than ink.
 *
 * The oracles are deliberately relative: they measure the ink's own bounding
 * box and its per-column centreline rather than predicting an absolute canvas
 * pixel for a world coordinate. The artwork layer's device grid, the camera and
 * the dock geometry are all free to move without turning these into
 * screenshot-diff tests.
 */

const CONTENT_CANVAS = 'canvas.editor-canvas__content-layer';

async function contentCanvasBox(page: import('@playwright/test').Page) {
  const canvas = page.locator(CONTENT_CANVAS);
  await canvas.waitFor({ state: 'attached', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box || box.width < 10 || box.height < 10) {
    throw new Error('content canvas not laid out');
  }
  return box;
}

interface InkShape {
  /** Ink pixel count. */
  count: number;
  /** Bounding box of the ink in CSS px relative to the sampled region. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  /** Per-column ink centroid (`n` = ink pixels in that column), left to right. */
  columns: Array<{ x: number; y: number; n: number }>;
}

/**
 * Read the artwork layer and describe the dark ("ink") pixels inside a region
 * given in canvas-relative CSS pixels. The backing store can be larger than the
 * CSS box on a fractional/retina DPR, so everything is converted back to CSS px.
 */
async function readInk(
  page: import('@playwright/test').Page,
  region: { x: number; y: number; w: number; h: number },
): Promise<InkShape> {
  return page.evaluate(
    ({ selector, rect }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(selector);
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) throw new Error('artwork canvas is not readable 2D');
      const scale = canvas.width / Math.max(1, canvas.clientWidth);
      const sx = Math.max(0, Math.round(rect.x * scale));
      const sy = Math.max(0, Math.round(rect.y * scale));
      const sw = Math.max(1, Math.round(rect.w * scale));
      const sh = Math.max(1, Math.round(rect.h * scale));
      const data = ctx.getImageData(sx, sy, sw, sh).data;

      let count = 0;
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      const colSum = new Float64Array(sw);
      const colCount = new Int32Array(sw);

      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const offset = (y * sw + x) * 4;
          const r = data[offset]!;
          const g = data[offset + 1]!;
          const b = data[offset + 2]!;
          const a = data[offset + 3]!;
          // Ink is dark and opaque. The empty design surface is light.
          if (a > 128 && r < 120 && g < 120 && b < 120) {
            count++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            colSum[x] = (colSum[x] ?? 0) + y;
            colCount[x] = (colCount[x] ?? 0) + 1;
          }
        }
      }

      const columns: Array<{ x: number; y: number; n: number }> = [];
      for (let x = 0; x < sw; x++) {
        const n = colCount[x] ?? 0;
        if (n > 0) columns.push({ x: x / scale, y: (colSum[x] ?? 0) / n / scale, n });
      }

      return {
        count,
        left: count > 0 ? minX / scale : Number.NaN,
        right: count > 0 ? maxX / scale : Number.NaN,
        top: count > 0 ? minY / scale : Number.NaN,
        bottom: count > 0 ? maxY / scale : Number.NaN,
        width: count > 0 ? (maxX - minX + 1) / scale : 0,
        height: count > 0 ? (maxY - minY + 1) / scale : 0,
        columns,
      };
    },
    { selector: CONTENT_CANVAS, rect: region },
  );
}

/** Spread of the per-column ink centreline, ignoring sparse antialias columns. */
function centrelineSpread(shape: InkShape, minColumnInk = 3): number {
  const solid = shape.columns.filter((column) => column.n >= minColumnInk);
  if (solid.length < 2) return 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const column of solid) {
    if (column.y < min) min = column.y;
    if (column.y > max) max = column.y;
  }
  return max - min;
}

test.describe('Vector ink rendering', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('a Pencil tap leaves a visible dot on the artwork layer', async ({ page }) => {
    test.setTimeout(60_000);
    const box = await contentCanvasBox(page);
    const tapX = 220;
    const tapY = 200;

    await page.keyboard.press('Shift+p');
    await page.waitForTimeout(200);
    await page.mouse.click(box.x + tapX, box.y + tapY);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(400);

    // A zero-point path committed "successfully" here and rendered nothing.
    const ink = await readInk(page, { x: tapX - 40, y: tapY - 40, w: 80, h: 80 });
    expect(ink.count, `tap ink ${JSON.stringify({ ...ink, columns: undefined })}`).toBeGreaterThan(
      20,
    );
    // A dot, not a smear: bounded in both axes.
    expect(ink.width).toBeLessThan(60);
    expect(ink.height).toBeLessThan(60);

    const shot = test.info().outputPath('pencil-tap-dot.png');
    await page.locator(CONTENT_CANVAS).screenshot({ path: shot });
    await test.info().attach('pencil-tap-dot', { path: shot, contentType: 'image/png' });
  });

  test('a straight Pencil stroke renders as a stroke, not as a zero-area fill', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const box = await contentCanvasBox(page);
    const lineY = 260;
    const fromX = 140;
    const toX = 460;

    await page.keyboard.press('Shift+p');
    await page.waitForTimeout(200);

    // A deliberately straight drag: the centreline has no geometric feature at
    // all, so this is exactly the case the old fill-only path erased.
    await page.mouse.move(box.x + fromX, box.y + lineY);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
      await page.mouse.move(box.x + fromX + ((toX - fromX) * step) / 6, box.y + lineY);
    }
    await page.mouse.up();

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(400);

    const region = { x: fromX - 40, y: lineY - 90, w: toX - fromX + 80, h: 180 };
    const ink = await readInk(page, region);
    const summary = JSON.stringify({ ...ink, columns: undefined });

    expect(ink.count, `ink ${summary}`).toBeGreaterThan(100);
    // Spans the drag (round caps add roughly one stroke width in total).
    expect(ink.width, `ink ${summary}`).toBeGreaterThan((toX - fromX) * 0.9);
    // A 20 px stroke, not a hairline and not a blob.
    expect(ink.height, `ink ${summary}`).toBeGreaterThan(6);
    expect(ink.height, `ink ${summary}`).toBeLessThan(60);
    // A straight stroke has a straight centreline; a filled closed polygon
    // would have a varying one.
    expect(centrelineSpread(ink), `ink ${summary}`).toBeLessThan(2.5);

    const shot = test.info().outputPath('pencil-straight-stroke.png');
    await page.locator(CONTENT_CANVAS).screenshot({ path: shot });
    await test.info().attach('pencil-straight-stroke', { path: shot, contentType: 'image/png' });
  });

  test('a Pencil stroke ends under the released pointer', async ({ page }) => {
    test.setTimeout(60_000);
    const box = await contentCanvasBox(page);
    const lineY = 200;
    const fromX = 160;
    const toX = 440;

    await page.keyboard.press('Shift+p');
    await page.waitForTimeout(200);

    await page.mouse.move(box.x + fromX, box.y + lineY);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
      await page.mouse.move(box.x + fromX + ((toX - fromX) * step) / 6, box.y + lineY);
    }
    await page.mouse.up();
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(400);

    const drawn = await readInk(page, { x: fromX - 40, y: lineY - 90, w: toX - fromX, h: 180 });
    // Nothing may be drawn past where the pointer was released (beyond the
    // round cap, which cannot exceed half a stroke width).
    const beyond = await readInk(page, { x: toX + 40, y: lineY - 90, w: 120, h: 180 });
    expect(
      beyond.count,
      `ink past release ${JSON.stringify({ ...beyond, columns: undefined })}`,
    ).toBe(0);
    expect(drawn.count).toBeGreaterThan(100);
  });

  test('a Pen drag bows the committed segment away from the chord', async ({ page }) => {
    test.setTimeout(60_000);
    const box = await contentCanvasBox(page);
    const startX = 180;
    const startY = 300;
    const endX = 460;
    const endY = 300;

    await page.keyboard.press('p');
    await page.waitForTimeout(200);
    await page.mouse.click(box.x + startX, box.y + startY);
    await page.waitForTimeout(300);

    // Drag the second anchor's direction handle out and release.
    await page.mouse.move(box.x + endX, box.y + endY);
    await page.mouse.down();
    await page.mouse.move(box.x + endX + 170, box.y + endY - 170, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(400);

    const region = { x: startX - 40, y: endY - 160, w: endX - startX + 80, h: 320 };
    const ink = await readInk(page, region);
    const summary = JSON.stringify({ ...ink, columns: undefined });
    expect(ink.count, `ink ${summary}`).toBeGreaterThan(100);
    // A handle bends the segment off the chord; a corner point would leave a
    // straight 20 px band whose centreline never moves.
    expect(centrelineSpread(ink), `ink ${summary}`).toBeGreaterThan(4);

    const shot = test.info().outputPath('pen-drag-handle.png');
    await page.locator(CONTENT_CANVAS).screenshot({ path: shot });
    await test.info().attach('pen-drag-handle', { path: shot, contentType: 'image/png' });
  });

  /**
   * Synthetic pointer stream, labelled as such.
   *
   * A browser does not promise a qualifying pointermove between pointerdown
   * and pointerup — a fast flick or a busy main thread can deliver the whole
   * displacement in the release event. Real Playwright mouse input always
   * emits an intervening move, so that event shape can only be produced by
   * dispatching the sequence directly.
   */
  test('a Pen drag reported only by pointerup still creates direction handles', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await contentCanvasBox(page);
    const startX = 180;
    const startY = 240;
    const endX = 460;
    const endY = 240;

    await page.keyboard.press('p');
    await page.waitForTimeout(200);

    const dispatch = async (type: string, x: number, y: number, buttons: number): Promise<void> => {
      await page.evaluate(
        ({ selector, eventType, cx, cy, buttonState }) => {
          const canvas = document.querySelector<HTMLCanvasElement>(selector);
          if (!canvas) throw new Error('canvas missing');
          const rect = canvas.getBoundingClientRect();
          canvas.dispatchEvent(
            new PointerEvent(eventType, {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 1,
              pointerType: 'pen',
              isPrimary: true,
              button: buttonState === 0 ? -1 : 0,
              buttons: buttonState,
              pressure: buttonState === 0 ? 0 : 0.5,
              clientX: rect.left + cx,
              clientY: rect.top + cy,
            }),
          );
        },
        { selector: CONTENT_CANVAS, eventType: type, cx: x, cy: y, buttonState: buttons },
      );
    };

    // Anchor one.
    await dispatch('pointerdown', startX, startY, 1);
    await dispatch('pointerup', startX, startY, 0);
    await page.waitForTimeout(250);

    // Anchor two, with the whole drag reported only at release.
    await dispatch('pointerdown', endX, endY, 1);
    await dispatch('pointerup', endX + 170, endY - 170, 0);
    await page.waitForTimeout(250);

    await page.keyboard.press('Enter');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(400);

    const region = { x: startX - 40, y: endY - 160, w: endX - startX + 80, h: 320 };
    const ink = await readInk(page, region);
    const summary = JSON.stringify({ ...ink, columns: undefined });
    expect(ink.count, `ink ${summary}`).toBeGreaterThan(100);
    expect(centrelineSpread(ink), `ink ${summary}`).toBeGreaterThan(4);

    const shot = test.info().outputPath('pen-release-only-handle.png');
    await page.locator(CONTENT_CANVAS).screenshot({ path: shot });
    await test.info().attach('pen-release-only-handle', {
      path: shot,
      contentType: 'image/png',
    });
  });
});

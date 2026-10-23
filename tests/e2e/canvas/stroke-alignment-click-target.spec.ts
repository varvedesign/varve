import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Stroke alignment must move the click target with the paint.
 * GraphiteEditor/Graphite#3047 reports that an inside/centre/outside setting
 * never reached hit testing, so an outside-aligned stroke's outer half was
 * unreachable. Varve's hit test expanded candidate bounds by the bounding box
 * plus a zoom-aware screen tolerance only, which under-picked every pixel past
 * that margin. This spec paints a 40 px outside stroke, reads the canvas as the
 * rendering oracle, and clicks 20 px beyond the geometry.
 */
test.use({ viewport: { width: 1440, height: 1000 } });

const RECT_FROM = { x: 420, y: 260 };
const RECT_TO = { x: 600, y: 400 };
/** 20 px right of the rectangle: painted by a 40 px outside stroke, outside
 * the 8 px click tolerance. */
const OUTSIDE_BAND = { x: 620, y: 330 };
/** Empty artwork area used to clear the selection and to sample the backdrop. */
const EMPTY = { x: 200, y: 700 };

async function canvasPoint(page: Page, x: number, y: number) {
  const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
  if (!box) throw new Error('canvas not mounted');
  return { x: box.x + x, y: box.y + y };
}

async function clickCanvas(page: Page, x: number, y: number) {
  const point = await canvasPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function samplePixel(page: Page, x: number, y: number): Promise<string> {
  const point = await canvasPoint(page, x, y);
  const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
  if (!box) throw new Error('canvas not mounted');
  return page.evaluate(
    ({ px, py, left, top }) => {
      const canvas = document.querySelector(
        'canvas.editor-canvas__content-layer',
      ) as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 'no-2d-context';
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      const data = ctx.getImageData(
        Math.round((px - left) * scale),
        Math.round((py - top) * scale),
        1,
        1,
      ).data;
      return `${data[0]},${data[1]},${data[2]},${data[3]}`;
    },
    { px: point.x, py: point.y, left: box.x, top: box.y },
  );
}

async function editorHasSelection(page: Page): Promise<boolean> {
  return page
    .getByRole('spinbutton', { name: 'X (px)', exact: true })
    .first()
    .isVisible()
    .catch(() => false);
}

async function clearSelection(page: Page) {
  await clickCanvas(page, EMPTY.x, EMPTY.y);
  await page.keyboard.press('Escape');
  await expect.poll(() => editorHasSelection(page), { timeout: 10000 }).toBe(false);
}

async function setStrokePosition(page: Page, position: 'Inside' | 'Center' | 'Outside') {
  const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
  await inspector.getByLabel('Stroke position').click();
  await page.getByRole('option', { name: position, exact: true }).click();
}

test.describe('stroke alignment click targets', () => {
  test('an outside stroke band is clickable where it paints', async ({ page }) => {
    await navigateToEditor(page);

    await page.keyboard.press('r');
    const from = await canvasPoint(page, RECT_FROM.x, RECT_FROM.y);
    const to = await canvasPoint(page, RECT_TO.x, RECT_TO.y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('v');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
    await inspector.getByRole('button', { name: 'Add stroke', exact: true }).click();
    const weight = inspector.getByRole('spinbutton', { name: /Stroke weight \(px\)/i });
    await weight.fill('40');
    await weight.press('Enter');
    await weight.blur();
    await setStrokePosition(page, 'Outside');

    const backdrop = await samplePixel(page, EMPTY.x, EMPTY.y);
    const painted = await samplePixel(page, OUTSIDE_BAND.x, OUTSIDE_BAND.y);
    // The oracle: the pixel the click will target is the stroke, not the page.
    expect(painted).not.toBe(backdrop);

    await clearSelection(page);
    await clickCanvas(page, OUTSIDE_BAND.x, OUTSIDE_BAND.y);
    await expect.poll(() => editorHasSelection(page), { timeout: 10000 }).toBe(true);
    await page.screenshot({ path: 'reports/stroke-alignment/outside-stroke-target.png' });

    // Control: the same point is unpainted and untargeted for an inside stroke.
    await setStrokePosition(page, 'Inside');
    const insidePainted = await samplePixel(page, OUTSIDE_BAND.x, OUTSIDE_BAND.y);
    expect(insidePainted).toBe(backdrop);

    await clearSelection(page);
    await clickCanvas(page, OUTSIDE_BAND.x, OUTSIDE_BAND.y);
    await expect.poll(() => editorHasSelection(page), { timeout: 10000 }).toBe(false);
    await page.screenshot({ path: 'reports/stroke-alignment/inside-stroke-no-target.png' });
  });
});

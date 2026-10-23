import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * GraphiteEditor/Graphite#2549 reports an axis-aligned line with almost no
 * hover/click area: a box selection started instead of a drag, and the cursor
 * stayed on rotate. This spec proves Varve's behaviour either way instead of
 * assuming it.
 *
 * A horizontal line has a zero-height bounding box, so direct manipulation can
 * only work through the click policy's bounding-box tolerance fallback. Varve
 * does not rotate from the box body at all (rotation has its own handle), so
 * the cursor half of the report is a structural difference rather than a
 * defect.
 *
 * The drag is performed as one continuous gesture from an unselected line.
 * That is the reported workflow, and it avoids the select-click / drag-press
 * repeat-click path, which resolves as a depth cycle by design.
 */
test.use({ viewport: { width: 1440, height: 1000 } });

const LINE_FROM = { x: 420, y: 300 };
const LINE_TO = { x: 720, y: 300 };
const MIDPOINT = { x: 570, y: 300 };
const DRAG_DELTA_Y = 120;
/** Empty artwork area used to clear the selection and sample the backdrop. */
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

/**
 * Every pixel in a short vertical run, so the assertions do not depend on the
 * sub-pixel row a 1 px line lands on.
 */
async function columnPixels(page: Page, x: number, yFrom: number, yTo: number): Promise<string[]> {
  const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
  if (!box) throw new Error('canvas not mounted');
  return page.evaluate(
    ({ px, pyFrom, pyTo, left, top }) => {
      const canvas = document.querySelector(
        'canvas.editor-canvas__content-layer',
      ) as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return ['no-2d-context'];
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      const out: string[] = [];
      for (let y = pyFrom; y <= pyTo; y += 1) {
        const data = ctx.getImageData(
          Math.round((px - left) * scale),
          Math.round((y - top) * scale),
          1,
          1,
        ).data;
        out.push(`${data[0]},${data[1]},${data[2]},${data[3]}`);
      }
      return out;
    },
    { px: box.x + x, pyFrom: box.y + yFrom, pyTo: box.y + yTo, left: box.x, top: box.y },
  );
}

async function editorHasSelection(page: Page): Promise<boolean> {
  return page
    .getByRole('spinbutton', { name: 'X (px)', exact: true })
    .first()
    .isVisible()
    .catch(() => false);
}

async function selectionY(page: Page): Promise<number> {
  const value = await page
    .getByRole('spinbutton', { name: 'Y (px)', exact: true })
    .first()
    .inputValue();
  return Number(value);
}

test.describe('axis-aligned line direct manipulation', () => {
  test('a zero-height line is hoverable and draggable in one gesture', async ({ page }) => {
    await navigateToEditor(page);

    await page.keyboard.press('l');
    const from = await canvasPoint(page, LINE_FROM.x, LINE_FROM.y);
    const to = await canvasPoint(page, LINE_TO.x, LINE_TO.y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('v');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await clickCanvas(page, EMPTY.x, EMPTY.y);
    await expect.poll(() => editorHasSelection(page), { timeout: 10000 }).toBe(false);

    // Hover: SelectTool resolves 'hover' to the move cursor. A rotate cursor
    // here was the Graphite report; Varve keeps rotation on its own handle.
    const midpoint = await canvasPoint(page, MIDPOINT.x, MIDPOINT.y);
    await page.mouse.move(midpoint.x, midpoint.y);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              getComputedStyle(document.querySelector('canvas.editor-canvas__content-layer')!)
                .cursor,
          ),
        { timeout: 10000 },
      )
      .toBe('move');

    const boxBefore = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
    if (!boxBefore) throw new Error('canvas not mounted');
    const [backdrop] = await columnPixels(page, EMPTY.x, EMPTY.y, EMPTY.y);
    expect(backdrop, 'backdrop sample').toBeDefined();
    // Canvas pixels lag the interaction by a frame, so every pixel assertion
    // polls instead of sampling once (a blank in-flight frame is not evidence).
    await expect
      .poll(
        async () =>
          (await columnPixels(page, MIDPOINT.x, MIDPOINT.y - 6, MIDPOINT.y + 6)).some(
            (pixel) => pixel !== backdrop,
          ),
        { timeout: 5000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () =>
          (
            await columnPixels(
              page,
              MIDPOINT.x,
              MIDPOINT.y + DRAG_DELTA_Y - 10,
              MIDPOINT.y + DRAG_DELTA_Y + 10,
            )
          ).every((pixel) => pixel === backdrop),
        { timeout: 5000 },
      )
      .toBe(true);

    // Drag as a single gesture: pressing the unselected line must move it, not
    // start a box selection.
    await page.mouse.move(midpoint.x, midpoint.y);
    await page.mouse.down();
    await page.mouse.move(midpoint.x, midpoint.y + DRAG_DELTA_Y, { steps: 12 });
    await page.mouse.up();

    await expect.poll(() => editorHasSelection(page), { timeout: 10000 }).toBe(true);
    // Grid snapping may settle the value a few units off the raw delta.
    await expect.poll(() => selectionY(page), { timeout: 10000 }).toBeGreaterThan(400);

    // Selecting an object opens the contextual properties row, which shortens
    // the canvas viewport and shifts canvas-relative coordinates up by the same
    // amount. Re-anchor the expected rows against the canvas box measured
    // before the selection existed.
    const boxAfter = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
    if (!boxAfter) throw new Error('canvas not mounted');
    const shift = boxAfter.y - boxBefore.y;
    const expectedRow = MIDPOINT.y - shift + DRAG_DELTA_Y;

    await expect
      .poll(
        async () =>
          (await columnPixels(page, MIDPOINT.x, expectedRow - 10, expectedRow + 10)).some(
            (pixel) => pixel !== backdrop,
          ),
        { timeout: 5000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () =>
          (
            await columnPixels(page, MIDPOINT.x, MIDPOINT.y - shift - 6, MIDPOINT.y - shift + 6)
          ).every((pixel) => pixel === backdrop),
        { timeout: 5000 },
      )
      .toBe(true);
    await page.screenshot({ path: 'reports/axis-aligned-line/dragged-line.png' });
  });
});

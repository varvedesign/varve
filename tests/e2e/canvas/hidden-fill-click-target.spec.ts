import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Hidden paint must be neither visible nor clickable.
 * GraphiteEditor/Graphite#2554 reports hidden geometry staying reachable by
 * clicking. In Varve the same class had two halves: the IR builder dropped
 * hidden fills, so replay fell back to the node's legacy colour and painted the
 * fill the user had just hidden; and the hit test's bounding-box fallback still
 * claimed a target across the whole box. This spec covers both, with a pixel
 * read as the rendering oracle.
 */
test.use({ viewport: { width: 1440, height: 1000 } });

const A = { x: 400, y: 220 };
const B = { x: 720, y: 220 };
const C = { x: 720, y: 540 };
/** Inside the bounding box, ~100px from the nearest painted segment. */
const INTERIOR = { x: 660, y: 320 };

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

async function drawOpenPath(page: Page) {
  await page.keyboard.press('p');
  for (const point of [A, B, C]) {
    const target = await canvasPoint(page, point.x, point.y);
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(60);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await page.keyboard.press('v');
}

async function setFillVisibility(page: Page, visible: boolean) {
  const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
  const toggle = inspector.getByLabel(visible ? /Show fill/i : /Hide fill/i).first();
  if (!(await toggle.isVisible().catch(() => false))) {
    // The Fill section is a disclosure; expand it if it is collapsed.
    await inspector.getByRole('button', { name: /^Fill/ }).first().click();
  }
  await toggle.click();
}

test.describe('hidden fill click target', () => {
  test('a shape whose only fill is hidden stops claiming its bounding box', async ({ page }) => {
    await navigateToEditor(page);
    await drawOpenPath(page);
    await setFillVisibility(page, false);

    // Empty-canvas click returns focus to the canvas; Escape then clears the
    // editor's selection (the tool owns that key).
    await clickCanvas(page, 150, 700);
    await page.keyboard.press('Escape');
    await expect.poll(() => editorHasSelection(page), { timeout: 10000 }).toBe(false);

    const paintedWhenHidden = await samplePixel(page, INTERIOR.x, INTERIOR.y);
    await clickCanvas(page, INTERIOR.x, INTERIOR.y);
    await expect.poll(() => editorHasSelection(page), { timeout: 10000 }).toBe(false);
    await page.screenshot({ path: 'reports/hidden-fill/hidden-fill-no-target.png' });

    // Control: with the fill visible again the same point is a target. The
    // layer row selects the node (its interior deliberately does not).
    await page.getByRole('treeitem').first().click();
    await expect.poll(() => editorHasSelection(page), { timeout: 10000 }).toBe(true);
    await setFillVisibility(page, true);
    await clickCanvas(page, 150, 700);
    await page.keyboard.press('Escape');
    await expect.poll(() => editorHasSelection(page), { timeout: 10000 }).toBe(false);

    const paintedWhenVisible = await samplePixel(page, INTERIOR.x, INTERIOR.y);
    await clickCanvas(page, INTERIOR.x, INTERIOR.y);
    await expect.poll(() => editorHasSelection(page), { timeout: 10000 }).toBe(true);
    await page.screenshot({ path: 'reports/hidden-fill/visible-fill-target.png' });

    // The hidden fill must paint nothing: replay previously fell back to the
    // node's legacy colour, so the shape looked filled while it was not.
    expect(paintedWhenHidden).not.toBe(paintedWhenVisible);
  });
});

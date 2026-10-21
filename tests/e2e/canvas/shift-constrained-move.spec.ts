import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/**
 * Shift constrains a transform gesture (docs/architecture/input-system-behavior-
 * matrix.md, "Constrain / centre / snap bypass"). Before this spec existed the
 * move gesture ignored it: InteractionSession tracked an axis lock that no tool
 * read, so a Shift-drag moved on both axes exactly like an unconstrained drag.
 *
 * Graphite removed its 45 degree move constraint and users asked for it back
 * (GraphiteEditor/Graphite#4246). The contract here keeps the axis case for
 * near-axis drags and preserves a deliberate diagonal.
 */
test.use({ viewport: { width: 1440, height: 1000 } });

const RECT = { x1: 300, y1: 250, x2: 520, y2: 400 } as const;
const CENTER = { x: 410, y: 325 } as const;

async function drawRect(page: Page) {
  await page.keyboard.press('r');
  await dragOnCanvas(page, RECT.x1, RECT.y1, RECT.x2, RECT.y2);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  // A shape tool stays active after it draws, so Shift would mean "square"
  // for the next drag and a canvas click would draw instead of select.
  await page.keyboard.press('v');
}

async function position(page: Page): Promise<{ x: number; y: number }> {
  const x = page.getByRole('spinbutton', { name: 'X (px)', exact: true }).first();
  const y = page.getByRole('spinbutton', { name: 'Y (px)', exact: true }).first();
  return { x: Number(await x.inputValue()), y: Number(await y.inputValue()) };
}

async function shiftDragTo(page: Page, toX: number, toY: number) {
  await page.keyboard.down('Shift');
  await dragOnCanvas(page, CENTER.x, CENTER.y, toX, toY);
  await page.keyboard.up('Shift');
}

test.describe('Shift-constrained movement', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await drawRect(page);
    await page.mouse.move(0, 0);
    // Select the shape on the canvas so the Inspector reports its position.
    const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
    if (!box) throw new Error('canvas not mounted');
    await page.mouse.click(box.x + CENTER.x, box.y + CENTER.y);
    await expect(page.getByRole('treeitem').first()).toHaveAttribute('aria-selected', 'true');
  });

  test('a near-axis Shift-drag moves along that axis only', async ({ page }) => {
    const before = await position(page);
    // 100 across, 20 down: inside the 22.5 degree axis band.
    await shiftDragTo(page, CENTER.x + 100, CENTER.y + 20);
    const after = await position(page);
    expect(after.y - before.y).toBeCloseTo(0, 0);
    expect(after.x - before.x).toBeGreaterThan(90);
  });

  test('a deliberate diagonal Shift-drag keeps its 45 degree direction', async ({ page }) => {
    const before = await position(page);
    await shiftDragTo(page, CENTER.x + 80, CENTER.y + 80);
    const after = await position(page);
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    expect(dx).toBeGreaterThan(60);
    expect(dy).toBeGreaterThan(60);
    expect(Math.abs(dx - dy)).toBeLessThan(2);
  });

  test('an unconstrained drag keeps both components', async ({ page }) => {
    const before = await position(page);
    await dragOnCanvas(page, CENTER.x, CENTER.y, CENTER.x + 100, CENTER.y + 20);
    const after = await position(page);
    expect(after.x - before.x).toBeGreaterThan(70);
    expect(after.y - before.y).toBeGreaterThan(10);
  });

  test('the constrained drag stays a single undo step', async ({ page }) => {
    const before = await position(page);
    await shiftDragTo(page, CENTER.x + 100, CENTER.y + 20);
    const moved = await position(page);
    expect(moved.x).not.toBeCloseTo(before.x, 0);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    const restored = await position(page);
    expect(restored.x).toBeCloseTo(before.x, 0);
    expect(restored.y).toBeCloseTo(before.y, 0);
  });
});

import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/**
 * With the Text tool active and a text layer selected, Ctrl+Enter begins
 * editing it — the keyboard path from "text selected" to "typing". Graphite
 * added the same entry point (GraphiteEditor/Graphite#4756, closing #3637);
 * Varve uses the chord rather than plain Enter because Enter already renames
 * the selected layer here.
 */
test.use({ viewport: { width: 1440, height: 1000 } });

const EDIT_SURFACE = '[data-text-edit-surface="true"]';

async function canvasPoint(page: Page, x: number, y: number) {
  const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
  if (!box) throw new Error('canvas not mounted');
  return { x: box.x + x, y: box.y + y };
}

async function createPointText(page: Page, x: number, y: number) {
  await page.keyboard.press('t');
  const point = await canvasPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(EDIT_SURFACE)).toBeVisible({ timeout: 10000 });
  // Give the layer content: an empty text object is not a useful thing to
  // re-open, and the workflow under test starts from real text.
  await page.keyboard.type('Hello');
  // Escape leaves the session and keeps the text object selected.
  await page.keyboard.press('Escape');
  await expect(page.locator(EDIT_SURFACE)).toHaveCount(0, { timeout: 10000 });
}

test.describe('Text tool Enter', () => {
  test('Ctrl+Enter begins editing the selected text layer', async ({ page }) => {
    await navigateToEditor(page);
    await createPointText(page, 420, 320);
    await expect(page.getByRole('treeitem')).toHaveCount(1);

    // Give the canvas keyboard focus and a real editor selection: select the
    // text object with the Select tool, then arm the Text tool. Tool keys are
    // routed from the canvas, so focus has to be there first.
    await page.keyboard.press('v');
    const point = await canvasPoint(page, 420, 320);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByRole('spinbutton', { name: 'X (px)', exact: true }).first()).toBeVisible(
      { timeout: 10000 },
    );
    await page.keyboard.press('t');
    await expect(page.getByRole('spinbutton', { name: 'X (px)', exact: true }).first()).toBeVisible(
      { timeout: 10000 },
    );
    // Tool keys are routed from the focused canvas, so focus it explicitly:
    // selecting through the panel leaves focus on the row.
    await page.locator('canvas.editor-canvas__content-layer').focus();

    await page.keyboard.press('Control+Enter');
    await expect(page.locator(EDIT_SURFACE)).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'reports/text-tool-enter/editing.png' });
  });

  test('plain Enter still renames instead of editing', async ({ page }) => {
    await navigateToEditor(page);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 300, 250, 520, 400);
    await expect(page.getByRole('treeitem')).toHaveCount(1);
    // Same focus path as the Ctrl+Enter case: click the object on the canvas
    // so the content layer owns the keyboard. Enter on a Layers row activates
    // the row; it does not open the canvas rename dialog. The old assertion
    // watched any dialog and passed when Text options auto-opened.
    await page.keyboard.press('v');
    const point = await canvasPoint(page, 410, 320);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByRole('spinbutton', { name: 'X (px)', exact: true }).first()).toBeVisible(
      {
        timeout: 10000,
      },
    );
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.press('t');
    await expect(page.getByRole('dialog', { name: 'Text tool options' })).toHaveCount(0);
    // Playwright's press('Enter') is swallowed before the canvas React
    // handler (the old test saw the auto-opened Text options dialog). A
    // bubbling keydown on the focused content layer is the same path as a
    // typed Enter and opens the rename dialog without starting a text session.
    await canvas.evaluate((el) => {
      el.focus();
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    await expect(page.getByRole('dialog', { name: 'Rename layer' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(EDIT_SURFACE)).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
});

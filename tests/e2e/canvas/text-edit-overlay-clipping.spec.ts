/**
 * E2E: the inline text-edit surface is clipped to the canvas viewport.
 *
 * PDFCraft #4056 reports an edit overlay that is not clipped to the viewport
 * and "gets fixed on scroll": while a long text object is being edited, the
 * DOM editing surface can cover the inspector, and moving the camera leaves
 * it in the wrong place. Varve positions the textarea in screen space from the
 * same camera transform the renderer uses and clips both paint and hit
 * testing with a viewport `inset(...)`.
 *
 * These assertions are about the observable outcome in a real browser at a
 * small window: after scrolling and zooming, no part of the editing surface
 * is hit-testable over the inspector, and its clip rectangle stays inside the
 * canvas dock.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const EDIT_SURFACE = '[data-text-edit-surface="true"]';

// First paint on a shared machine has been measured near 90s; leave room for
// navigation plus the interaction under test.
test.describe.configure({ timeout: 420_000 });

async function canvasBox(page: Page) {
  const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
  if (!box) throw new Error('canvas not mounted');
  return box;
}

async function createLongTextNearRightEdge(page: Page) {
  const box = await canvasBox(page);
  await page.keyboard.press('t');
  // Near the right edge of the canvas dock, so an unclipped surface would
  // extend under the inspector.
  const point = { x: box.x + box.width - 120, y: box.y + 120 };
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(EDIT_SURFACE)).toBeVisible({ timeout: 10000 });
  await page.keyboard.type('A very long line of text that overflows the canvas dock');
}

async function overlayState(page: Page) {
  return page.evaluate(() => {
    const surface = document.querySelector(
      '[data-text-edit-surface="true"]',
    ) as HTMLTextAreaElement | null;
    if (!surface) throw new Error('edit surface missing');
    const wrapper = surface.parentElement as HTMLElement;
    const clip = getComputedStyle(wrapper).clipPath;
    const match = clip.match(/inset\(([^)]+)\)/);
    const rawInsets = match?.[1];
    const insets = rawInsets
      ? rawInsets.split(/\s+/).map((value) => Number.parseFloat(value))
      : null;
    const canvas = document.querySelector('.editor-canvas') as HTMLElement | null;
    const inspector = document.querySelector('#editor-inspector-panel') as HTMLElement | null;
    if (!canvas || !inspector) throw new Error('canvas or inspector missing');
    return {
      clip,
      insets,
      canvas: canvas.getBoundingClientRect().toJSON(),
      inspector: inspector.getBoundingClientRect().toJSON(),
      surface: surface.getBoundingClientRect().toJSON(),
    };
  });
}

/** The point at the inspector's centre must not belong to the edit surface. */
async function expectInspectorNotCovered(page: Page) {
  const hit = await page.evaluate(() => {
    const inspector = document.querySelector('#editor-inspector-panel') as HTMLElement | null;
    if (!inspector) throw new Error('inspector missing');
    const rect = inspector.getBoundingClientRect();
    const el = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      isEditSurface: Boolean(el?.closest('[data-text-edit-surface="true"]')),
      inInspector: Boolean(el?.closest('#editor-inspector-panel')),
    };
  });
  expect(hit.isEditSurface).toBe(false);
  expect(hit.inInspector).toBe(true);
}

test.describe('text edit overlay clipping', () => {
  test.use({ viewport: { width: 1024, height: 600 } });

  test('stays clipped to the canvas while scrolling and zooming', async ({ page }) => {
    await navigateToEditor(page);
    await createLongTextNearRightEdge(page);

    const initial = await overlayState(page);
    expect(initial.clip).toContain('inset');
    expect(initial.insets).not.toBeNull();
    await expectInspectorNotCovered(page);

    // Scroll the canvas under the edit session; the clip must follow.
    await page.mouse.move(initial.canvas.x + 200, initial.canvas.y + 200);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(120);
    const afterScroll = await overlayState(page);
    expect(afterScroll.insets).not.toBeNull();
    await expectInspectorNotCovered(page);

    // Zoom out with the keyboard path so the surface keeps a camera-derived
    // position, then check the clip again.
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+-');
    await page.waitForTimeout(120);
    const afterZoom = await overlayState(page);
    expect(afterZoom.insets).not.toBeNull();
    // The clip's right edge must not extend past the canvas dock's right edge
    // by more than a subpixel rounding error.
    const rightInset = (afterZoom.insets as number[])[1] ?? 0;
    const clipRight = 1024 - rightInset;
    expect(clipRight).toBeLessThanOrEqual(afterZoom.canvas.x + afterZoom.canvas.width + 1);
    await expectInspectorNotCovered(page);

    // No page-level horizontal overflow from the fixed-position surface.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('stays clipped at a scaled viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await navigateToEditor(page);
    await createLongTextNearRightEdge(page);
    await expectInspectorNotCovered(page);
    const state = await overlayState(page);
    const rightInset = (state.insets as number[])[1] ?? 0;
    expect(1440 - rightInset).toBeLessThanOrEqual(state.canvas.x + state.canvas.width + 1);
  });
});

test.describe('text edit surface layout parity', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('mirrors the paragraph alignment the canvas painted', async ({ page }) => {
    await navigateToEditor(page);
    const box = await canvasBox(page);
    await page.keyboard.press('t');
    await page.mouse.click(box.x + 320, box.y + 220);
    await expect(page.locator(EDIT_SURFACE)).toBeVisible({ timeout: 10000 });
    await page.keyboard.type('Alignment parity');
    await page.keyboard.press('Escape');
    await expect(page.locator(EDIT_SURFACE)).toHaveCount(0, { timeout: 10000 });

    // Select the text and centre it through the Inspector, the real route.
    await page.getByRole('treeitem').first().click();
    const center = page
      .getByRole('radiogroup', { name: 'Horizontal align' })
      .getByRole('radio', { name: 'Align center' });
    await center.click();
    await expect(center).toBeChecked();

    // Re-enter editing from the canvas the way a user does, then read the
    // surface's layout.
    // Re-select through the layers tree (the route the keyboard editing spec
    // uses), arm the Text tool, focus the canvas, then begin editing.
    await page.getByRole('treeitem').first().click();
    await page.keyboard.press('t');
    await page.locator('canvas.editor-canvas__content-layer').focus();
    await page.keyboard.press('Control+Enter');
    await expect(page.locator(EDIT_SURFACE)).toBeVisible({ timeout: 10000 });
    const alignment = await page.evaluate(() => {
      const surface = document.querySelector('[data-text-edit-surface="true"]');
      return surface ? getComputedStyle(surface).textAlign : null;
    });
    expect(alignment).toBe('center');
  });
});

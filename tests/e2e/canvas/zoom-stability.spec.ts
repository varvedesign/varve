import { expect, type Locator, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function selectionRect(page: Page): Promise<SelectionRect> {
  const overlay = page.locator('svg:has(filter#selection-glow)');
  const rect = overlay.locator(':scope > rect').first();
  await expect(rect).toBeVisible();
  return rect.evaluate((element) => {
    const selection = element as SVGRectElement;
    return {
      x: selection.x.baseVal.value,
      y: selection.y.baseVal.value,
      width: selection.width.baseVal.value,
      height: selection.height.baseVal.value,
    };
  });
}

const PIXEL_ORACLE_CSS_SIZE = { width: 640, height: 480 };

async function rawContentHash(page: Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element, oracleSize) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('content canvas context unavailable');
    const bounds = canvas.getBoundingClientRect();
    const scaleX = canvas.width / bounds.width;
    const scaleY = canvas.height / bounds.height;
    const oracle = document.createElement('canvas');
    oracle.width = oracleSize.width;
    oracle.height = oracleSize.height;
    const oracleContext = oracle.getContext('2d');
    if (!oracleContext) throw new Error('pixel oracle context unavailable');
    oracleContext.drawImage(
      canvas,
      0,
      0,
      oracleSize.width * scaleX,
      oracleSize.height * scaleY,
      0,
      0,
      oracleSize.width,
      oracleSize.height,
    );
    return crypto.subtle
      .digest('SHA-256', oracleContext.getImageData(0, 0, oracleSize.width, oracleSize.height).data)
      .then((digest) =>
        Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      );
  }, PIXEL_ORACLE_CSS_SIZE);
}

async function contentHash(page: Page): Promise<string> {
  let previous = '';
  let unchanged = 0;
  // Fit Selection and zoom keys can animate; compare settled pixels so a
  // camera animation frame is not mistaken for a stale render.
  await expect
    .poll(
      async () => {
        const current = await rawContentHash(page);
        unchanged = current === previous ? unchanged + 1 : 0;
        previous = current;
        return unchanged;
      },
      { timeout: 15_000, intervals: [100] },
    )
    .toBeGreaterThanOrEqual(3);
  return previous;
}

// The selected object's default fill is the same #9e9e9e as the page, so a
// colour-difference sample cannot see it once the page fills the viewport at
// high zoom. The regression this test guards is a leaked clip / stale camera
// redraw, so compare the live surface with a same-camera authoritative full
// redraw: a partial-redraw bug shows different pixels, and a correct render
// matches exactly (including an object that happens to match the page).
async function expectSurfaceMatchesFullRedraw(canvas: Locator, label: string): Promise<void> {
  const page = canvas.page();
  const cameraBefore = await page.evaluate(() =>
    JSON.stringify(
      (
        window as unknown as {
          __varvePerf?: { getLast?: () => { camera?: unknown } | null };
        }
      ).__varvePerf?.getLast?.()?.camera ?? null,
    ),
  );
  const live = await contentHash(page);
  const result = (await page.evaluate(async () => {
    return (
      window as unknown as {
        __varvePerf?: {
          forceFullRedraw?: () => Promise<{ authoritative: boolean; renderPath: string }>;
        };
      }
    ).__varvePerf?.forceFullRedraw?.();
  })) as { authoritative: boolean; renderPath: string } | undefined;
  expect(result, `${label}: full-redraw pixel oracle must be installed`).toBeTruthy();
  expect(result?.authoritative, `${label}: oracle must commit a fresh full frame`).toBe(true);
  const cameraAfter = await page.evaluate(() =>
    JSON.stringify(
      (
        window as unknown as {
          __varvePerf?: { getLast?: () => { camera?: unknown } | null };
        }
      ).__varvePerf?.getLast?.()?.camera ?? null,
    ),
  );
  expect(cameraAfter, `${label}: redraw must keep the camera fixed`).toBe(cameraBefore);
  const authoritative = await contentHash(page);
  console.info(`[zoom paint oracle] ${label} live=${live} authoritative=${authoritative}`);
  expect(live, `${label}: live pixels must match a same-camera full redraw`).toBe(authoritative);
}

test.describe('Zoom camera stability', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    // The full-redraw oracle and camera probe live on the perf handle, which
    // is only installed with ?perf=1 (same opt-in concept-art uses).
    await navigateToEditor(page, '/?perf=1');
  });

  test('fit-selection and subsequent zooms keep the selected object centered and painted', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');

    await page.keyboard.press('r');
    // Keep the test shape large enough that the 24px resize hit targets do not
    // cover its centre; this assertion is about moving/repainting, not handle
    // hit-testing for a tiny object.
    await dragOnCanvas(page, 60, 45, 140, 105);
    // The auto-namer may label a small square rect "Icon placeholder"
    // instead of "Rectangle N" — match either so creation is verified.
    await expect(
      page.getByRole('treeitem').filter({ hasText: /rectangle|icon placeholder/i }),
    ).toHaveCount(1);
    const beforeMove = await selectionRect(page);
    // The selection overlay paints from React state while the pointer tool
    // reads its authoritative selection through stateRef. Let that commit
    // reach the input pipeline before starting the move gesture.
    await page.waitForTimeout(50);
    // Moving a leaf takes the renderer's partial-redraw path. A leaked clip
    // from that path previously made the next camera-only redraw appear blank.
    // Snapping is not part of this render-pipeline assertion; disable it so a
    // tiny placeholder cannot be held on a coincident guide during the drag.
    const disableSnap = page.getByRole('button', { name: 'Disable snapping', exact: true });
    if (await disableSnap.isVisible().catch(() => false)) await disableSnap.click();
    await page.keyboard.press('v');
    await dragOnCanvas(page, 100, 75, 140, 115);
    const afterMove = await selectionRect(page);
    expect(afterMove.x - beforeMove.x).toBeGreaterThan(10);
    expect(afterMove.y - beforeMove.y).toBeGreaterThan(10);

    await canvas.focus();
    await page.keyboard.press('Shift+2');
    await page.waitForTimeout(350);
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found after selection layout settled');

    const fitted = await selectionRect(page);
    expect(fitted.x + fitted.width / 2).toBeCloseTo(canvasBox.width / 2, 0);
    expect(fitted.y + fitted.height / 2).toBeCloseTo(canvasBox.height / 2, 0);
    await expectSurfaceMatchesFullRedraw(canvas, 'fit');

    await page.keyboard.press('+');
    await page.waitForTimeout(100);
    const zoomedIn = await selectionRect(page);
    expect(zoomedIn.x + zoomedIn.width / 2).toBeCloseTo(canvasBox.width / 2, 0);
    expect(zoomedIn.y + zoomedIn.height / 2).toBeCloseTo(canvasBox.height / 2, 0);
    await expectSurfaceMatchesFullRedraw(canvas, 'zoom-in');

    await page.keyboard.press('-');
    await page.waitForTimeout(100);
    const zoomedOut = await selectionRect(page);
    expect(zoomedOut.x + zoomedOut.width / 2).toBeCloseTo(canvasBox.width / 2, 0);
    expect(zoomedOut.y + zoomedOut.height / 2).toBeCloseTo(canvasBox.height / 2, 0);
    await expectSurfaceMatchesFullRedraw(canvas, 'zoom-out');
  });

  test('a trackpad wheel burst accumulates every zoom delta around the selected object', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.keyboard.press('r');
    await dragOnCanvas(page, 80, 60, 140, 110);
    await canvas.focus();
    await page.keyboard.press('Shift+2');
    await page.waitForTimeout(350);

    const before = await selectionRect(page);
    await canvas.evaluate(
      (element, center) => {
        const bounds = element.getBoundingClientRect();
        for (let index = 0; index < 12; index += 1) {
          element.dispatchEvent(
            new WheelEvent('wheel', {
              bubbles: true,
              cancelable: true,
              clientX: bounds.left + center.x,
              clientY: bounds.top + center.y,
              ctrlKey: true,
              deltaY: -10,
            }),
          );
        }
      },
      { x: before.x + before.width / 2, y: before.y + before.height / 2 },
    );
    await page.waitForTimeout(150);

    const after = await selectionRect(page);
    expect(after.width).toBeGreaterThan(before.width * 2);
    // The zoom anchor is the measured box centre; its fractional SVG values
    // quantize the anchor by <1px at zoom 1, which the ~3.3x zoomed-out box
    // then shows as up to ~3px. Tolerate that scaled quantization — the
    // invariant is that the anchor does not drift with zoom amount.
    expect(Math.abs(after.x + after.width / 2 - (before.x + before.width / 2))).toBeLessThanOrEqual(
      3,
    );
    expect(
      Math.abs(after.y + after.height / 2 - (before.y + before.height / 2)),
    ).toBeLessThanOrEqual(3);
    await expectSurfaceMatchesFullRedraw(canvas, 'wheel');
  });

  test('zoom keeps an overflowing child painted when its unclipped frame is offscreen', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    // Draw the child first, then draw a frame around it. Frame creation captures
    // fully-contained siblings, exercising the real pointer-driven parenting path.
    await page.keyboard.press('r');
    await dragOnCanvas(page, 140, 140, 200, 200);
    await page.keyboard.press('f');
    await dragOnCanvas(page, 100, 100, 260, 260);

    const frameRow = page.locator('[role="treeitem"][data-layer-type="frame"]').first();
    // The child is a small rect; the auto-namer may label it "Icon
    // placeholder" instead of "Rectangle N".
    const childRow = page
      .getByRole('treeitem')
      .filter({ hasText: /rectangle|icon placeholder/i })
      .last();
    await expect(frameRow).toBeVisible();
    await expect(childRow).toBeVisible();
    await expect(childRow).toHaveAttribute('aria-level', '2');

    // Frames clip by default. Disable clipping through the mounted Inspector;
    // this is the state that makes off-frame descendants valid visible content.
    const layoutDisclosure = page
      .getByRole('region', { name: 'Inspector' })
      .getByRole('button', { name: 'Stack / Grid', exact: true })
      .first();
    if ((await layoutDisclosure.getAttribute('aria-expanded')) !== 'true') {
      await layoutDisclosure.click();
    }
    const clipContent = page.getByRole('switch', { name: /^clip content$/i });
    await expect(clipContent).toBeChecked();
    await clipContent.uncheck();
    await expect(clipContent).not.toBeChecked();

    // Move the child far outside the frame in local coordinates, then move the
    // frame itself completely left of the viewport. The overflowing child lands
    // back inside the viewport while its parent's own bounds remain offscreen.
    await childRow.click();
    const childX = page.getByRole('spinbutton', { name: /^x(?: \(ab\))? \(px\)$/i });
    await childX.fill('850');
    await childX.press('Enter');

    await frameRow.click();
    const frameX = page.getByRole('spinbutton', { name: /^x(?: \(ab\))? \(px\)$/i });
    await frameX.fill('-400');
    await frameX.press('Enter');
    await page.waitForTimeout(100);

    const offscreenFrame = await selectionRect(page);
    expect(offscreenFrame.x + offscreenFrame.width).toBeLessThan(0);

    await childRow.click();
    const beforeZoom = await selectionRect(page);
    expect(beforeZoom.x).toBeGreaterThan(0);
    expect(beforeZoom.x + beforeZoom.width).toBeLessThan(canvasBox.width);
    await expectSurfaceMatchesFullRedraw(canvas, 'overflow-before');

    await canvas.focus();
    await page.keyboard.press('+');
    await page.waitForTimeout(150);

    const afterZoom = await selectionRect(page);
    expect(afterZoom.x + afterZoom.width).toBeGreaterThan(0);
    expect(afterZoom.x).toBeLessThan(canvasBox.width);
    expect(afterZoom.y + afterZoom.height).toBeGreaterThan(0);
    expect(afterZoom.y).toBeLessThan(canvasBox.height);
    await expectSurfaceMatchesFullRedraw(canvas, 'overflow-after');
  });
});

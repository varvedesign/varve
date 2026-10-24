/**
 * E2E regression: local AI background removal must not be refused by the
 * shared memory ledger on a host that can run its own models.
 *
 * The reported defect (2026-10-22) was a 480x640 High-quality run refused with
 * "Request reserves 541786112 bytes, above the 400000000-byte process limit."
 * The unit suites pin admission and exact-model routing; this spec proves the
 * real editor (Vite dev server, real worker, bundled U²-NetP) still completes
 * an AI cutout and never renders a raw byte-count refusal.
 *
 * Auto runs the bundled model, so no download is required in CI.
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from '../helpers/evidence-output';
import { navigateToEditor, switchWorkspace } from '../shared';

const FIXTURE = path.resolve(__dirname, '../fixtures/test-image.png');
const CONTENT_CANVAS = 'canvas.editor-canvas__content-layer';

async function importTestImage(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#file-import-input').setInputFiles(FIXTURE);
  // Import decode competes with other local work on a busy machine; the
  // shared runner serialises heavy tasks, but a loaded host can still take
  // tens of seconds to decode the fixture and commit the layer.
  await page.getByRole('treeitem').first().waitFor({ timeout: 30000 });
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
  await page.getByRole('treeitem').first().click();
  await page.locator(CONTENT_CANVAS).waitFor({ state: 'visible', timeout: 30000 });
}

async function openBackgroundRemoval(page: import('@playwright/test').Page) {
  await switchWorkspace(page, 'Photo');
  const inspector = page.locator('.editor__inspector-panel');
  await inspector.getByRole('tab', { name: 'Adjustments' }).click();
  const section = inspector.getByRole('button', { name: 'Background Removal' });
  if ((await section.getAttribute('aria-expanded')) === 'false') await section.click();
  return inspector;
}

async function bluePixelCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return 0;
    const dpr = window.devicePixelRatio || 1;
    let bluePixels = 0;
    for (let y = 0; y < canvas.height; y += 5 * dpr) {
      for (let x = 0; x < canvas.width; x += 5 * dpr) {
        const d = ctx.getImageData(x, y, 1, 1)?.data;
        if (d && (d[2] ?? 0) > 200 && (d[0] ?? 255) < 50 && (d[1] ?? 255) < 50) bluePixels++;
      }
    }
    return bluePixels;
  }, CONTENT_CANVAS);
}

test.describe('Local AI background removal capacity', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('Auto cutout runs the bundled model and removes the background', async ({ page }) => {
    test.setTimeout(180000);
    await importTestImage(page);
    const before = await bluePixelCount(page);
    expect(before).toBeGreaterThan(0);

    const inspector = await openBackgroundRemoval(page);
    const methodSelect = inspector.getByRole('combobox', { name: 'Background removal method' });
    await methodSelect.click();
    await page.getByRole('option', { name: /Auto — general photos/ }).click();

    await inspector.getByRole('button', { name: 'Remove background from image' }).click();

    const review = page.getByRole('region', { name: 'Background removal review' });
    await expect(review).toBeVisible({ timeout: 150000 });

    // The capacity refusal must never reach the panel, in any wording.
    const alert = inspector.getByRole('alert');
    if (await alert.count()) {
      await expect(alert).not.toContainText(/bytes\b/i);
      await expect(alert).not.toContainText(/process limit/i);
    }

    await review.getByRole('button', { name: 'Apply result' }).click();
    await expect(review).toBeHidden({ timeout: 10000 });

    await expect.poll(() => bluePixelCount(page), { timeout: 20000 }).toBeLessThan(before * 0.2);

    await page.screenshot({
      path: evidencePath('auto-cutout-after-apply.png'),
      fullPage: false,
    });
  });

  test('model readiness separates installation from qualified memory evidence', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await importTestImage(page);
    const inspector = await openBackgroundRemoval(page);
    const methodSelect = inspector.getByRole('combobox', { name: 'Background removal method' });
    await methodSelect.click();
    await page.getByRole('option', { name: /High quality/ }).click();

    const info = inspector.getByRole('region', { name: 'Background removal readiness' });
    await expect(info).toBeVisible({ timeout: 10000 });
    await expect(info.getByRole('status')).not.toContainText('Checking');
    await info.getByRole('button', { name: 'Model details' }).click();
    await info.scrollIntoViewIfNeeded();
    await expect(info).toContainText('Peak working memory has not yet been validated');
    await expect(info).not.toContainText(/450 MB|4\.1 GB|over its limit/i);
    await expect(info).not.toContainText(/RAM RAM/i);

    // Batch the supported themes and two desktop widths; inspect these images
    // separately from the assertions before claiming visual verification.
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['dark', 'light', 'high-contrast']) {
        await page.evaluate(
          (value) => document.documentElement.setAttribute('data-theme', value),
          theme,
        );
        await info.scrollIntoViewIfNeeded();
        expect(
          await info.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        ).toBe(true);
        await info.screenshot({
          path: evidencePath(`high-quality-model-info-${width}-${theme}.png`),
        });
      }
    }
    await page.screenshot({
      path: evidencePath('high-quality-panel.png'),
      fullPage: false,
    });
  });

  test('clearing and restoring image selection keeps the model controls usable', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await importTestImage(page);
    const inspector = await openBackgroundRemoval(page);
    const status = inspector.getByRole('region', { name: 'Background removal readiness' });
    await expect(status).toBeVisible();
    // Escape clears canvas selection only while the canvas owns focus; the
    // section controls above hold focus here. Give the canvas a real click
    // (empty space also clears on its own), then Escape with canvas focus.
    await page.locator(CONTENT_CANVAS).click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('Escape');
    await expect(status).toBeHidden();
    await page.getByRole('treeitem').first().click();
    await expect(status).toBeVisible();
    await expect(status.getByRole('status')).toContainText('No model required');
    await expect(
      inspector.getByRole('button', { name: 'Remove background from image' }),
    ).toBeEnabled();
    expect(
      errors.filter((message) => /hooks|React|BackgroundRemovalSection/i.test(message)),
    ).toEqual([]);
  });
});

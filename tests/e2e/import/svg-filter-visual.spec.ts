import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const dropShadowSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="170%" height="180%">
      <feDropShadow dx="14" dy="14" stdDeviation="7" flood-color="#111827" flood-opacity="0.85" />
    </filter>
  </defs>
  <rect id="shadow-card" x="38" y="28" width="118" height="84" rx="8" fill="#4f46e5" filter="url(#shadow)" />
</svg>`;

async function readRenderedShadow(page: import('@playwright/test').Page) {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const surface = element as HTMLCanvasElement;
    const context = surface.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Content canvas does not expose a 2D context');
    const { data, width, height } = context.getImageData(0, 0, surface.width, surface.height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let fillPixels = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const red = data[offset] ?? 0;
        const green = data[offset + 1] ?? 0;
        const blue = data[offset + 2] ?? 0;
        if (Math.abs(red - 79) <= 12 && Math.abs(green - 70) <= 12 && blue > 190) {
          fillPixels += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    let shadowPixels = 0;
    if (maxX >= 0) {
      const left = Math.max(0, minX - 50);
      const top = Math.max(0, minY - 50);
      const right = Math.min(width, maxX + 51);
      const bottom = Math.min(height, maxY + 51);
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) continue;
          const offset = (y * width + x) * 4;
          const red = data[offset] ?? 0;
          const green = data[offset + 1] ?? 0;
          const blue = data[offset + 2] ?? 0;
          const alpha = data[offset + 3] ?? 0;
          if (alpha > 0 && red < 85 && green < 90 && blue < 115) shadowPixels += 1;
        }
      }
    }
    return { fillPixels, shadowPixels };
  });
}

test('imports an editable Inkscape-style SVG drop shadow through the editor UI', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await navigateToEditor(page);

  await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
  const importItem = page
    .getByRole('menu', { name: 'File', exact: true })
    .getByRole('menuitem', { name: /^Import…/ });
  const picker = page.waitForEvent('filechooser', { timeout: 10000 });
  await importItem.click();
  const fileChooser = await picker;
  await fileChooser.setFiles({
    name: 'inkscape-drop-shadow.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(dropShadowSvg),
  });

  const report = page.getByRole('dialog', { name: 'Import Results' });
  await expect(report).toBeVisible();
  await report.getByRole('button', { name: /show details/i }).click();
  await expect(report).toContainText(/filter clipping region/i);
  await expect(report).toContainText(/feDropShadow blur/i);
  await page.screenshot({ path: testInfo.outputPath('inkscape-svg-import-report.png') });

  await report.getByRole('button', { name: 'Reveal selection' }).click();
  await report.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'shadow-card' })).toBeVisible();
  const effects = page.locator('.insp-disclosure').filter({ hasText: 'Layer Effects' });
  await effects.scrollIntoViewIfNeeded();
  const effectsHeading = effects.getByRole('button', { name: 'Layer Effects', exact: true });
  if ((await effectsHeading.getAttribute('aria-expanded')) !== 'true') await effectsHeading.click();
  await expect(
    effects.locator('.insp-effect-row').filter({ hasText: 'Drop Shadow' }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('inkscape-svg-drop-shadow-editable.png') });
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.selection-overlay__dim')).toHaveCount(0);
  const zoom = page.locator('#status-zoom');
  await zoom.fill('100');
  await zoom.press('Enter');
  await expect.poll(async () => (await readRenderedShadow(page)).shadowPixels).toBeGreaterThan(10);
  const renderedShadow = await readRenderedShadow(page);
  expect(renderedShadow.fillPixels).toBeGreaterThan(100);
  expect(renderedShadow.shadowPixels).toBeGreaterThan(10);
  await page.screenshot({
    path: testInfo.outputPath('inkscape-svg-drop-shadow-desktop-light.png'),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await zoom.fill('100');
  await zoom.press('Enter');
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath('inkscape-svg-drop-shadow-mobile-light.png') });

  await page.evaluate(() => {
    localStorage.setItem('varve-theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath('inkscape-svg-drop-shadow-mobile-dark.png') });
});

test('reports a zero-length SVG path without inserting placeholder geometry', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);

  await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
  const importItem = page
    .getByRole('menu', { name: 'File', exact: true })
    .getByRole('menuitem', { name: /^Import…/ });
  const picker = page.waitForEvent('filechooser', { timeout: 10000 });
  await importItem.click();
  const fileChooser = await picker;
  await fileChooser.setFiles({
    name: 'zero-length-path.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg><path d="M 0,0" style="stroke:blue;stroke-width:1.5;stroke-dasharray:1,1"/></svg>',
    ),
  });

  const report = page.getByRole('dialog', { name: 'Import Results' });
  await expect(report).toBeVisible();
  await report.getByRole('button', { name: /show details/i }).click();
  await expect(report).toContainText('0 layers inserted');
  await expect(report).toContainText('SVG <path> has fewer than two points — skipped');
  await expect(report.getByRole('button', { name: 'Reveal selection' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('inkscape-svg-zero-length-path-warning.png') });
});

test('reports overflowing SVG path coordinates without inserting invalid geometry', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);

  await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
  const importItem = page
    .getByRole('menu', { name: 'File', exact: true })
    .getByRole('menuitem', { name: /^Import…/ });
  const picker = page.waitForEvent('filechooser', { timeout: 10000 });
  await importItem.click();
  const fileChooser = await picker;
  await fileChooser.setFiles({
    name: 'overflowing-path.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg><path d="m 0 0 v 1e309 -1e309 0" /></svg>'),
  });

  const report = page.getByRole('dialog', { name: 'Import Results' });
  await expect(report).toBeVisible();
  await report.getByRole('button', { name: /show details/i }).click();
  await expect(report).toContainText('0 layers inserted');
  await expect(report).toContainText('SVG <path> contains non-finite geometry — skipped');
  await expect(report.getByRole('button', { name: 'Reveal selection' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('inkscape-svg-overflow-path-warning.png') });
});

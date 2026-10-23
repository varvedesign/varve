import { expect, type Page, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';

test.use({ viewport: { width: 1440, height: 1000 } });

async function patchPixels(page: Page, point: { x: number; y: number }) {
  return page
    .locator('canvas.editor-canvas__content-layer')
    .evaluate((canvas: HTMLCanvasElement, point) => {
      const rect = canvas.getBoundingClientRect();
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No content-canvas 2D context');
      const scale = canvas.width / rect.width;
      return [
        ...ctx.getImageData(
          Math.round((point.x - 65 - rect.left) * scale),
          Math.round((point.y - 65 - rect.top) * scale),
          Math.round(130 * scale),
          Math.round(130 * scale),
        ).data,
      ];
    }, point);
}

test('white semitransparent soft brush does not darken its backdrop at the fringe', async ({
  page,
}) => {
  await navigateToCleanEditor(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await page.locator('#file-import-input').setInputFiles({
    name: 'opaque-gray-backdrop.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg><rect width="600" height="500" fill="#606060"/></svg>'),
  });
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
  const report = page.getByRole('dialog', { name: 'Import Results', exact: true });
  await expect(report).toBeVisible();
  await report.getByRole('button', { name: 'Close', exact: true }).click();
  const topLeft = await page.getByLabel('Top-left resize handle', { exact: true }).boundingBox();
  const bottomRight = await page
    .getByLabel('Bottom-right resize handle', { exact: true })
    .boundingBox();
  if (!topLeft || !bottomRight) throw new Error('Backdrop bounds unavailable');
  const point = {
    x: (topLeft.x + topLeft.width / 2 + bottomRight.x + bottomRight.width / 2) / 2,
    y: (topLeft.y + topLeft.height / 2 + bottomRight.y + bottomRight.height / 2) / 2,
  };
  await canvas.focus();
  await page.keyboard.press('Control+Shift+A');
  await page.keyboard.press('b');
  const toolOptions = page.getByRole('button', { name: 'Tool options', exact: true });
  await expect(toolOptions).toHaveAttribute('aria-expanded', 'true');
  const options = page.locator('.tool-options__popover');
  await options.getByRole('combobox', { name: 'Brush preset', exact: true }).click();
  await page.getByRole('option', { name: 'Airbrush', exact: true }).click();
  await options.getByLabel('Foreground color', { exact: true }).fill('#ffffff');
  const radius = options.getByRole('spinbutton', { name: 'Size (px)', exact: true });
  await radius.fill('40');
  await radius.press('Enter');
  await toolOptions.click();
  await expect(options).toBeHidden();

  await expect.poll(async () => (await patchPixels(page, point))[0]).toBe(96);
  const before = await patchPixels(page, point);
  // Prove the fixture backdrop is opaque and uniform; otherwise a grid or
  // artwork boundary could be mistaken for an alpha fringe.
  const backdrop = before.slice(0, 4);
  expect(backdrop[3]).toBe(255);
  expect(before.every((value, index) => value === backdrop[index % 4])).toBe(true);

  await page.mouse.move(point.x - 12, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 12, point.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 15000 });

  const brightnessGain = async () => {
    const after = await patchPixels(page, point);
    return after.reduce(
      (gain, value, index) =>
        index % 4 === 3 ? gain : Math.max(gain, value - backdrop[index % 4]!),
      0,
    );
  };
  await expect.poll(brightnessGain, { timeout: 15000 }).toBeGreaterThan(3);
  const after = await patchPixels(page, point);
  const darkestDelta = after.reduce(
    (delta, value, index) =>
      index % 4 === 3 ? delta : Math.min(delta, value - backdrop[index % 4]!),
    0,
  );
  // White source-over can only brighten an opaque backdrop. Double-applied
  // premultiplication makes the low-alpha source dark and violates this bound.
  expect(darkestDelta).toBeGreaterThanOrEqual(-1);
  await page.screenshot({ path: test.info().outputPath('soft-white-brush.png') });
});

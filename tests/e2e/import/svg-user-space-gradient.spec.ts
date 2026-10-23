import { expect, type Page, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';

test.use({ viewport: { width: 1440, height: 1000 } });

const STOPS = '<stop offset="0" stop-color="black"/><stop offset="1" stop-color="white"/>';

async function importSvg(page: Page, source: string) {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Import/ }).click();
  await page.locator('#file-import-input').setInputFiles({
    name: 'user-space-gradient.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(source),
  });
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
  const report = page.getByRole('dialog', { name: 'Import Results', exact: true });
  await expect(report).toBeVisible();
  await report.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByLabel('Top-left resize handle', { exact: true })).toBeVisible();
}

/** Sample actual artwork, using selection handles only to locate its bounds. */
async function grayAtFraction(page: Page, fraction: number) {
  const start = await page.getByLabel('Top-left resize handle', { exact: true }).boundingBox();
  const end = await page.getByLabel('Bottom-right resize handle', { exact: true }).boundingBox();
  if (!start || !end) throw new Error('Selected artwork bounds unavailable');
  return page.locator('canvas.editor-canvas__content-layer').evaluate(
    (canvas: HTMLCanvasElement, { start, end, fraction }) => {
      const rect = canvas.getBoundingClientRect();
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Content canvas has no 2D context');
      const x = start.x + start.width / 2 + (end.x - start.x) * fraction;
      const y = (start.y + start.height / 2 + end.y + end.height / 2) / 2;
      return [
        ...context.getImageData(
          Math.round(((x - rect.left) * canvas.width) / rect.width),
          Math.round(((y - rect.top) * canvas.height) / rect.height),
          1,
          1,
        ).data,
      ];
    },
    { start, end, fraction },
  );
}

test('File Import keeps a positioned user-space linear gradient on its artwork', async ({
  page,
}) => {
  await navigateToCleanEditor(page);
  await importSvg(
    page,
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="200" y1="140" x2="400" y2="140">${STOPS}</linearGradient></defs><rect x="200" y="100" width="200" height="80" fill="url(#g)"/></svg>`,
  );
  await expect.poll(async () => (await grayAtFraction(page, 0.25))[3]).toBe(255);
  await page.screenshot({ path: test.info().outputPath('svg-user-space-linear.png') });
  await test.info().attach('painted-gradient-samples', {
    body: JSON.stringify({
      quarter: await grayAtFraction(page, 0.25),
      threeQuarter: await grayAtFraction(page, 0.75),
    }),
    contentType: 'application/json',
  });
  await expect.poll(async () => (await grayAtFraction(page, 0.25))[0]).toBeGreaterThan(45);
  await expect.poll(async () => (await grayAtFraction(page, 0.25))[0]).toBeLessThan(85);
  await expect.poll(async () => (await grayAtFraction(page, 0.75))[0]).toBeGreaterThan(170);
  await expect.poll(async () => (await grayAtFraction(page, 0.75))[0]).toBeLessThan(215);
});

test('File Import keeps a positioned user-space radial gradient centred on its circle', async ({
  page,
}) => {
  await navigateToCleanEditor(page);
  await importSvg(
    page,
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="240" cy="180" r="87"><stop offset="0" stop-color="white"/><stop offset="1" stop-color="black"/></radialGradient></defs><circle cx="240" cy="180" r="87" fill="url(#g)"/></svg>',
  );
  await expect.poll(async () => (await grayAtFraction(page, 0.5))[3]).toBe(255);
  await page.screenshot({ path: test.info().outputPath('svg-user-space-radial.png') });
  await test.info().attach('painted-radial-samples', {
    body: JSON.stringify({
      center: await grayAtFraction(page, 0.5),
      halfRadius: await grayAtFraction(page, 0.75),
    }),
    contentType: 'application/json',
  });
  await expect.poll(async () => (await grayAtFraction(page, 0.5))[0]).toBeGreaterThan(240);
  await expect.poll(async () => (await grayAtFraction(page, 0.75))[0]).toBeGreaterThan(110);
  await expect.poll(async () => (await grayAtFraction(page, 0.75))[0]).toBeLessThan(145);
});

import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const NONZERO_RING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <path d="M10 10H110V110H10Z M35 35V85H85V35Z" fill="#1f8a70" fill-rule="nonzero"/>
</svg>`;
const EVENODD_SAME_WINDING_RING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <path d="M10 10H110V110H10Z M35 35H85V85H35Z" fill="#1f8a70" fill-rule="evenodd"/>
</svg>`;

async function importOffsetSVG(page: import('@playwright/test').Page, svg: string, name: string) {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /import/i }).click();
  await page.locator('#file-import-input').setInputFiles({
    name,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg),
  });
  await expect(page.locator('.layers-panel [role="treeitem"]')).toHaveCount(1, {
    timeout: 30000,
  });
}

async function applyNegativeOffset(page: import('@playwright/test').Page) {
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Path', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Path' })
    .getByRole('menuitem', { name: /Offset Path/ })
    .click();
  const distance = page.getByRole('textbox', { name: 'Offset path distance (px)' });
  await expect(distance).toBeVisible();
  await distance.fill('-10');
  await distance.press('Enter');
  await expect(distance).toBeHidden();
}

async function captureCanvas(page: import('@playwright/test').Page, snapshotName: string) {
  // The async action leaves the Object menu open after its prompt returns.
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.click({ position: { x: 100, y: 100 } });
  await page.evaluate(() => {
    (
      window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } }
    ).__varvePerf?.forceFullRedraw?.();
  });
  await page.mouse.move(20, 20);
  await page.waitForTimeout(700);
  await expect(canvas).toHaveScreenshot(snapshotName, { maxDiffPixels: 1000 });
}

test('Object → Offset Path updates the hole in an imported nonzero compound path', async ({
  page,
}) => {
  test.setTimeout(120000);
  await navigateToEditor(page);
  const dismissHint = page.getByRole('button', { name: 'Dismiss hint' });
  if (await dismissHint.isVisible().catch(() => false)) await dismissHint.click();
  await importOffsetSVG(page, NONZERO_RING_SVG, 'nonzero-ring.svg');
  await applyNegativeOffset(page);
  await captureCanvas(page, 'compound-path-offset.png');
});

test('Object → Offset Path expands a same-winding even-odd hole as the filled path contracts', async ({
  page,
}) => {
  test.setTimeout(120000);
  await navigateToEditor(page);
  const dismissHint = page.getByRole('button', { name: 'Dismiss hint' });
  if (await dismissHint.isVisible().catch(() => false)) await dismissHint.click();
  await importOffsetSVG(page, EVENODD_SAME_WINDING_RING_SVG, 'evenodd-same-winding.svg');
  await applyNegativeOffset(page);
  await captureCanvas(page, 'compound-path-offset-evenodd.png');
});

import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const NONZERO_RING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <path d="M10 10H110V110H10Z M35 35V85H85V35Z" fill="#1f8a70" fill-rule="nonzero"/>
</svg>`;

test('Object → Offset Path updates the hole in an imported nonzero compound path', async ({
  page,
}) => {
  test.setTimeout(120000);
  await navigateToEditor(page);
  const dismissHint = page.getByRole('button', { name: 'Dismiss hint' });
  if (await dismissHint.isVisible().catch(() => false)) await dismissHint.click();

  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /import/i }).click();
  await page.locator('#file-import-input').setInputFiles({
    name: 'nonzero-ring.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(NONZERO_RING_SVG),
  });
  await expect(page.locator('.layers-panel [role="treeitem"]')).toHaveCount(1, {
    timeout: 30000,
  });

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

  // The async action leaves the Object menu open after its prompt returns.
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.click({ position: { x: 100, y: 100 } });
  await page.evaluate(() => {
    (
      window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } }
    ).__varvePerf?.forceFullRedraw?.();
  });
  await page.waitForTimeout(700);
  await expect(canvas).toHaveScreenshot('compound-path-offset.png', {
    maxDiffPixels: 1000,
  });
});

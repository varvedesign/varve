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
  await page.waitForTimeout(500);
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

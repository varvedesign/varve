import { writeFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { resizePanelToWidth } from '../helpers/panel-resize';
import { navigateToEditor } from '../shared';

const baseline = process.env.VARVE_LAYERS_PHASE === 'baseline';
const phase = baseline ? 'before' : 'after';

async function revealLayers(page: Page) {
  if (!(await page.getByTestId('layers-panel').isVisible())) {
    await page.getByRole('button', { name: 'Show layers panel', exact: true }).click();
  }
  await expect(page.getByTestId('layers-panel')).toBeVisible();
}

/**
 * The import's post-commit flow can publish two modal overlays: Import
 * Results (fidelity changes/warnings) and Missing Fonts (families absent on
 * this device). Either backdrop intercepts every pointer event behind it, and
 * closing one can reveal the other, so both are dismissed in order and then
 * re-checked. Timeouts are conditional: a clean import simply waits them out.
 */
async function dismissImportOverlays(page: Page, timeout: number) {
  const results = page.getByRole('dialog', { name: 'Import Results' });
  const fonts = page.getByRole('dialog', { name: 'Missing Fonts' });

  if (
    await results.waitFor({ state: 'visible', timeout }).then(
      () => true,
      () => false,
    )
  ) {
    await results.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(results).toBeHidden();
  }
  if (
    await fonts.waitFor({ state: 'visible', timeout }).then(
      () => true,
      () => false,
    )
  ) {
    await fonts.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(fonts).toBeHidden();
  }
  // Stragglers that arrived while the other overlay was being closed.
  if (await results.isVisible().catch(() => false)) {
    await results.getByRole('button', { name: 'Close', exact: true }).click();
  }
  if (await fonts.isVisible().catch(() => false)) {
    await fonts.getByRole('button', { name: 'Dismiss', exact: true }).click();
  }
  await expect(results).toBeHidden();
  await expect(fonts).toBeHidden();
}

test('real artwork hierarchy at responsive sizes, themes and rail widths', async ({
  page,
}, info) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles('tests/e2e/fixtures/layers-mobile-app.svg');
  const rows = page.locator('.layers-panel__tree [role="treeitem"]');
  await expect(rows.first()).toBeVisible();
  await dismissImportOverlays(page, 15000);
  await rows.nth(1).click();
  await page.mouse.move(1000, 600);
  const metrics: unknown[] = [];
  for (const width of [375, 768, 899, 900, 1024, 1280]) {
    await page.setViewportSize({ width, height: width === 1024 ? 600 : 900 });
    await revealLayers(page);
    for (const theme of ['light', 'dark', 'high-contrast']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.screenshot({
        path: info.outputPath(`${phase}-${width}-${theme}.png`),
        animations: 'disabled',
      });
    }
    metrics.push(
      await page.getByTestId('layers-panel').evaluate((panel) => ({
        viewport: window.innerWidth,
        panel: panel.getBoundingClientRect().toJSON(),
        rows: [...panel.querySelectorAll<HTMLElement>('[role="treeitem"]')].map((row) => ({
          name: row.querySelector('.layers-row__name')?.textContent,
          row: row.getBoundingClientRect().toJSON(),
          nameWidth: row.querySelector('.layers-row__name')?.getBoundingClientRect().width,
          scrollWidth: row.scrollWidth,
          clientWidth: row.clientWidth,
        })),
      })),
    );
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await revealLayers(page);
  for (const width of [180, 220, 239, 240, 288]) {
    await resizePanelToWidth(page, 'layers', width);
    await page
      .getByTestId('layers-panel')
      .screenshot({ path: info.outputPath(`${phase}-rail-${width}.png`), animations: 'disabled' });
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.screenshot({ path: info.outputPath(`${phase}-text-200.png`), animations: 'disabled' });
  await writeFile(info.outputPath(`${phase}-metrics.json`), JSON.stringify(metrics, null, 2));
  if (!baseline) {
    await expect(page.locator('.layers-row__drag-handle')).toHaveCount(0);
    await expect(page.locator('.layers-row__selection-check').first()).toBeVisible();
  }
});

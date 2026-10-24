/**
 * Home's files / render / results readout is a diagnostic (F-06, shell audit
 * 2026-10-21): it shows only with Settings > Performance > Diagnostics on.
 */
import { expect, test } from '@playwright/test';
import { navigateToHome } from '../shared';

test.describe('Home performance readout', () => {
  test('is hidden by default', async ({ page }) => {
    await navigateToHome(page);
    await expect(page.getByLabel('Performance profile')).toHaveCount(0);
  });

  test('shows with performance diagnostics on', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'varve-editor-settings',
        JSON.stringify({ performance: { showPerformanceDiagnostics: true } }),
      );
    });
    await navigateToHome(page);
    await expect(page.getByLabel('Performance profile')).toBeVisible();
  });
});

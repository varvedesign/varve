import { expect, test } from '@playwright/test';

test.describe('Font provider marketing copy', () => {
  test('local-first page explains offline catalog discovery and explicit installs', async ({
    page,
  }) => {
    await page.goto('/features/local-first');
    const featurePage = page.locator('.feature-page');
    await expect(featurePage).toContainText('shipped Fontsource catalog offline');
    await expect(featurePage).toContainText('explicit desktop install');
    await page.screenshot({
      path: test.info().outputPath('local-first-font-catalog.png'),
      fullPage: true,
    });
  });

  test('typography page explains the keyless, pinned installation flow', async ({ page }) => {
    await page.goto('/features/typography');
    const featurePage = page.locator('.feature-page');
    await expect(featurePage).toContainText('does not require a Google Fonts key');
    await expect(featurePage).toContainText('version-pinned Fontsource artifact');
    await expect(featurePage).toContainText('requested Fontsource face');
    await expect(featurePage).toContainText('requested weight, style, and license');
    const textFrameCallout = featurePage.locator('.feature-callout').filter({
      hasText: 'Keep text readable over detailed artwork',
    });
    await expect(textFrameCallout).toContainText('In development');
    await expect(textFrameCallout).toContainText('not in a released build yet');
    await page.screenshot({
      path: test.info().outputPath('typography-fontsource-flow.png'),
      fullPage: true,
    });
    await page.screenshot({
      path: test.info().outputPath('typography-text-frame-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: test.info().outputPath('typography-text-frame-mobile.png'),
      fullPage: true,
    });
  });
});

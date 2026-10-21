import { expect, test } from '@playwright/test';

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`comic lettering feature explains direct callout editing at ${viewport.name} size`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      localStorage.setItem('varve:website-analytics-consent', 'denied');
      localStorage.setItem('varve-theme', 'light');
    });
    if (!baseURL) throw new Error('Website base URL is required');
    const basePath = new URL(baseURL).pathname.replace(/\/$/, '');
    const response = await page.goto(`${basePath}/features/comic-lettering`);
    expect(response?.status()).toBe(200);

    const feature = page.locator('.comic-page');
    await expect(feature.getByRole('heading', { name: /letter the page/i })).toBeVisible();
    await expect(feature).toContainText('Move body, anchor the tail');
    await expect(feature).toContainText(
      'Drag the body handle to move balloon and text with the tail tip anchored',
    );
    await expect(feature).toContainText('drag tip and bend handles to aim');
    await expect(feature).toContainText(
      'Use the Inspector for exact values, width, flip, and extra tails',
    );
    await expect(feature).toContainText('Built foundation');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );

    await feature.locator('.comic-visual').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`comic-lettering-feature-${viewport.name}.png`),
      fullPage: false,
    });
  });
}

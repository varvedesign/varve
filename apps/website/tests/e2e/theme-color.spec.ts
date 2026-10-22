import { expect, test } from '@playwright/test';

test('browser theme color follows the manual site theme across reloads', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('radio', { name: 'Dark theme' }).click();

  const darkMeta = page.locator('meta[name="theme-color"][data-theme-color="dark"]');
  const lightMeta = page.locator('meta[name="theme-color"][data-theme-color="light"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(darkMeta).toHaveAttribute('content', '#0d1117');
  await expect(darkMeta).not.toHaveAttribute('media');
  await expect(lightMeta).toHaveAttribute('media', 'not all');
  await page.locator('.site-header').screenshot({
    path: test.info().outputPath('website-dark-theme-header.png'),
  });

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(darkMeta).not.toHaveAttribute('media');

  await page.getByRole('radio', { name: 'Light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(lightMeta).toHaveAttribute('content', '#ffffff');
  await expect(lightMeta).not.toHaveAttribute('media');
  await expect(darkMeta).toHaveAttribute('media', 'not all');
});

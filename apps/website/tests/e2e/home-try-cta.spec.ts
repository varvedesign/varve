import { expect, test } from '@playwright/test';
import { dismissAnalyticsBanner } from './helpers';

test('home hero and closing CTAs open the browser demo with campaign refs', async ({ page }) => {
  await page.goto('/');
  await dismissAnalyticsBanner(page);

  const hero = page.locator('.hero-ctas');
  const heroTry = hero.getByRole('link', { name: 'Try it in your browser' });
  await expect(heroTry).toBeVisible();
  await expect(heroTry).toHaveAttribute('href', /\/try\/\?ref=home-hero/);
  await expect(heroTry).toHaveAttribute('data-analytics-demo-launch');
  await expect(
    page.locator('.hero-more').getByRole('link', { name: 'What is Varve?' }),
  ).toBeVisible();

  const closing = page.locator('.closing-cta');
  const closingTry = closing.getByRole('link', { name: 'Try it in your browser' });
  await expect(closingTry).toBeVisible();
  await expect(closingTry).toHaveAttribute('href', /\/try\/\?ref=home-closing/);
  await expect(closingTry).toHaveAttribute('data-analytics-demo-launch');
});

test('home and product local-first sections link to the local-first storage feature page with a canonical trailing slash', async ({
  page,
}) => {
  await page.goto('/');
  await dismissAnalyticsBanner(page);

  const homeLink = page
    .locator('.local-first-section')
    .getByRole('link', { name: 'local-first storage' });
  await expect(homeLink).toBeVisible();
  await expect(homeLink).toHaveAttribute('href', /\/features\/local-first\/$/);

  await page.goto('/product');
  await dismissAnalyticsBanner(page);

  const productLink = page
    .locator('.product-section')
    .filter({
      has: page.getByRole('heading', { name: 'Local-first, your files, your machine' }),
    })
    .getByRole('link', { name: 'local-first storage' });
  await expect(productLink).toBeVisible();
  await expect(productLink).toHaveAttribute('href', /\/features\/local-first\/$/);
});

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

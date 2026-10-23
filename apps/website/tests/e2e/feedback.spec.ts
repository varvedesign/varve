import { expect, test } from '@playwright/test';

/**
 * /feedback is the in-app Send Feedback landing page. These specs pin the
 * three choices a visitor must be able to take, plus a mobile visual
 * baseline the same way /press is captured.
 */

test('feedback page offers bug, discussion, and email choices', async ({ page }) => {
  await page.goto('/feedback');

  await expect(page.getByRole('heading', { level: 1, name: 'Send feedback' })).toBeVisible();
  await expect(page.getByText('The app sends nothing automatically.')).toBeVisible();
  await expect(page.getByText('You only need to say what happened.')).toBeVisible();
  await expect(page.getByText('A screenshot helps.')).toBeVisible();
  await expect(page.getByText('Everything else is optional.')).toBeVisible();

  await expect(page.getByRole('heading', { level: 2, name: 'Something broke?' })).toBeVisible();
  await expect(page.getByText('Tell us what happened.')).toBeVisible();
  const bug = page.getByRole('link', { name: 'Report a bug' });
  await expect(bug).toBeVisible();
  await expect(bug).toHaveAttribute(
    'href',
    'https://github.com/varvedesign/varve/issues/new/choose',
  );

  await expect(
    page.getByRole('heading', { level: 2, name: 'Have an idea or a question?' }),
  ).toBeVisible();
  const ideas = page.getByRole('link', { name: 'Share it' });
  await expect(ideas).toBeVisible();
  await expect(ideas).toHaveAttribute('href', 'https://github.com/varvedesign/varve/discussions');

  await expect(page.getByRole('heading', { level: 2, name: 'Prefer email?' })).toBeVisible();

  const email = page.getByRole('link', { name: 'Email Varve product feedback' });
  await expect(email).toBeVisible();
  await expect(email).toHaveText('feedback@varve.studio');
  await expect(email).toHaveAttribute('href', /^mailto:feedback@varve.studio/);
});

test('feedback page keeps the chooser readable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.localStorage.setItem('varve:website-analytics-consent', 'denied');
    window.localStorage.setItem('varve-theme', 'light');
  });

  await page.goto('/feedback');
  await expect(page.getByRole('heading', { name: 'Send feedback' })).toBeVisible();
  await expect(page.getByText('You choose what to share.')).toBeVisible();
  await expect(page).toHaveScreenshot('feedback-page-mobile.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

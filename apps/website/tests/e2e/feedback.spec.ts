import { expect, test } from '@playwright/test';

/**
 * /feedback is the in-app Send Feedback landing page. These specs pin the
 * email and forum choices a visitor must be able to take, plus a mobile
 * visual baseline the same way /press is captured.
 */

test('feedback page offers email, forum, and copy choices', async ({ page }) => {
  await page.goto('/feedback');

  await expect(page.getByRole('heading', { level: 1, name: 'Send feedback' })).toBeVisible();
  await expect(page.getByText('The app sends nothing automatically.')).toBeVisible();
  await expect(page.getByText('You only need to say what happened.')).toBeVisible();
  await expect(page.getByText('A screenshot helps.').first()).toBeVisible();
  await expect(page.getByText('Everything else is optional.')).toBeVisible();

  await expect(page.getByRole('heading', { level: 2, name: 'Something broke?' })).toBeVisible();
  await expect(page.getByText('Email us what happened. A screenshot helps.')).toBeVisible();
  const bugEmail = page.getByRole('link', { name: 'Email Varve product feedback' }).first();
  await expect(bugEmail).toBeVisible();
  await expect(bugEmail).toHaveText('feedback@varve.studio');
  await expect(bugEmail).toHaveAttribute('href', /^mailto:feedback@varve.studio/);
  await expect(page.getByText('Have a GitHub account? You can also post it there.')).toBeVisible();
  const github = page.getByRole('link', { name: 'You can also post it there.' });
  await expect(github).toBeVisible();
  await expect(github).toHaveAttribute(
    'href',
    'https://github.com/varvedesign/varve/issues/new/choose',
  );

  await expect(
    page.getByRole('heading', { level: 2, name: 'Have an idea or a question?' }),
  ).toBeVisible();
  const forum = page.getByRole('link', { name: 'Post on the Varve forum (GitHub account needed)' });
  await expect(forum).toBeVisible();
  await expect(forum).toHaveAttribute('href', 'https://github.com/varvedesign/varve/discussions');

  await expect(page.getByRole('heading', { level: 2, name: 'Prefer email?' })).toHaveCount(0);

  const emails = page.getByRole('link', { name: 'Email Varve product feedback' });
  await expect(emails).toHaveCount(1);
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

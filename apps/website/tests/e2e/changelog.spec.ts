import { expect, test } from '@playwright/test';

test.describe('changelog', () => {
  test('matches CHANGELOG dates, updater, and Generative Edit attribution', async ({ page }) => {
    await page.goto('/changelog');

    await expect(page.getByRole('heading', { name: 'Varve changelog', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'GitHub releases' })).toHaveAttribute(
      'href',
      'https://github.com/varvedesign/varve/releases',
    );

    const latest = page.locator('[id="v0.5.1"]');
    await expect(latest.getByRole('heading', { name: /0\.5\.1/ })).toBeVisible();
    await expect(latest.locator('time')).toHaveAttribute('datetime', '2026-10-15');
    // The release summary is its own block; scoping here keeps the assertion
    // exact now that the summary and the Linux packaging entry both mention
    // the updater.
    const summary = latest.locator('.changelog-category--summary');
    await expect(summary.getByText(/Tauri updater/i)).toBeVisible();
    await expect(summary.getByText(/update checks run only after/i)).toBeVisible();
    await expect(latest.getByText(/toggling Settings/i).first()).toBeVisible();
    await expect(latest.getByText(/crash dialog/i).first()).toBeVisible();
    await expect(latest.getByText(/setting persists/i).first()).toBeVisible();
    await expect(latest.getByText(/honored at inference/i)).toHaveCount(0);
    await expect(latest.getByText(/Generative Edit/i)).toHaveCount(0);

    const previous = page.locator('[id="v0.5.0"]');
    await expect(previous.locator('time')).toHaveAttribute('datetime', '2026-10-09');
    await expect(previous.getByText(/Generative Edit/i).first()).toBeVisible();
    await expect(previous.getByText(/Consent-first desktop updates/i).first()).toBeVisible();
    await expect(previous.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/varvedesign/varve/releases/tag/v0.5.0',
    );
  });
});

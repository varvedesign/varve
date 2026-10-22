import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/**
 * Area-text overset must be reported by preflight.
 *
 * External evidence: vectorcraft#1471 (area-type overflow is not reported),
 * #2323 (the indicator appears only once the frame is selected), #2769 (CJK
 * area text clips its last line silently). Varve computed overflow while
 * painting and discarded it, so preflight said `unavailable` and a clipped
 * frame warned nobody.
 *
 * This drives the real editor: a small area frame, text that cannot fit, then
 * the preflight badge.
 */
test.use({ viewport: { width: 1440, height: 1000 } });

test('a frame too small for its text is reported as text overflow', async ({ page }) => {
  await navigateToEditor(page);
  // Preflight is a Print-workspace status section; Design does not show it.
  await page.getByRole('radio', { name: 'Print workspace' }).click();

  // Area text: drag a frame with the Type tool, then type far more than fits.
  await page.keyboard.press('t');
  await dragOnCanvas(page, 200, 200, 300, 250);
  await page.keyboard.type(
    'The quick brown fox jumps over the lazy dog and keeps running well past the frame.',
  );
  await page.keyboard.press('Escape');

  const badge = page.getByRole('button', { name: /^Preflight:/ });
  await expect(badge).toBeVisible({ timeout: 15000 });
  await expect(badge).toHaveAttribute('aria-label', /warning|error/i);

  await badge.click();
  const panel = page.getByRole('dialog', { name: 'Preflight issues' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/Text overflow/i);

  // Capture the panel itself: a page screenshot taken later can miss it if the
  // badge toggles closed, and the finding is the evidence.
  await panel.screenshot({ path: 'reports/vectorcraft/preflight-overset-panel.png' });
  await page.screenshot({ path: 'reports/vectorcraft/preflight-overset.png', fullPage: false });
});

test('a frame large enough for its text is not reported as overflow', async ({ page }) => {
  await navigateToEditor(page);
  await page.getByRole('radio', { name: 'Print workspace' }).click();

  await page.keyboard.press('t');
  await dragOnCanvas(page, 150, 150, 750, 650);
  await page.keyboard.type('Short.');
  await page.keyboard.press('Escape');

  const badge = page.getByRole('button', { name: /^Preflight:/ });
  // The badge may exist for other findings (missing fonts, print checks); the
  // overflow entry must not be among them.
  if (await badge.isVisible().catch(() => false)) {
    await badge.click();
    const panel = page.getByRole('dialog', { name: 'Preflight issues' });
    await expect(panel).toBeVisible();
    await expect(panel).not.toContainText(/Text overflow/i);
    await page.keyboard.press('Escape');
  }
});

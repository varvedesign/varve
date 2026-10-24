import { expect, type Page, test } from '@playwright/test';

/**
 * Crash-loop classification — design-system audit 2026-09-27 (§7.4).
 *
 * The crash-loop counter must count evidence of interrupted runs, not
 * ordinary boots. The Home surface never mounts `LifecycleProvider`, so
 * `strata-clean-shutdown` is never written there; with the old
 * `!== 'true'` classification every Home load (and every fresh profile's
 * first boot) recorded a startup failure, and the third load within the
 * 10-minute window tripped the safe-mode screen with zero page errors.
 * Probe evidence: reports/ds-audit-2026-09-27/probe.log.
 */
const HOME_NAV_TIMEOUT_MS = 300_000;
const HOME_VISIBLE_TIMEOUT_MS = 180_000;

async function loadHome(page: Page): Promise<void> {
  await page.goto('/', { timeout: HOME_NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
  const reload = page.locator('.boot-error-reload');
  if (await reload.isVisible({ timeout: 1000 }).catch(() => false)) {
    await reload.click();
  }
  await page.locator('.varve-home').waitFor({ state: 'visible', timeout: HOME_VISIBLE_TIMEOUT_MS });
}

test.describe('crash-loop classification', () => {
  test('three plain Home loads never enter safe mode or count failures', async ({ page }) => {
    test.setTimeout(540_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    for (let load = 1; load <= 3; load++) {
      await loadHome(page);
    }

    // The old classification tripped the safe-mode screen on load 3.
    await expect(page.locator('.safe-mode-screen')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/);

    const crashLoop = await page.evaluate(() => {
      const raw = localStorage.getItem('varve:crash-loop');
      if (!raw) return { failures: 0, marker: null as string | null };
      const parsed = JSON.parse(raw) as { failures?: number[] };
      return {
        failures: Array.isArray(parsed.failures) ? parsed.failures.length : 0,
        marker: localStorage.getItem('strata-clean-shutdown'),
      };
    });
    // No page errors: these loads were healthy from the app's point of view.
    expect(errors).toEqual([]);
    // No failure may be recorded for boots that were never interrupted.
    expect(crashLoop.failures).toBe(0);
  });
});

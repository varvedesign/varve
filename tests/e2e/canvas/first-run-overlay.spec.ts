/**
 * First-run start panel coverage.
 *
 * Automation skips the panel on a fresh profile so the rest of the suite can
 * reach the editor. This spec opts back in with the force key and drives the
 * real panel (F-45): a modal dialog with focus inside, four starting points
 * whose keys are the live bindings, each starting point doing what its key
 * does, and every way out remembered.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const FORCE_KEY = 'varve:first-run-overlay:force';
const DISMISSED_KEY = 'varve:first-run-overlay:dismissed';

async function openForcedPanel(page: Page) {
  await page.addInitScript((key: string) => {
    localStorage.setItem(key, '1');
  }, FORCE_KEY);
  await navigateToEditor(page);
  const panel = page.getByRole('dialog', { name: 'Welcome to Varve' });
  await expect(panel).toBeVisible();
  return panel;
}

const dismissedFlag = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), DISMISSED_KEY);

test.describe('first-run start panel', () => {
  test('stays off a fresh Playwright profile so the editor is clickable', async ({ page }) => {
    await navigateToEditor(page);
    await expect(page.locator('.first-run-overlay')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^rectangle$/i })).toBeVisible();
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await expect(page.getByRole('button', { name: /^rectangle$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('is a modal dialog with four starting points and their live keys', async ({ page }) => {
    const panel = await openForcedPanel(page);

    // Focus is inside the dialog on open, on the first starting point.
    const starts = panel.getByRole('list', { name: 'Starting points' }).getByRole('button');
    await expect(starts).toHaveCount(4);
    await expect(starts.first()).toBeFocused();
    await expect(starts.first()).toContainText('Draw a frame');

    // Keys come from the effective bindings (Linux runner: Ctrl).
    await expect(starts.nth(0).locator('kbd')).toHaveText('F');
    await expect(starts.nth(1).locator('kbd')).toHaveText('R');
    await expect(starts.nth(2).locator('kbd')).toHaveText('T');
    await expect(starts.nth(3).locator('kbd')).toHaveText(/Ctrl\+\//);
    await expect(starts.nth(1)).toHaveAttribute('aria-keyshortcuts', 'R');
    await expect(panel.getByRole('button', { name: /Open Help/ })).toContainText('F1');

    // The editor behind the modal is inert: Tab never reaches it.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      // The dialog is rendered inside the shell, so exclude focus within it.
      const behind = await page.evaluate(() => {
        const active = document.activeElement;
        const inDialog = document.querySelector('dialog.first-run-overlay')?.contains(active);
        return !inDialog && (document.querySelector('.editor-shell')?.contains(active) ?? false);
      });
      expect(behind).toBe(false);
    }

    // A starting point does what its key does, and closes the panel for good.
    await starts.nth(1).click();
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: /^rectangle$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect.poll(() => dismissedFlag(page)).toBe('true');
  });

  test('Find any command opens the command palette', async ({ page }) => {
    const panel = await openForcedPanel(page);
    await panel.getByRole('button', { name: /Find any command/ }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  });

  test('Escape closes, is remembered, and stays closed after reopening', async ({ page }) => {
    const panel = await openForcedPanel(page);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect.poll(() => dismissedFlag(page)).toBe('true');

    // Reloading an in-editor session returns to Home (unclean-startup
    // recovery). Re-open the same file: the panel must stay gone even though
    // the force key is still set.
    await page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
    const recovery = page.locator('dialog[open]').filter({
      hasText: /closed unexpectedly|recover your documents/i,
    });
    if ((await recovery.count()) > 0) {
      await recovery
        .getByRole('button', { name: /review my documents/i })
        .first()
        .click({ timeout: 5000 })
        .catch(() => undefined);
    }
    const recent = page.getByRole('gridcell').first();
    await recent.waitFor({ state: 'visible', timeout: 60000 });
    await recent.dblclick({ timeout: 15000 });
    await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 60000 });
    await expect(page.locator('.first-run-overlay')).toHaveCount(0);
  });

  test('the blank-canvas button closes and remembers the choice', async ({ page }) => {
    const panel = await openForcedPanel(page);
    await panel.getByRole('button', { name: 'Start with a blank canvas' }).click();
    await expect(panel).toBeHidden();
    await expect.poll(() => dismissedFlag(page)).toBe('true');
  });
});

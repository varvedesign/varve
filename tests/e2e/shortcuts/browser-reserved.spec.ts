import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function trackShortcutDefaultPrevented(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const target = window as Window & { __lastShortcutDefaultPrevented?: boolean };
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key.toLowerCase() === 'h' || event.key.toLowerCase() === 'o') {
          queueMicrotask(() => {
            target.__lastShortcutDefaultPrevented = event.defaultPrevented;
          });
        }
      },
      { capture: true },
    );
  });
}

test.describe('browser-reserved shortcuts', () => {
  test('leaves Ctrl+Shift+H available to browser history', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    await trackShortcutDefaultPrevented(page);

    await page.keyboard.press('Control+Shift+H');
    await page.screenshot({ path: testInfo.outputPath('browser-history-shortcut.png') });
    await expect(page.locator('.editor-shell')).toBeVisible({ timeout: 3000 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __lastShortcutDefaultPrevented?: boolean })
              .__lastShortcutDefaultPrevented,
        ),
      )
      .toBe(false);
  });

  test('leaves Ctrl+Shift+O available to browser bookmarks', async ({ page }) => {
    await navigateToEditor(page);
    await trackShortcutDefaultPrevented(page);

    const viewMenuButton = page
      .getByRole('menubar', { name: 'Application' })
      .getByRole('menuitem', { name: 'View' });
    await viewMenuButton.click();
    const viewMenu = page.getByRole('menu', { name: 'View' });
    await viewMenu.getByRole('menuitem', { name: 'Canvas Mode' }).hover();
    const outlineMode = page
      .getByRole('menu', { name: 'Canvas Mode' })
      .getByRole('menuitemcheckbox', { name: /Outline Mode/ });
    await expect(outlineMode).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+Shift+O');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __lastShortcutDefaultPrevented?: boolean })
              .__lastShortcutDefaultPrevented,
        ),
      )
      .toBe(false);
    await expect(page.locator('.editor-shell')).toBeVisible();
    await viewMenuButton.click();
    await page
      .getByRole('menu', { name: 'View' })
      .getByRole('menuitem', { name: 'Canvas Mode' })
      .hover();
    await expect(
      page
        .getByRole('menu', { name: 'Canvas Mode' })
        .getByRole('menuitemcheckbox', { name: /Outline Mode/ }),
    ).toHaveAttribute('aria-checked', 'false');
  });
});

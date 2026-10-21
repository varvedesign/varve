import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('plain-text paste explains when browser clipboard access needs a secure origin', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });

  await navigateToEditor(page);
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: 'Paste as Plain Text' }).click();

  await expect(page.locator('#strata-canvas-announcer-polite')).toHaveText(
    'Clipboard access requires HTTPS or localhost; try Ctrl+V or open Varve securely',
    { timeout: 5000 },
  );
  await test.info().attach('clipboard-secure-origin-feedback', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

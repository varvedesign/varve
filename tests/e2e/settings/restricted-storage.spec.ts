import { expect, test } from '@playwright/test';
import { dragOnCanvas } from '../shared';

test('editor still starts and accepts drawing when localStorage is denied', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied for this document.', 'SecurityError');
      },
    });
  });

  await page.goto('/');
  const newButton = page.getByRole('button', { name: /^new$/i });
  await newButton.waitFor({ timeout: 45000 });
  await newButton.click();
  const create = page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create(\s+design)?$/i })
    .first();
  await create.waitFor({ timeout: 15000 });
  await create.click();
  await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 30000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
  await expect(page.locator('.layers-panel')).toBeVisible({ timeout: 30000 });
  await page.keyboard.press('r');
  await dragOnCanvas(page, 150, 150, 350, 300);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await page.screenshot({ path: test.info().outputPath('restricted-storage-editor.png') });
});

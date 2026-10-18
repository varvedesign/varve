import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('overflowing numeric expressions are rejected by the real Inspector field', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await page.keyboard.press('Escape');
  await page.locator('canvas.editor-canvas__content-layer').focus();
  await page.keyboard.press('f');

  const inspector = page.locator('.editor-inspector');
  await inspector.getByRole('option', { name: /^iPhone SE\b/ }).click();
  const width = inspector.getByRole('spinbutton', { name: 'W (px)', exact: true });
  await expect(width).toHaveValue('375');
  await page.screenshot({
    path: testInfo.outputPath('number-value-before.png'),
    fullPage: true,
    animations: 'disabled',
  });

  const nearLimit = `1${'0'.repeat(308)}`;
  const expression = `${nearLimit} * 10`;
  await width.fill(expression);
  await width.press('Enter');

  const error = inspector.getByRole('alert');
  await expect(error).toHaveText('Not a valid number or expression');
  await expect(width).toHaveAttribute('aria-invalid', 'true');
  await expect(width).toHaveAttribute('aria-valuenow', '375');
  await page.screenshot({
    path: testInfo.outputPath('number-overflow-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

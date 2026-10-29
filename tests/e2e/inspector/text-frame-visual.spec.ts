import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('text frame background renders and a zero-width border persists', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>;
    win.__textFrameSavedDocument = null;
    Object.defineProperty(win, 'showSaveFilePicker', {
      configurable: true,
      value: async (options: { suggestedName?: string }) => ({
        name: options.suggestedName ?? 'text-frame.varve',
        queryPermission: async () => 'granted' as PermissionState,
        createWritable: async () => ({
          write: async (value: unknown) => {
            win.__textFrameSavedDocument = typeof value === 'string' ? value : String(value);
          },
          close: async () => undefined,
        }),
      }),
    });
  });
  await navigateToEditor(page);
  await page
    .getByRole('menubar')
    .getByRole('menuitem', { name: /^File$/ })
    .click();
  await page.locator('.editor-menubar__menu-item').filter({ hasText: /^New/ }).first().click();
  await expect(page.locator('.save-status')).toHaveText('Not saved');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas has no bounds');

  await page.keyboard.press('t');
  await page.mouse.click(bounds.x + 160, bounds.y + 180);
  await page.keyboard.insertText('Keep this label readable');
  await page.keyboard.press('Escape');

  const frameSection = page.getByRole('button', { name: /Text Frame/ });
  await expect(frameSection).toBeVisible();
  const backgroundToggle = page.getByRole('switch', { name: 'Add text frame background' });
  await backgroundToggle.focus();
  await page.keyboard.press('Space');
  const backgroundSwatch = page.getByRole('button', { name: 'Text frame background colour' });
  await backgroundSwatch.focus();
  await page.keyboard.press('Enter');
  const colorDialog = page.getByRole('dialog', { name: /pick text frame background colour/i });
  await expect(colorDialog).toBeVisible();
  const hex = colorDialog.getByRole('textbox', { name: 'Hex color' });
  await hex.fill('#57d0c6');
  await hex.press('Enter');
  await colorDialog.getByRole('button', { name: /^done$/i }).click();

  const borderToggle = page.getByRole('switch', { name: 'Add text frame border' });
  await borderToggle.focus();
  await page.keyboard.press('Space');
  const width = page.getByRole('spinbutton', { name: 'Border width' });
  await expect(width).toHaveValue('1');
  await page.screenshot({ path: testInfo.outputPath('text-frame-painted-border.png') });
  await width.fill('0');
  await width.press('Enter');
  await expect(width).toHaveValue('0');
  await expect(page.getByRole('switch', { name: 'Remove text frame border' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Remove text frame background' })).toBeChecked();

  await page
    .getByRole('menubar')
    .getByRole('menuitem', { name: /^File$/ })
    .click();
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: /^Save Ctrl\+S$/ })
    .click();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const savedDocument = await page.evaluate(
    () => (window as unknown as { __textFrameSavedDocument: string }).__textFrameSavedDocument,
  );
  expect(savedDocument).toContain('"textFrame"');
  expect(savedDocument).toContain('"width":0');
  await page.locator('#file-open-input').setInputFiles({
    name: 'text-frame-round-trip.varve',
    mimeType: 'application/json',
    buffer: Buffer.from(savedDocument),
  });
  const textLayer = page.getByRole('treeitem', { name: /Keep this label readable/ });
  await expect(textLayer).toBeVisible();
  await textLayer.click();
  await expect(page.getByRole('switch', { name: 'Remove text frame border' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Remove text frame background' })).toBeChecked();
  await expect(page.getByRole('spinbutton', { name: 'Border width' })).toHaveValue('0');

  await page.screenshot({ path: testInfo.outputPath('text-frame-controls-after-reopen.png') });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('treeitem', { name: /Keep this label readable/ }).press('Escape');
  await page.getByRole('button', { name: 'Fit selection to viewport' }).click();
  await page.screenshot({ path: testInfo.outputPath('text-frame-1024x768.png') });
});

test('mixed text-frame colors can be normalized across a multi-selection', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas has no bounds');

  for (const [label, x] of [
    ['First mixed frame', 160],
    ['Second mixed frame', 340],
  ] as const) {
    await page.keyboard.press('t');
    await page.mouse.click(bounds.x + x, bounds.y + 180);
    await page.keyboard.insertText(label);
    await page.keyboard.press('Escape');
  }

  const first = page.getByRole('treeitem', { name: /First mixed frame/ });
  const second = page.getByRole('treeitem', { name: /Second mixed frame/ });
  await first.click();
  await page.getByRole('switch', { name: 'Add text frame background' }).click();
  const firstColor = page.getByRole('button', { name: 'Text frame background colour' });
  await firstColor.click();
  const firstDialog = page.getByRole('dialog', { name: /pick text frame background colour/i });
  await firstDialog.getByRole('textbox', { name: 'Hex color' }).fill('#57d0c6');
  await firstDialog.getByRole('textbox', { name: 'Hex color' }).press('Enter');
  await firstDialog.getByRole('button', { name: /^done$/i }).click();

  await second.click({ modifiers: ['Control'] });
  await expect(page.locator('.insp-panel__multi-count')).toBeVisible();
  await page.getByRole('switch', { name: 'Add text frame background' }).click();

  const mixedColor = page.getByRole('button', { name: 'Text frame background colour' });
  await expect(mixedColor.locator('.insp-swatch__value')).toHaveText('Mixed');
  await page.screenshot({ path: testInfo.outputPath('text-frame-multi-selection-mixed.png') });
  await mixedColor.click();
  const mixedDialog = page.getByRole('dialog', { name: /pick text frame background colour/i });
  const hex = mixedDialog.getByRole('textbox', { name: 'Hex color' });
  await hex.fill('#6A5ACD');
  await hex.press('Enter');
  await mixedDialog.getByRole('button', { name: /^done$/i }).click();

  await mixedColor.click();
  const normalizedDialog = page.getByRole('dialog', { name: /pick text frame background colour/i });
  await expect(
    normalizedDialog.getByRole('textbox', {
      name: 'Hex color',
    }),
  ).toHaveValue('#6a5acd');
  await normalizedDialog.getByRole('button', { name: /^done$/i }).click();
  await page.screenshot({ path: testInfo.outputPath('text-frame-multi-selection-normalized.png') });
});

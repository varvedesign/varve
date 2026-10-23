/**
 * Enhance dialog admission: model operations, presets, and the download
 * dialog stay hidden when AI features are off. CPU upscale stays.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const AI_HINT = 'Turn on AI features in Settings to use this';
const MODEL_OPERATIONS = ['Denoise', 'Restore + Upscale', 'Deblur', 'Deblur + Upscale'];
const MODEL_PRESETS = [
  'Photo cleanup + upscale',
  'Photo AI upscale',
  'Denoise only',
  'Deblur only',
];
const CPU_METHODS = ['Pixel art', 'Fast', 'Balanced', 'Quality'];

function screenshotDir(testInfo: TestInfo): string {
  return process.env.VARVE_AI_SCREENSHOT_DIR ?? testInfo.outputDir;
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const dir = screenshotDir(testInfo);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
  });
}

function seedAi(enabled: boolean) {
  localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled } }));
}

async function openEnhance(page: Page) {
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await page.getByRole('button', { name: 'Enhance', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Enhance image' })).toBeVisible();
}

async function openSelect(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name: 'Enhance image' });
  await dialog.getByRole('combobox', { name }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
}

test.describe('Enhance AI admission', () => {
  test('hides model operations and presets when AI is off', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    await page.addInitScript(seedAi, false);
    await openEnhance(page);

    const dialog = page.getByRole('dialog', { name: 'Enhance image' });
    await expect(dialog.getByText(AI_HINT)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Download model' })).toHaveCount(0);

    await openSelect(page, 'Enhancement operation');
    await expect(page.getByRole('option', { name: 'Auto / Recommended' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Upscale' })).toBeVisible();
    for (const label of MODEL_OPERATIONS) {
      await expect(page.getByRole('option', { name: label, exact: true })).toHaveCount(0);
    }
    await capture(page, testInfo, 'ai_off_enhance_operations');
    await page.keyboard.press('Escape');

    await openSelect(page, 'Enhancement preset');
    await expect(page.getByRole('option', { name: 'Recommended (Auto)' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Fast preview' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Pixel art upscale' })).toBeVisible();
    for (const label of MODEL_PRESETS) {
      await expect(page.getByRole('option', { name: label, exact: true })).toHaveCount(0);
    }
    await capture(page, testInfo, 'ai_off_enhance_presets');
    await page.keyboard.press('Escape');

    await dialog.getByRole('combobox', { name: 'Enhancement operation' }).click();
    await page.getByRole('option', { name: 'Upscale' }).click();
    await openSelect(page, 'Upscale quality');
    for (const label of CPU_METHODS) {
      await expect(page.getByRole('option', { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await expect(page.getByRole('option', { name: /AI enhancement/i })).toHaveCount(0);
    await capture(page, testInfo, 'ai_off_enhance_cpu_methods');
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog', { name: /SCUNet|NAFNet|huggingface/i })).toHaveCount(0);
  });

  test('keeps model operations and presets when AI is on', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    await page.addInitScript(seedAi, true);
    await openEnhance(page);

    const dialog = page.getByRole('dialog', { name: 'Enhance image' });
    await expect(dialog.getByText(AI_HINT)).toHaveCount(0);

    await openSelect(page, 'Enhancement operation');
    for (const label of MODEL_OPERATIONS) {
      await expect(page.getByRole('option', { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await capture(page, testInfo, 'ai_on_enhance_operations');
    await page.keyboard.press('Escape');

    await openSelect(page, 'Enhancement preset');
    for (const label of MODEL_PRESETS) {
      await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
    }
    await capture(page, testInfo, 'ai_on_enhance_presets');
  });
});

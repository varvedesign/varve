import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { navigateToEditor } from '../shared';

/** Shared constants and helpers for the two short-window workbench specs. */
export const SHORT = { width: 1918, height: 729 };

export async function importGenerated(
  page: Page,
  testInfo: import('@playwright/test').TestInfo,
  w: number,
  h: number,
  kind: 'detail' | 'shapes',
) {
  await navigateToEditor(page);
  const dataUrl = await page.evaluate(
    ({ sw, sh, k }) => {
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      if (k === 'detail') {
        // Detail, not a flat gradient: a smooth one analyses as blur and routes
        // Auto onto a model path that may not be installed.
        for (let y = 0; y < sh; y += 8) {
          for (let x = 0; x < sw; x += 8) {
            const v = (x * 7 + y * 13) % 255;
            ctx.fillStyle = `rgb(${v}, ${(x * 3) % 255}, ${(y * 5) % 255})`;
            ctx.fillRect(x, y, 8, 8);
          }
        }
      } else {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, sw, sh);
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(sw / 4, sh / 2, sh / 4.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(sw / 2, sh * 0.27, sw * 0.37, sh * 0.45);
      }
      return canvas.toDataURL('image/png');
    },
    { sw: w, sh: h, k: kind },
  );
  const file = testInfo.outputPath(`source-${kind}-${w}x${h}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  await page.locator('#file-import-input').setInputFiles(file);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
}

export async function closeStartupModals(page: Page) {
  for (let i = 0; i < 6; i += 1) {
    const open = page.locator('dialog[open]');
    if ((await open.count()) === 0) break;
    await open
      .last()
      .evaluate((d) => (d as HTMLDialogElement).close())
      .catch(() => {});
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('Escape').catch(() => {});
}

export async function openEnhance(page: Page, testInfo: import('@playwright/test').TestInfo) {
  await importGenerated(page, testInfo, 480, 640, 'detail');
  await page.getByRole('button', { name: 'Enhance', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Enhance image' })).toBeVisible();
  // CPU-only operation: Auto may choose a model path that is not installed.
  await page.getByRole('combobox', { name: 'Enhancement operation' }).click();
  await page.getByRole('option', { name: 'Upscale', exact: true }).click();
  await expect(page.locator('.upscale-preview__image--upscaled')).toHaveCount(1, {
    timeout: 30000,
  });
  await expect(page.getByText('Generating preview…')).toHaveCount(0, { timeout: 30000 });
}

export const rect = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom, right: b.right };
  }, selector);

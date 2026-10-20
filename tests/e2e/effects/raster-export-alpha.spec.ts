import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('PNG render with no background keeps untouched pixels transparent', async ({ page }) => {
  await page.goto('/');
  const moduleUrl = `/@fs${resolve(process.cwd(), 'packages/engine/src/raster.ts')}`;
  const alpha = await page.evaluate(async (url) => {
    const { renderRaster } = await import(/* @vite-ignore */ url);
    const result = await renderRaster([], { format: 'png', width: 2, height: 2 });
    const bitmap = await createImageBitmap(result.blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable.');
    context.drawImage(bitmap, 0, 0);
    return [...context.getImageData(0, 0, bitmap.width, bitmap.height).data].filter(
      (_value, index) => index % 4 === 3,
    );
  }, moduleUrl);
  expect(alpha).toEqual([0, 0, 0, 0]);
});

test('reported WebP and AVIF support matches the encoded blob MIME', async ({ page }) => {
  await page.goto('/');
  const moduleUrl = `/@fs${resolve(process.cwd(), 'packages/engine/src/raster.ts')}`;
  const encodings = await page.evaluate(async (url) => {
    const { renderRaster, supportsFormat } = await import(/* @vite-ignore */ url);
    const results = [];
    for (const format of ['webp', 'avif'] as const) {
      try {
        const output = await renderRaster([], { format, width: 2, height: 2 });
        results.push({
          format,
          supported: supportsFormat(format),
          blobType: output.blob.type,
          error: null,
        });
      } catch (error) {
        results.push({
          format,
          supported: supportsFormat(format),
          blobType: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }, moduleUrl);
  console.log(`Canvas encode probes: ${JSON.stringify(encodings)}`);
  expect(
    encodings.every((encoding) =>
      encoding.supported
        ? encoding.blobType === `image/${encoding.format}`
        : encoding.blobType === null && encoding.error !== null,
    ),
  ).toBe(true);
});

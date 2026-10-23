/**
 * With AI features turned off, no model file is requested or loaded.
 * Intercepts network and Worker model jobs while the visible AI entry
 * points are exercised.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { selectInspectorTab } from '../helpers/inspector-tabs';
import { navigateToEditor } from '../shared';

const MODEL_URL = /\.onnx(\.data)?(\?|$)|huggingface\.co|hf\.co|cdn-lfs/i;

async function importTestImage(page: import('@playwright/test').Page) {
  const imageDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d');
    ctx.fillStyle = '#4466aa';
    ctx.fillRect(0, 0, 120, 80);
    return canvas.toDataURL('image/png');
  });
  const base64 = imageDataUrl.split(',')[1]!;
  const tmpFile = path.join('/tmp', `ai-off-${Date.now()}.png`);
  fs.writeFileSync(tmpFile, Buffer.from(base64, 'base64'));
  await page.locator('#file-import-input').setInputFiles(tmpFile);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
}

test.describe('AI off loads no model files', () => {
  test('no model network or worker infer after exercising AI entry points', async ({ page }) => {
    test.setTimeout(120000);
    const modelRequests: string[] = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (MODEL_URL.test(url)) {
        modelRequests.push(url);
        return route.abort();
      }
      return route.continue();
    });
    await page.addInitScript(() => {
      localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: false } }));
      const posted: unknown[] = [];
      (window as unknown as { __varveAiWorkerPosts?: unknown[] }).__varveAiWorkerPosts = posted;
      const RealWorker = window.Worker;
      Object.defineProperty(window, 'Worker', {
        configurable: true,
        value: new Proxy(RealWorker, {
          construct(target, args) {
            const worker = Reflect.construct(target, args) as Worker;
            const original = worker.postMessage.bind(worker) as (
              message: unknown,
              options?: unknown,
            ) => void;
            worker.postMessage = ((message: unknown, options?: unknown) => {
              posted.push(message);
              return original(message, options);
            }) as Worker['postMessage'];
            return worker;
          },
        }),
      });
    });

    await navigateToEditor(page);
    await importTestImage(page);
    await page.locator('.layers-panel').getByRole('treeitem').click();
    await selectInspectorTab(page, 'Adjustments');

    await expect(page.getByText('Turn on AI features in Settings to use this').first()).toBeVisible(
      {
        timeout: 10000,
      },
    );
    await expect(page.getByRole('button', { name: 'Depth Blur' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /generate depth map/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /enable depth blur/i })).toHaveCount(0);
    await expect(page.getByText('Colorize')).toHaveCount(0);
    await expect(page.getByText('AI Denoise')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /select object|select specific object/i }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: /download ai model/i })).toHaveCount(0);
    await expect(page.getByText('AI Balanced')).toHaveCount(0);
    await expect(page.getByText('AI High Quality')).toHaveCount(0);

    const bgRemove = page.getByRole('button', { name: /remove background|cut out/i }).first();
    if (await bgRemove.isVisible().catch(() => false)) {
      await bgRemove.click();
    }

    expect(modelRequests, `model requests:\n${modelRequests.join('\n')}`).toEqual([]);
    const posted = await page.evaluate(
      () => (window as unknown as { __varveAiWorkerPosts?: unknown[] }).__varveAiWorkerPosts ?? [],
    );
    const modelJobs = posted.filter((message) => {
      const record = message as { type?: string; options?: { method?: string } };
      return (
        record.type === 'infer' || (record.type === 'upscale' && record.options?.method === 'ai')
      );
    });
    expect(modelJobs).toEqual([]);
  });
});

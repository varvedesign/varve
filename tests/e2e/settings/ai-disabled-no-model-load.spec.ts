/**
 * With AI features turned off, no model file is requested or loaded.
 * Intercepts network and Worker model jobs while every AI-off acceptance
 * state is exercised in the real editor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { selectInspectorTab } from '../helpers/inspector-tabs';
import { navigateToEditor, navigateToHome, sidebarNavClick, switchWorkspace } from '../shared';

const MODEL_URL = /\.onnx(\.data)?(\?|$)|huggingface\.co|hf\.co|cdn-lfs/i;
const SCREENSHOT_DIR = '/opt/cursor/artifacts/screenshots';
const AI_HINT = 'Turn on AI features in Settings to use this';

async function capture(page: import('@playwright/test').Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const dest = path.join(SCREENSHOT_DIR, `${name}.png`);
  if (fs.existsSync(dest)) return;
  await page.screenshot({
    path: dest,
    fullPage: true,
  });
}

async function importTestImage(page: import('@playwright/test').Page) {
  const imageDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d');
    ctx.fillStyle = '#88aacc';
    ctx.fillRect(0, 0, 160, 120);
    ctx.fillStyle = '#cc3344';
    ctx.beginPath();
    ctx.ellipse(80, 60, 36, 44, 0, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL('image/png');
  });
  const base64 = imageDataUrl.split(',')[1]!;
  const tmpFile = path.join('/tmp', `ai-off-${Date.now()}.png`);
  fs.writeFileSync(tmpFile, Buffer.from(base64, 'base64'));
  await page.locator('#file-import-input').setInputFiles(tmpFile);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  fs.unlinkSync(tmpFile);
}

function seedAiOff() {
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
}

test.describe('AI off loads no model files', () => {
  test('no model network or worker infer after exercising AI-off states', async ({ page }) => {
    test.setTimeout(180000);
    const modelRequests: string[] = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (MODEL_URL.test(url)) {
        modelRequests.push(url);
        return route.abort();
      }
      return route.continue();
    });
    await page.addInitScript(seedAiOff);

    await navigateToHome(page);
    await sidebarNavClick(page, 'Assets');
    await page.locator('.asset-browser').waitFor({ state: 'visible', timeout: 15000 });
    const fixture = path.resolve('apps/desktop/public/icons/favicon-16x16.png');
    await page.locator('.asset-browser input[type="file"]').setInputFiles(fixture);
    await expect(page.locator('.asset-browser').getByText(AI_HINT)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: /natural-language search model/i })).toHaveCount(
      0,
    );
    await capture(page, 'ai_off_home_assets');

    await navigateToEditor(page);
    await importTestImage(page);
    await page.locator('.layers-panel').getByRole('treeitem').click();

    await selectInspectorTab(page, 'Design');
    await expect(page.getByRole('button', { name: 'AI Tools' })).toHaveCount(0);
    await capture(page, 'ai_off_design_tab');

    const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
    const selectionSources = inspector.getByRole('button', { name: 'Selection Sources' });
    await expect(selectionSources).toBeVisible({ timeout: 10000 });
    await selectionSources.scrollIntoViewIfNeeded();
    if ((await selectionSources.getAttribute('aria-expanded')) !== 'true') {
      await selectionSources.click();
    }
    await expect(selectionSources).toHaveAttribute('aria-expanded', 'true');
    await expect(inspector.getByRole('button', { name: /^Select subject/ })).toHaveCount(0);
    await expect(inspector.locator('.insp-selection-sources__hint')).toBeVisible({
      timeout: 10000,
    });
    await capture(page, 'ai_off_selection_sources');

    await page
      .getByRole('menubar')
      .getByRole('menuitem', { name: /^File$/ })
      .click();
    await page.getByRole('menuitem', { name: /^Export… Ctrl\+E$/ }).click();
    const exportDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: /^Export$/ }),
    });
    await exportDialog.getByRole('heading', { name: /^Export$/ }).waitFor({ timeout: 10000 });
    await exportDialog.getByLabel('Remove background before export').click();
    await expect(
      exportDialog.getByRole('combobox', { name: 'Background removal method for export' }),
    ).toContainText('Quick');
    await expect(exportDialog.getByText('Balanced')).toHaveCount(0);
    await expect(exportDialog.getByText('High quality')).toHaveCount(0);
    await expect(exportDialog.getByText(AI_HINT)).toBeVisible();
    await exportDialog
      .getByRole('region', { name: 'Background' })
      .screenshot({ path: path.join(SCREENSHOT_DIR, 'ai_off_export_background.png') });
    await capture(page, 'ai_off_export_dialog');
    await page.keyboard.press('Escape');

    const controlBar = page.getByRole('toolbar', { name: 'Contextual properties' });
    const controlBarRemove = controlBar.getByRole('button', { name: 'Remove background' });
    await expect(controlBarRemove, 'control-bar Remove background must be present').toBeVisible({
      timeout: 10000,
    });
    await controlBarRemove.hover();
    await expect(page.getByText('Remove background (B)')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/on-device ML/i)).toHaveCount(0);
    await page.getByText('Remove background (B)').screenshot({
      path: path.join(SCREENSHOT_DIR, 'ai_off_shortcut_tooltip.png'),
    });
    await capture(page, 'ai_off_shortcut');
    await controlBarRemove.click();
    await expect(page.locator('.varve-toast')).toHaveCount(0);
    await expect(page.getByText(/on-device ML/i)).toHaveCount(0);
    const controlBarReview = page.getByRole('region', { name: 'Background removal review' });
    await expect(controlBarReview).toBeVisible({ timeout: 15000 });
    await controlBarReview.screenshot({
      path: path.join(SCREENSHOT_DIR, 'ai_off_control_bar_review.png'),
    });
    await capture(page, 'ai_off_control_bar_remove_background');
    await controlBarReview
      .getByRole('button', { name: /cancel preview|cancel background removal/i })
      .click();
    await expect(controlBarReview).toBeHidden({ timeout: 5000 });

    await switchWorkspace(page, 'Photo');
    await selectInspectorTab(page, 'Adjustments');
    const bgSection = page.getByRole('button', { name: 'Background Removal' });
    if ((await bgSection.getAttribute('aria-expanded')) === 'false') {
      await bgSection.click();
    }
    await expect(page.getByRole('option', { name: /AI Balanced|AI High Quality/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Depth Blur' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /generate depth map/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /enable depth blur/i })).toHaveCount(0);
    await expect(page.getByText('Colorize')).toHaveCount(0);
    await expect(page.getByText('AI Denoise')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /select object|select specific object/i }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: /download ai model/i })).toHaveCount(0);

    const methodSelect = page.getByRole('combobox', { name: 'Background removal method' });
    await expect(methodSelect).toContainText(/Fast — instant, simple backgrounds|Quick/i);
    const inspectorRemove = page.getByRole('button', { name: 'Remove background from image' });
    await expect(inspectorRemove).toBeVisible({ timeout: 10000 });
    await inspectorRemove.click();
    const quickReview = page.getByRole('region', { name: 'Background removal review' });
    await expect(quickReview).toBeVisible({ timeout: 15000 });
    await expect(quickReview.getByRole('button', { name: 'Apply result' })).toBeVisible();
    await quickReview.screenshot({
      path: path.join(SCREENSHOT_DIR, 'ai_off_quick_cutout_mask.png'),
    });
    await capture(page, 'ai_off_quick_cutout_full');

    expect(modelRequests, `model requests:\n${modelRequests.join('\n')}`).toEqual([]);
    const modelJobs = await page.evaluate(() => {
      const value = (window as unknown as { __varveAiWorkerPosts?: unknown }).__varveAiWorkerPosts;
      if (!Array.isArray(value)) return [];
      return value.flatMap((message) => {
        if (!message || typeof message !== 'object') return [];
        const record = message as { type?: string; options?: { method?: string } };
        if (
          record.type === 'infer' ||
          (record.type === 'upscale' && record.options?.method === 'ai')
        ) {
          return [{ type: record.type, method: record.options?.method ?? null }];
        }
        return [];
      });
    });
    expect(modelJobs).toEqual([]);
  });
});

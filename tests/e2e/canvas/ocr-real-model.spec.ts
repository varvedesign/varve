import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import type { Document } from '@varve/scene';
import { selectInspectorTab } from '../helpers/inspector-tabs';
import { navigateToEditor, switchWorkspace } from '../shared';

/** Actual optional PaddleOCR artifacts, browser ORT, editable layers and pixels.
 * VARVE_OCR_REAL_MODEL=1 permits the normal explicit model download.
 * VARVE_OCR_ARTIFACT_CACHE optionally supplies SHA-verified upstream bytes through
 * HTTP interception for repeatable offline runs; no model output is replaced.
 * Native execution/acquisition is separately covered by ocr-native.e2e.ts. */
test.skip(!process.env.VARVE_OCR_REAL_MODEL, 'Set VARVE_OCR_REAL_MODEL=1 for the real OCR gate');

async function useVerifiedArtifactCache(page: Page): Promise<void> {
  const directory = process.env.VARVE_OCR_ARTIFACT_CACHE;
  if (!directory) return;
  const manifest = JSON.parse(readFileSync('apps/desktop/public/models/manifest.json', 'utf8')) as {
    models: Array<{ id: string; remoteUrl: string; sha256: string }>;
  };
  for (const id of ['paddleocr-det-v4', 'paddleocr-rec-v4', 'paddleocr-keys-v1']) {
    const entry = manifest.models.find((model) => model.id === id);
    if (!entry) throw new Error(`Missing OCR artifact ${id}`);
    const body = readFileSync(join(directory, entry.sha256));
    expect(createHash('sha256').update(body).digest('hex')).toBe(entry.sha256);
    await page.route(entry.remoteUrl, (route) =>
      route.fulfill({
        body,
        contentType: 'application/octet-stream',
        headers: { 'access-control-allow-origin': '*', 'content-length': String(body.length) },
      }),
    );
  }
}

async function importPrintedLine(page: Page): Promise<void> {
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 432;
    canvas.height = 82;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Fixture canvas unavailable');
    await document.fonts.load('48px "DejaVu Sans"');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = '48px "DejaVu Sans"';
    context.fillStyle = 'black';
    context.fillText('Hello world 2026', 12, 57);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.locator('#file-import-input').setInputFiles({
    name: 'ocr-printed-line.png',
    mimeType: 'image/png',
    buffer: Buffer.from(encoded, 'base64'),
  });
  await expect(page.getByRole('treeitem', { name: /ocr-printed-line/ })).toBeVisible();
  await page.getByRole('treeitem', { name: /ocr-printed-line/ }).click();
  await page.getByRole('button', { name: 'Fit selection to viewport' }).click();
}

async function contentHash(page: Page): Promise<string> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) throw new Error('Content canvas unavailable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  });
}

/** Fixture-only document setup; recognition, application and interactions still
 * go through the actual UI, worker, ORT and renderer. */
async function setImagePlacement(page: Page, placement: 'plain' | 'crop' | 'tile'): Promise<void> {
  if (placement === 'plain') return;
  await page.evaluate((mode) => {
    interface Editor {
      serializeDocument: () => string;
      updateDoc: (updater: (document: Document) => Document) => void;
    }
    interface Fiber {
      memoizedProps?: { value?: Editor };
      child?: Fiber;
      sibling?: Fiber;
    }
    const root = document.getElementById('root') as unknown as Record<string, Fiber>;
    const key = Object.keys(root).find((name) => name.startsWith('__reactContainer$'));
    const find = (fiber: Fiber | undefined): Editor | undefined => {
      if (!fiber) return undefined;
      const value = fiber.memoizedProps?.value;
      return typeof value?.serializeDocument === 'function'
        ? value
        : (find(fiber.child) ?? find(fiber.sibling));
    };
    const editor = key && find(root[key]);
    if (!editor) throw new Error('Editor context unavailable');
    editor.updateDoc((document) => {
      const image = Object.values(document.nodes).find((node) =>
        node.name?.startsWith('ocr-printed-line'),
      );
      if (image?.kind !== 'shape') throw new Error('OCR image unavailable');
      const fills = image.fills?.map((fill) =>
        fill.image
          ? {
              ...fill,
              image: {
                ...fill.image,
                ...(mode === 'crop'
                  ? { crop: { x: 90, y: 0, w: 12, h: 82 } }
                  : { fit: 'tile' as const, x: 229.9 }),
              },
            }
          : fill,
      );
      return { ...document, nodes: { ...document.nodes, [image.id]: { ...image, fills } } };
    });
  }, placement);
}

for (const placement of ['plain', 'crop', 'tile'] as const) {
  test(`recognized text becomes visible, editable, undoable canvas content (${placement})`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    await useVerifiedArtifactCache(page);
    await navigateToEditor(page);
    await importPrintedLine(page);
    await switchWorkspace(page, 'Photo');
    await selectInspectorTab(page, 'Adjustments');
    const disclosure = page.getByRole('button', { name: 'Recognize Text', exact: true });
    if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
    const download = page.getByRole('button', {
      name: 'Download OCR models (~15 MB)',
      exact: true,
    });
    if (await download.isVisible()) await download.click();
    const recognize = page.getByRole('button', { name: 'Recognize text in image', exact: true });
    await expect(recognize).toBeVisible({ timeout: 120_000 });
    await recognize.click();
    const result = page.locator('.ocr-results input');
    await expect(result).toHaveCount(1, { timeout: 90_000 });
    await expect(result).toHaveValue('Hello world 2026');
    await page.screenshot({ path: info.outputPath('ocr-recognized.png') });
    await setImagePlacement(page, placement);

    await page.getByRole('button', { name: 'Create editable text layers', exact: true }).click();
    const text = page.getByRole('treeitem', { name: /OCR: Hello world 2026/ });
    await expect(text).toBeVisible();
    await text.click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(text).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(text).toBeVisible();

    // Remove the source pixels from the comparison so an unchanged image cannot
    // disguise an invisible or off-canvas text layer. Visibility is exercised via UI.
    const image = page.getByRole('treeitem', { name: /ocr-printed-line/ });
    await image.hover();
    await image.getByRole('button', { name: /^Hide / }).click();
    await text.click();
    await selectInspectorTab(page, 'Design');
    const typography = page.getByRole('button', { name: 'Typography', exact: true });
    if ((await typography.getAttribute('aria-expanded')) !== 'true') await typography.click();
    const content = page.getByRole('textbox', { name: 'Text content', exact: true });
    await expect(content).toHaveValue('Hello world 2026');
    const beforeEdit = await contentHash(page);
    await content.fill('Hello edited 2026');
    await content.press('Tab');
    await expect(content).toHaveValue('Hello edited 2026');
    await expect.poll(() => contentHash(page)).not.toBe(beforeEdit);
    const withText = await contentHash(page);
    await page.screenshot({ path: info.outputPath('ocr-editable-visible-text.png') });
    await text.hover();
    await text.getByRole('button', { name: /^Hide / }).click();
    await expect.poll(() => contentHash(page)).not.toBe(withText);
    await text.getByRole('button', { name: /^Show / }).click();
    await expect.poll(() => contentHash(page)).toBe(withText);
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor } from '../shared';

/**
 * Aspect and layout matrix for the Enhance and Vectorize modals.
 *
 * A modal can look correct on the square favicon every other spec uses and
 * still squash a portrait source or push its controls out of the window, so
 * each case records the geometry the design depends on — stage aspect against
 * the output aspect, stage against hint, whether the dialog body scrolls at
 * all, and whether the modal fits the window — at two window sizes. Captures
 * land in the test's own output directory for review.
 */
test.describe.configure({ mode: 'default' });

const CASES = [
  { name: 'portrait', w: 476, h: 848 },
  { name: 'landscape', w: 848, h: 476 },
  { name: 'square', w: 512, h: 512 },
  { name: 'ultrawide', w: 1600, h: 400 },
  { name: 'tiny', w: 16, h: 16 },
];

const VIEWPORTS = [
  { name: 'wide', width: 1919, height: 1014 },
  { name: 'laptop', width: 1280, height: 800 },
];

/**
 * Capture into the test's own output directory, so review images land in the
 * report and never in the repository.
 */
async function capture(
  testInfo: import('@playwright/test').TestInfo,
  name: string,
  shot: { screenshot: (options: { path: string }) => Promise<Buffer | null> },
) {
  const file = testInfo.outputPath(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await shot.screenshot({ path: file });
}

async function importGenerated(page: import('@playwright/test').Page, w: number, h: number) {
  await navigateToEditor(page);
  const dataUrl = await page.evaluate(
    ({ sw, sh }) => {
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      // Detail, not a flat gradient: a smooth gradient analyses as blur and
      // routes Auto onto a model path that may not be installed.
      for (let y = 0; y < sh; y += 8) {
        for (let x = 0; x < sw; x += 8) {
          const v = (x * 7 + y * 13) % 255;
          ctx.fillStyle = `rgb(${v}, ${(x * 3) % 255}, ${(y * 5) % 255})`;
          ctx.fillRect(x, y, 8, 8);
        }
      }
      ctx.strokeStyle = '#111';
      ctx.lineWidth = Math.max(2, Math.round(sw / 40));
      ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, sw - 2 * ctx.lineWidth, sh - 2 * ctx.lineWidth);
      return canvas.toDataURL('image/png');
    },
    { sw: w, sh: h },
  );
  const file = path.join('/tmp', `modal-validation-${w}x${h}-${Date.now()}.png`);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  await page.locator('#file-import-input').setInputFiles(file);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
}

async function closeStartupModals(page: import('@playwright/test').Page) {
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

async function openVectorize(page: import('@playwright/test').Page, w: number, h: number) {
  await importGenerated(page, w, h);
  await closeStartupModals(page);
  await openMenu(page, 'Object');
  await page.getByRole('menuitem', { name: /Vectorize Image/i }).click();
  await page.locator('.vectorize__diagnostics').waitFor({ timeout: 30000 });
}

async function openEnhance(page: import('@playwright/test').Page, w: number, h: number) {
  await importGenerated(page, w, h);
  await page.getByRole('button', { name: 'Enhance', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Enhance image' })).toBeVisible();
  // CPU-only operation: Auto may choose Deblur on detailed fixtures, which
  // waits on a model that is not installed.
  await page.getByRole('combobox', { name: 'Enhancement operation' }).click();
  await page.getByRole('option', { name: 'Upscale', exact: true }).click();
  await expect(page.locator('.upscale-preview__image--upscaled')).toHaveCount(1, {
    timeout: 30000,
  });
}

for (const viewport of VIEWPORTS) {
  for (const kase of CASES) {
    test(`enhance ${kase.name} @ ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openEnhance(page, kase.w, kase.h);
      const dialog = page.getByRole('dialog', { name: 'Enhance image' });

      const geometry = await page.evaluate(() => {
        const box = document.querySelector(
          '.upscale-preview__image-container',
        ) as HTMLElement | null;
        // The SHARED wrapper is the scroll owner: the grid inside it is
        // auto-height, so its own scrollHeight always equals its clientHeight
        // and asserting on it would pass no matter what scrolled. This is the
        // element that actually gains a scrollbar when the window clamps the
        // dialog.
        const body = document.querySelector(
          'dialog.upscale-dialog .varve-dialog__body',
        ) as HTMLElement | null;
        const hint = document.querySelector('.upscale-preview__hint') as HTMLElement | null;
        const rect = box?.getBoundingClientRect();
        const hintRect = hint?.getBoundingClientRect();
        return {
          stage: rect ? { w: rect.width, h: rect.height } : null,
          bodyScroll: body ? { sh: body.scrollHeight, ch: body.clientHeight } : null,
          stageTop: rect ? rect.top : null,
          hintTop: hintRect ? hintRect.top : null,
          stageBottom: rect ? rect.bottom : null,
          hint: hint?.textContent ?? '',
        };
      });

      const output = geometry.hint.match(/Output:\s*(\d+)x(\d+)/i);
      expect(output, `hint: ${geometry.hint}`).not.toBeNull();
      const outputAspect = Number(output?.[1]) / Number(output?.[2]);
      expect(geometry.stage).not.toBeNull();
      const stageAspect = geometry.stage!.w / geometry.stage!.h;
      expect(
        Math.abs(stageAspect - outputAspect),
        `${kase.name}@${viewport.name} stage ${Math.round(geometry.stage!.w)}x${Math.round(geometry.stage!.h)} (${stageAspect.toFixed(3)}) vs output ${outputAspect.toFixed(3)}`,
      ).toBeLessThan(0.02);

      // Exactly one scroller: the dialog body, and only if the window clamped
      // the modal. On a window that can hold the whole workbench nothing
      // scrolls at all — that is the point of sizing the modal to content.
      expect(geometry.bodyScroll).not.toBeNull();
      expect(geometry.bodyScroll!.sh).toBeLessThanOrEqual(geometry.bodyScroll!.ch + 1);
      // The hint row sits below the stage, never over it.
      expect(geometry.stageBottom!).toBeLessThanOrEqual(geometry.hintTop! + 1);

      // The modal itself has to sit inside the window: a dialog sized from a
      // stale viewport variable gets its header clipped off the top, which an
      // element screenshot hides but a user does not.
      const dialogBox = await dialog.boundingBox();
      const viewportSize = page.viewportSize();
      expect(dialogBox, 'dialog has a box').not.toBeNull();
      expect(viewportSize, 'viewport is set').not.toBeNull();
      expect(
        dialogBox!.y,
        `${kase.name}@${viewport.name} dialog top ${dialogBox!.y}`,
      ).toBeGreaterThanOrEqual(-1);
      expect(
        dialogBox!.y + dialogBox!.height,
        `${kase.name}@${viewport.name} dialog bottom ${dialogBox!.y + dialogBox!.height} of ${viewportSize!.height}`,
      ).toBeLessThanOrEqual(viewportSize!.height + 1);

      await capture(testInfo, `${kase.name}-${viewport.name}-viewport.png`, page);
      await capture(testInfo, `${kase.name}-${viewport.name}.png`, dialog);
    });
  }

  for (const kase of [CASES[0]!, CASES[1]!, CASES[3]!]) {
    test(`vectorize ${kase.name} @ ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openVectorize(page, kase.w, kase.h);
      const dialog = page.getByRole('dialog').first();

      const geometry = await page.evaluate(() => {
        const dialog = document.querySelector('dialog.varve-dialog[open]');
        if (!dialog) throw new Error('no open .varve-dialog to measure');
        const body = dialog.querySelector('.varve-dialog__body') as HTMLElement | null;
        const modes = dialog.querySelector('[aria-label="Trace type"]') as HTMLElement | null;
        const stage = dialog.querySelector('.vectorize__preview') as HTMLElement | null;
        const canvas = dialog.querySelector(
          '.vectorize__preview-canvas',
        ) as HTMLCanvasElement | null;
        const apply = Array.from(dialog.querySelectorAll('button')).find((b) =>
          /Apply trace/.test(b.textContent ?? ''),
        ) as HTMLElement | null;
        const bodyRect = body?.getBoundingClientRect();
        const modesRect = modes?.getBoundingClientRect();
        const stageRect = stage?.getBoundingClientRect();
        const canvasRect = canvas?.getBoundingClientRect();
        const applyRect = apply?.getBoundingClientRect();
        return {
          bodyScroll: body ? { sh: body.scrollHeight, ch: body.clientHeight } : null,
          bodyTop: bodyRect ? bodyRect.top : null,
          modesTop: modesRect ? modesRect.top : null,
          stage: stageRect ? { w: stageRect.width, h: stageRect.height } : null,
          // Rendered canvas box is what the user sees; its ratio must be the
          // source's, not whatever the stage happens to be.
          canvas: canvasRect ? { w: canvasRect.width, h: canvasRect.height } : null,
          applyBottom: applyRect ? applyRect.bottom : null,
          applyRight: applyRect ? applyRect.right : null,
          dialogRight: dialog.getBoundingClientRect().right,
        };
      });

      // Trace type must never be scrolled off the top of the modal.
      expect(geometry.modesTop).not.toBeNull();
      expect(geometry.modesTop!).toBeGreaterThanOrEqual(geometry.bodyTop! - 1);
      expect(geometry.bodyScroll!.sh).toBeLessThanOrEqual(geometry.bodyScroll!.ch + 1);
      // Apply stays inside the dialog.
      expect(geometry.applyRight!).toBeLessThanOrEqual(geometry.dialogRight! + 1);

      // The stage must reproduce the source aspect, not squash to the stage.
      expect(geometry.canvas).not.toBeNull();
      const canvasAspect = geometry.canvas!.w / geometry.canvas!.h;
      expect(
        Math.abs(canvasAspect - kase.w / kase.h),
        `${kase.name}@${viewport.name} canvas ${Math.round(geometry.canvas!.w)}x${Math.round(geometry.canvas!.h)} (${canvasAspect.toFixed(3)}) vs source ${(kase.w / kase.h).toFixed(3)}`,
      ).toBeLessThan(0.03);

      await capture(testInfo, `vectorize-${kase.name}-${viewport.name}.png`, dialog);
    });
  }
}

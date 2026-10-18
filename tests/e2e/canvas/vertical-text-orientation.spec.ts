import { expect, test } from '@playwright/test';
import { evidencePath } from '../helpers/evidence-output';
import { navigateToEditor } from '../shared';

/**
 * Visual acceptance for the two vertical-writing repairs:
 *
 * 1. Mixed orientation resolves from the pinned UAX #50 table: ASCII
 *    punctuation ( ! ( ) - . ) and ASCII digits rotate a quarter turn
 *    clockwise inside vertical columns while CJK punctuation and kana stay
 *    upright. Before the pinned data landed, every punctuation or symbol
 *    cluster stood upright regardless of script.
 * 2. Tate-chu-yoko: a textCombineUpright span occupies ONE measured cell
 *    drawn horizontally, instead of stacking each digit upright at a fixed
 *    0.72 scale.
 *
 * Screenshots land in docs/screenshots/vertical-text/ for human review; the
 * ink assertions only guard that the canvas actually painted.
 */
test.describe('vertical text orientation and tate-chu-yoko', () => {
  test('vertical-rl mixed orientation rotates ASCII punctuation and digits', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    await page.keyboard.press('t');
    const options = page.locator('.tool-options__popover');
    await expect(options).toBeVisible({ timeout: 5000 });
    await options.getByRole('combobox', { name: 'Writing mode' }).selectOption('vertical-rl');
    await options.getByRole('combobox', { name: 'Character orientation' }).selectOption('mixed');

    await page.mouse.click(box.x + 300, box.y + 160);
    await page.keyboard.insertText('縦書き(A) -50度! 「東京」12、本日');
    await expect(page.locator('textarea[data-text-edit-surface="true"]')).toHaveAttribute(
      'data-writing-mode',
      'vertical-rl',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.waitForTimeout(500);

    const shot = evidencePath('vertical-text/vertical-orientation-mixed.png');
    await canvas.screenshot({ path: shot });
    await page.screenshot({ path: shot });

    const inkPixels = await canvas.evaluate((element) => {
      const target = element as HTMLCanvasElement;
      const context = target.getContext('2d');
      if (!context) return 0;
      const pixels = context.getImageData(0, 0, target.width, target.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i]! < 170 && pixels[i + 3]! > 0) count += 1;
      }
      return count;
    });
    expect(inkPixels).toBeGreaterThan(100);
  });

  test('combine toggle lays a digit pair into one horizontal cell', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    await page.keyboard.press('t');
    const options = page.locator('.tool-options__popover');
    await expect(options).toBeVisible({ timeout: 5000 });
    await options.getByRole('combobox', { name: 'Writing mode' }).selectOption('vertical-rl');

    await page.mouse.click(box.x + 300, box.y + 160);
    await page.keyboard.insertText('平成12年、東京');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.waitForTimeout(400);

    const beforeShot = evidencePath('vertical-text/tate-chuyoko-before.png');
    await canvas.screenshot({ path: beforeShot });
    await page.screenshot({ path: beforeShot });

    // Select "12" inside the rich span editor: enable rich text, then build
    // a DOM Range over the pair inside the contenteditable run so the
    // editor context resolves a rich selection, then press the combine
    // toggle exposed for vertical nodes.
    await page.getByRole('switch', { name: 'Enable rich text editing' }).click();
    const runSpan = page.locator('.rich-span-editor__run');
    await expect(runSpan).toBeVisible({ timeout: 5000 });
    await page.evaluate(() => {
      const span = document.querySelector<HTMLElement>('.rich-span-editor__run');
      if (!span?.firstChild) throw new Error('rich span editor has no run text');
      const text = span.textContent ?? '';
      const start = text.indexOf('12');
      if (start < 0) throw new Error(`no digit pair in run text: ${text}`);
      const range = document.createRange();
      range.setStart(span.firstChild, start);
      range.setEnd(span.firstChild, start + 2);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      span.dispatchEvent(new Event('select', { bubbles: true }));
      span.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    });

    const combine = page.getByRole('button', {
      name: /combine selection horizontally in vertical text/i,
    });
    await expect(combine).toBeVisible({ timeout: 5000 });
    await expect(combine).toHaveAttribute('aria-pressed', 'false');
    await combine.click();
    await expect(combine).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const afterShot = evidencePath('vertical-text/tate-chuyoko-after.png');
    await canvas.screenshot({ path: afterShot });
    await page.screenshot({ path: afterShot });

    const inkPixels = await canvas.evaluate((element) => {
      const target = element as HTMLCanvasElement;
      const context = target.getContext('2d');
      if (!context) return 0;
      const pixels = context.getImageData(0, 0, target.width, target.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i]! < 170 && pixels[i + 3]! > 0) count += 1;
      }
      return count;
    });
    expect(inkPixels).toBeGreaterThan(100);
  });
});

/**
 * Switching directly between text nodes must commit the previous node's
 * buffered draft before the next editing surface becomes active.
 *
 * Source analogue: PdfCraft #2022, where a direct click into another text box
 * lost the first draft. Its upstream regression checks saved text and undo;
 * this browser check exercises Varve's matching pointer workflow.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('switching text targets commits the previous buffered draft and preserves undo', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigateToEditor(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  const firstPoint = { x: (box?.x ?? 0) + 300, y: (box?.y ?? 0) + 200 };
  const secondPoint = { x: (box?.x ?? 0) + 300, y: (box?.y ?? 0) + 305 };
  // Text-tool clicks place the insertion anchor at the upper-left of each
  // text run; use its visible interior for subsequent selection clicks.
  const firstTarget = { x: firstPoint.x + 50, y: firstPoint.y + 12 };
  const secondTarget = { x: secondPoint.x + 50, y: secondPoint.y + 12 };
  const editingSurface = page.locator('textarea[data-text-edit-surface="true"]');

  await page.keyboard.press('t');
  await page.mouse.click(firstPoint.x, firstPoint.y);
  await expect(editingSurface).toBeVisible();
  await page.keyboard.insertText('First original');
  await page.keyboard.press('Escape');

  await page.keyboard.press('t');
  await page.mouse.click(secondPoint.x, secondPoint.y);
  await expect(editingSurface).toBeVisible();
  await page.keyboard.insertText('Second original');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');

  await page.mouse.click(firstTarget.x, firstTarget.y);
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
  const firstEditor = page.getByRole('textbox', { name: /editing text/i });
  await expect(firstEditor).toBeVisible();

  // Hold the 100 ms coalescing timer so the only way the first value reaches
  // the document is through the edit-session switch.
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await firstEditor.fill('First buffered update');
  await expect(firstEditor).toHaveValue('First buffered update');

  // Clicking another text object in the active Text tool switches the editing
  // session before the first node's debounce expires.
  await page.mouse.click(secondTarget.x, secondTarget.y);
  const secondEditor = page.getByRole('textbox', { name: /editing text/i });
  await expect(secondEditor).toBeVisible();
  await expect(secondEditor).toHaveValue('Second original');

  await page.mouse.click(firstTarget.x, firstTarget.y);
  const firstSwitchedEditor = page.getByRole('textbox', { name: /editing text/i });
  await expect(firstSwitchedEditor).toHaveValue('First buffered update');
  await page.clock.resume();
  await page.waitForTimeout(100);
  await page.screenshot({ path: testInfo.outputPath('text-target-switch.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('v');
  await page.getByRole('treeitem', { name: /Text: First original/ }).click();
  await expect(page.getByRole('textbox', { name: 'Text content', exact: true })).toHaveValue(
    'First original',
  );
});

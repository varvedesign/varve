import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function selectLayer(page: import('@playwright/test').Page, name: RegExp) {
  const layer = page.getByRole('treeitem', { name }).first();
  await expect(layer).toBeVisible();
  await layer.click();
}

async function dragHandle(
  page: import('@playwright/test').Page,
  handle: import('@playwright/test').Locator,
  dx: number,
  dy: number,
) {
  const box = await handle.boundingBox();
  if (!box) throw new Error('callout handle has no visible bounds');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

test('edits callout tail point and bend directly on the canvas', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await navigateToEditor(page);

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('editor canvas has no bounds');

  await page.keyboard.press('t');
  await page.mouse.click(bounds.x + 260, bounds.y + 200);
  const textEditor = page.getByRole('textbox', { name: /editing text/i });
  await expect(textEditor).toBeFocused();
  await page.keyboard.insertText('The exit is just beyond the station.');
  await page.keyboard.press('Escape');

  await page.keyboard.press('v');
  await selectLayer(page, /text:/i);
  await page.getByRole('button', { name: 'Add speech balloon', exact: true }).click();
  await selectLayer(page, /speech balloon/i);

  const tip = page.getByRole('button', { name: 'Move callout tail 1 point' });
  const bend = page.getByRole('button', { name: 'Bend callout tail 1' });
  await expect(tip).toBeVisible();
  await expect(bend).toBeVisible();
  await expect(tip).toHaveCSS('width', '24px');
  await expect(bend).toHaveCSS('height', '24px');
  await canvas.screenshot({ path: testInfo.outputPath('callout-handles-default-zoom.png') });

  const tailX = page.getByRole('spinbutton', { name: 'Tail X' });
  const tailY = page.getByRole('spinbutton', { name: 'Tail Y' });
  const curve = page.getByRole('spinbutton', { name: 'Tail curve' });
  const initialTip = { x: await tailX.inputValue(), y: await tailY.inputValue() };
  await dragHandle(page, tip, 36, -24);
  await expect(tailX).not.toHaveValue(initialTip.x);
  await expect(tailY).not.toHaveValue(initialTip.y);
  const movedTip = { x: await tailX.inputValue(), y: await tailY.inputValue() };

  const initialCurve = await curve.inputValue();
  await dragHandle(page, bend, -30, 20);
  await expect(curve).not.toHaveValue(initialCurve);
  await expect(tailX).toHaveValue(movedTip.x);
  await expect(tailY).toHaveValue(movedTip.y);
  await canvas.screenshot({ path: testInfo.outputPath('callout-handles-edited.png') });

  await tip.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tailX).not.toHaveValue(movedTip.x);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(tailX).not.toHaveValue(movedTip.x);

  await page.keyboard.press('Shift+1');
  await expect(tip).toBeVisible();
  await expect(tip).toHaveCSS('width', '24px');
  await expect(bend).toHaveCSS('height', '24px');

  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(curve).toHaveValue(initialCurve);
  await expect(tailX).toHaveValue(movedTip.x);
  await expect(tailY).toHaveValue(movedTip.y);
});

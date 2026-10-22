/**
 * Undo granularity for the controls this batch fixed.
 *
 * A native range input emits a change event per pointer move, and a held arrow
 * key repeats. Without a gesture transaction every one of those became its own
 * undo entry: `Ctrl+Z` stepped back a single intermediate value and a drag
 * could consume the whole 50-entry history. Mask density and corner smoothing
 * reached `updateDoc` with no transaction at all.
 *
 * This spec drives the real control through the real mouse and undoes through
 * the real Edit menu, so it fails if the gesture boundary regresses to an event
 * boundary. The keyboard half of the contract — one held-key burst is one
 * entry, and separate presses stay separate — is covered by
 * `context/__tests__/useGestureTransaction.test.tsx`, where repeat events can
 * be dispatched deterministically.
 */
import { expect, type Page, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor } from '../shared';

async function dragRange(page: Page, slider: ReturnType<Page['getByRole']>) {
  const box = await slider.boundingBox();
  if (!box) throw new Error('slider has no bounding box');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  // Many intermediate values: a per-event history would need many undos.
  await page.mouse.move(box.x + box.width * 0.8, y, { steps: 12 });
  await page.mouse.up();
}

async function undoOnce(page: Page) {
  await openMenu(page, 'Edit');
  const undoItem = page.getByRole('menuitem', { name: /^Undo/ });
  await expect(undoItem).toBeEnabled();
  await undoItem.click();
}

/** Create a rounded rect and select it so the corner section is available. */
async function setupRoundedRect(page: Page) {
  await navigateToEditor(page);
  const canvas = page.locator('.editor-canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  // Draw away from the centre hint card, inside the canvas surface.
  const startX = box.x + box.width * 0.18;
  const startY = box.y + box.height * 0.2;
  await page.keyboard.press('r');
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 200, startY + 150, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('.layers-panel')).toBeVisible({ timeout: 20000 });

  // A first-run workspace hint can sit over the lower canvas.
  const dismissHint = page.getByRole('button', { name: 'Got it' });
  if (await dismissHint.isVisible({ timeout: 1500 }).catch(() => false)) {
    await dismissHint.click();
  }

  // The new rectangle is selected; Corner Radius starts collapsed.
  const cornerHeading = page.getByRole('button', { name: 'Corner Radius' });
  await cornerHeading.scrollIntoViewIfNeeded();
  await cornerHeading.click();
  await expect(page.getByRole('spinbutton', { name: 'Radius (px)' })).toBeVisible({
    timeout: 20000,
  });
}

test.describe('gesture undo granularity', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a corner-smoothing drag is one undo step', async ({ page }, testInfo) => {
    await setupRoundedRect(page);

    // Round the corners so the smoothing control appears.
    const radius = page.getByRole('spinbutton', { name: 'Radius (px)' });
    await radius.fill('24');
    await radius.press('Enter');

    const slider = page.getByRole('slider', { name: 'Corner smoothing' });
    await expect(slider).toBeVisible({ timeout: 10000 });
    const before = Number(await slider.inputValue());

    await dragRange(page, slider);
    const after = Number(await slider.inputValue());
    expect(after, 'the drag must move the smoothing value').not.toBe(before);

    await page.screenshot({ path: testInfo.outputPath('corner-smoothing-dragged.png') });

    // One undo must return the smoothing value, not step back one notch.
    await undoOnce(page);
    await expect.poll(async () => Number(await slider.inputValue())).toBe(before);

    await page.screenshot({ path: testInfo.outputPath('corner-smoothing-undone.png') });
  });
});

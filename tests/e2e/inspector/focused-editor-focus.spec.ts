/**
 * Inspector focused editor — the non-modal dialog focus contract, in a real
 * browser.
 *
 * The surface is a persistent editor for a selected layer's effect
 * parameters. It declares `aria-modal="false"`, so it must not behave like a
 * modal: focus enters on open, Tab must be able to leave it, and dismissal
 * must hand focus back to the row that owns it.
 *
 * These assertions cannot live in jsdom alone: the portal withholds
 * `visibility: visible` until placement settles, and the Tab handoff walks the
 * document's real sequential focus order.
 */
import { expect, type Page, test } from '@playwright/test';
import { addLayerEffect, navigateToEditor } from '../shared';

/** Draw a rectangle and open the Drop Shadow parameter editor for it. */
async function openDropShadowEditor(page: Page) {
  await navigateToEditor(page);
  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 5000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + 180, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 340, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('v');

  const effectsHeading = page.getByRole('button', { name: 'Layer Effects' });
  await effectsHeading.scrollIntoViewIfNeeded();
  await effectsHeading.click();
  const effectsSection = page.locator('.insp-disclosure').filter({ hasText: 'Layer Effects' });
  await addLayerEffect(page, effectsSection, 'Drop Shadow');

  const row = page.locator('.insp-effect-row').first();
  const trigger = row.locator('.insp-disclosure__trigger');
  await trigger.click();

  const dialog = page.locator('.insp-focused-editor');
  await expect(dialog).toBeVisible();
  return { row, trigger, dialog };
}

/** Whether DOM focus currently sits inside the focused editor, if it is open. */
function focusIsInsideEditor(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const dialog = document.querySelector('.insp-focused-editor');
    return Boolean(dialog && dialog.contains(document.activeElement));
  });
}

test.describe('Inspector focused editor focus contract', () => {
  test('declares a non-modal dialog and moves focus into it', async ({ page }) => {
    const { dialog } = await openDropShadowEditor(page);

    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'false');
    await expect.poll(() => focusIsInsideEditor(page), { timeout: 5000 }).toBe(true);
  });

  test('Escape closes the editor and returns focus to the owning row', async ({ page }) => {
    const { trigger, dialog } = await openDropShadowEditor(page);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  });

  test('Tab leaves the editor instead of trapping focus inside it', async ({ page }) => {
    const { dialog } = await openDropShadowEditor(page);
    await expect.poll(() => focusIsInsideEditor(page), { timeout: 5000 }).toBe(true);

    // Walk forward with Tab. A focus trap cycles back inside the surface
    // forever; a non-modal surface hands focus on and closes.
    let leftAfterTabs = -1;
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press('Tab');
      if (!(await focusIsInsideEditor(page))) {
        leftAfterTabs = step;
        break;
      }
    }

    expect(leftAfterTabs, 'Tab never escaped the focused editor').toBeGreaterThanOrEqual(0);
    // The handoff closes the surface rather than leaving a detached portal
    // behind, and focus continues in the inspector after the owning row.
    await expect(dialog).toBeHidden();
  });

  test('dismissing with the header button returns focus to the owning row', async ({ page }) => {
    const { trigger, dialog } = await openDropShadowEditor(page);

    await dialog.getByRole('button', { name: /^Close / }).click();

    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

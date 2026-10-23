/**
 * Layers row toggles and name room (D-3, F-20, 2026-10-23).
 *
 * Eye, lock and the unpinned solo star reserved three 24px slots on every row
 * whether or not they said anything, leaving a 1440px window ~117px for the
 * layer name. Toggles in their default state (visible, unlocked) now take no
 * width until the row is hovered, focused or selected; a hidden or locked
 * state always shows; touch input always shows everything.
 */
import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

const rows = (page: Page) => page.locator('.layers-panel__tree [role="treeitem"]');

async function toggleWidths(row: Locator): Promise<number[]> {
  return row
    .locator('.layers-row__toggle')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
}

/** Clear the selection and park the pointer away from the Layers panel. */
async function settle(page: Page) {
  await page.keyboard.press('Escape');
  const canvas = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
  if (canvas) await page.mouse.move(canvas.x + canvas.width - 30, canvas.y + canvas.height - 80);
  await expect(page.locator('.layers-panel__tree [aria-selected="true"]')).toHaveCount(0);
}

test.describe('Layers row toggles', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('an idle row gives its name the room the toggles reserved', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);
    await settle(page);

    const row = rows(page).nth(1);
    expect(await toggleWidths(row)).toEqual([0, 0, 0]);
    const label = await row.locator('.layers-row__label').boundingBox();
    expect(label?.width ?? 0).toBeGreaterThanOrEqual(165);

    // Hover reveals them at full target size.
    await row.hover();
    for (const width of await toggleWidths(row)) expect(width).toBeGreaterThanOrEqual(24);
  });

  test('hidden and locked rows show their state without hover', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);
    await settle(page);

    const row = rows(page).nth(1);
    await row.hover();
    await row.locator('.layers-row__toggle--visibility-on').click();
    await row.hover();
    await row.locator('.layers-row__toggle--locked-off').click();
    await settle(page);
    // The click left focus on the lock; move it out of the row too.
    await page.getByRole('searchbox', { name: 'Filter layers by name' }).focus();

    const eye = row.locator('.layers-row__toggle--visibility-off');
    const lock = row.locator('.layers-row__toggle--locked-on');
    for (const toggle of [eye, lock]) {
      await expect(toggle).toBeVisible();
      expect((await toggle.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(24);
      expect(await toggle.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    }
    // The default-state solo star stays out of the way.
    expect((await toggleWidths(row))[2]).toBe(0);
  });

  test('keyboard focus and selection reveal a row toggles', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);
    await settle(page);

    // Selection alone reveals eye and lock; the solo star stays hover/focus only.
    const target = rows(page).nth(2);
    await target.click();
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('searchbox', { name: 'Filter layers by name' }).focus();
    await page.mouse.move(5, 5);
    const [eye, lock, solo] = await toggleWidths(target);
    expect(eye).toBeGreaterThanOrEqual(24);
    expect(lock).toBeGreaterThanOrEqual(24);
    expect(solo).toBe(0);

    // Keyboard focus on an unselected row reveals all of its toggles.
    const other = rows(page).nth(0);
    await other.evaluate((el) => (el as HTMLElement).focus());
    await expect(other).toBeFocused();
    for (const width of await toggleWidths(other)) expect(width).toBeGreaterThanOrEqual(24);
  });
});

test.describe('Layers row toggles on touch', () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true });

  test('a coarse pointer always shows every toggle', async ({ page }) => {
    await navigateToEditor(page);
    // Touch emulation must report the media the CSS keys on.
    expect(
      await page.evaluate(
        () => matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches,
      ),
    ).toBe(true);
    await seedLayers(page, 2);
    await page.keyboard.press('Escape');
    for (const width of await toggleWidths(rows(page).first())) {
      expect(width).toBeGreaterThanOrEqual(24);
    }
  });
});

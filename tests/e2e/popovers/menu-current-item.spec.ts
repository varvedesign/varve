/**
 * A menu opened by pointer shows no item as chosen (F-46, shell audit
 * 2026-10-22). The menu makes its first item current on open so the keyboard
 * has somewhere to start; that item used to be painted with the selected
 * fill, so every pointer-opened menu looked as if its first command were
 * already picked. Keyboard focus still shows the fill and the focus ring.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

test('pointer-opened menu: no fill until the keyboard moves, then a visible current item', async ({
  page,
}) => {
  await navigateToEditor(page);
  const box = await page.locator('.editor-canvas').boundingBox();
  if (!box) throw new Error('canvas not laid out');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 160, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 250, { steps: 4 });
  await page.mouse.up();
  await page.mouse.click(box.x + 220, box.y + 200, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Canvas context menu' });
  await expect(menu).toBeVisible();
  // Park the pointer away from the menu so no row is hovered.
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10);

  const fills = () =>
    menu.evaluate((element) =>
      // Checked toggles keep their fill by design; they report state.
      [...element.querySelectorAll('[role^="menuitem"]:not([aria-checked="true"])')].map(
        (item) => getComputedStyle(item).backgroundColor,
      ),
    );
  expect((await fills()).filter((fill) => fill !== 'rgba(0, 0, 0, 0)')).toEqual([]);

  await page.keyboard.press('ArrowDown');
  const focused = await page.evaluate(() => {
    const item = document.activeElement as HTMLElement | null;
    if (!item?.matches('[role^="menuitem"]')) return null;
    const style = getComputedStyle(item);
    return { fill: style.backgroundColor, outline: style.outlineStyle };
  });
  expect(focused).not.toBeNull();
  expect(focused!.fill).not.toBe(TRANSPARENT);
  expect(focused!.outline).toBe('solid');
});

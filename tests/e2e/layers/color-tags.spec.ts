import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Layers Panel - Color Tags', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 3);
  });

  async function setFirstTag(page: import('@playwright/test').Page, label: string) {
    const firstItem = page.getByRole('treeitem').first();
    await firstItem.click({ button: 'right' });
    const menu = page.locator('.varve-ctxmenu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Color Tag' }).click();
    await page
      .getByRole('menu', { name: 'Color Tag submenu' })
      .getByRole('menuitem', { name: new RegExp(`^${label}$`, 'i') })
      .click();
    await expect(firstItem).toHaveAttribute('data-layer-color', label.toLowerCase());
  }

  test('filters tagged and untagged layers through the Layers filter pipeline', async ({
    page,
  }) => {
    await setFirstTag(page, 'Red');

    // The color tag is one dimension of the Filter menu (F-48).
    const chooseTagFilter = async (label: string) => {
      await page.getByRole('button', { name: /^Filter options/ }).click();
      const filterMenu = page.getByRole('menu', { name: 'Filter layers' });
      await filterMenu.getByRole('menuitem', { name: /^Color tag/ }).click();
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
      // Choosing keeps the menu open; Escape closes the submenu, then the menu.
      for (let i = 0; i < 2 && (await filterMenu.isVisible()); i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(50);
      }
      await expect(filterMenu).toBeHidden();
    };
    await chooseTagFilter('Red');

    const filteredRows = page.getByRole('treeitem');
    await expect(filteredRows).toHaveCount(1);
    await expect(filteredRows.first()).toHaveAttribute('data-layer-color', 'red');

    // Each active constraint is a removable token.
    await page.getByRole('button', { name: 'Remove filter: Red tag' }).click();
    await expect(filteredRows).toHaveCount(3);

    await chooseTagFilter('No color tag');
    await expect(filteredRows).toHaveCount(2);
    await expect
      .poll(() => filteredRows.evaluateAll((rows) => rows.every((row) => !row.dataset.layerColor)))
      .toBe(true);

    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(filteredRows).toHaveCount(3);
  });

  test('assignment is restored by undo and redo', async ({ page }) => {
    const firstItem = page.getByRole('treeitem').first();

    await setFirstTag(page, 'Red');
    await expect(firstItem).toHaveAttribute('data-layer-color', 'red');

    await page.keyboard.press('Control+z');
    await expect(firstItem).not.toHaveAttribute('data-layer-color', 'red');

    await page.keyboard.press('Control+Shift+z');
    await expect(firstItem).toHaveAttribute('data-layer-color', 'red');
  });
});

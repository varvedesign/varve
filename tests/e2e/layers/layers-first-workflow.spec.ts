import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Layers-first workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 600 });
    await navigateToEditor(page);
  });

  test('keeps names and the tree usable, then preserves selection and scroll through Home', async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await seedLayers(page, 24);
    await page.keyboard.press('v');
    const tree = page.getByRole('tree', { name: /layers/i });
    const firstRow = tree.getByRole('treeitem').first();
    const treeBox = await tree.boundingBox();
    const statusBox = await page.locator('.editor-status').boundingBox();
    expect(treeBox).not.toBeNull();
    expect(statusBox).not.toBeNull();
    expect(treeBox!.height).toBeGreaterThanOrEqual(160);
    expect(treeBox!.y + treeBox!.height).toBeLessThanOrEqual(statusBox!.y + 1);
    const identityBox = await firstRow.locator('.layers-row__label').boundingBox();
    expect(identityBox!.width).toBeGreaterThanOrEqual(48);

    await tree.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const finalRow = tree.getByRole('treeitem', { name: /^Rectangle 1(?:,|$)/ });
    await finalRow.click();
    await expect(finalRow).toHaveAttribute('aria-selected', 'true');
    const selectedId = await finalRow.getAttribute('data-node-id');
    const beforeScroll = await tree.evaluate((element) => element.scrollTop);
    const beforeZoom = await page.locator('#status-zoom').inputValue();
    expect(beforeScroll).toBeGreaterThan(0);

    await page.locator('.editor-menubar__home').click();
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await expect(tree.locator(`[data-node-id="${selectedId}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect
      .poll(() => tree.evaluate((element) => element.scrollTop))
      .toBeCloseTo(beforeScroll, 0);
    await expect(page.locator('#status-zoom')).toHaveValue(beforeZoom);

    for (const viewport of [
      { width: 900, height: 600 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark', 'high-contrast']) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        await page.screenshot({
          path: testInfo.outputPath(`layers-first-${viewport.width}-${theme}.png`),
          animations: 'disabled',
        });
      }
    }
    expect(errors).toEqual([]);
  });

  test('canvas management keeps a stable name and restores keyboard focus after cancellation', async ({
    page,
  }, testInfo) => {
    const navigator = page.getByRole('region', { name: 'Design Canvases' });
    const name = navigator.locator('.design-canvas-panel__name').first();
    const before = await name.boundingBox();
    const actions = navigator.getByRole('button', { name: 'Actions for Canvas 1', exact: true });
    await actions.hover();
    expect(await name.boundingBox()).toEqual(before);
    await actions.focus();
    expect(await name.boundingBox()).toEqual(before);
    await actions.press('Enter');
    const menu = page.getByRole('menu', { name: 'Actions for Canvas 1', exact: true });
    await expect(menu).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('canvas-actions-900.png') });
    await page.keyboard.press('Enter');
    const rename = page.getByRole('dialog', { name: 'Rename Design Canvas', exact: true });
    await expect(rename.getByRole('textbox')).toBeFocused();
    await rename.getByRole('textbox').fill('Cancelled name');
    await page.keyboard.press('Escape');
    await expect(rename).toBeHidden();
    await expect(name).toHaveText('Canvas 1');
    await expect(actions).toBeFocused();

    await actions.press('Enter');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    const remove = page.getByRole('alertdialog', { name: 'Remove Design Canvas', exact: true });
    await expect(remove).toBeVisible();
    await remove.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(remove).toBeHidden();
    await expect(name).toHaveText('Canvas 1');
    await expect(actions).toBeFocused();
  });
});

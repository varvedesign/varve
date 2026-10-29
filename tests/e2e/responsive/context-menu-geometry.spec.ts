import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test('layer context menu stays visible and scrollable in a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await navigateToEditor(page);
  await seedLayers(page, 3);
  await expect(
    page.getByRole('button', { name: /Auto-reveal canvas selection in Layers panel/ }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Layer navigation settings' }).click();
  await expect(
    page.getByRole('menuitemcheckbox', { name: /Reveal canvas selection in Layers panel/ }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  const row = page.getByRole('treeitem').first();
  await row.click({ button: 'right' });
  const menu = page.locator('.varve-ctxmenu[role="menu"]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Reveal in Layers Panel' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Rename', exact: true }).hover();
  await page.screenshot({
    path: test.info().outputPath('layer-context-menu-1280-after.png'),
    animations: 'disabled',
  });
  const geometry = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const parent = element.parentElement;
    return {
      menu: rect.toJSON(),
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      parent: parent?.getBoundingClientRect().toJSON(),
      parentStyle: parent?.getAttribute('style'),
      style: element.getAttribute('style'),
      canvases: [...document.querySelectorAll<HTMLElement>('.editor-canvas')].map((canvas) =>
        canvas.getBoundingClientRect().toJSON(),
      ),
      toolbars: [...document.querySelectorAll<HTMLElement>('.floating-toolbar')].map((toolbar) =>
        toolbar.getBoundingClientRect().toJSON(),
      ),
      row: document
        .querySelector<HTMLElement>('[role="treeitem"]')
        ?.getBoundingClientRect()
        .toJSON(),
    };
  });
  const canvas = await page.locator('.editor-canvas').boundingBox();
  expect(canvas).not.toBeNull();
  expect(geometry.menu.left).toBeGreaterThanOrEqual(canvas!.x - 1);
  expect(geometry.menu.top).toBeGreaterThanOrEqual(canvas!.y - 1);
  expect(geometry.menu.bottom).toBeLessThanOrEqual(canvas!.y + canvas!.height + 1);
  const toolbar = await page.locator('.floating-toolbar').boundingBox();
  expect(toolbar).not.toBeNull();
  expect(geometry.menu.bottom).toBeLessThanOrEqual(toolbar!.y - 4);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  await menu.evaluate((element) => (element.scrollTop = element.scrollHeight));
  await expect(menu.getByRole('menuitem', { name: /select/i }).last()).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('layer-context-menu-1280-scrolled.png'),
    animations: 'disabled',
  });
  await menu.getByRole('menuitem', { name: 'Masking' }).hover();
  const submenu = page.getByRole('menu', { name: 'Masking submenu' });
  await expect(submenu).toBeVisible();
  const submenuBox = await submenu.boundingBox();
  expect(submenuBox).not.toBeNull();
  expect(submenuBox!.x).toBeGreaterThanOrEqual(0);
  expect(submenuBox!.x + submenuBox!.width).toBeLessThanOrEqual(1280);
  await page.screenshot({
    path: test.info().outputPath('layer-context-menu-1280-submenu.png'),
    animations: 'disabled',
  });
  await menu.getByRole('menuitem', { name: 'Color Tag' }).hover();
  const bottomSubmenu = page.getByRole('menu', { name: 'Color Tag submenu' });
  await expect(bottomSubmenu).toBeVisible();
  const bottomSubmenuBox = await bottomSubmenu.boundingBox();
  expect(bottomSubmenuBox).not.toBeNull();
  expect(bottomSubmenuBox!.y + bottomSubmenuBox!.height).toBeLessThanOrEqual(toolbar!.y - 4);
  await page.screenshot({
    path: test.info().outputPath('layer-context-menu-1280-bottom-submenu.png'),
    animations: 'disabled',
  });
});

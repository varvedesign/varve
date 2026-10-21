import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('tablet switcher matches desktop scale at a 1536px window', async ({ browser }) => {
  const desktop = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  const desktopPage = await desktop.newPage();
  await navigateToEditor(desktopPage);
  const desktopBar = desktopPage.locator('.workspace-dock__bar');
  await expect(desktopBar).toBeVisible();
  const desktopBox = await desktopBar.boundingBox();
  expect(desktopBox).not.toBeNull();
  await desktopPage.screenshot({
    path: test.info().outputPath('workspace-switcher-desktop-1536.png'),
    animations: 'disabled',
  });
  await desktop.close();

  const tablet = await browser.newContext({
    viewport: { width: 1536, height: 864 },
    hasTouch: true,
  });
  await tablet.addInitScript(() => {
    localStorage.setItem(
      'varve-editor-settings',
      JSON.stringify({ appearance: { layoutPreference: 'tablet' } }),
    );
  });
  const tabletPage = await tablet.newPage();
  await navigateToEditor(tabletPage);
  await expect(tabletPage.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');
  const tabletBar = tabletPage.locator('.workspace-dock__bar');
  await expect(tabletBar).toBeVisible();
  await expect(
    tabletPage.getByRole('button', { name: 'Auto-reveal canvas selection in Layers panel' }),
  ).toHaveCount(0);
  await expect(tabletPage.getByTestId('restore-left-panel')).toBeHidden();
  await expect(tabletPage.locator('.editor__fab--layers')).toBeHidden();
  const tabletChrome = await tabletPage.evaluate(() => ({
    canvasDockStyle: document
      .querySelector<HTMLElement>('.editor-shell__canvas-dock')
      ?.getAttribute('style'),
    panels: [
      ...document.querySelectorAll<HTMLElement>('.editor__layers-panel, .editor__inspector-panel'),
    ].map((panel) => ({
      panel: panel.dataset.panel,
      rect: panel.getBoundingClientRect().toJSON(),
      visibility: getComputedStyle(panel).visibility,
    })),
    launchers: [...document.querySelectorAll<HTMLElement>('.editor__fab')].map((launcher) => ({
      label: launcher.getAttribute('aria-label'),
      display: getComputedStyle(launcher).display,
      rect: launcher.getBoundingClientRect().toJSON(),
    })),
  }));
  console.log('TABLET CHROME', JSON.stringify(tabletChrome));
  const inspector = tabletChrome.panels.find((panel) => panel.panel === 'inspector');
  const resourcesLauncher = tabletChrome.launchers.find((launcher) =>
    launcher.label?.includes('resources panel'),
  );
  expect(inspector).toBeDefined();
  expect(resourcesLauncher).toBeDefined();
  if (resourcesLauncher?.display !== 'none') {
    expect(resourcesLauncher!.rect.right).toBeLessThanOrEqual(inspector!.rect.left - 4);
  }
  const tabletBox = await tabletBar.boundingBox();
  expect(tabletBox).not.toBeNull();
  expect(tabletBox!.height).toBeLessThanOrEqual(desktopBox!.height + 4);
  expect(tabletBox!.width).toBeLessThanOrEqual(desktopBox!.width + 16);
  await tabletPage.screenshot({
    path: test.info().outputPath('workspace-switcher-tablet-1536.png'),
    animations: 'disabled',
  });
  await tablet.close();
});

test('an open tablet drawer does not leave a duplicate panel reveal button', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 620 });
  await page.addInitScript(() => {
    localStorage.setItem(
      'varve-editor-settings',
      JSON.stringify({ appearance: { layoutPreference: 'tablet' } }),
    );
  });
  await navigateToEditor(page);

  for (const [launcherClass, panelClass] of [
    ['.editor__fab--layers', '.editor__layers-panel'],
    ['.editor__fab--inspector', '.editor__inspector-panel'],
    ['.editor__fab--library', '.editor__library-panel'],
  ] as const) {
    const launcher = page.locator(launcherClass);
    const panel = page.locator(panelClass);
    await expect(launcher).toBeVisible();
    await launcher.click();
    await expect(panel).toBeVisible();
    await expect(launcher).toBeHidden();
    if (launcherClass === '.editor__fab--layers') {
      await expect(page.getByTestId('restore-left-panel')).toBeHidden();
      await page.mouse.move(350, 300);
      await page.screenshot({
        path: test.info().outputPath('tablet-layers-open-without-reveal-820.png'),
        animations: 'disabled',
      });
    }
    await page.keyboard.press('Escape');
    await expect(launcher).toBeVisible();
    await expect(panel).toBeHidden();
    await expect(launcher).toBeFocused();
  }
});

test('tablet application menu labels do not compress into adjacent buttons', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 620 });
  await page.addInitScript(() => {
    localStorage.setItem(
      'varve-editor-settings',
      JSON.stringify({ appearance: { layoutPreference: 'tablet' } }),
    );
  });
  await navigateToEditor(page);
  await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');

  const rail = page.getByRole('menubar', { name: 'Application' });
  const labels = await rail.locator('.editor-menubar__item').evaluateAll((buttons) =>
    buttons.map((button) => ({
      name: button.textContent?.trim(),
      width: button.clientWidth,
      contentWidth: button.scrollWidth,
    })),
  );
  expect(labels.filter(({ width, contentWidth }) => contentWidth > width + 1)).toEqual([]);

  const leftEdge = await page.evaluate(() => {
    const home = document.querySelector<HTMLElement>('.editor-menubar__home');
    const rail = document.querySelector<HTMLElement>('.editor-menubar__left');
    if (!home || !rail) throw new Error('missing application menu chrome');
    return {
      homeRight: home.getBoundingClientRect().right,
      railLeft: rail.getBoundingClientRect().left,
      railScrollLeft: rail.scrollLeft,
    };
  });
  expect(leftEdge.railLeft).toBeGreaterThanOrEqual(leftEdge.homeRight - 1);
  expect(leftEdge.railScrollLeft).toBe(0);

  await page.screenshot({
    path: test.info().outputPath('tablet-menubar-labels-820.png'),
    animations: 'disabled',
  });

  const help = rail.getByRole('menuitem', { name: 'Help', exact: true });
  await help.click();
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({
    path: test.info().outputPath('tablet-menubar-help-820.png'),
    animations: 'disabled',
  });
});

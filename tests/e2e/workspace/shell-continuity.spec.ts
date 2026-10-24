import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor, seedLayers, setVisibleCheckbox } from '../shared';

test.use({ viewport: { width: 1440, height: 900 } });

async function openPerformanceSettings(page: Page) {
  await page.keyboard.press('Control+,');
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole('tab', { name: 'Performance', exact: true }).click();
  return settings;
}

test('leaving a focused submenu preserves navigation in the surviving root menu', async ({
  page,
}) => {
  await navigateToEditor(page);
  await seedLayers(page, 1);
  await page.getByRole('treeitem').first().click({ button: 'right' });
  const root = page.locator('[data-overlay-kind="context-menu"]');
  const parent = root.getByRole('menuitem', { name: /^Select/ });
  // Enter with the keyboard so focus is actually owned by the child before
  // testing pointer-leave dismissal. Hovering its already-current first item
  // alone need not move DOM focus.
  await page.keyboard.type('sel');
  await expect(parent).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const child = page.locator('[data-overlay-kind="submenu"]');
  await expect(child).toBeVisible();
  const firstAction = child.locator('[role="menuitem"]:not([disabled])').first();
  await firstAction.hover();
  await expect(firstAction).toBeFocused();
  await page.mouse.move(1400, 850);
  await expect(child).toHaveCount(0);
  await expect(root).toBeVisible();
  await expect(parent).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(parent).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(root).toHaveCount(0);
});

test('keyboard canvas menu dismissal restores the canvas-wide focus indicator', async ({
  page,
}) => {
  await navigateToEditor(page);
  const canvas = page.getByTestId('editor-canvas');
  const section = page.locator('.editor-canvas');
  await canvas.click({ position: { x: 80, y: 80 } });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(canvas).toBeFocused();
  await expect(section).toHaveAttribute('data-canvas-focus-visible', 'true');
  await page.keyboard.press('Shift+F10');
  const menu = page.locator('[data-overlay-kind="context-menu"]');
  await expect(menu).toBeVisible();
  // Deliberately cross the previous 500ms Tab-provenance window while reading.
  await page.waitForTimeout(650);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(canvas).toBeFocused();
  await expect(section).toHaveAttribute('data-canvas-focus-visible', 'true');
  await canvas.click({ position: { x: 80, y: 80 } });
  await expect(section).not.toHaveAttribute('data-canvas-focus-visible', 'true');
});

test('ancestor actions remain pointer-reachable through the narrow status row', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await navigateToEditor(page);
  await page.locator('#file-import-input').setInputFiles({
    name: 'nested-selection.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">' +
        '<g data-name="Outer artwork"><g data-name="Inner artwork">' +
        '<rect data-name="Target rectangle" x="20" y="30" width="180" height="120" fill="#347c8c"/>' +
        '</g></g></svg>',
    ),
  });
  await page.getByRole('searchbox', { name: 'Filter layers by name' }).fill('Target rectangle');
  const target = page.getByRole('treeitem', { name: /^Target rectangle/ });
  await expect(target).toBeVisible();
  const status = page.locator('.editor-status');
  for (const ancestor of ['Outer artwork', 'Inner artwork']) {
    await target.click();
    const crumb = status.getByRole('button', { name: ancestor, exact: true });
    await expect(crumb).toHaveCount(1);
    // Scroll only the public status scroller. scrollIntoView would also scroll
    // overflow:hidden ancestors, concealing a pointer-only clipping defect.
    const offset = await crumb.evaluate((element) => {
      const bar = element.closest('.editor-status')!;
      return element.getBoundingClientRect().left - bar.getBoundingClientRect().left;
    });
    await status.evaluate((element, delta) => {
      element.scrollLeft += delta - 8;
    }, offset);
    const hit = await crumb.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return element === top || (top !== null && element.contains(top));
    });
    await page.screenshot({ path: testInfo.outputPath(`ancestor-${ancestor}.png`) });
    expect(hit, `${ancestor} must be exposed by the status row's scrolling`).toBe(true);
    await crumb.click();
    await expect(status.locator('.selection-info-bar__name')).toHaveText(ancestor);
  }
});

for (const initiallyEnabled of [false, true]) {
  test(`Home follows editor diagnostics changes from ${initiallyEnabled}`, async ({ page }) => {
    await page.addInitScript((enabled) => {
      localStorage.setItem(
        'varve-editor-settings',
        JSON.stringify({ performance: { showPerformanceDiagnostics: enabled } }),
      );
    }, initiallyEnabled);
    await navigateToEditor(page);
    const settings = await openPerformanceSettings(page);
    const toggle = settings.getByRole('switch', { name: 'Show performance overlay', exact: true });
    await expect(toggle).toBeChecked({ checked: initiallyEnabled });
    await setVisibleCheckbox(toggle, !initiallyEnabled);
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await page.locator('.editor-menubar__home').click();
    await expect(page.getByRole('button', { name: 'Continue editing', exact: true })).toBeVisible();
    await expect(page.getByLabel('Performance profile')).toHaveCount(initiallyEnabled ? 0 : 1);
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
    await expect(page.locator('.editor-shell')).toBeVisible();
  });
}

import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor, seedLayers, setVisibleCheckbox } from '../shared';

test.use({ viewport: { width: 900, height: 600 } });

async function openFileMenu(page: Page) {
  const trigger = page.getByRole('menuitem', { name: 'File', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  return trigger;
}

async function rememberCodeSubtab(page: Page) {
  await openFileMenu(page);
  await page.getByRole('menuitem', { name: 'Set Up Export', exact: true }).click();
  const code = page.locator('.editor-inspector').getByRole('tab', { name: 'Code', exact: true });
  await code.click();
  await expect(code).toHaveAttribute('aria-selected', 'true');
}

async function expectExportSettings(page: Page) {
  const inspector = page.locator('.editor-inspector');
  await expect(inspector.getByRole('tab', { name: 'Format', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(inspector.getByRole('heading', { name: 'Export configurations' })).toBeVisible();
}

async function expectPointerReachable(control: Locator) {
  await expect(control).toBeVisible();
  const hit = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return (
      rect.left >= 0 &&
      rect.right <= innerWidth &&
      (top === element || (top !== null && element.contains(top)))
    );
  });
  expect(hit, 'control is reachable without scrolling the status row').toBe(true);
}

test('labelled Home round trip preserves the active selection', async ({ page }) => {
  await navigateToEditor(page);
  await seedLayers(page, 2);
  const selected = page.getByRole('treeitem', { selected: true });
  await expect(selected).toHaveCount(1);
  const selectedName = await selected.getAttribute('aria-label');
  const home = page.getByRole('button', { name: 'Home', exact: true });
  // textContent includes the logo's SVG title; the visible label is the tail.
  await expect(home).toContainText('Home');
  await home.click();
  await page.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(page.locator('.editor-shell')).toBeVisible();
  await expect(selected).toHaveAttribute('aria-label', selectedName!);
});

test('export setup reveals the collapsed Inspector and focuses settings without opening a batch', async ({
  page,
}) => {
  await navigateToEditor(page);
  await seedLayers(page, 1);
  await rememberCodeSubtab(page);
  await page.getByRole('button', { name: /^Collapse Inspector/ }).click();
  await expect(page.locator('.editor-inspector')).toBeHidden();
  await openFileMenu(page);
  await page.getByRole('menuitem', { name: 'Set Up Export', exact: true }).click();
  const tab = page.locator('#insp-tab-export');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(tab).toBeFocused();
  await expectExportSettings(page);
  await expect(page.getByRole('dialog', { name: 'Export Batch', exact: true })).toHaveCount(0);
  await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(1);
});

test('batch cancellation returns focus to File and setup hands it to the Inspector', async ({
  page,
}) => {
  await navigateToEditor(page);
  await seedLayers(page, 1);
  await rememberCodeSubtab(page);
  const file = await openFileMenu(page);
  await page.getByRole('menuitem', { name: /^Export Batch…/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export Batch', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(file).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: /^Export Batch…/ }).click();
  await dialog.getByRole('button', { name: 'Set Up Export', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#insp-tab-export')).toBeFocused();
  await expectExportSettings(page);
  await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(1);
});

for (const width of [900, 1440]) {
  for (const theme of ['light', 'dark', 'high-contrast']) {
    test(`clear workbench is readable at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 900 ? 600 : 900 });
      await page.addInitScript(() => {
        localStorage.setItem(
          'varve-editor-settings',
          JSON.stringify({ learning: { showContextualTips: false } }),
        );
      });
      await navigateToEditor(page);
      await seedLayers(page, 1);
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const status = page.locator('.editor-status');
      await expectPointerReachable(status.getByRole('button', { name: 'Fit all to viewport' }));
      await expectPointerReachable(
        status.getByRole('button', { name: 'Fit selection to viewport' }),
      );
      await expectPointerReachable(status.getByRole('button', { name: 'Fit active canvas' }));
      await page.screenshot({ path: testInfo.outputPath(`workbench-${width}-${theme}.png`) });

      const view = status.getByRole('button', { name: 'View options', exact: true });
      await view.focus();
      await page.keyboard.press('Enter');
      const options = page.getByRole('dialog', { name: 'View options', exact: true });
      const grid = options.getByLabel('Grid spacing (px)');
      await expect(grid).toBeFocused();
      await grid.fill('24');
      await grid.press('Enter');
      await setVisibleCheckbox(
        options.getByRole('switch', { name: 'Baseline grid', exact: true }),
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`view-options-${width}-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(options).toBeHidden();
      await expect(view).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(grid).toHaveValue('24');
      await expect(
        options.getByRole('switch', { name: 'Baseline grid', exact: true }),
      ).toBeChecked();
      await page.keyboard.press('Escape');

      await page.keyboard.press('Control+e');
      const batch = page.getByRole('dialog', { name: 'Export Batch', exact: true });
      await expect(batch).toBeVisible();
      await expect(batch.getByRole('button', { name: 'Set Up Export' })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`export-batch-${width}-${theme}.png`) });
      await batch.getByRole('button', { name: 'Set Up Export' }).click();
      await expect(page.locator('#insp-tab-export')).toBeFocused();
    });
  }
}

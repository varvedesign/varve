import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function selectedOutline(page: Page, name: string) {
  const row = page.getByRole('treeitem', { name: new RegExp(`^${name},`) });
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  const outline = page.locator('svg:has(filter#selection-glow) > rect').first();
  await expect(outline).toBeVisible();
  const bounds = await outline.boundingBox();
  if (!bounds) throw new Error(`Selection outline missing for ${name}`);
  return bounds;
}

test('the first edit to an imported Figma grid keeps children in separate cells', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page);

  const source = {
    name: 'Imported dashboard',
    document: {
      type: 'DOCUMENT',
      children: [
        {
          id: 'page:grid',
          type: 'CANVAS',
          name: 'Dashboard',
          children: [
            {
              id: 'frame:grid',
              type: 'FRAME',
              name: 'Imported grid',
              layoutMode: 'GRID',
              gridColumnCount: 2,
              gridRowCount: 1,
              gridColumnGap: 12,
              gridColumnsSizing: '120px 1fr',
              gridRowsSizing: 'auto',
              gridItemsPositioning: 'MANUAL',
              absoluteBoundingBox: { x: 40, y: 40, width: 360, height: 160 },
              children: [
                {
                  id: 'cell:left',
                  type: 'RECTANGLE',
                  name: 'Left card',
                  absoluteBoundingBox: { x: 40, y: 40, width: 120, height: 80 },
                  gridColumnAnchorIndex: 0,
                  gridRowAnchorIndex: 0,
                  gridColumnSpan: 1,
                  gridRowSpan: 1,
                },
                {
                  id: 'cell:right',
                  type: 'RECTANGLE',
                  name: 'Right card',
                  absoluteBoundingBox: { x: 172, y: 40, width: 228, height: 80 },
                  gridColumnAnchorIndex: 1,
                  gridRowAnchorIndex: 0,
                  gridColumnSpan: 1,
                  gridRowSpan: 1,
                },
              ],
            },
          ],
        },
      ],
    },
  };
  await page.locator('#file-import-input').setInputFiles({
    name: 'imported-grid.fig',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(source)),
  });
  const frame = page.getByRole('treeitem', { name: /^Imported grid,/ });
  await expect(frame).toBeVisible({ timeout: 30000 });
  const importReport = page.getByRole('dialog', { name: 'Import Results', exact: true });
  if (await importReport.isVisible({ timeout: 1000 }).catch(() => false)) {
    await importReport.getByRole('button', { name: 'Close', exact: true }).click();
  }

  const beforeLeft = await selectedOutline(page, 'Left card');
  const beforeRight = await selectedOutline(page, 'Right card');
  expect(beforeRight.x).toBeGreaterThan(beforeLeft.x + beforeLeft.width + 8);
  await page.screenshot({ path: testInfo.outputPath('imported-grid-before-first-edit.png') });

  await frame.click();
  await expect(page.getByRole('combobox', { name: 'Layout mode' })).toContainText('Grid');
  const columns = page.getByRole('textbox', { name: 'Grid template columns' });
  await expect(columns).toHaveValue('120px 1fr');
  await columns.fill('140px 1fr');
  await columns.press('Enter');
  await expect(columns).toHaveValue('140px 1fr');

  const afterLeft = await selectedOutline(page, 'Left card');
  const afterRight = await selectedOutline(page, 'Right card');
  expect(afterRight.x - afterLeft.x).toBeCloseTo(152, 0);
  expect(afterRight.x).toBeGreaterThan(afterLeft.x + afterLeft.width + 8);
  expect(afterLeft.y).toBeCloseTo(afterRight.y, 0);
  await page.screenshot({ path: testInfo.outputPath('imported-grid-after-first-edit.png') });
});

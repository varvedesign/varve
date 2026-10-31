/**
 * E2E: Figma import integration smoke test.
 *
 * Verifies the editor loads correctly with the Figma parser registered,
 * accepts .fig files, and imports a checked-in native archive through the real
 * browser file picker. JSON conversion remains covered by importer unit tests.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function dismissImportReport(page: import('@playwright/test').Page): Promise<void> {
  const report = page.getByRole('dialog', { name: 'Import Results', exact: true });
  if (!(await report.isVisible({ timeout: 1000 }).catch(() => false))) return;
  // Shared Dialog labels the icon Close dialog and the footer Close.
  // Dismiss the actual native top-layer report before font recovery input.
  await report.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(report).toHaveCount(0);
}

test.describe('Figma import integration', () => {
  test('editor loads with Figma parser registered and file input accepts .fig', async ({
    page,
  }) => {
    await navigateToEditor(page);

    // Verify the editor loaded
    await expect(page.locator('.layers-panel')).toBeVisible({ timeout: 30000 });

    // Verify the import input accepts .fig files
    const importInput = page.locator('#file-import-input');
    const accept = await importInput.getAttribute('accept');
    expect(accept).toContain('.fig');

    // Verify the canvas is rendering
    const canvas = page.locator('.editor-canvas canvas, canvas').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    // Take a screenshot for visual verification
    const testResultsDir = process.env.PLAYWRIGHT_TEST_RESULT_DIR ?? 'test-results';
    await page.screenshot({
      path: `${testResultsDir}/figma-import-editor-loaded.png`,
      fullPage: false,
    });
  });

  test('imports editable Figma JSON through the file picker without a report for a clean file', async ({
    page,
  }) => {
    await navigateToEditor(page);
    const fixture = {
      name: 'Basic Figma UI',
      document: {
        type: 'DOCUMENT',
        children: [
          {
            id: 'page:1',
            type: 'CANVAS',
            name: 'Design',
            absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
            children: [
              {
                id: 'frame:1',
                type: 'FRAME',
                name: 'Auto Layout card',
                absoluteBoundingBox: { x: 40, y: 40, width: 280, height: 140 },
                layoutMode: 'VERTICAL',
                itemSpacing: 12,
                paddingTop: 16,
                paddingRight: 16,
                paddingBottom: 16,
                paddingLeft: 16,
                children: [
                  {
                    id: 'text:1',
                    type: 'TEXT',
                    name: 'Title',
                    characters: 'Imported text remains editable',
                    absoluteBoundingBox: { x: 56, y: 56, width: 248, height: 24 },
                    style: { fontFamily: 'Inter', fontSize: 18, fontWeight: 600 },
                  },
                  {
                    id: 'shape:1',
                    type: 'RECTANGLE',
                    name: 'Button',
                    absoluteBoundingBox: { x: 56, y: 92, width: 120, height: 40 },
                    rectangleCornerRadii: [8, 8, 8, 8],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    await page.locator('#file-import-input').setInputFiles({
      name: 'basic.fig',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(fixture), 'utf8'),
    });
    await expect(page.locator('.layers-panel')).toContainText('Auto Layout card', {
      timeout: 30000,
    });
    await dismissImportReport(page);
    await expect(page.locator('.editor-canvas canvas, canvas').first()).toBeVisible();
    const testResultsDir = process.env.PLAYWRIGHT_TEST_RESULT_DIR ?? 'test-results';
    await page.screenshot({
      path: `${testResultsDir}/figma-import-basic-ui.png`,
      fullPage: false,
    });
  });

  test('imports the checked-in native .fig fixture through the real file picker', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve(process.cwd(), 'packages/import/test-fixtures/OpenFigs.fig'));
    await expect(page.locator('.layers-panel')).toContainText('WhiteOpenFigOutlinedIcon', {
      timeout: 30000,
    });
    await dismissImportReport(page);
    await expect(page.locator('.editor-canvas canvas, canvas').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('native-fig-import.png') });
  });

  test('keeps imported grid tracks and cell placement after the first edit', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const fixture = {
      name: 'Imported grid first edit',
      document: {
        type: 'DOCUMENT',
        children: [
          {
            id: 'page:grid',
            type: 'CANVAS',
            name: 'Design',
            children: [
              {
                id: 'frame:grid',
                type: 'FRAME',
                name: 'Imported dashboard grid',
                layoutMode: 'GRID',
                gridColumnCount: 3,
                gridRowCount: 1,
                gridColumnsSizing: '100px 1fr 2fr',
                gridRowsSizing: 'auto',
                gridColumnGap: 16,
                gridRowGap: 0,
                gridItemsPositioning: 'MANUAL',
                absoluteBoundingBox: { x: 40, y: 40, width: 420, height: 180 },
                children: [
                  {
                    id: 'cell:first',
                    type: 'RECTANGLE',
                    name: 'First cell',
                    absoluteBoundingBox: { x: 40, y: 40, width: 100, height: 80 },
                    fills: [{ type: 'SOLID', color: { r: 0.15, g: 0.75, b: 0.68, a: 1 } }],
                    gridColumnAnchorIndex: 0,
                    gridRowAnchorIndex: 0,
                    gridColumnSpan: 1,
                    gridRowSpan: 1,
                  },
                  {
                    id: 'cell:span',
                    type: 'RECTANGLE',
                    name: 'Spanning cell',
                    absoluteBoundingBox: { x: 156, y: 40, width: 304, height: 80 },
                    fills: [{ type: 'SOLID', color: { r: 0.92, g: 0.43, b: 0.18, a: 1 } }],
                    gridColumnAnchorIndex: 1,
                    gridRowAnchorIndex: 0,
                    gridColumnSpan: 2,
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
      buffer: Buffer.from(JSON.stringify(fixture), 'utf8'),
    });
    await expect(page.locator('.layers-panel')).toContainText('Imported dashboard grid', {
      timeout: 30000,
    });
    await dismissImportReport(page);
    await page
      .getByRole('treeitem', { name: /Imported dashboard grid/ })
      .first()
      .click();
    await expect(page.getByRole('combobox', { name: 'Layout mode' })).toContainText('Grid');
    const columns = page.getByRole('textbox', { name: /^column \d+ size$/ });
    await expect(columns).toHaveCount(3);
    await expect(columns.nth(0)).toHaveValue('100px');
    await expect(columns.nth(1)).toHaveValue('1fr');
    await expect(columns.nth(2)).toHaveValue('2fr');
    await page.screenshot({ path: testInfo.outputPath('imported-grid-before-edit.png') });

    await page.getByRole('button', { name: 'Add column', exact: true }).click();
    await expect(columns).toHaveCount(4);
    await expect(columns.nth(0)).toHaveValue('100px');
    await expect(columns.nth(1)).toHaveValue('1fr');
    await expect(columns.nth(2)).toHaveValue('2fr');
    await page.screenshot({ path: testInfo.outputPath('imported-grid-after-first-edit.png') });
    await page.getByRole('treeitem', { name: /First cell/ }).click();
    await expect(page.getByRole('spinbutton', { name: 'Column start' })).toHaveValue('1');
    await expect(page.getByRole('spinbutton', { name: 'Column end' })).toHaveValue('2');
    await page.getByRole('treeitem', { name: /Spanning cell/ }).click();
    await expect(page.getByRole('spinbutton', { name: 'Column start' })).toHaveValue('2');
    await expect(page.getByRole('spinbutton', { name: 'Column end' })).toHaveValue('4');
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('button', { name: /^Redo Edit/ })).toBeVisible();
    await page
      .getByRole('treeitem', { name: /Imported dashboard grid/ })
      .first()
      .click();
    await expect(columns).toHaveCount(3);
  });

  test('shows the fidelity report when source semantics are degraded', async ({ page }) => {
    await navigateToEditor(page);
    const fixture = {
      document: {
        type: 'DOCUMENT',
        children: [
          {
            id: 'page:1',
            type: 'CANVAS',
            name: 'Design',
            children: [
              {
                id: 'boolean:1',
                type: 'BOOLEAN_OPERATION',
                name: 'Unsupported union',
                booleanOperation: 'UNION',
                absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
                children: [],
              },
            ],
          },
        ],
      },
    };
    await page.locator('#file-import-input').setInputFiles({
      name: 'degraded.fig',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(fixture), 'utf8'),
    });
    const report = page.getByRole('dialog', { name: 'Import Results', exact: true });
    await expect(report).toBeVisible({ timeout: 30000 });
    await expect(report).toContainText('Import Results');
    await report.getByRole('button', { name: /show details/i }).click();
    await expect(report).toContainText('Boolean operation');
  });

  test('opens font replacement for a missing rich-text run and applies it globally', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const fixture = {
      name: 'Rich text font replacement',
      document: {
        type: 'DOCUMENT',
        children: [
          {
            id: 'page:1',
            type: 'CANVAS',
            name: 'Typography',
            children: [
              {
                id: 'frame:1',
                type: 'FRAME',
                name: 'Font replacement fixture',
                absoluteBoundingBox: { x: 40, y: 40, width: 420, height: 160 },
                children: [
                  {
                    id: 'text:1',
                    type: 'TEXT',
                    name: 'Rich text',
                    characters: 'This run needs a replacement',
                    absoluteBoundingBox: { x: 56, y: 56, width: 388, height: 32 },
                    style: { fontFamily: 'Inter', fontSize: 20, fontWeight: 400 },
                    characterStyleOverrides: Array.from(
                      { length: 'This run needs a replacement'.length },
                      () => 1,
                    ),
                    styleOverrideTable: {
                      '1': { fontFamily: 'Missing Display', fontSize: 20, fontWeight: 700 },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    await page.locator('#file-import-input').setInputFiles({
      name: 'rich-font.fig',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(fixture), 'utf8'),
    });

    const report = page.getByRole('dialog', { name: 'Import Results', exact: true });
    await expect(report).toBeVisible({ timeout: 30000 });
    await dismissImportReport(page);

    const dialog = page.getByRole('dialog', { name: 'Missing Fonts' });
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await expect(dialog).toContainText('Missing Display');
    await expect(dialog).toContainText('rich-text runs');
    await page.screenshot({ path: testInfo.outputPath('font-replacement-dialog.png') });
    await expect(dialog.getByRole('button', { name: 'Replace All' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Replace All' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.layers-panel')).toContainText('Rich text');
  });

  test('offers and installs an exact Fontsource face for an imported missing family', async ({
    page,
  }, testInfo) => {
    const fontPath = path.resolve(
      'apps/desktop/node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2',
    );
    const fontBytes = await readFile(fontPath);
    await page.route('https://cdn.jsdelivr.net/fontsource/fonts/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'font/woff2', body: fontBytes });
    });
    await navigateToEditor(page);

    const fixture = {
      name: 'Exact Fontsource recovery',
      document: {
        type: 'DOCUMENT',
        children: [
          {
            id: 'page:1',
            type: 'CANVAS',
            name: 'Typography',
            children: [
              {
                id: 'text:1',
                type: 'TEXT',
                name: 'Fontsource text',
                characters: 'An exact face can be recovered',
                absoluteBoundingBox: { x: 56, y: 56, width: 388, height: 48 },
                style: { fontFamily: 'Fraunces', fontSize: 28, fontWeight: 700 },
              },
            ],
          },
        ],
      },
    };

    await page.locator('#file-import-input').setInputFiles({
      name: 'fontsource-recovery.fig',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(fixture), 'utf8'),
    });

    const report = page.getByRole('dialog', { name: 'Import Results', exact: true });
    await expect(report).toBeVisible({ timeout: 30000 });
    await dismissImportReport(page);

    const dialog = page.getByRole('dialog', { name: 'Missing Fonts' });
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await expect(dialog).toContainText('Exact family available from Fontsource');
    await expect(dialog).toContainText('700');
    await expect(dialog).toContainText('SIL Open Font License');
    await page.screenshot({ path: testInfo.outputPath('fontsource-recovery-dialog.png') });

    await dialog.getByRole('button', { name: 'Browse fonts' }).click();
    const browserDialog = page.getByRole('dialog', { name: 'Browse fonts' });
    await expect(browserDialog).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('fontsource-browser-from-recovery.png') });
    await browserDialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(dialog).toBeVisible();

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: testInfo.outputPath('fontsource-recovery-dialog-dark.png') });

    await dialog.getByRole('button', { name: 'Install Fraunces 700' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator('.layers-panel')).toContainText('Fontsource text');
  });

  test('does not flag a registered family whose requested weight has no exact file', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);

    // Regression: the registry ships Arial Regular and Bold only. An authored
    // ExtraBold request (for example after a family replacement that carried
    // the original weight) must resolve to the nearest available face instead
    // of raising the Missing Fonts dialog on every open.
    const fixture = {
      name: 'Nearest weight resolution',
      document: {
        type: 'DOCUMENT',
        children: [
          {
            id: 'page:1',
            type: 'CANVAS',
            name: 'Typography',
            children: [
              {
                id: 'text:1',
                type: 'TEXT',
                name: 'Extra bold Arial',
                characters: 'AVAILABLE',
                absoluteBoundingBox: { x: 56, y: 56, width: 320, height: 72 },
                style: { fontFamily: 'Arial', fontSize: 48, fontWeight: 800 },
              },
            ],
          },
        ],
      },
    };

    await page.locator('#file-import-input').setInputFiles({
      name: 'nearest-weight.fig',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(fixture), 'utf8'),
    });

    await expect(page.locator('.layers-panel')).toContainText('Extra bold Arial', {
      timeout: 30000,
    });
    await dismissImportReport(page);
    await expect(page.getByRole('dialog', { name: 'Missing Fonts' })).toHaveCount(0);
    await expect(page.locator('.editor-canvas canvas, canvas').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('nearest-weight-no-dialog.png') });
  });
});

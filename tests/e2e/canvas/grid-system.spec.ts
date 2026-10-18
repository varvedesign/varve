import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Grid system — real editor controls and visual overlay', () => {
  test('keeps document, pixel, and layout-guide visibility independent', async ({ page }) => {
    await navigateToEditor(page);

    const documentGrid = page.getByRole('button', { name: 'Document Grid', exact: true });
    await documentGrid.scrollIntoViewIfNeeded();
    await documentGrid.click();

    const showGrid = page.getByRole('switch', { name: 'Show grid', exact: true });
    const snapGrid = page.getByRole('switch', { name: 'Snap to document grid', exact: true });
    const showPixelGrid = page.getByRole('switch', {
      name: 'Show at high zoom',
      exact: true,
    });
    const snapPixels = page.getByRole('switch', { name: 'Snap to integer pixels', exact: true });
    const showLayoutGuides = page.getByRole('switch', {
      name: 'Show layout guides',
      exact: true,
    });

    await expect(showGrid).toBeVisible();
    await expect(snapGrid).toBeVisible();
    await expect(showPixelGrid).toBeVisible();
    await expect(snapPixels).toBeVisible();
    await expect(showLayoutGuides).toBeVisible();

    await showGrid.check();
    await snapGrid.uncheck();
    await showPixelGrid.check();
    await snapPixels.check();
    await showLayoutGuides.check();
    await expect(showGrid).toBeChecked();
    await expect(snapGrid).not.toBeChecked();
    await expect(showPixelGrid).toBeChecked();
    await expect(snapPixels).toBeChecked();
    await expect(showLayoutGuides).toBeChecked();

    // The grid switches retain focus in the Inspector, where single-letter
    // shortcuts are intentionally ignored. Select the Frame tool through its
    // visible control so this test drives the same path a mouse user gets.
    await page
      .getByRole('button', { name: /^Frame\b/ })
      .first()
      .click();
    // Keep the drag clear of the empty-canvas onboarding card, which can
    // otherwise consume the pointer sequence before the first frame exists.
    await dragOnCanvas(page, 24, 24, 248, 168);
    const frameRow = page.getByRole('treeitem').first();
    await expect(page.getByRole('treeitem')).toHaveCount(1);
    await frameRow.click();

    const historyWarnings: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'warning' && text.includes('updateDoc called outside transaction')) {
        historyWarnings.push(text);
      }
    });
    const layoutGuides = page.getByRole('button', { name: 'Layout guides', exact: true });
    await layoutGuides.scrollIntoViewIfNeeded();
    await layoutGuides.click();
    await page.getByRole('button', { name: 'Add layout guide', exact: true }).click();
    await expect(page.locator('.insp-layout-guide-card')).toHaveCount(1);
    const showGuide = page.getByRole('switch', { name: /show layout guide 1/i });
    await expect(showGuide).toBeChecked();
    await showGuide.uncheck();
    await expect(showGuide).not.toBeChecked();
    await page.keyboard.press('Control+z');
    await expect(showGuide).toBeChecked();
    await page.keyboard.press('Control+Shift+z');
    await expect(showGuide).not.toBeChecked();
    expect(historyWarnings).toEqual([]);

    await page.screenshot({ path: 'test-results/grid-system-editor.png', fullPage: false });
  });

  test('opens Guide Layouts with preview validation and Escape cancel', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    await page.getByRole('menuitem', { name: 'View', exact: true }).click();
    const viewMenu = page.getByRole('menu', { name: 'View' });
    await expect(viewMenu).toBeVisible();
    await viewMenu.getByRole('menuitem', { name: 'Guides', exact: true }).hover();
    await page
      .getByRole('menuitem', { name: /^Guide Layouts/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Guide Layouts' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((element) => element.matches(':modal'))).toBe(true);
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await expect(dialog.getByRole('combobox', { name: 'Preset' })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Layout type' })).toBeVisible();
    await expect(dialog).toContainText('Select a frame to apply a guide layout.');
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Count' }).press('Enter');
    await expect(dialog).toBeVisible();
    const layoutType = dialog.getByRole('combobox', { name: 'Layout type' });
    await layoutType.click();
    const layoutOptions = page.getByRole('listbox', { name: 'Layout type' });
    await expect(layoutOptions).toBeVisible();
    await layoutOptions.evaluate(async (element) => {
      const layer = element.closest('.varve-floating-layer') ?? element;
      await Promise.all(
        layer
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    await page.screenshot({ path: testInfo.outputPath('guide-layout-nested-select.png') });
    await page.getByRole('option', { name: 'Rows' }).click();
    await expect(layoutType).toContainText('Rows');
    await page.screenshot({
      path: testInfo.outputPath('guide-layout-dialog-desktop.png'),
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const responsiveMetrics = await dialog.evaluate((element) => {
      const dialogRect = element.getBoundingClientRect();
      const grid = element.querySelector<HTMLElement>('.guide-layout-dialog__grid');
      if (!grid) throw new Error('Guide Layouts input grid not found');
      return {
        left: dialogRect.left,
        right: dialogRect.right,
        viewportWidth: window.innerWidth,
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      };
    });
    expect(responsiveMetrics.left).toBeGreaterThanOrEqual(0);
    expect(responsiveMetrics.right).toBeLessThanOrEqual(responsiveMetrics.viewportWidth);
    expect(responsiveMetrics.columns).toBe(2);
    await page.screenshot({
      path: testInfo.outputPath('guide-layout-dialog-mobile.png'),
    });

    const count = dialog.getByRole('textbox', { name: 'Count' });
    await count.fill('not-a-number');
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');

    await page.keyboard.press('Control+Alt+Shift+g');
    await expect(page.getByRole('dialog', { name: 'Guide Layouts' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('previews grid track removal, cancels with Escape, then applies as one undo step', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60000);
    await navigateToEditor(page);
    await page.keyboard.press('f');
    await dragOnCanvas(page, 24, 24, 248, 168);
    const frame = page.getByRole('treeitem').first();
    await expect(frame).toBeVisible();
    await frame.click();

    const mode = page.getByRole('combobox', { name: 'Layout mode' });
    await mode.click();
    await page.getByRole('option', { name: 'Grid', exact: true }).click();

    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await dragOnCanvas(page, 60, 60, 132, 108);
    const frameLayer = page.locator('[role="treeitem"][data-layer-type="frame"]').first();
    await expect(page.getByRole('treeitem')).toHaveCount(2);
    await frameLayer.click();

    const addColumn = page.getByRole('button', { name: 'Add column', exact: true });
    await addColumn.click();
    await addColumn.click();
    const columns = page.getByRole('textbox', { name: /^column \d+ size$/ });
    await expect(columns).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('grid-tracks-before-removal.png') });

    const removeFirst = page.getByRole('button', { name: 'Remove column 1', exact: true });
    await removeFirst.focus();
    await page.keyboard.press('Enter');
    const preview = page.getByRole('dialog', { name: 'Preview track removal' });
    await expect(preview).toBeVisible();
    await expect(preview).toBeFocused();
    await expect(preview.getByText('Before', { exact: true })).toBeVisible();
    await expect(preview.getByText('After', { exact: true })).toBeVisible();
    await expect(preview.locator('.insp-grid-track-editor__preview-item')).toHaveCount(2);
    const previewColumns = () =>
      preview.locator('.insp-grid-track-editor__preview-pair').evaluate((element) => ({
        viewport: window.innerWidth,
        columns: getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
      }));
    await page.screenshot({ path: testInfo.outputPath('grid-track-removal-preview-wide.png') });
    await page.setViewportSize({ width: 481, height: 844 });
    await expect.poll(previewColumns).toEqual({ viewport: 481, columns: 2 });
    await page.screenshot({ path: testInfo.outputPath('grid-track-removal-preview-481.png') });
    await page.setViewportSize({ width: 480, height: 844 });
    await expect.poll(previewColumns).toEqual({ viewport: 480, columns: 1 });
    await page.screenshot({ path: testInfo.outputPath('grid-track-removal-preview-480.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(previewColumns).toEqual({ viewport: 390, columns: 1 });
    const dialogBounds = await preview.boundingBox();
    expect(dialogBounds).not.toBeNull();
    expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(390);
    await expect(preview.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Apply removal', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('grid-track-removal-preview-mobile.png') });
    await page.screenshot({ path: testInfo.outputPath('grid-track-removal-preview.png') });
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();
    await expect(page.locator('canvas.editor-canvas__content-layer')).toBeFocused();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(columns).toHaveCount(2);
    await removeFirst.focus();
    await page.keyboard.press('Enter');
    await expect(preview).toBeVisible();
    await preview.getByRole('button', { name: 'Apply removal', exact: true }).click();
    await expect(preview).toBeHidden();
    await expect(columns).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(columns).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('grid-tracks-after-single-undo.png') });
  });
});

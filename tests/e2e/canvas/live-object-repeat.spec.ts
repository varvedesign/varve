import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function groupSelected(page: import('@playwright/test').Page): Promise<unknown> {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return null;
    const key = Object.keys(root).find(
      (candidate) =>
        candidate.startsWith('__reactFiber$') || candidate.startsWith('__reactContainer$'),
    );
    if (!key) return null;
    const visit = (fiber: Record<string, unknown> | null): Record<string, unknown> | null => {
      if (!fiber) return null;
      for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
        const value = (props as Record<string, unknown> | undefined)?.value;
        if (value && typeof value === 'object' && 'groupSelected' in value) {
          return value as Record<string, unknown>;
        }
      }
      return (
        visit(fiber.child as Record<string, unknown> | null) ||
        visit(fiber.sibling as Record<string, unknown> | null)
      );
    };
    const editor = visit(
      (root as unknown as Record<string, unknown>)[key] as Record<string, unknown>,
    );
    return (editor?.groupSelected as (() => unknown) | undefined)?.() ?? null;
  });
}

test.describe('live object repeat', () => {
  test('renders and edits a source-linked grid repeat from the inspector', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 960 });
    await navigateToEditor(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('content canvas not found');

    await page.keyboard.press('r');
    await page.mouse.move(box.x + 140, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 190, box.y + 200, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 230, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 280, box.y + 200, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press('v');
    const sourceRows = page.getByRole('treeitem');
    await expect(sourceRows).toHaveCount(2);
    await sourceRows.nth(0).click();
    await sourceRows.nth(1).click({ modifiers: ['Control'] });
    await groupSelected(page);

    const group = page
      .getByRole('treeitem')
      .filter({ hasText: /^Group/ })
      .first();
    await expect(group).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Live repeat/ })).toBeVisible();
    await page.getByLabel('Repeat arrangement').click();
    await page.getByRole('option', { name: 'Grid' }).click();

    const columns = page.getByRole('spinbutton', { name: 'Columns' });
    const horizontalSpacing = page.getByRole('spinbutton', { name: 'Horizontal spacing (px)' });
    await columns.fill('3');
    await columns.blur();
    await horizontalSpacing.fill('80');
    await horizontalSpacing.blur();
    await expect(columns).toHaveValue('3');
    await expect(horizontalSpacing).toHaveValue('80');

    await page.screenshot({ path: test.info().outputPath('live-object-repeat-grid.png') });
    await page.keyboard.press('ControlOrMeta+z');
    await expect(horizontalSpacing).toHaveValue('120');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(columns).toHaveValue('2');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(columns).toHaveValue('3');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(horizontalSpacing).toHaveValue('80');
  });
});

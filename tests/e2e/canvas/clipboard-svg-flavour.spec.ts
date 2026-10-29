import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/**
 * Copying a selection must offer other applications something they can paste as
 * artwork. Varve writes its editable payload plus text; neither is a vector
 * document, so a paste into Inkscape/Krita/Figma used to arrive as node names.
 * Graphite's equivalent change is GraphiteEditor/Graphite#4499 (resolving
 * #2373).
 *
 * The clipboard is read back through the browser API, which is the same write
 * the desktop app performs through its platform bridge.
 */
test.use({
  viewport: { width: 1440, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'],
});

test('copy puts an image/svg+xml representation on the clipboard', async ({ page }) => {
  await navigateToEditor(page);
  await page.keyboard.press('r');
  await dragOnCanvas(page, 320, 260, 520, 400);
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.keyboard.press('v');
  await page.getByRole('treeitem').first().click();
  await expect(page.getByRole('spinbutton', { name: 'X (px)', exact: true }).first()).toBeVisible({
    timeout: 10000,
  });

  await page.keyboard.press('Control+c');
  await page.waitForTimeout(600);

  const clipboard = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const types = items.flatMap((item) => item.types);
    let svg: string | null = null;
    for (const item of items) {
      if (!item.types.includes('image/svg+xml')) continue;
      svg = await (await item.getType('image/svg+xml')).text();
      break;
    }
    return { types, svg };
  });

  // The editable payload stays offered, so in-app paste keeps full fidelity.
  expect(clipboard.types.some((type) => type.includes('varve+json'))).toBe(true);
  expect(clipboard.types).toContain('image/svg+xml');
  expect(clipboard.svg).toBeTruthy();
  expect(clipboard.svg).toContain('<svg');
  expect(clipboard.svg).toContain('<rect');
  // No page backdrop: pasting must not bring a white rectangle.
  expect(clipboard.svg).not.toContain('fill="#ffffff"');
});

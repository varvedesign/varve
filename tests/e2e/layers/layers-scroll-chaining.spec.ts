/**
 * Layers rail scrolling (user report 2026-10-24, "issues with scrolling").
 *
 * At window heights up to 900px the left rail is the outer scroller and the
 * layer tree scrolls inside it. The tree used to set `overscroll-behavior:
 * contain`, so a wheel over the list stopped dead at the list's end: the
 * minimap and canvas list above it could only be reached by finding the rail's
 * own scrollbar. The wheel now carries on into the rail once the list is spent.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Layers rail scroll chaining', () => {
  test.use({ viewport: { width: 1024, height: 540 } });

  test('the wheel over the layer list carries on into the rail once the list is at its end', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await seedLayers(page, 14);

    const rail = page.locator('#editor-layers-panel');
    const tree = page.locator('.layers-panel__tree');
    expect(await rail.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await tree.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

    // Put the rail at the top and the list at its end.
    await rail.evaluate((el) => {
      el.scrollTop = 0;
    });
    await tree.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const box = await tree.boundingBox();
    if (!box) throw new Error('layer tree has no bounds');
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 60));

    // Wheel down repeatedly, pausing so each one is its own gesture rather than
    // latched to the list.
    await expect
      .poll(
        async () => {
          await page.mouse.wheel(0, 240);
          await page.waitForTimeout(250);
          return rail.evaluate((el) => el.scrollTop);
        },
        { timeout: 15_000, intervals: [300] },
      )
      .toBeGreaterThan(0);
  });
});

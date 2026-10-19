import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test('resizes multiple selected objects together from the canvas bounds', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  await seedLayers(page, 2);

  const shapes = page.locator('[role="treeitem"][data-layer-type="shape"]');
  await expect(shapes).toHaveCount(2);
  await shapes.first().click();
  await shapes.nth(1).click({ modifiers: ['Control'] });
  await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(2);
  const members = page.locator('polygon.selection-overlay__member');
  await expect(members).toHaveCount(2);
  const memberBounds = () =>
    members.evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, y, width, height } = (node as SVGPolygonElement).getBBox();
        return { x, y, width, height };
      }),
    );
  const beforeMembers = await memberBounds();

  const bounds = page.locator('svg[role="presentation"] > rect[stroke-dasharray]');
  await expect(bounds).toBeVisible();
  const before = await bounds.evaluate((node) => ({
    x: Number(node.getAttribute('x')),
    y: Number(node.getAttribute('y')),
    width: Number(node.getAttribute('width')),
    height: Number(node.getAttribute('height')),
  }));
  const beforePath = testInfo.outputPath('multi-selection-before-resize.png');
  await page.screenshot({ path: beforePath });
  await testInfo.attach('multi-selection-before-resize', { path: beforePath });

  const handle = page.locator('[aria-label="Bottom-right resize handle"]');
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('Multi-selection resize handle has no screen bounds');
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 36, startY + 24, { steps: 3 });
  await page.mouse.up();

  await expect
    .poll(() => bounds.evaluate((node) => Number(node.getAttribute('width'))))
    .toBeGreaterThan(before.width);
  await expect
    .poll(() => bounds.evaluate((node) => Number(node.getAttribute('height'))))
    .toBeGreaterThan(before.height);
  const after = await bounds.evaluate((node) => ({
    x: Number(node.getAttribute('x')),
    y: Number(node.getAttribute('y')),
    width: Number(node.getAttribute('width')),
    height: Number(node.getAttribute('height')),
  }));
  expect(after.x).toBeCloseTo(before.x, 8);
  expect(after.y).toBeCloseTo(before.y, 8);
  const afterMembers = await memberBounds();
  expect(afterMembers).toHaveLength(beforeMembers.length);
  for (const [index, resized] of afterMembers.entries()) {
    const original = beforeMembers[index];
    expect(original).toBeDefined();
    expect(resized.width).toBeGreaterThan(original!.width);
    expect(resized.height).toBeGreaterThan(original!.height);
  }
  const afterPath = testInfo.outputPath('multi-selection-after-resize.png');
  await page.screenshot({ path: afterPath });
  await testInfo.attach('multi-selection-after-resize', { path: afterPath });
});

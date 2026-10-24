import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

// Touch gestures are exercised on the product's touch path: the tablet
// layout, where Layers opens as a full-height drawer. In the desktop sidebar
// the stacked sections above the tree leave it no rows at these heights
// (observed: tree squeezed to ~0px between the chips and the sticky bulk bar),
// so coordinates there cannot represent a usable touch surface.
test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

/**
 * The touch point must be the row itself: the sticky bulk-action bar can
 * overlap the tree's lower rows, and in this touch-enabled desktop
 * configuration the shared sidebar squeezes the tree so tightly that row boxes
 * can fall outside the panel's visible area entirely. Pulls the row toward the
 * top of the tree's visible strip (clear of every overlap) and re-verifies via
 * `elementFromPoint`.
 */
async function clearRowHitTarget(page: Page, tree: ReturnType<Page['locator']>, row: Locator) {
  const name = row.locator('.layers-row__name');
  // Center the row across ALL scrollable ancestors first (panel content and
  // tree), so the row's box is genuinely inside the visible area — then fine-
  // tune within the tree for the sticky bulk bar's overlap band.
  await row.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(120);
  let last = 'none';
  for (let attempt = 0; attempt < 8; attempt++) {
    const box = await name.boundingBox();
    if (!box) throw new Error('Layer row has no geometry');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const verdict = await page.evaluate(
      ({ px, py }) => {
        const hit = document.elementFromPoint(px, py);
        if (hit?.closest('[role="treeitem"]')) return { kind: 'row' as const };
        const treeEl = document.querySelector('.layers-panel__tree');
        const treeRect = treeEl?.getBoundingClientRect();
        return {
          kind: 'blocked' as const,
          cls: hit ? (hit.className || hit.tagName).toString().slice(0, 60) : 'none',
          top: treeRect?.top ?? 0,
        };
      },
      { px: x, py: y },
    );
    if (verdict.kind === 'row') return box;
    last = verdict.cls;
    const delta = y - (verdict.top + 24);
    if (Math.abs(delta) < 4) break; // pinned at the strip top and still blocked
    await tree.evaluate((el, d) => {
      el.scrollTop += d;
    }, delta);
    await page.waitForTimeout(140);
  }
  throw new Error(`Could not place a touch point on the row; last blocked by: ${last}`);
}

/**
 * The import's post-commit flow can publish two modal overlays: Import
 * Results (fidelity changes/warnings) and Missing Fonts (families absent on
 * this device). Either backdrop intercepts every pointer event behind it, and
 * closing one can reveal the other, so both are dismissed in order and then
 * re-checked. This fixture has no text, so the waits are usually short.
 */
async function dismissImportOverlays(page: Page, timeout: number) {
  const results = page.getByRole('dialog', { name: 'Import Results' });
  const fonts = page.getByRole('dialog', { name: 'Missing Fonts' });

  if (
    await results.waitFor({ state: 'visible', timeout }).then(
      () => true,
      () => false,
    )
  ) {
    await results.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(results).toBeHidden();
  }
  if (
    await fonts.waitFor({ state: 'visible', timeout }).then(
      () => true,
      () => false,
    )
  ) {
    await fonts.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(fonts).toBeHidden();
  }
  if (await results.isVisible().catch(() => false)) {
    await results.getByRole('button', { name: 'Close', exact: true }).click();
  }
  if (await fonts.isVisible().catch(() => false)) {
    await fonts.getByRole('button', { name: 'Dismiss', exact: true }).click();
  }
  await expect(results).toBeHidden();
  await expect(fonts).toBeHidden();
}

async function prepare(page: Page, count: number) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'varve-editor-settings',
      JSON.stringify({ appearance: { layoutPreference: 'tablet' } }),
    );
  });
  await navigateToEditor(page);
  const showLayers = page.getByRole('button', { name: 'Show layers panel', exact: true });
  if (await showLayers.isVisible().catch(() => false)) {
    await showLayers.click();
  }
  await expect(page.getByTestId('layers-panel')).toBeVisible();
  const rectangles = Array.from(
    { length: count },
    (_, i) => `<rect id="item-${i}" x="${i * 3}" y="${i * 3}" width="20" height="20"/>`,
  ).join('');
  await page.locator('#file-import-input').setInputFiles({
    name: 'touch-layers.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${rectangles}</svg>`,
    ),
  });
  const tree = page.locator('.layers-panel__tree');
  await expect(tree.locator('[role="treeitem"]').first()).toBeVisible();
  // Fail fast on a degenerate tree (near-zero rows), not on the product's
  // genuinely cramped-but-usable geometry (~138px here, which is real).
  const treeBox = await tree.boundingBox();
  if (!treeBox || treeBox.height < 100) {
    throw new Error(
      `Layers tree too small for touch gesture tests: ${treeBox?.height ?? 'null'}px`,
    );
  }
  await dismissImportOverlays(page, 5000);
  return tree;
}

test('a swipe that starts on a row scrolls without changing its order', async ({ page }, info) => {
  const tree = await prepare(page, 60);
  await expect.poll(() => tree.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // The header count is the document total and exists without an active filter.
  const before = await page.locator('.layers-panel__count').textContent();
  expect(before).toBeTruthy();
  const box = await tree.boundingBox();
  if (!box) throw new Error('Layers tree has no geometry');
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.75;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y - step * 18 }],
    });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => tree.evaluate((el) => el.scrollTop)).toBeGreaterThan(40);
  await expect(page.locator('.drag-overlay')).toBeHidden();
  await expect(page.locator('.layers-panel__count')).toHaveText(before!);
  await tree.screenshot({ path: info.outputPath('touch-swipe-scroll.png') });
  // Home is a real user navigation route back to the first authored row.
  // Focus a mounted row (roving tabindex: rows are programmatic-focus
  // targets), then the tree's Home handler scrolls the virtualizer to 0.
  await tree.locator('[role="treeitem"]').first().focus();
  await page.keyboard.press('Home');
  await expect.poll(() => tree.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(tree.locator('[role="treeitem"]').first()).toHaveAttribute('aria-posinset', '1');
  await expect(tree.locator('.layers-row__name').first()).toHaveText('item-59');
});

test('a held row previews and commits one undoable touch reorder', async ({ page }, info) => {
  const tree = await prepare(page, 5);
  const rows = tree.locator('[role="treeitem"]');
  await expect(rows).toHaveCount(5);
  const before = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-node-id')));
  // Source = second row: in the product's cramped tree the top rows sit clear
  // of the bottom-sticky bulk bar, so their centers are touchable directly.
  const sourceRow = rows.nth(1);
  // The import leaves every root selected. Dragging then carries the whole
  // selection, and every row is a (correctly) cycle-invalid target. Select the
  // source alone first — the same setup the mouse drag suites use — so the
  // gesture moves one layer onto valid destinations.
  await sourceRow.click();
  await expect(sourceRow).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => tree.locator('[aria-selected="true"]').count()).toBe(1);
  const source = await clearRowHitTarget(page, tree, sourceRow);
  await expect(sourceRow).toBeInViewport();
  const target = await rows.nth(0).boundingBox();
  if (!source || !target) throw new Error('Layer rows have no geometry');
  const targetHit = await page.evaluate(
    ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[role="treeitem"]'),
    { x: target.x + target.width / 2, y: target.y + 2 },
  );
  expect(targetHit, 'target point must resolve into a row').toBe(true);
  const session = await page.context().newCDPSession(page);
  const x = source.x + source.width / 2;
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: source.y + source.height / 2 }],
  });
  // Waiting here is the interaction itself: the configured hold is 250ms.
  await page.waitForTimeout(350);
  await expect(page.locator('.drag-overlay')).toBeVisible();
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: target.y + 2 }],
  });
  await expect(page.locator('.layers-row--drop-before [data-node-id]')).toHaveAttribute(
    'data-node-id',
    before[0]!,
  );
  await tree.screenshot({ path: info.outputPath('touch-reorder-preview.png') });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(rows.first()).toHaveAttribute('data-node-id', before[1]!);
  await rows.first().focus();
  await page.keyboard.press('Control+z');
  await expect
    .poll(() => rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-node-id'))))
    .toEqual(before);
});

test('cancelling a touch drag leaves artwork order and input ownership intact', async ({
  page,
}) => {
  const tree = await prepare(page, 5);
  const rows = tree.locator('[role="treeitem"]');
  const before = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-node-id')));
  const sourceRow = rows.nth(1);
  const source = await clearRowHitTarget(page, tree, sourceRow);
  await expect(sourceRow).toBeInViewport();
  const session = await page.context().newCDPSession(page);
  const point = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(350);
  await expect(page.locator('.drag-overlay')).toBeVisible();
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(page.locator('.drag-overlay')).toBeHidden();
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-node-id')))).toEqual(
    before,
  );
  // A nested visibility control must not become a fresh row drag, even held.
  const firstRow = rows.first();
  await expect(firstRow).toBeInViewport();
  const control = firstRow.getByRole('button', { name: /^Hide / });
  const box = await control.boundingBox();
  if (!box) throw new Error('Visibility control has no geometry');
  const controlHit = await page.evaluate(
    ({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit?.closest('[role="treeitem"]');
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(controlHit, 'control point must resolve into a row').toBe(true);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  await page.waitForTimeout(350);
  await expect(page.locator('.drag-overlay')).toBeHidden();
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(rows.first()).toHaveClass(/layers-row--hidden/);
});

/**
 * Raster strokes, undo/redo and branch switches through the real editor.
 *
 * Covers the paths changed by the stroke-draft, history-capture and tile-
 * identity work (ADR-0241): a stroke batch is built from one tile draft, a
 * committed stroke is captured by persistent history, and the retained raster
 * surface and partial-redraw region must show the document that is current,
 * not the one shown before.
 *
 * The oracle is revisit equality: the content canvas for a given document
 * state must render the same pixels every time that state is shown, and a
 * different state must not render identically. It does not depend on tile
 * alignment, so it holds wherever the strokes land.
 *
 * Synchronisation. Persistent history records a stroke asynchronously, and
 * Ctrl+Z routes to the in-memory stack when the session has not yet recorded
 * the stroke, so a stable canvas does not mean the step exists. Every stroke
 * therefore waits for the History panel's step count to grow and settle before
 * the next undo, redo or branch switch. The Steps list is the lineage up to the
 * current head, so an undo shortens it by one and a redo restores it; any other
 * count, or a disabled Redo button after an undo, means a stray capture of the
 * restored document was appended and the redo path was discarded.
 */
import { expect, type Page, test } from '@playwright/test';
import { openSubmenu } from '../helpers/menu-helpers';
import { dragOnCanvas, navigateToEditor } from '../shared';

const CONTENT = 'canvas.editor-canvas__content-layer';

/** A screenshot that has stopped changing (refinement and worker frames done). */
async function settledShot(page: Page): Promise<Buffer> {
  const canvas = page.locator(CONTENT);
  let previous = await canvas.screenshot();
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.waitForTimeout(250);
    const next = await canvas.screenshot();
    if (Buffer.compare(previous, next) === 0) return next;
    previous = next;
  }
  return previous;
}

const same = (a: Buffer, b: Buffer) => Buffer.compare(a, b) === 0;

const STEP = '.history-panel__step';

async function openStepsTab(page: Page) {
  const tab = page.getByRole('tab', { name: 'Steps' });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await page.locator(STEP).first().waitFor({ timeout: 30000 });
}

async function stepCount(page: Page): Promise<number> {
  await openStepsTab(page);
  return page.locator(STEP).count();
}

/**
 * Resolve with the step count once history has recorded at least `atLeast`
 * steps and the count has stopped changing, so the next navigation cannot race
 * a capture that is still in flight.
 */
async function waitForHistoryRecorded(page: Page, atLeast: number): Promise<number> {
  await expect
    .poll(() => stepCount(page), {
      timeout: 60_000,
      message: `history never recorded ${atLeast} steps`,
    })
    .toBeGreaterThanOrEqual(atLeast);
  let last = await stepCount(page);
  let stableSince = Date.now();
  while (Date.now() - stableSince < 700) {
    await page.waitForTimeout(60);
    const now = await stepCount(page);
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    }
  }
  return last;
}

/** Paint one stroke and wait until history has recorded it. Returns the new step count. */
async function strokeAndRecord(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<number> {
  const before = await stepCount(page);
  await dragOnCanvas(page, from[0], from[1], to[0], to[1]);
  return waitForHistoryRecorded(page, before + 1);
}

async function openHistoryPanel(page: Page) {
  const panels = await openSubmenu(page, 'View', 'Panels');
  await panels.getByRole('menuitem', { name: /History Panel/ }).click();
  await page.locator('.editor__history-panel').waitFor({ timeout: 15000 });
}

async function switchTo(page: Page, branch: string) {
  await page.getByRole('tab', { name: 'Branches' }).click();
  await page
    .locator('.history-panel__branch')
    .filter({ hasText: branch })
    .getByRole('button', { name: 'Switch', exact: true })
    .click();
  await expect(page.locator('.history-panel__branch--current')).toContainText(branch);
  await page.waitForTimeout(400);
}

test.describe('raster strokes with undo, redo and branches', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  test('undo and redo restore exact pixels across several strokes', async ({ page }) => {
    await navigateToEditor(page);
    await page.keyboard.press('b');
    await page.waitForTimeout(250);
    // The open History panel narrows the canvas (~489 px wide): keep strokes
    // well inside it.
    await openHistoryPanel(page);
    const blank = await settledShot(page);

    await strokeAndRecord(page, [220, 260], [330, 260]);
    const afterFirst = await settledShot(page);
    expect(same(blank, afterFirst)).toBe(false);

    const recorded = await strokeAndRecord(page, [220, 330], [330, 330]);
    const afterSecond = await settledShot(page);
    expect(same(afterFirst, afterSecond)).toBe(false);

    const redoButton = page.getByRole('button', { name: /^Redo/ });

    await page.keyboard.press('Control+z');
    expect(same(await settledShot(page), afterFirst)).toBe(true);
    expect(await stepCount(page), 'undo moves the head back one step').toBe(recorded - 1);
    await expect(redoButton, 'undo must leave redo available').toBeEnabled();

    await page.keyboard.press('Control+z');
    const undoneAll = await settledShot(page);
    expect(same(undoneAll, afterFirst)).toBe(false);
    expect(same(undoneAll, blank)).toBe(true);
    expect(await stepCount(page), 'second undo moves the head back again').toBe(recorded - 2);
    await expect(redoButton, 'second undo must leave redo available').toBeEnabled();

    await page.keyboard.press('Control+Shift+z');
    expect(same(await settledShot(page), afterFirst)).toBe(true);
    expect(await stepCount(page), 'redo moves the head forward one step').toBe(recorded - 1);

    await page.keyboard.press('Control+Shift+z');
    expect(same(await settledShot(page), afterSecond)).toBe(true);
    expect(await stepCount(page), 'second redo returns to the recorded head').toBe(recorded);
  });

  test('a different stroke after undo does not resurrect the undone one', async ({ page }) => {
    await navigateToEditor(page);
    await page.keyboard.press('b');
    await page.waitForTimeout(250);
    await openHistoryPanel(page);

    await strokeAndRecord(page, [220, 260], [330, 260]);
    const base = await settledShot(page);

    const recorded = await strokeAndRecord(page, [220, 340], [330, 340]);
    const withFirst = await settledShot(page);

    await page.keyboard.press('Control+z');
    expect(same(await settledShot(page), base)).toBe(true);
    expect(await stepCount(page), 'undo moves the head back one step').toBe(recorded - 1);
    await expect(
      page.getByRole('button', { name: /^Redo/ }),
      'undo must leave redo available',
    ).toBeEnabled();

    // Same length and tool, different geometry. If this stroke lands on a tile
    // the undone one also touched, that tile's version counter repeats with
    // different pixels, which a retained surface keyed on the version alone
    // would show stale. Tile placement is not asserted here, so this is a
    // behaviour check, not a proof that the aliasing case was exercised; the
    // unit regressions in rasterSurfaceIdentity.integration.test.ts are.
    await strokeAndRecord(page, [250, 420], [360, 420]);
    const withSecond = await settledShot(page);
    expect(same(withSecond, withFirst)).toBe(false);
    expect(same(withSecond, base)).toBe(false);

    await page.keyboard.press('Control+z');
    expect(same(await settledShot(page), base)).toBe(true);
    await page.keyboard.press('Control+Shift+z');
    expect(same(await settledShot(page), withSecond)).toBe(true);
  });

  test('switching branches re-renders each branch exactly on revisit', async ({ page }) => {
    await navigateToEditor(page);
    await page.keyboard.press('b');
    await page.waitForTimeout(250);
    await openHistoryPanel(page);

    // Shared ancestor stroke, then branch from it.
    await strokeAndRecord(page, [220, 260], [330, 260]);
    await settledShot(page);
    await page.locator('.history-panel__content button:has-text("+ Branch")').first().click();
    await page.locator('.history-panel__form-input').fill('alt');
    await page.locator('.history-panel__form-actions button:has-text("Create")').click();
    await page.getByRole('tab', { name: 'Branches' }).click();
    await expect(page.locator('.history-panel__branch--current')).toContainText('main');

    const ancestor = await settledShot(page);

    // main paints one more stroke.
    await strokeAndRecord(page, [220, 340], [330, 340]);
    const mainState = await settledShot(page);
    expect(same(mainState, ancestor)).toBe(false);

    // alt paints a same-length stroke elsewhere.
    await switchTo(page, 'alt');
    expect(same(await settledShot(page), ancestor)).toBe(true);
    await strokeAndRecord(page, [250, 420], [360, 420]);
    const altState = await settledShot(page);
    expect(same(altState, ancestor)).toBe(false);
    expect(same(altState, mainState)).toBe(false);

    // Revisits must be exact and must not bleed one branch into the other.
    await switchTo(page, 'main');
    expect(same(await settledShot(page), mainState)).toBe(true);
    await switchTo(page, 'alt');
    expect(same(await settledShot(page), altState)).toBe(true);
    await switchTo(page, 'main');
    expect(same(await settledShot(page), mainState)).toBe(true);
  });
});

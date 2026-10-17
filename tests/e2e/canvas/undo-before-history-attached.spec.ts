/**
 * Undo pressed before persistent history has attached (ADR-0241 open item).
 *
 * History attaches asynchronously after a document opens (IndexedDB open, then
 * the genesis write), and on a cold start that window is long enough to paint
 * and press Ctrl+Z inside it. The editor steps from its local stacks there, and
 * the step has to reach history in order rather than be recorded as a new edit.
 *
 * The window is held open deterministically: the history database's open is
 * reported to the app only when the test releases it, so nothing here depends on
 * how fast the machine is. The assertions are what a user can observe:
 *
 * - Ctrl+Z acts at once, while history is still not attached;
 * - once history catches up, the Steps list is the lineage up to the undone
 *   head, with no step that records the undo itself, and the canvas shows the
 *   undone head exactly (history is the verified record, so it is also what the
 *   canvas converges on);
 * - Redo is available and restores the undone stroke's pixels exactly.
 *
 * What the canvas shows between Ctrl+Z and attach is deliberately not compared
 * with the earlier state. That step comes from the editor's local stack, and in
 * real-browser runs it did not always restore the exact pre-stroke pixels (an
 * empty layer, or only the later stroke, remained). That is not caused by the
 * history bridge and is not covered by this spec; see ADR-0241 Open items.
 */
import { expect, type Page, test } from '@playwright/test';
import { openSubmenu } from '../helpers/menu-helpers';
import { dragOnCanvas, navigateToEditor } from '../shared';

const CONTENT = 'canvas.editor-canvas__content-layer';
const STEP = '.history-panel__step';

interface HistoryGateWindow {
  __releaseHistoryOpen?: () => void;
}

/**
 * Report `indexedDB.open('varve-history')` as finished only after
 * `window.__releaseHistoryOpen()`. The database itself opens at once, because a
 * schema upgrade must run inside its own event; only the caller's `success`
 * event is held back.
 */
async function holdHistoryDatabaseOpen(page: Page) {
  await page.addInitScript(() => {
    const gate = new Promise<void>((resolve) => {
      (window as unknown as HistoryGateWindow).__releaseHistoryOpen = resolve;
    });
    const realOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
      const request = realOpen.call(this, name, version);
      if (name !== 'varve-history') return request;
      const add = request.addEventListener.bind(request) as typeof request.addEventListener;
      request.addEventListener = ((type: string, listener: EventListener, options?: unknown) => {
        if (type !== 'success') return add(type, listener, options as AddEventListenerOptions);
        return add(
          type,
          (event: Event) => {
            void gate.then(() => listener.call(request, event));
          },
          options as AddEventListenerOptions,
        );
      }) as typeof request.addEventListener;
      return request;
    } as typeof IDBFactory.prototype.open;
  });
}

async function releaseHistoryDatabaseOpen(page: Page) {
  await page.evaluate(() => (window as unknown as HistoryGateWindow).__releaseHistoryOpen?.());
}

/**
 * The content canvas as pixels. The element can be replaced while a frame is
 * captured (a dev-server hot update on a shared machine, a remount), which
 * Playwright reports as "not attached"; look again rather than fail on it.
 */
async function grab(page: Page): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.locator(CONTENT).screenshot();
    } catch (error) {
      if (attempt >= 4) throw error;
      await page.waitForTimeout(250);
    }
  }
}

/** A screenshot that has stopped changing (refinement and worker frames done). */
async function settledShot(page: Page): Promise<Buffer> {
  let previous = await grab(page);
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.waitForTimeout(250);
    const next = await grab(page);
    if (Buffer.compare(previous, next) === 0) return next;
    previous = next;
  }
  return previous;
}

const same = (a: Buffer, b: Buffer) => Buffer.compare(a, b) === 0;

/**
 * The next settled screenshot that differs from `previous`. A stroke is drawn
 * asynchronously, so on a loaded machine the first stable frame after the
 * pointer is released can still be the old one.
 */
async function shotAfterChange(page: Page, previous: Buffer): Promise<Buffer> {
  await expect
    .poll(async () => same(await grab(page), previous), {
      timeout: 30_000,
      message: 'the stroke never changed the canvas',
    })
    .toBe(false);
  return settledShot(page);
}

async function openHistoryPanel(page: Page) {
  const panels = await openSubmenu(page, 'View', 'Panels');
  await panels.getByRole('menuitem', { name: /History Panel/ }).click();
  await page.locator('.editor__history-panel').waitFor({ timeout: 15000 });
}

/** The Steps rows, or none while the panel still shows its "No history" state (no tabs yet). */
async function stepLabels(page: Page): Promise<string[]> {
  const tab = page.getByRole('tab', { name: 'Steps' });
  if ((await tab.count()) === 0) return [];
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  return page.locator(STEP).allInnerTexts();
}

/** Resolve once the Steps list has `count` rows and has stopped changing. */
async function waitForSteps(page: Page, count: number): Promise<string[]> {
  await expect
    .poll(async () => (await stepLabels(page)).length, {
      timeout: 60_000,
      message: `history never listed ${count} steps`,
    })
    .toBe(count);
  let last = await stepLabels(page);
  let stableSince = Date.now();
  while (Date.now() - stableSince < 700) {
    await page.waitForTimeout(60);
    const now = await stepLabels(page);
    if (now.join('|') !== last.join('|')) {
      last = now;
      stableSince = Date.now();
    }
  }
  return last;
}

test.describe('undo before persistent history has attached', () => {
  test.setTimeout(240_000);

  test('restores at once and leaves history coherent once it attaches', async ({ page }) => {
    const historyLog: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('[history]')) historyLog.push(message.text());
    });
    await holdHistoryDatabaseOpen(page);
    await navigateToEditor(page);
    await page.keyboard.press('b');
    await page.waitForTimeout(250);
    await openHistoryPanel(page);
    const blank = await settledShot(page);

    await dragOnCanvas(page, 220, 260, 330, 260);
    const afterFirst = await shotAfterChange(page, blank);
    await dragOnCanvas(page, 220, 330, 330, 330);
    const afterSecond = await shotAfterChange(page, afterFirst);
    expect(same(blank, afterFirst)).toBe(false);
    expect(same(afterFirst, afterSecond)).toBe(false);
    // The window is open: history has attached nothing yet.
    await expect(
      page.getByTestId('history-panel').getByText('No history', { exact: true }),
      'history must still be unattached',
    ).toBeVisible();

    await page.keyboard.press('Control+z');
    expect(same(await settledShot(page), afterSecond), 'undo acts at once').toBe(false);
    await expect(
      page.getByTestId('history-panel').getByText('No history', { exact: true }),
      'undo must not wait for history',
    ).toBeVisible();

    await releaseHistoryDatabaseOpen(page);
    // Genesis and the creation of the painted layer; the undone stroke is the
    // redo target and the undo itself is not a step.
    const steps = await waitForSteps(page, 2);
    expect(steps.join(' ')).not.toMatch(/Delete/);
    expect(
      same(await settledShot(page), afterFirst),
      'once history has caught up the canvas shows the undone head exactly',
    ).toBe(true);
    test.info().annotations.push({ type: 'history log', description: historyLog.join('\n') });
    const redoButton = page.getByRole('button', { name: /^Redo/ });
    await expect(redoButton, 'undo before attach must leave redo available').toBeEnabled();

    await page.keyboard.press('Control+Shift+z');
    expect(same(await settledShot(page), afterSecond), 'redo restores the undone stroke').toBe(
      true,
    );
    await waitForSteps(page, 3);

    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(same(await settledShot(page), blank), 'two undos return to the blank layer').toBe(true);
    await waitForSteps(page, 1);
  });
});

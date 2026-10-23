/**
 * Layers search and filter (F-48, 2026-10-23).
 *
 * The search field was a passive text box: no keyboard route from it into the
 * results, no way to step through matches, Escape did nothing useful, and the
 * filter options opened as a 504px chip wall that pushed the tree it filters
 * off the rail. These tests drive the replacement with real input:
 *
 * - Ctrl/Cmd+F from inside the panel finds a layer,
 * - Enter / Shift+Enter step through matches like find-in-page, keeping focus
 *   in the field, and ArrowDown moves into the results,
 * - Escape clears the text first and leaves the field second,
 * - "Select matches" and stepping act on matches, never on the ancestors the
 *   tree shows as context,
 * - filter options are one menu that floats over the tree, and every active
 *   constraint is a removable token,
 * - typing stays responsive on a ~320-layer document.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const CARDS = 40;

/** 40 cards x (group + 7 named children) = 320 layers, with real nesting. */
function cardsSvg(): string {
  let body = '';
  for (let i = 0; i < CARDS; i++) {
    const x = (i % 8) * 100;
    const y = Math.floor(i / 8) * 120;
    const n = i + 1;
    body += `<g id="card-${n}" data-name="Card ${n}">
      <rect id="card-${n}-bg" data-name="Card ${n} background" x="${x}" y="${y}" width="90" height="110" fill="#eee"/>
      <rect id="card-${n}-image" data-name="Card ${n} image" x="${x + 5}" y="${y + 5}" width="80" height="40" fill="#8ab"/>
      <rect id="card-${n}-title" data-name="Card ${n} title" x="${x + 5}" y="${y + 50}" width="80" height="10" fill="#333"/>
      <rect id="card-${n}-copy" data-name="Card ${n} copy" x="${x + 5}" y="${y + 64}" width="80" height="16" fill="#999"/>
      <rect id="card-${n}-badge" data-name="Card ${n} badge" x="${x + 60}" y="${y + 8}" width="20" height="8" fill="#c63"/>
      <rect id="card-${n}-divider" data-name="Card ${n} divider" x="${x + 5}" y="${y + 84}" width="80" height="1" fill="#ccc"/>
      <rect id="card-${n}-cta" data-name="Card ${n} button" x="${x + 5}" y="${y + 90}" width="50" height="14" fill="#2a7"/>
    </g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">${body}</svg>`;
}

async function layerCount(page: Page): Promise<number> {
  const text = await page.locator('.layers-panel__count').textContent();
  return Number.parseInt(text ?? '0', 10);
}

async function openCardsDocument(page: Page) {
  await navigateToEditor(page);
  await page.locator('#file-import-input').setInputFiles({
    name: 'cards.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(cardsSvg()),
  });
  await expect.poll(() => layerCount(page), { timeout: 120_000 }).toBeGreaterThanOrEqual(320);
  await page.waitForTimeout(250);
}

const searchField = (page: Page) => page.getByRole('searchbox', { name: 'Filter layers by name' });

async function selectedRowNames(page: Page): Promise<string[]> {
  return page
    .locator('.layers-panel__tree [role="treeitem"][aria-selected="true"] .layers-row__name')
    .allTextContents();
}

test.describe('Layers search and filter', () => {
  test.describe.configure({ timeout: 240_000 });

  test('finds with Ctrl+F, steps matches with Enter, and leaves with Escape', async ({ page }) => {
    await openCardsDocument(page);

    // Ctrl+F from a row in the panel moves to the search and selects its text.
    await page.getByRole('treeitem').first().click();
    await page.keyboard.press('Control+f');
    await expect(searchField(page)).toBeFocused();

    await page.keyboard.type('button');
    await expect(page.locator('.layers-filter-bar__count')).toContainText(`${CARDS} of`);

    // Rows run top of the stack first, so the last imported card leads.
    // Enter selects the first match, then the next; focus never leaves the field.
    await page.keyboard.press('Enter');
    await expect.poll(() => selectedRowNames(page)).toEqual([`Card ${CARDS} button`]);
    await page.keyboard.press('Enter');
    await expect.poll(() => selectedRowNames(page)).toEqual([`Card ${CARDS - 1} button`]);
    await page.keyboard.press('Shift+Enter');
    await expect.poll(() => selectedRowNames(page)).toEqual([`Card ${CARDS} button`]);
    // Back from the first match wraps to the last, like find-in-page.
    await page.keyboard.press('Shift+Enter');
    await expect.poll(() => selectedRowNames(page)).toEqual(['Card 1 button']);
    await expect(searchField(page)).toBeFocused();

    // The buttons do the same for pointer users; forward from the last wraps.
    await page.getByRole('button', { name: 'Next match' }).click();
    await expect.poll(() => selectedRowNames(page)).toEqual([`Card ${CARDS} button`]);

    // ArrowDown moves into the results at the first match.
    await searchField(page).focus();
    await page.keyboard.press('ArrowDown');
    const focused = page.locator('[role="treeitem"]:focus');
    await expect(focused).toHaveCount(1);
    await expect(focused.locator('.layers-row__name')).toHaveText(`Card ${CARDS} button`);

    // Escape clears the text (focus stays), then leaves for the tree.
    await searchField(page).focus();
    await page.keyboard.press('Escape');
    await expect(searchField(page)).toHaveValue('');
    await expect(searchField(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="treeitem"]:focus')).toHaveCount(1);
  });

  test('Select matches takes the matches, not the ancestors shown as context', async ({ page }) => {
    await openCardsDocument(page);
    await searchField(page).fill('Card 40 button');

    // The tree shows the match under its card, for context.
    const rows = page.locator('.layers-panel__tree [role="treeitem"] .layers-row__name');
    await expect(rows).toHaveText(['Card 40', 'Card 40 button']);
    await expect(page.locator('.layers-filter-bar__count')).toContainText('1 of');

    await page.getByRole('button', { name: 'Select matches' }).click();
    await expect.poll(() => selectedRowNames(page)).toEqual(['Card 40 button']);

    // The count follows the tree's matching rule (word prefixes): a mid-word
    // fragment shows no rows and must not count hundreds of matches (F-51).
    await searchField(page).fill('ard');
    await expect(rows).toHaveCount(0);
    await expect(page.locator('.layers-filter-bar__count')).toContainText('0 of');
  });

  test('filter options are one floating menu and active filters are removable tokens', async ({
    page,
  }) => {
    await openCardsDocument(page);
    const firstRow = page.getByRole('treeitem').first();
    const rowTop = async () => (await firstRow.boundingBox())?.y ?? Number.NaN;
    const before = await rowTop();

    const trigger = page.getByRole('button', { name: 'Filter options' });
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Filter layers' });
    await expect(menu).toBeVisible();
    // The menu floats over the tree instead of pushing it down the rail.
    expect(await rowTop()).toBe(before);

    await menu.getByRole('menuitem', { name: /^Type/ }).click();
    // The SVG importer turns each <g> card into a frame.
    await page.getByRole('menuitemcheckbox', { name: 'Frame', exact: true }).click();
    // Checkable items keep the menu open for further choices.
    await expect(page.getByRole('menuitemcheckbox', { name: 'Frame', exact: true })).toBeChecked();
    for (let i = 0; i < 2 && (await menu.isVisible()); i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(50);
    }
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await expect(page.getByRole('button', { name: 'Filter options, 1 active' })).toBeVisible();
    const token = page.getByRole('button', { name: 'Remove filter: Frame' });
    await expect(token).toBeVisible();
    const box = await token.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
    await expect(page.locator('.layers-filter-bar__count')).toContainText(`${CARDS} of`);

    await token.click();
    await expect(token).toBeHidden();
    await expect(page.getByRole('button', { name: 'Filter options' })).toBeVisible();
    // Removing the last token hands focus back to the search field.
    await expect(searchField(page)).toBeFocused();
  });

  test('typing in the search stays responsive at ~320 layers', async ({ page }) => {
    await openCardsDocument(page);
    await searchField(page).focus();

    // Keystroke-to-next-frame time for each prefix of a typical query, measured
    // in the page so the harness round-trip is not counted.
    const samples = await page.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Filter layers by name"]',
      );
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!input || !setValue) throw new Error('search field not found');
      const times: number[] = [];
      for (const query of [
        'c',
        'ca',
        'car',
        'card',
        'card 1',
        'card 1 ',
        'card 1 b',
        'card 1 bu',
      ]) {
        const start = performance.now();
        setValue.call(input, query);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        times.push(Math.round(performance.now() - start));
      }
      return times;
    });
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
    console.log(`LAYER_SEARCH_LATENCY_MS ${JSON.stringify({ samples, median })}`);
    expect(median).toBeLessThan(100);
  });
});

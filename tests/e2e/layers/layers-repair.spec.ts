import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
<g id="toolbar" data-name="Toolbar">
<rect id="primary" data-name="Primary Large Button" x="20" y="20" width="140" height="40" fill="#16857c"/>
<rect id="secondary" data-name="Secondary Button" x="180" y="20" width="140" height="40" fill="#a4c9c3"/>
</g>
<rect id="cjk" data-name="设计按钮" x="20" y="100" width="140" height="40" fill="#cfa36d"/>
<rect id="arabic" data-name="زر رئيسي" x="180" y="100" width="140" height="40" fill="#7989c5"/>
</svg>`;

function row(page: Page, name: string) {
  return page.locator('.layers-panel__tree [role="treeitem"]').filter({
    has: page.locator('.layers-row__name', { hasText: name }),
  });
}

/**
 * The import's post-commit flow can publish two modal overlays: Import
 * Results (fidelity changes/warnings) and Missing Fonts (families absent on
 * this device). Either backdrop intercepts every pointer event behind it, and
 * closing one can reveal the other, so both are dismissed in order and then
 * re-checked. Simple SVGs may publish neither; the waits are conditional.
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

async function prepare(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await navigateToEditor(page);
  await page.locator('#file-import-input').setInputFiles({
    name: 'layers-workflow.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg),
  });
  await expect(row(page, 'Primary Large Button')).toBeVisible();
  await dismissImportOverlays(page, 5000);
}

test('nested multilingual results select only matches and stay actionable', async ({
  page,
}, info) => {
  await prepare(page);
  const search = page.getByRole('searchbox', { name: 'Filter layers by name' });
  await search.fill('primary button');
  await expect(row(page, 'Primary Large Button')).toBeVisible();
  await expect(row(page, 'Toolbar')).toBeVisible();
  await expect(page.locator('.layers-filter-bar__count')).toContainText('1 of 5 layers');
  await page.getByRole('button', { name: 'Select matches', exact: true }).click();
  await expect(row(page, 'Primary Large Button')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'Toolbar')).toHaveAttribute('aria-selected', 'false');

  await search.fill('button');
  await page.getByRole('button', { name: 'Select matches', exact: true }).click();
  await expect(page.locator('.layers-panel__tree [aria-selected="true"]')).toHaveCount(2);
  await expect(page.locator('.layers-bulk-bar')).toBeVisible();
  await page.getByTestId('layers-panel').screenshot({ path: info.outputPath('filtered-bulk.png') });

  for (const query of ['按钮', 'رئيسي']) {
    await search.fill(query);
    await expect(page.locator('.layers-filter-bar__count')).toContainText('1 of 5 layers');
    await page.getByRole('button', { name: 'Select matches', exact: true }).click();
    await expect(page.locator('.layers-panel__tree [aria-selected="true"]')).toHaveCount(1);
  }
});

test('rename cycling, filter refresh and blur keep focus with the user', async ({ page }) => {
  await prepare(page);
  const primary = row(page, 'Primary Large Button');
  const id = await primary.getAttribute('data-node-id');
  const group = row(page, 'Toolbar');
  const expansion = await group.getAttribute('aria-expanded');

  // The row starts below the short tree's fold, and the import leaves the
  // three top-level roots selected. Select first: that scrolls the row into
  // view and lets the selection-driven layout settle, so both clicks of the
  // dblclick land on one stable box. Without the settle, the layout can shift
  // mid-gesture and the second click lands one row off (reproduced identically
  // on the pre-repair baseline; recorded in
  // docs/audits/layers-repair-2026-10-23.md).
  await primary.click();
  await expect(primary).toHaveAttribute('aria-selected', 'true');
  await expect(primary.locator('.layers-row__name')).toBeInViewport();
  await primary.locator('.layers-row__name').dblclick();

  await expect(group).toHaveAttribute('aria-expanded', expansion!);
  // Scope by node id: while editing, the row renders the input INSTEAD of the
  // `.layers-row__name` span, so a name-based row filter no longer matches its
  // own row. Strict: the rename editor must be inside the double-clicked row.
  const edit = page
    .locator(`[data-node-id="${id}"]`)
    .getByRole('textbox', { name: 'Rename Primary Large Button' });
  await expect(edit).toBeVisible();
  await edit.fill('Renamed Primary');
  await edit.press('Tab');
  await expect(page.locator('.layers-row__name-input')).toBeFocused();
  await expect(page.locator('.layers-row__name-input')).toHaveCount(1);
  await page.locator('.layers-row__name-input').press('Shift+Tab');
  await expect(page.locator(`[data-node-id="${id}"] .layers-row__name-input`)).toBeFocused();
  const search = page.getByRole('searchbox', { name: 'Filter layers by name' });
  await search.click();
  await expect(search).toBeFocused();
  await expect(page.locator('.layers-row__name-input')).toHaveCount(0);
  await search.fill('renamed primary');
  await expect(page.locator('.layers-filter-bar__count')).toContainText('1 of 5 layers');
  await expect(row(page, 'Renamed Primary')).toBeVisible();
});

test('one visibility gesture on a filtered selection has one undo step', async ({ page }) => {
  await prepare(page);
  const search = page.getByRole('searchbox', { name: 'Filter layers by name' });
  await search.fill('button');
  await page.getByRole('button', { name: 'Select matches', exact: true }).click();
  await row(page, 'Primary Large Button')
    .getByRole('button', { name: 'Hide Primary Large Button', exact: true })
    .click();
  await expect(row(page, 'Primary Large Button')).toHaveClass(/layers-row--hidden/);
  await expect(row(page, 'Secondary Button')).toHaveClass(/layers-row--hidden/);
  await row(page, 'Primary Large Button').focus();
  await page.keyboard.press('Control+z');
  await expect(row(page, 'Primary Large Button')).not.toHaveClass(/layers-row--hidden/);
  await expect(row(page, 'Secondary Button')).not.toHaveClass(/layers-row--hidden/);
  await page.keyboard.press('Control+Shift+z');
  await expect(row(page, 'Primary Large Button')).toHaveClass(/layers-row--hidden/);
  await expect(row(page, 'Secondary Button')).toHaveClass(/layers-row--hidden/);
});

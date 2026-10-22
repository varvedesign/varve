/**
 * E2E: a PDF set in a vertical writing mode must import as a column.
 *
 * `Identity-V` (or a CMap with `/WMode 1`) advances glyphs down the page. The
 * importer used to lay every run out horizontally, so a Japanese or Chinese
 * column arrived as one long line — the wrong document, not a fidelity loss,
 * because every character still existed.
 *
 * The assertion is on the rendered result rather than on a field: the ink of a
 * three-character column must be taller than it is wide. A horizontal run of
 * the same text is wider than it is tall, so the check discriminates.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * A Type0 font with `Identity-V` and a `/ToUnicode` map for three codes.
 * Object numbers: 1 catalog, 2 page tree, 3 page, 4 content, 5 font,
 * 6 font resource name is in the page's `/Resources`, 7 descendant, 8 CMap.
 */
function verticalPdf(content = 'BT /F1 24 Tf 300 700 Td <000300040005> Tj ET'): Buffer {
  const cmapLines = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...['A', 'B', 'C', 'D', 'E', 'F'].flatMap((letter, offset) => [
      '1 beginbfchar',
      `<000${offset + 3}> <00${(letter.codePointAt(0) ?? 0).toString(16).toUpperCase()}>`,
      'endbfchar',
    ]),
    'endcmap',
    'end',
  ];
  const cmap = cmapLines.join('\n');
  const parts = [
    '%PDF-1.7\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /Noto /Encoding /Identity-V /DescendantFonts [7 0 R] /ToUnicode 8 0 R >>\nendobj\n',
    '7 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Noto /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>\nendobj\n',
    `8 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream\nendobj\n`,
  ];
  return Buffer.from(parts.join(''), 'latin1');
}

/**
 * Bounding box of the *dark* painted pixels. The artboard and the canvas
 * chrome paint light pixels; the imported text is near-black, so filtering by
 * luminance isolates the glyphs from the page background.
 */
async function inkBox(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement | null;
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        if ((data[offset + 3] ?? 0) < 128) continue;
        const luminance =
          (data[offset] ?? 0) * 0.2126 +
          (data[offset + 1] ?? 0) * 0.7152 +
          (data[offset + 2] ?? 0) * 0.0722;
        if (luminance > 128) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    return { width: maxX - minX + 1, height: maxY - minY + 1 };
  });
}

test('a vertical-writing PDF imports as a column, not a line', async ({ page }) => {
  await navigateToEditor(page);

  const directory = mkdtempSync(join(tmpdir(), 'varve-vertical-'));
  const source = join(directory, 'vertical.pdf');
  writeFileSync(source, verticalPdf());

  await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /import/i }).click();
  await page.locator('#file-import-input').setInputFiles(source);

  const dialog = page.getByRole('dialog', { name: /import results/i });
  await dialog.waitFor({ state: 'visible', timeout: 30000 });
  await dialog.getByRole('button', { name: /^close$/i }).click();

  await expect(page.locator('.layers-panel').locator('[role="treeitem"]')).toHaveCount(1, {
    timeout: 15000,
  });

  await expect
    .poll(
      async () => {
        const box = await inkBox(page);
        if (!box) return 'no ink';
        return box.height > box.width * 1.5 ? 'column' : `line ${box.width}x${box.height}`;
      },
      { timeout: 15000 },
    )
    .toBe('column');

  const shotDir = process.env.VARVE_SHOT_DIR ?? join(tmpdir(), 'varve-vertical-shots');
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({
    path: join(shotDir, 'vertical-import.png'),
    clip: { x: 0, y: 0, width: 1280, height: 800 },
  });
});

test('one-glyph-per-Tj placement becomes one column per column, not one layer per glyph', async ({
  page,
}) => {
  await navigateToEditor(page);

  const directory = mkdtempSync(join(tmpdir(), 'varve-vertical-columns-'));
  const source = join(directory, 'vertical-columns.pdf');
  // First column: one Tj with six glyphs. Second column: six separate Tj
  // operators, which is how many producers position upright glyphs.
  writeFileSync(
    source,
    verticalPdf(
      [
        'BT /F1 20 Tf 500 700 Td <000300040005000600070008> Tj ET',
        'BT /F1 20 Tf 460 700 Td <0003> Tj <0004> Tj <0005> Tj <0006> Tj <0007> Tj <0008> Tj ET',
      ].join('\n'),
    ),
  );

  await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /import/i }).click();
  await page.locator('#file-import-input').setInputFiles(source);

  const dialog = page.getByRole('dialog', { name: /import results/i });
  await dialog.waitFor({ state: 'visible', timeout: 30000 });
  await dialog.getByRole('button', { name: /^show details \(/i }).click();
  await expect(
    dialog.getByText(/7 vertical text run\(s\) were imported as 2 vertical column\(s\)/),
  ).toBeVisible({ timeout: 10000 });
  const shotDir = process.env.VARVE_SHOT_DIR;
  if (shotDir) {
    mkdirSync(shotDir, { recursive: true });
    await page.screenshot({
      path: join(shotDir, 'import-vertical-writing-results.png'),
      fullPage: true,
    });
  }
  await dialog.getByRole('button', { name: /^close$/i }).click();

  const layers = page.locator('.layers-panel');
  await expect(layers.locator('[role="treeitem"]')).toHaveCount(2, { timeout: 15000 });
  await expect(layers.getByText(/^Vertical text \(Noto\)$/)).toHaveCount(2);

  // Each column is independently selectable and reports the editable property.
  await layers
    .getByRole('treeitem', { name: /Vertical text \(Noto\)/ })
    .first()
    .click();
  const advanced = page.getByRole('button', { name: 'Advanced typography', exact: true });
  await advanced.scrollIntoViewIfNeeded();
  if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();
  await expect(page.getByRole('combobox', { name: 'Writing mode (not rotation)' })).toHaveText(
    'Vertical, right to left',
    { timeout: 5000 },
  );
  if (shotDir) {
    await page
      .locator('canvas.editor-canvas__content-layer')
      .screenshot({ path: join(shotDir, 'import-vertical-writing-canvas.png') });
    await page.screenshot({
      path: join(shotDir, 'import-vertical-writing-editor.png'),
      fullPage: true,
    });
  }
});

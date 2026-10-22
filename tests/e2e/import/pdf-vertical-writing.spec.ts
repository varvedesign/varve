/**
 * E2E: vertical-writing PDF text arrives as vertical columns.
 *
 * A vertical CMap (`/Identity-V`, ISO 32000-2 §9.7.4.3) advances the pen down
 * the column. Reading those runs as horizontal lines turns three columns into
 * three rows that overlap along one baseline, and a producer that places one
 * glyph per `Tj` produces one editable object per character. This test drives
 * the real File > Import route and checks what the user gets: three editable
 * columns, each marked vertical in the Inspector, painted as columns.
 *
 * Evidence: PDFCraft #3216 (critical), #3711, #3712. Screenshots land in
 * docs/screenshots/pdfcraft/.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const SHOT_DIR = join(process.cwd(), 'docs', 'screenshots', 'pdfcraft');

const GLYPHS: Array<[number, string]> = [
  [1, '縦'],
  [2, '書'],
  [3, 'き'],
  [4, 'の'],
  [5, '試'],
  [6, '験'],
  [7, '隣'],
  [8, 'の'],
  [9, '列'],
  [10, 'の'],
  [11, '文'],
  [12, '章'],
  [13, '離'],
  [14, 'れ'],
  [15, 'た'],
  [16, '列'],
];

function hex(value: number): string {
  return value.toString(16).padStart(4, '0').toUpperCase();
}

/** Three columns at 20pt; the middle one puts one glyph per `Tj`. */
function buildVerticalPdf(): Buffer {
  const content = [
    'BT /V1 20 Tf 500 720 Td <000100020003000400050006> Tj ET',
    'BT /V1 20 Tf 470 720 Td <0007> Tj <0008> Tj <0009> Tj <000A> Tj <000B> Tj <000C> Tj ET',
    'BT /V1 20 Tf 300 720 Td <000D000E000F0010> Tj ET',
  ].join('\n');
  const toUnicode = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CMapName /Varve-E2E-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    `${GLYPHS.length} beginbfchar`,
    ...GLYPHS.map(([code, text]) => `<${hex(code)}> <${hex(text.codePointAt(0) ?? 0)}>`),
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
  const widths = new Array(GLYPHS.length).fill(1000).join(' ');
  const parts = [
    '%PDF-1.7\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /V1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /VFont /Encoding /Identity-V /DescendantFonts [6 0 R] /ToUnicode 8 0 R >>\nendobj\n',
    `6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /VFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R /DW 1000 /W [1 [${widths}]] /DW2 [880 -1000] >>\nendobj\n`,
    '7 0 obj\n<< /Type /FontDescriptor /FontName /VFont /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>\nendobj\n',
    `8 0 obj\n<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream\nendobj\n`,
    'trailer\n<< /Root 1 0 R >>\n%%EOF\n',
  ];
  return Buffer.from(parts.join(''), 'latin1');
}

async function importPdf(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /import/i }).click();
  await page.locator('#file-import-input').setInputFiles({
    name: 'vertical-writing.pdf',
    mimeType: 'application/pdf',
    buffer: buildVerticalPdf(),
  });
  const dialog = page.getByRole('dialog', { name: /import results/i });
  await dialog.waitFor({ state: 'visible', timeout: 30000 });
}

test.describe('PDF import — vertical writing', () => {
  test('imports three Identity-V columns as vertical text, not one row per glyph', async ({
    page,
  }) => {
    test.slow();
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigateToEditor(page);
    await importPdf(page);

    const dialog = page.getByRole('dialog', { name: /import results/i });
    await dialog.getByRole('button', { name: /^show details \(/i }).click();
    const note = dialog.getByText(
      /8 vertical text run\(s\) were imported as 3 vertical column\(s\)/,
    );
    await expect(note).toBeVisible({ timeout: 10000 });
    // Detail rows must use the dialog's width, not shrink into side-by-side
    // slivers beside the warning list.
    const dialogBox = await dialog.boundingBox();
    const noteBox = await note.boundingBox();
    if (!dialogBox || !noteBox) throw new Error('import details are not laid out');
    expect(noteBox.width).toBeGreaterThan(dialogBox.width * 0.5);
    await page.screenshot({
      path: join(SHOT_DIR, 'import-vertical-writing-results.png'),
      fullPage: true,
    });
    await dialog.getByRole('button', { name: /^close$/i }).click();

    const layers = page.locator('.layers-panel');
    // Three columns, not sixteen single-glyph objects.
    await expect(layers.locator('[role="treeitem"]')).toHaveCount(3, { timeout: 15000 });
    await expect(layers.getByText(/^Vertical text \(VFont\)$/).first()).toBeVisible();

    // Select the six-glyph column and confirm the editable property the
    // importer set, through the Inspector control the user would use.
    await layers
      .getByRole('treeitem', { name: /Vertical text \(VFont\)/ })
      .first()
      .click();
    const advanced = page.getByRole('button', { name: 'Advanced typography', exact: true });
    await advanced.scrollIntoViewIfNeeded();
    if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();
    const writing = page.getByRole('combobox', { name: 'Writing mode (not rotation)' });
    await expect(writing).toHaveText('Vertical, right to left', { timeout: 5000 });
    const orientation = page.getByRole('combobox', { name: 'Vertical text orientation' });
    await expect(orientation).toHaveText('Mixed', { timeout: 5000 });

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.screenshot({ path: join(SHOT_DIR, 'import-vertical-writing-canvas.png') });
    await page.screenshot({
      path: join(SHOT_DIR, 'import-vertical-writing-editor.png'),
      fullPage: true,
    });

    // Ink must reach the canvas: the columns are painted, not only modelled.
    const ink = await canvas.evaluate((element) => {
      const target = element as HTMLCanvasElement;
      const context = target.getContext('2d');
      if (!context) return 0;
      const pixels = context.getImageData(0, 0, target.width, target.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if ((pixels[i + 3] ?? 0) > 0) count += 1;
      }
      return count;
    });
    expect(ink).toBeGreaterThan(500);
  });
});

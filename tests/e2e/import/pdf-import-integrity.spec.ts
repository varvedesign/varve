/**
 * E2E: PDF import must not invent content the page does not show.
 *
 * Three classes are present in the file and must not become visible artwork:
 * text in an invisible render mode (a searchable OCR layer over a scan),
 * content in an optional-content group the document hides (a PDF layer, as
 * layered CAD exports ship), and anything at all in an encrypted document.
 *
 * The real File > Import route is used, and the assertions are on what the
 * user sees: the Import Results dialog, and the layer tree, which must not
 * contain the hidden text.
 *
 * Evidence: PDFCraft 2986/3211/3214 (hidden layers drawn as visible),
 * 3029/3109 (invisible text brought in as visible), 3450/3904 (encrypted
 * files opening as nothing). Screenshots go to a temp directory; the checked-in
 * copies in docs/screenshots/pdfcraft/ were captured with VARVE_SHOT_DIR.
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Evidence screenshots go to a temporary directory by default. Writing into
 * the checkout would dirty the source tree during a CI run, and the lane
 * runner requires an unchanged clean source at the planned commit. Set
 * `VARVE_SHOT_DIR` to capture into the repository for a documented review.
 */
const SHOT_DIR = process.env.VARVE_SHOT_DIR ?? join(tmpdir(), 'varve-pdfcraft-shots');

/**
 * Assemble a small but structurally real PDF. Object numbers are fixed so a
 * test can reference extras: 1 catalog, 2 page tree, 3 page, 4 content,
 * 5 font, 6+ extras.
 */
function buildPdf(options: {
  content: string;
  catalogExtra?: string;
  resourcesExtra?: string;
  extraObjects?: string[];
  trailerExtra?: string;
}): Buffer {
  const parts = [
    '%PDF-1.7\n',
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R${options.catalogExtra ? ` ${options.catalogExtra}` : ''} >>\nendobj\n`,
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >>${options.resourcesExtra ? ` ${options.resourcesExtra}` : ''} >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${options.content.length} >>\nstream\n${options.content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    ...(options.extraObjects ?? []),
    options.trailerExtra ?? '',
  ];
  return Buffer.from(parts.join(''), 'latin1');
}

async function openImportFromMenu(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /import/i }).click();
}

async function importPdf(
  page: import('@playwright/test').Page,
  name: string,
  buffer: Buffer,
): Promise<void> {
  await openImportFromMenu(page);
  await page.locator('#file-import-input').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer,
  });
  const dialog = page.getByRole('dialog', { name: /import results/i });
  await dialog.waitFor({ state: 'visible', timeout: 30000 });
}

async function showDetails(page: import('@playwright/test').Page): Promise<void> {
  // The layer rows carry their own "Show details for …" buttons, so the
  // dialog must be the scope.
  await page
    .getByRole('dialog', { name: /import results/i })
    .getByRole('button', { name: /^show details \(/i })
    .click();
}

/** True when the canvas has any painted pixel (the visible run reached it). */
async function canvasHasInk(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement | null;
    if (!canvas) return false;
    const context = canvas.getContext('2d');
    if (!context) return false;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let offset = 3; offset < data.length; offset += 4) {
      if ((data[offset] ?? 0) > 0) return true;
    }
    return false;
  });
}

test.describe('PDF import integrity', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('hidden optional-content layer is not painted and is named in Import Results', async ({
    page,
  }) => {
    mkdirSync(SHOT_DIR, { recursive: true });
    await importPdf(
      page,
      'hidden-layer.pdf',
      buildPdf({
        content: [
          '/OC /MC0 BDC',
          'BT /F1 18 Tf 72 700 Td (HIDDEN CAD LAYER TEXT) Tj ET',
          'EMC',
          'BT /F1 18 Tf 72 600 Td (VISIBLE LAYER TEXT) Tj ET',
        ].join('\n'),
        catalogExtra: '/OCProperties << /OCGs [6 0 R] /D << /OFF [6 0 R] >> >>',
        resourcesExtra: '/Properties << /MC0 6 0 R >>',
        extraObjects: ['6 0 obj\n<< /Type /OCG /Name (Hidden CAD layer) >>\nendobj\n'],
      }),
    );

    await showDetails(page);
    const dialog = page.getByRole('dialog', { name: /import results/i });
    await expect(dialog.getByText(/Hidden CAD layer/)).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText(/default layer configuration hides them/i)).toBeVisible();
    await page.screenshot({
      path: join(SHOT_DIR, 'import-hidden-layer-results.png'),
      fullPage: true,
    });
    await dialog.getByRole('button', { name: /^close$/i }).click();

    // The visible run is imported; the hidden one never reaches the scene.
    const layers = page.locator('.layers-panel');
    // Two runs are in the file; only the visible one becomes a node.
    await expect(layers.locator('[role="treeitem"]')).toHaveCount(1, { timeout: 15000 });
    await expect.poll(() => canvasHasInk(page)).toBe(true);
  });

  test('invisible OCR text is reported instead of imported as visible text', async ({ page }) => {
    await importPdf(
      page,
      'ocr-layer.pdf',
      buildPdf({
        content: [
          'BT /F1 14 Tf 3 Tr 72 700 Td (hidden searchable ocr text) Tj ET',
          'BT /F1 14 Tf 0 Tr 72 600 Td (PRINTED HEADLINE) Tj ET',
        ].join('\n'),
      }),
    );

    await showDetails(page);
    const dialog = page.getByRole('dialog', { name: /import results/i });
    await expect(dialog.getByText(/invisible or clip-only render mode/i)).toBeVisible({
      timeout: 10000,
    });
    await dialog.getByRole('button', { name: /^close$/i }).click();

    const layers = page.locator('.layers-panel');
    // The file has two runs: the invisible one must not become a second node.
    await expect(layers.locator('[role="treeitem"]')).toHaveCount(1, { timeout: 15000 });
    await expect.poll(() => canvasHasInk(page)).toBe(true);
  });

  test('encrypted PDF is refused with an explanation, not imported as a blank page', async ({
    page,
  }) => {
    mkdirSync(SHOT_DIR, { recursive: true });
    await importPdf(
      page,
      'protected.pdf',
      buildPdf({
        content: 'BT /F1 18 Tf 72 700 Td (ciphertext) Tj ET',
        trailerExtra: 'trailer\n<< /Root 1 0 R /Encrypt 6 0 R >>\n%%EOF\n',
      }),
    );

    await showDetails(page);
    const dialog = page.getByRole('dialog', { name: /import results/i });
    await expect(dialog.getByText(/This PDF is encrypted/i)).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText(/export an unencrypted copy/i)).toBeVisible();
    // A refusal is a failure, not a conversion with fidelity changes.
    await expect(dialog.getByText(/failed or could not be imported/i)).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, 'import-encrypted-results.png'), fullPage: true });
    await dialog.getByRole('button', { name: /^close$/i }).click();

    // Nothing was inserted: no text node can exist for a document that was
    // never read.
    await expect(page.locator('.layers-panel').locator('[role="treeitem"]')).toHaveCount(0, {
      timeout: 15000,
    });
  });
});

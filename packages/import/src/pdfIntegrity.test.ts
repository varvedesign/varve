/**
 * PDF import integrity: what the importer must refuse to invent.
 *
 * Three classes of document content are *present* in the file but must not
 * become visible artwork on import:
 *
 * - content that the document marks hidden (optional-content groups whose
 *   default is OFF, the way a CAD or layered PDF ships its layers);
 * - text whose render mode paints nothing (`3 Tr` invisible, `7 Tr` clip),
 *   which is how a searchable OCR layer is attached to a scan;
 * - anything at all in an encrypted document, whose streams are ciphertext
 *   until the standard security handler decrypts them.
 *
 * In each case the honest outcome is "not imported, and reported", never a
 * silent empty page and never artwork the source does not show.
 *
 * Evidence: PDFCraft issues 3450/3904 (encrypted files open as nothing),
 * 2986/3211/3214 (hidden layers drawn as visible), 3029/3109 (invisible text
 * brought in as visible text). The assertions describe Varve's contract.
 */
import { describe, expect, it } from 'vitest';
import { createPdfParser } from './pdf';

const encoder = new TextEncoder();

/**
 * A minimal PDF whose catalog and page carry caller-supplied extras. Object
 * numbers are fixed so a test can reference them: 1 catalog, 2 page tree,
 * 3 page, 4 content, 5.. extras.
 */
function buildPdf(options: {
  content: string;
  catalogExtra?: string;
  pageExtra?: string;
  resourcesExtra?: string;
  trailerExtra?: string;
}): Uint8Array {
  const extraObjects: string[] = [];
  const catalogExtra = options.catalogExtra ? ` ${options.catalogExtra}` : '';
  const pageExtra = options.pageExtra ? ` ${options.pageExtra}` : '';
  const resourcesExtra = options.resourcesExtra ? ` ${options.resourcesExtra}` : '';
  const parts = [
    '%PDF-1.7\n',
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R${catalogExtra} >>\nendobj\n`,
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]${pageExtra} /Contents 4 0 R /Resources << /Font << /F1 5 0 R >>${resourcesExtra} >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${options.content.length} >>\nstream\n${options.content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    ...extraObjects,
  ];
  const body = parts.join('');
  return concat([encoder.encode(body), encoder.encode(options.trailerExtra ?? '')]);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function textOf(result: ReturnType<ReturnType<typeof createPdfParser>['parse']>): string[] {
  return Object.values(result.document.nodes)
    .filter((node) => node.kind === 'text')
    .map((node) => ('text' in node ? String(node.text) : ''));
}

describe('PDF import — refuse to invent visible content', () => {
  const parser = createPdfParser();

  it('reports an encrypted document instead of importing ciphertext as empty pages', () => {
    const result = parser.parse(
      buildPdf({
        content: 'BT /F1 12 Tf 40 700 Td (Hello) Tj ET',
        trailerExtra: 'trailer\n<< /Root 1 0 R /Encrypt 6 0 R >>\n%%EOF\n',
      }),
    );
    expect(result.warnings.join(' ')).toMatch(/password|encrypt/i);
    expect(result.capabilities?.text).toBe(false);
  });

  it('does not import text set in invisible render mode as visible text', () => {
    // A searchable OCR layer: the hidden text follows the scan, painted with
    // rendering mode 3 so no glyph reaches the page.
    const result = parser.parse(
      buildPdf({
        content: [
          'BT /F1 12 Tf 3 Tr 40 700 Td (hidden ocr layer) Tj ET',
          'BT /F1 12 Tf 0 Tr 40 600 Td (printed headline) Tj ET',
        ].join('\n'),
      }),
    );
    expect(textOf(result)).toEqual(['printed headline']);
    expect((result.unsupportedFeatures ?? []).join(' ')).toMatch(/invisible/i);
  });

  it('does not import text used only as a clipping path', () => {
    const result = parser.parse(
      buildPdf({
        content: ['BT /F1 12 Tf 7 Tr 40 700 Td (clip only) Tj ET'].join('\n'),
      }),
    );
    expect(textOf(result)).toEqual([]);
    expect((result.unsupportedFeatures ?? []).join(' ')).toMatch(/invisible|clip/i);
  });

  it('leaves content in an optional-content group that defaults to OFF out of the page', () => {
    const content = [
      '/OC /MC0 BDC',
      'BT /F1 12 Tf 40 700 Td (hidden layer text) Tj ET',
      'EMC',
      'BT /F1 12 Tf 40 600 Td (visible layer text) Tj ET',
    ].join('\n');
    const result = parser.parse(
      buildPdf({
        content,
        catalogExtra: '/OCProperties << /OCGs [6 0 R] /D << /OFF [6 0 R] >> >>',
        resourcesExtra: '/Properties << /MC0 6 0 R >>',
        pageExtra: '',
        trailerExtra: '6 0 obj\n<< /Type /OCG /Name (Hidden CAD layer) >>\nendobj\n',
      }),
    );
    expect(textOf(result)).toEqual(['visible layer text']);
    expect((result.unsupportedFeatures ?? []).join(' ')).toMatch(/Hidden CAD layer/);
  });

  it('keeps content in an optional-content group that defaults to ON', () => {
    const content = ['/OC /MC0 BDC', 'BT /F1 12 Tf 40 700 Td (shown layer text) Tj ET', 'EMC'].join(
      '\n',
    );
    const result = parser.parse(
      buildPdf({
        content,
        catalogExtra: '/OCProperties << /OCGs [6 0 R] /D << /OFF [] >> >>',
        resourcesExtra: '/Properties << /MC0 6 0 R >>',
        trailerExtra: '6 0 obj\n<< /Type /OCG /Name (Visible layer) >>\nendobj\n',
      }),
    );
    expect(textOf(result)).toEqual(['shown layer text']);
  });

  it('ends an inline image at EI followed by a delimiter, so the rest of the page survives', () => {
    // The spec asks for white space after EI, but producers emit `EI/OC` and
    // treating that as image data swallows every operator after the image.
    const content = [
      'BI /W 2 /H 1 /BPC 8 /CS /G ID',
      '\u00ff\u00ff',
      'EI/OC /MC1 BDC',
      'BT /F1 12 Tf 40 700 Td (after image) Tj ET',
      'EMC',
    ].join('\n');
    const result = parser.parse(
      buildPdf({
        content,
        catalogExtra: '/OCProperties << /OCGs [6 0 R] /D << /ON [6 0 R] >> >>',
        resourcesExtra: '/Properties << /MC1 6 0 R >>',
        trailerExtra: '6 0 obj\n<< /Type /OCG /Name (Shown) >>\nendobj\n',
      }),
    );
    expect(textOf(result)).toEqual(['after image']);
  });
});

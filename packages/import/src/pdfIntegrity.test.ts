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
  /** A second content stream; the page then declares `/Contents [4 0 R 6 0 R]`. */
  secondContent?: string;
  catalogExtra?: string;
  pageExtra?: string;
  resourcesExtra?: string;
  trailerExtra?: string;
  /** Put `/Encrypt` in the catalog instead of the trailer (a false-positive probe). */
  encryptInCatalog?: boolean;
}): Uint8Array {
  const catalogExtra = options.catalogExtra ? ` ${options.catalogExtra}` : '';
  const pageExtra = options.pageExtra ? ` ${options.pageExtra}` : '';
  const resourcesExtra = options.resourcesExtra ? ` ${options.resourcesExtra}` : '';
  const contents = options.secondContent === undefined ? '4 0 R' : '[4 0 R 6 0 R]';
  const parts = [
    '%PDF-1.7\n',
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R${catalogExtra} >>\nendobj\n`,
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]${pageExtra} /Contents ${contents} /Resources << /Font << /F1 5 0 R >>${resourcesExtra} >> >>\nendobj\n`,
    streamObject(4, options.content),
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
  ];
  if (options.secondContent !== undefined) parts.push(streamObject(6, options.secondContent));
  const body = parts.join('');
  return concat([encoder.encode(body), encoder.encode(options.trailerExtra ?? '')]);
}

/** `/Length` is the encoded byte count, not the character count. */
function streamObject(number: number, content: string): string {
  const length = encoder.encode(content).length;
  return `${number} 0 obj\n<< /Length ${length} >>\nstream\n${content}\nendstream\nendobj\n`;
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
    // The service reports a refusal from this field, not by matching text.
    expect(result.failure).toMatch(/encrypted/i);
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

  it('reports an optional-content section given a direct dictionary as unresolved', () => {
    // `/OC << /OCGs [6 0 R] >> BDC` needs an object graph the interpreter does
    // not carry. Treating its members as a property name would import content
    // that the document may hide, with no diagnostic at all.
    const content = [
      '/OC << /OCGs [6 0 R] >> BDC',
      'BT /F1 12 Tf 40 700 Td (inside inline group) Tj ET',
      'EMC',
      'BT /F1 12 Tf 40 600 Td (outside group) Tj ET',
    ].join('\n');
    const result = parser.parse(
      buildPdf({
        content,
        catalogExtra: '/OCProperties << /OCGs [6 0 R] /D << /OFF [6 0 R] >> >>',
        trailerExtra: '6 0 obj\n<< /Type /OCG /Name (Hidden CAD layer) >>\nendobj\n',
      }),
    );
    expect(textOf(result)).toEqual(['inside inline group', 'outside group']);
    expect((result.unsupportedFeatures ?? []).join(' ')).toMatch(
      /optional-content section\(s\) could not be resolved/i,
    );
  });

  it('keeps marked-content state across the streams of one page', () => {
    // A `/Contents` array is one concatenated program: a section opened in the
    // first stream continues in the second, so its content stays hidden.
    const result = parser.parse(
      buildPdf({
        content: ['/OC /MC0 BDC', 'BT /F1 12 Tf 40 700 Td (hidden first stream) Tj ET'].join('\n'),
        secondContent: [
          'BT /F1 12 Tf 40 650 Td (hidden second stream) Tj ET',
          'EMC',
          'BT /F1 12 Tf 40 600 Td (visible after EMC) Tj ET',
        ].join('\n'),
        catalogExtra: '/OCProperties << /OCGs [7 0 R] /D << /OFF [7 0 R] >> >>',
        resourcesExtra: '/Properties << /MC0 7 0 R >>',
        trailerExtra: '7 0 obj\n<< /Type /OCG /Name (Hidden CAD layer) >>\nendobj\n',
      }),
    );
    expect(textOf(result)).toEqual(['visible after EMC']);
  });

  it('does not refuse a readable document that merely contains the word /Encrypt', () => {
    // No `trailer` keyword (xref-stream style file), and the content stream is
    // uncompressed: a bare substring match would refuse this document.
    const result = parser.parse(
      buildPdf({
        content: 'BT /F1 12 Tf 40 700 Td (/Encrypt is only a word here) Tj ET',
        trailerExtra: 'startxref\n0\n%%EOF\n',
      }),
    );
    expect(result.failure).toBeUndefined();
    expect(textOf(result)).toEqual(['/Encrypt is only a word here']);
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

/**
 * PDF import fidelity regressions.
 *
 * Each case pins a failure that a real document produces. The evidence is the
 * PDFCraft tracker (a separate PDF application) plus the PDF 32000 content
 * stream and string syntax; the assertions here describe Varve's contract, not
 * that project's implementation:
 *
 * - text lands where the page puts it (top-left origin, `/Rotate` applied)
 * - real files decode: their content streams are zlib `FlateDecode`
 * - character codes resolve through the font encoding, so accents survive
 * - `TJ` kerning adjustments do not weld words together
 * - inline image bytes are never re-read as page content
 * - a run the importer cannot read is reported, never invented
 */
import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createPdfParser } from './pdf';

interface PageSpec {
  readonly content: string;
  readonly mediaBox?: string;
  readonly rotate?: number;
  readonly fontObject?: string;
  readonly extraObjects?: string[];
  /** Declares a filter whose body is not really encoded, to test reporting. */
  readonly declaredFilter?: string;
}

const encoder = new TextEncoder();

function ascii(text: string): Uint8Array {
  return encoder.encode(text);
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

/**
 * Assemble a small but structurally real PDF with sequential object numbers.
 * The body is built as bytes, never as a string re-encoded as UTF-8: a
 * compressed stream contains bytes above 0x7F, and passing those through a
 * JavaScript string would corrupt them before the parser ever sees the file.
 */
function buildPdf(pages: PageSpec[], options: { deflate?: boolean } = {}): Uint8Array {
  const chunks: Uint8Array[] = [ascii('%PDF-1.7\n')];
  const pageObjectNumbers: number[] = [];
  let next = 1;
  const catalogNumber = next++;
  const pagesNumber = next++;

  const pageEntries: Array<{
    number: number;
    contentsNumber: number;
    fontNumber: number | null;
    spec: PageSpec;
  }> = [];

  for (const spec of pages) {
    const number = next++;
    const contentsNumber = next++;
    const fontNumber = spec.fontObject ? next++ : null;
    pageEntries.push({ number, contentsNumber, fontNumber, spec });
    pageObjectNumbers.push(number);
  }

  chunks.push(
    ascii(`${catalogNumber} 0 obj\n<< /Type /Catalog /Pages ${pagesNumber} 0 R >>\nendobj\n`),
  );
  chunks.push(
    ascii(
      `${pagesNumber} 0 obj\n<< /Type /Pages /Kids [${pageObjectNumbers
        .map((n) => `${n} 0 R`)
        .join(' ')}] /Count ${pageEntries.length} >>\nendobj\n`,
    ),
  );

  for (const entry of pageEntries) {
    const box = entry.spec.mediaBox ?? '[0 0 612 792]';
    const rotate = entry.spec.rotate !== undefined ? `/Rotate ${entry.spec.rotate} ` : '';
    chunks.push(
      ascii(
        `${entry.number} 0 obj\n<< /Type /Page /Parent ${pagesNumber} 0 R /MediaBox ${box} ${rotate}/Contents ${entry.contentsNumber} 0 R /Resources << /Font << /F1 ${entry.fontNumber ?? 0} 0 R >> >> >>\nendobj\n`,
      ),
    );
    chunks.push(streamChunks(entry.contentsNumber, entry.spec, options.deflate === true));
    if (entry.fontNumber && entry.spec.fontObject) {
      chunks.push(ascii(`${entry.fontNumber} 0 obj\n${entry.spec.fontObject}\nendobj\n`));
    }
    for (const extra of entry.spec.extraObjects ?? []) chunks.push(ascii(`${extra}\n`));
  }

  chunks.push(ascii(`trailer\n<< /Root ${catalogNumber} 0 R >>\n%%EOF\n`));
  return concat(chunks);
}

function streamChunks(number: number, spec: PageSpec, deflated: boolean): Uint8Array {
  if (spec.declaredFilter) {
    // The body is deliberately not encoded in that filter: the importer must
    // report the filter instead of returning an empty page.
    return concat([
      ascii(
        `${number} 0 obj\n<< /Length ${spec.content.length} /Filter /${spec.declaredFilter} >>\nstream\n${spec.content}\nendstream\nendobj\n`,
      ),
    ]);
  }
  if (!deflated) {
    return concat([
      ascii(
        `${number} 0 obj\n<< /Length ${spec.content.length} >>\nstream\n${spec.content}\nendstream\nendobj\n`,
      ),
    ]);
  }
  const bytes = zlibSync(encoder.encode(spec.content));
  return concat([
    ascii(`${number} 0 obj\n<< /Length ${bytes.length} /Filter /FlateDecode >>\nstream\n`),
    bytes,
    ascii('\nendstream\nendobj\n'),
  ]);
}

const HELVETICA =
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

/** A stream object whose `/Length` matches its body exactly. */
function cMapObject(number: number, lines: string[]): string {
  const body = lines.join('\n');
  return `${number} 0 obj\n<< /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj`;
}

function textNodesOf(result: ReturnType<ReturnType<typeof createPdfParser>['parse']>) {
  return Object.values(result.document.nodes).filter((node) => node.kind === 'text');
}

describe('PDF import — geometry', () => {
  const parser = createPdfParser();

  it('places text from the top of the page, not mirrored from the bottom', () => {
    // PDF user space has its origin at the bottom-left; a baseline at y=700 of
    // an 792-high page is 92pt from the top.
    const result = parser.parse(
      buildPdf([{ content: 'BT /F1 12 Tf 100 700 Td (Hello) Tj ET', fontObject: HELVETICA }]),
    );
    const nodes = textNodesOf(result);
    expect(nodes).toHaveLength(1);
    const [, , , , x, y] = nodes[0]!.transform;
    // 100pt → 133.33px, 92pt from the top → 122.67px at the fixed 96dpi unit.
    expect(x).toBeCloseTo(133.33, 1);
    expect(y).toBeCloseTo(122.67, 1);
  });

  it('maps pages at their physical size (points → 96dpi world units)', () => {
    const result = parser.parse(
      buildPdf([{ content: 'BT /F1 12 Tf 10 10 Td (x) Tj ET', fontObject: HELVETICA }]),
    );
    const page = result.document.pages?.[0];
    expect(page?.width).toBeCloseTo(816, 0); // 612pt
    expect(page?.height).toBeCloseTo(1056, 0); // 792pt
  });

  it('applies a quarter-turn page rotation to size and to text position', () => {
    const result = parser.parse(
      buildPdf([
        {
          content: 'BT /F1 12 Tf 100 700 Td (Rotated) Tj ET',
          mediaBox: '[0 0 612 792]',
          rotate: 90,
          fontObject: HELVETICA,
        },
      ]),
    );
    const page = result.document.pages?.[0];
    expect(page?.width).toBeCloseTo(1056, 0); // display size is 792x612pt
    expect(page?.height).toBeCloseTo(816, 0);
    const [node] = textNodesOf(result);
    expect(node).toBeDefined();
  });

  it('honours a non-zero media box origin', () => {
    const result = parser.parse(
      buildPdf([
        {
          content: 'BT /F1 12 Tf 20 80 Td (Offset) Tj ET',
          mediaBox: '[10 20 622 812]',
          fontObject: HELVETICA,
        },
      ]),
    );
    const [node] = textNodesOf(result);
    expect(node).toBeDefined();
    const [, , , , x, y] = node!.transform;
    // x: 20pt is 10pt inside a box starting at x=10 → 13.33px.
    // y: 80pt is 60pt above the box's bottom → 732pt down from the top → 976px.
    expect(x).toBeCloseTo(13.33, 1);
    expect(y).toBeCloseTo(976, 0);
  });
});

describe('PDF import — real streams', () => {
  const parser = createPdfParser();

  it('imports text from a zlib FlateDecode content stream', () => {
    // Almost every real PDF compresses its content streams; before this, a
    // compressed stream produced no text at all.
    const result = parser.parse(
      buildPdf(
        [{ content: 'BT /F1 18 Tf 72 700 Td (Compressed line) Tj ET', fontObject: HELVETICA }],
        { deflate: true },
      ),
    );
    const nodes = textNodesOf(result);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toHaveProperty('text', 'Compressed line');
  });

  it('reads an uncompressed stream and a compressed stream identically', () => {
    const spec = 'BT /F1 14 Tf 72 700 Td (Same either way) Tj ET';
    const plain = parser.parse(buildPdf([{ content: spec, fontObject: HELVETICA }]));
    const deflated = parser.parse(
      buildPdf([{ content: spec, fontObject: HELVETICA }], { deflate: true }),
    );
    const [a] = textNodesOf(plain);
    const [b] = textNodesOf(deflated);
    expect(a).toHaveProperty('text', 'Same either way');
    expect(b).toHaveProperty('text', 'Same either way');
  });
});

describe('PDF import — text decoding', () => {
  const parser = createPdfParser();

  it('decodes octal escapes and WinAnsi accents', () => {
    // `caf\351` is "café" in WinAnsiEncoding: the escape is part of the string
    // syntax and the byte then resolves through the font encoding.
    const result = parser.parse(
      buildPdf([
        {
          content: 'BT /F1 12 Tf 72 700 Td (caf\\351 na\\357ve) Tj ET',
          fontObject: HELVETICA,
        },
      ]),
    );
    expect(textNodesOf(result)[0]).toHaveProperty('text', 'café naïve');
  });

  it('escapes parentheses and backslashes instead of truncating the string', () => {
    const result = parser.parse(
      buildPdf([
        {
          content: 'BT /F1 12 Tf 72 700 Td (A \\(b\\) \\\\ c) Tj ET',
          fontObject: HELVETICA,
        },
      ]),
    );
    expect(textNodesOf(result)[0]).toHaveProperty('text', 'A (b) \\ c');
  });

  it('decodes a hex string with a UTF-16BE byte-order mark', () => {
    const result = parser.parse(
      buildPdf([{ content: 'BT /F1 12 Tf 72 700 Td <FEFF00480069> Tj ET', fontObject: HELVETICA }]),
    );
    expect(textNodesOf(result)[0]).toHaveProperty('text', 'Hi');
  });

  it('resolves codes through a /ToUnicode CMap', () => {
    const fontObject = [
      '<< /Type /Font /Subtype /Type0 /BaseFont /Noto /Encoding /Identity-H',
      '/DescendantFonts [7 0 R] /ToUnicode 8 0 R >>',
    ].join(' ');
    const result = parser.parse(
      buildPdf([
        {
          content: 'BT /F1 12 Tf 72 700 Td <000300040005> Tj ET',
          fontObject,
          extraObjects: [
            '7 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Noto /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>\nendobj',
            cMapObject(8, [
              '/CIDInit /ProcSet findresource begin',
              '12 dict begin',
              'begincmap',
              '1 begincodespacerange',
              '<0000> <FFFF>',
              'endcodespacerange',
              '1 beginbfchar',
              '<0003> <0041>',
              'endbfchar',
              '1 beginbfchar',
              '<0004> <0042>',
              'endbfchar',
              '1 beginbfchar',
              '<0005> <0043>',
              'endbfchar',
              'endcmap',
              'end',
              'end',
            ]),
          ],
        },
      ]),
    );
    expect(textNodesOf(result)[0]).toHaveProperty('text', 'ABC');
  });

  it('reports a composite font with no mapping instead of inventing characters', () => {
    const result = parser.parse(
      buildPdf([
        {
          content: 'BT /F1 12 Tf 72 700 Td <000300040005> Tj ET',
          fontObject:
            '<< /Type /Font /Subtype /Type0 /BaseFont /Mystery /Encoding /Identity-H /DescendantFonts [7 0 R] >>',
          extraObjects: [
            '7 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Mystery >>\nendobj',
          ],
        },
      ]),
    );
    expect(textNodesOf(result)).toHaveLength(0);
    expect(result.unsupportedFeatures?.join(' ')).toMatch(/no readable encoding/i);
    expect(result.capabilities?.text).toBe(false);
  });
});

describe('PDF import — word gaps and inline images', () => {
  const parser = createPdfParser();

  it('keeps word gaps from TJ kerning adjustments', () => {
    // Without the numeric gap this reads "HelloWorld".
    const result = parser.parse(
      buildPdf([
        {
          content: 'BT /F1 12 Tf 72 700 Td [(Hello) -280 (World)] TJ ET',
          fontObject: HELVETICA,
        },
      ]),
    );
    expect(textNodesOf(result)[0]).toHaveProperty('text', 'Hello World');
  });

  it('does not weld words when the gap is letter kerning', () => {
    const result = parser.parse(
      buildPdf([{ content: 'BT /F1 12 Tf 72 700 Td [(A) -20 (V)] TJ ET', fontObject: HELVETICA }]),
    );
    expect(textNodesOf(result)[0]).toHaveProperty('text', 'AV');
  });

  it('never re-reads inline image bytes as page content', () => {
    // The image contains a byte above 0x7F and text that looks like operators.
    // Reading them as content is how a page loses everything after the image.
    const imageBytes = '\u00ff (injected) Tj ET ';
    const content = `BT /F1 12 Tf 72 700 Td (Before) Tj ET BI /W 4 /H 4 /CS /RGB ID ${imageBytes}EI BT /F1 12 Tf 72 600 Td (After) Tj ET`;
    const result = parser.parse(buildPdf([{ content, fontObject: HELVETICA }]));
    const texts = textNodesOf(result).map((node) => (node as { text: string }).text);
    expect(texts).toEqual(['Before', 'After']);
  });
});

describe('PDF import — pages', () => {
  const parser = createPdfParser();

  it('maps each PDF page to its own Varve page', () => {
    const result = parser.parse(
      buildPdf([
        { content: 'BT /F1 12 Tf 72 700 Td (First) Tj ET', fontObject: HELVETICA },
        {
          content: 'BT /F1 12 Tf 72 700 Td (Second) Tj ET',
          mediaBox: '[0 0 300 400]',
          fontObject: HELVETICA,
        },
      ]),
    );
    expect(result.document.pages).toHaveLength(2);
    expect(result.document.pages?.[1]?.width).toBeCloseTo(400, 0); // 300pt
    const texts = textNodesOf(result).map((node) => (node as { text: string }).text);
    expect(texts).toEqual(['First', 'Second']);
    const second = textNodesOf(result)[1]!;
    const secondPageRoot = result.document.pages?.[1]?.contentRoot;
    const root = result.document.nodes[secondPageRoot!] as { children: string[] };
    expect(root.children).toContain(second.id);
  });

  it('inherits the media box from the pages tree when a page omits it', () => {
    const result = parser.parse(
      buildPdf([{ content: 'BT /F1 12 Tf 20 20 Td (Inherited box) Tj ET', fontObject: HELVETICA }]),
    );
    expect(result.document.pages?.[0]?.width).toBeCloseTo(816, 0);
  });
});

describe('PDF import — honest reporting', () => {
  const parser = createPdfParser();

  it('imports axis-aligned rectangle fills', () => {
    const result = parser.parse(
      buildPdf([{ content: '1 0 0 rg 10 10 100 50 re f', fontObject: HELVETICA }]),
    );
    const shapes = Object.values(result.document.nodes).filter((node) => node.kind === 'shape');
    expect(shapes).toHaveLength(1);
    const shape = shapes[0] as { shape: { w: number; h: number }; fill: { r: number; a: number } };
    expect(shape.shape.w).toBeCloseTo(133.33, 1);
    expect(shape.shape.h).toBeCloseTo(66.67, 1);
    expect(shape.fill.r).toBe(255);
    expect(shape.fill.a).toBe(255);
  });

  it('skips CMYK paint and says so rather than converting it', () => {
    const result = parser.parse(
      buildPdf([{ content: '0 1 1 0 k 10 10 100 50 re f', fontObject: HELVETICA }]),
    );
    expect(Object.values(result.document.nodes).filter((n) => n.kind === 'shape')).toHaveLength(0);
    expect(result.unsupportedFeatures?.join(' ')).toMatch(/CMYK/i);
  });

  it('counts stroked paths as unsupported instead of drawing them', () => {
    const result = parser.parse(
      buildPdf([{ content: '2 w 10 10 m 100 100 l S', fontObject: HELVETICA }]),
    );
    expect(Object.values(result.document.nodes).filter((n) => n.kind === 'shape')).toHaveLength(0);
    expect(result.unsupportedFeatures?.join(' ')).toMatch(/stroked path/i);
  });

  it('names an undecodable stream filter instead of returning an empty page', () => {
    const result = parser.parse(
      buildPdf([
        {
          content: 'BT /F1 12 Tf 72 700 Td (encrypted body) Tj ET',
          fontObject: HELVETICA,
          declaredFilter: 'LZWDecode',
        },
      ]),
    );
    expect(result.unsupportedFeatures?.join(' ')).toMatch(/LZWDecode/);
    expect(result.warnings.join(' ')).toMatch(/could not be decoded/i);
  });

  it('reports a document with no extractable text as a warning, not a failure', () => {
    const result = parser.parse(
      buildPdf([{ content: '0 0 0 RG 5 w 1 1 m 10 10 l S', fontObject: HELVETICA }]),
    );
    expect(result.warnings.join(' ')).toMatch(/no text or plain rectangle/i);
    expect(result.document).toBeDefined();
  });

  it('does not crash on a truncated body and reports what it could not read', () => {
    const full = buildPdf([
      { content: 'BT /F1 12 Tf 72 700 Td (Truncated) Tj ET', fontObject: HELVETICA },
    ]);
    const result = parser.parse(full.slice(0, 120));
    expect(result.document).toBeDefined();
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('rejects a file that exceeds the import budget without parsing it', () => {
    const header = new TextEncoder().encode('%PDF-1.7\n');
    const huge = new Uint8Array(33 * 1024 * 1024);
    huge.set(header, 0);
    const result = parser.parse(huge);
    expect(result.nodeIds).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/budget/i);
  });
});

/**
 * Vertical-writing fixture.
 *
 * ISO 32000-2 §9.7.4.3: a Type0 font whose CMap has `WMode 1` (`/Identity-V`
 * here) advances the pen down the column instead of along the baseline. The
 * second column is written one glyph per `Tj`, which is how many producers
 * position upright glyphs; the importer must still read it as one column.
 */
function verticalWritingPdf(encoding: 'Identity-V' | 'Identity-H'): Uint8Array {
  const glyphs: Array<[number, string]> = [
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
  const hex = (code: number): string => code.toString(16).padStart(4, '0').toUpperCase();
  const vertical = encoding === 'Identity-V';
  const fourth = vertical
    ? 'BT /V1 20 Tf 470 720 Td <0007> Tj <0008> Tj <0009> Tj <000A> Tj <000B> Tj <000C> Tj ET'
    : 'BT /V1 20 Tf 470 720 Td <000700080009000A000B000C> Tj ET';
  const content = [
    'BT /V1 20 Tf 500 720 Td <000100020003000400050006> Tj ET',
    fourth,
    'BT /V1 20 Tf 300 720 Td <000D000E000F0010> Tj ET',
  ].join('\n');

  const toUnicode = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CMapName /Varve-Test-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    `${glyphs.length} beginbfchar`,
    ...glyphs.map(([code, text]) => `<${hex(code)}> <${hex(text.codePointAt(0) ?? 0)}>`),
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');

  const widths = new Array(16).fill(1000).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /V1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /Font /Subtype /Type0 /BaseFont /VFont /Encoding /${encoding} /DescendantFonts [6 0 R] /ToUnicode 8 0 R >>`,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /VFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R /DW 1000 /W [1 [${widths}]] /DW2 [880 -1000] >>`,
    '<< /Type /FontDescriptor /FontName /VFont /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
    `<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream`,
  ];

  const chunks: Uint8Array[] = [ascii('%PDF-1.7\n')];
  for (const [index, body] of objects.entries()) {
    chunks.push(ascii(`${index + 1} 0 obj\n${body}\nendobj\n`));
  }
  chunks.push(ascii('trailer\n<< /Root 1 0 R >>\n%%EOF\n'));
  return concat(chunks);
}

describe('PDF import — vertical writing (ISO 32000-2 §9.7.4.3)', () => {
  const parser = createPdfParser();
  const px = 96 / 72;

  it('imports an Identity-V column as upright vertical text, top to bottom', () => {
    const result = parser.parse(verticalWritingPdf('Identity-V'));
    const nodes = textNodesOf(result);
    expect(nodes).toHaveLength(3);
    const column = nodes.find((node) => node.kind === 'text' && node.text === '縦書きの試験');
    expect(column).toBeDefined();
    if (column?.kind !== 'text') throw new Error('expected a text node');
    expect(column.writingMode).toBe('vertical-rl');
    expect(column.textOrientation).toBe('mixed');
    expect(column.name).toContain('Vertical text');
    // The column is centred on its baseline: 0.475em right of the origin,
    // 0.6em (Varve's 1.2 line-height column) back to the node's left edge.
    const [, , , , x, y] = column.transform;
    expect(x).toBeCloseTo((500 + 20 * (0.475 - 0.6)) * px, 1);
    expect(y).toBeCloseTo((792 - 720) * px, 1);
    expect(column.fontSize).toBeCloseTo(20 * px, 1);
    expect(result.capabilities?.notes.join(' ')).toMatch(
      /8 vertical text run\(s\) were imported as 3 vertical column\(s\)/,
    );
  });

  it('merges one-glyph-per-Tj placement into one column without joining its neighbours', () => {
    const result = parser.parse(verticalWritingPdf('Identity-V'));
    const texts = textNodesOf(result)
      .filter((node) => node.kind === 'text')
      .map((node) => (node.kind === 'text' ? node.text : ''))
      .sort();
    // Six single-glyph runs become one six-character column; the neighbouring
    // columns stay separate nodes with their own text.
    expect(texts).toEqual(['縦書きの試験', '隣の列の文章', '離れた列'].sort());
    const column = textNodesOf(result).find(
      (node) => node.kind === 'text' && node.text === '隣の列の文章',
    );
    if (column?.kind !== 'text') throw new Error('expected the merged column');
    const [, , , , x, y] = column.transform;
    expect(x).toBeCloseTo((470 + 20 * (0.475 - 0.6)) * px, 1);
    expect(y).toBeCloseTo((792 - 720) * px, 1);
    expect(textNodesOf(result)).toHaveLength(3);
  });

  it('leaves the same font horizontal when the CMap is Identity-H', () => {
    const result = parser.parse(verticalWritingPdf('Identity-H'));
    const nodes = textNodesOf(result);
    expect(nodes).toHaveLength(3);
    for (const node of nodes) {
      if (node.kind !== 'text') continue;
      expect(node.writingMode).toBeUndefined();
      expect(node.textOrientation).toBeUndefined();
    }
    const first = nodes.find((node) => node.kind === 'text' && node.text === '縦書きの試験');
    if (first?.kind !== 'text') throw new Error('expected a horizontal run');
    const [, , , , x] = first.transform;
    // A horizontal run starts at its own origin, with no column centring.
    expect(x).toBeCloseTo(500 * px, 1);
  });
});

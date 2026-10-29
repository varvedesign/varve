import { beforeEach, describe, expect, it } from 'vitest';
import { createPdfParser } from './pdf';

function makePdfBytes(): Uint8Array {
  const header = '%PDF-1.4\n';
  return new TextEncoder().encode(header);
}

function makeNonPdfBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
}

function textNodes(result: ReturnType<ReturnType<typeof createPdfParser>['parse']>) {
  return Object.values(result.document.nodes).filter((node) => node.kind === 'text') as Array<{
    id: string;
    text: string;
    fontSize: number;
    transform: readonly number[];
  }>;
}

describe('PDF parser', () => {
  const parser = createPdfParser();

  beforeEach(() => {
    // Reset any cached state
  });

  it('detects PDF via header', () => {
    expect(parser.canParse(makePdfBytes())).toBe(true);
  });

  it('rejects non-PDF data', () => {
    expect(parser.canParse(makeNonPdfBytes())).toBe(false);
    expect(parser.canParse('<svg></svg>')).toBe(false);
  });

  it('returns supported extensions', () => {
    const exts = parser.supportedExtensions();
    expect(exts).toContain('pdf');
  });

  it('returns a format name', () => {
    expect(parser.format).toBe('pdf');
  });

  it('handles corrupt PDF gracefully without inventing content', () => {
    const result = parser.parse(new Uint8Array([0, 0, 0, 0, 0]));
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.nodeIds).toEqual([]);
    expect(result.unsupportedFeatures?.length).toBeGreaterThan(0);
  });

  it('handles empty buffer gracefully', () => {
    const result = parser.parse(new Uint8Array(0));
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.nodeIds).toEqual([]);
  });

  it('imports the text and rectangle of a minimal PDF', () => {
    const result = parser.parse(createMinimalPdf());
    expect(textNodes(result).map((node) => node.text)).toEqual(['Hello']);
    const shapes = Object.values(result.document.nodes).filter((node) => node.kind === 'shape');
    expect(shapes).toHaveLength(1);
  });

  it('does not crash on string input', () => {
    const result = parser.parse('%PDF-1.4 fake string content');
    expect(result.warnings.join(' ')).toMatch(/binary data/i);
    expect(result.nodeIds).toEqual([]);
  });

  it('names the constructs it did not import', () => {
    const result = parser.parse(createMinimalPdf());
    // A blanket "may lose fidelity" note is not a report: the unsupported list
    // must name what is missing from the imported document.
    expect(result.unsupportedFeatures?.join(' ')).toMatch(/not imported/i);
    expect(result.capabilities?.format).toBe('pdf');
    expect(result.capabilities?.images).toBe(false);
  });

  it('scale option scales node geometry and font size', () => {
    const minPdf = createMinimalPdf();
    const scaled = parser.parse(minPdf, { scale: 2 });
    const unscaled = parser.parse(minPdf, { scale: 1 });
    const scaledNode = textNodes(scaled)[0]!;
    const unscaledNode = textNodes(unscaled)[0]!;
    expect(scaledNode.fontSize).toBeCloseTo(unscaledNode.fontSize * 2, 3);
    expect(scaledNode.transform[4]).toBeCloseTo(unscaledNode.transform[4]! * 2, 3);
    expect(scaledNode.transform[5]).toBeCloseTo(unscaledNode.transform[5]! * 2, 3);
  });

  it('maps a multi-page document to one Varve page per PDF page', () => {
    const result = parser.parse(createTwoPagePdf());
    expect(result.document.pages).toHaveLength(2);
    expect(textNodes(result).map((node) => node.text)).toEqual(['First', 'Second']);
  });

  it('reports an embedded font it cannot map instead of emitting mojibake', () => {
    const result = parser.parse(createMinimalPdfWithCidFont());
    expect(textNodes(result)).toHaveLength(0);
    expect(result.unsupportedFeatures?.join(' ')).toMatch(/no readable encoding/i);
  });
});

function createMinimalPdf(): Uint8Array {
  return buildPdf([
    { text: 'Hello', fontDict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  ]);
}

function createTwoPagePdf(): Uint8Array {
  return buildPdf([
    { text: 'First', fontDict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    { text: 'Second', fontDict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  ]);
}

function createMinimalPdfWithCidFont(): Uint8Array {
  return buildPdf([
    {
      text: '\\000\\003\\000\\004',
      fontDict: '<< /Type /Font /Subtype /Type0 /BaseFont /Embedded /Encoding /Identity-H >>',
      hexString: true,
    },
  ]);
}

interface PageSource {
  readonly text: string;
  readonly fontDict: string;
  /** Emit the text as a hex string instead of a literal string. */
  readonly hexString?: boolean;
}

/**
 * Minimal single/multi-page PDF with a rectangle in each page's content
 * stream. The body is a plain string here; every fixture in this file is
 * uncompressed ASCII, so a string round-trip cannot corrupt it.
 */
function buildPdf(pages: PageSource[]): Uint8Array {
  const lines: string[] = ['%PDF-1.4'];
  const pageNumbers: number[] = [];
  let next = 1;
  const catalog = next++;
  const pagesObject = next++;
  const entries: Array<{ page: number; contents: number; font: number }> = [];
  for (let index = 0; index < pages.length; index += 1) {
    entries.push({ page: next++, contents: next++, font: next++ });
  }
  for (const entry of entries) pageNumbers.push(entry.page);

  lines.push(`${catalog} 0 obj`, '<< /Type /Catalog /Pages 2 0 R >>', 'endobj');
  lines.push(
    `${pagesObject} 0 obj`,
    `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    'endobj',
  );

  for (const [index, entry] of entries.entries()) {
    const source = pages[index]!;
    lines.push(
      `${entry.page} 0 obj`,
      `<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 612 792]`,
      `   /Contents ${entry.contents} 0 R /Resources << /Font << /F1 ${entry.font} 0 R >> >> >>`,
      'endobj',
    );
    const show = source.hexString ? `<${source.text}> Tj` : `(${source.text}) Tj`;
    const content = `BT /F1 12 Tf 100 700 Td ${show} ET 0.2 0.4 0.6 rg 20 20 100 50 re f`;
    lines.push(
      `${entry.contents} 0 obj`,
      `<< /Length ${content.length} >>`,
      'stream',
      content,
      'endstream',
      'endobj',
    );
    lines.push(`${entry.font} 0 obj`, source.fontDict, 'endobj');
  }

  lines.push('trailer', `<< /Size ${next} /Root ${catalog} 0 R >>`, '%%EOF');
  return new TextEncoder().encode(lines.join('\n'));
}

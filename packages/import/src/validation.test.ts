import { beforeEach, describe, expect, it } from 'vitest';
import { registerParser, resetRegistry } from './registry';
import { createSvgParser } from './svg';
import type { ImportParser } from './types';
import { validateImport } from './validation';

function makeValidationParser(
  format: string,
  extensions: string[],
  canParse: (data: string | Uint8Array) => boolean,
): ImportParser {
  return {
    format,
    supportedExtensions: () => extensions,
    canParse,
    parse: () => ({
      document: {
        id: '',
        name: '',
        formatVersion: '1',
        rootChildren: [],
        nodes: {},
        components: {},
        nextId: 1,
      },
      nodeIds: [],
      warnings: [],
    }),
  };
}

describe('validateImport', () => {
  beforeEach(() => {
    resetRegistry();
    registerParser(
      makeValidationParser('svg', ['svg'], (data) => {
        const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
        return str.trim().startsWith('<svg');
      }),
    );
    registerParser(
      makeValidationParser('pdf', ['pdf'], (data) => {
        if (typeof data === 'string') return false;
        return new TextDecoder().decode(data.slice(0, 5)) === '%PDF-';
      }),
    );
  });

  it('detects format from filename extension', async () => {
    const result = await validateImport('<svg><rect/></svg>', 'drawing.svg');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('svg');
  });

  it('reports unsupported features', async () => {
    const parser: ImportParser = {
      format: 'test',
      supportedExtensions: () => ['test'],
      canParse: () => true,
      parse: () => {
        const doc = {
          id: '',
          name: '',
          formatVersion: '1',
          rootChildren: ['n1'],
          nodes: { n1: { id: 'n1', kind: 'shape' as const, index: 0, name: 'Test' } },
          components: {},
          nextId: 2,
        };
        return {
          document: doc as never,
          nodeIds: ['n1'],
          warnings: ['Gradient fill unsupported', 'Pattern fill unsupported'],
        };
      },
    };
    resetRegistry();
    registerParser(parser);
    const result = await validateImport(new Uint8Array([0, 0, 0, 0, 0]), 'file.test');
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('uses SVG parser fidelity details instead of a blanket filter warning', async () => {
    registerParser(createSvgParser());
    const result = await validateImport(
      '<svg><defs><filter id="s"><feDropShadow dx="1" dy="1" stdDeviation="1"/></filter></defs><rect width="20" height="10" filter="url(#s)"/></svg>',
      'shadow.svg',
    );

    expect(result.unsupportedFeatures).toEqual([
      'SVG filter clipping region',
      'SVG feDropShadow blur semantics',
    ]);
    expect(result.warnings).not.toContain('SVG filters');
  });

  it('keeps SVG filter fidelity details when the filename extension mismatches', async () => {
    registerParser(createSvgParser());
    const result = await validateImport(
      '<svg><defs><filter id="s"><feDropShadow dx="1" dy="1" stdDeviation="1"/></filter></defs><rect width="20" height="10" filter="url(#s)"/></svg>',
      'shadow.png',
    );

    expect(result.format).toBe('svg');
    expect(result.unsupportedFeatures).toEqual([
      'SVG filter clipping region',
      'SVG feDropShadow blur semantics',
    ]);
    expect(result.warnings).toContain(
      'The filename extension .png does not match the detected SVG content; content detection was used.',
    );
  });

  it('estimates node count from structure analysis', async () => {
    const result = await validateImport(
      '<svg><rect/><circle/><text>hi</text></svg>',
      'drawing.svg',
    );
    expect(result.estimatedNodeCount).toBeGreaterThanOrEqual(1);
  });

  it('handles empty file gracefully', async () => {
    resetRegistry();
    registerParser(makeValidationParser('svg', ['svg'], () => false));
    const result = await validateImport(new Uint8Array(0), 'empty.svg');
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('handles corrupt file gracefully', async () => {
    resetRegistry();
    registerParser(makeValidationParser('pdf', ['pdf'], () => false));
    const result = await validateImport(new Uint8Array([255, 255, 255, 255]), 'corrupt.pdf');
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns invalid for unknown format', async () => {
    resetRegistry();
    const result = await validateImport(new Uint8Array([1, 2, 3, 4]), 'unknown.xyz');
    expect(result.valid).toBe(false);
    expect(result.format).toBe('xyz');
    expect(
      result.warnings.some(
        (w) => w.includes('Unknown') || w.includes('unknown') || w.includes('No parser'),
      ),
    ).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  findNonFiniteNumbers,
  NonFiniteDocumentError,
  repairNonFiniteNumbers,
} from './nonFinite';

describe('findNonFiniteNumbers', () => {
  it('finds Infinity and NaN at nested object, array and Map paths', () => {
    const document = {
      nodes: {
        shape: { opacity: Infinity, origin: { x: 0, y: 1 } },
        text: { size: Number.NaN },
      },
      rootChildren: ['shape', 'text'],
      rasterTiles: new Map([['tile-1', { x: -Infinity }]]),
    };

    const found = findNonFiniteNumbers(document);

    expect(found).toEqual(
      expect.arrayContaining([
        { path: 'nodes.shape.opacity', value: Infinity },
        { path: 'nodes.text.size', value: Number.NaN },
        { path: 'rasterTiles.tile-1.x', value: -Infinity },
      ]),
    );
    expect(found).toHaveLength(3);
  });

  it('skips typed-array binary payloads and reports at most the limit', () => {
    const bytes = new Float64Array([Infinity, 1, 2]);
    const document = {
      tileData: bytes,
      numeric: Infinity,
      nested: { a: Number.NaN, b: -Infinity, c: Number.POSITIVE_INFINITY },
    };

    expect(findNonFiniteNumbers(document, 2)).toEqual([
      { path: 'numeric', value: Infinity },
      { path: 'nested.a', value: Number.NaN },
    ]);
  });
});

describe('repairNonFiniteNumbers', () => {
  it('resets every non-finite number to zero, reports it, and copies only changed branches', () => {
    const unchanged = { width: 10, height: 20 };
    const document = {
      untouched: unchanged,
      nodes: { shape: { x: Infinity, y: 2 } },
      list: [0, Number.NaN],
      tileData: new Float64Array([Infinity]),
    };

    const result = repairNonFiniteNumbers(document);

    expect(result.repaired).toEqual(
      expect.arrayContaining([
        { path: 'nodes.shape.x', value: Infinity },
        { path: 'list[1]', value: Number.NaN },
      ]),
    );
    expect(result.document.nodes.shape).toEqual({ x: 0, y: 2 });
    expect(result.document.list).toEqual([0, 0]);
    // Binary payloads are pixel data, not document numbers, and are untouched.
    expect(result.document.tileData).toBe(document.tileData);
    expect(result.document.untouched).toEqual(unchanged);
  });

  it('returns the same object when there is nothing to repair', () => {
    const document = { a: 1, nested: [{ b: 2 }] };

    const result = repairNonFiniteNumbers(document);

    expect(result.document).toBe(document);
    expect(result.repaired).toEqual([]);
  });
});

describe('NonFiniteDocumentError', () => {
  it('names the offending fields and their values', () => {
    const error = new NonFiniteDocumentError([
      { path: 'nodes.shape.opacity', value: Infinity },
      { path: 'nodes.text.size', value: Number.NaN },
    ]);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NonFiniteDocumentError');
    expect(error.message).toContain('nodes.shape.opacity = Infinity');
    expect(error.message).toContain('nodes.text.size = NaN');
    expect(error.message).toContain('saving would replace it with null');
    expect(error.fields).toHaveLength(2);
  });
});

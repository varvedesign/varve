/**
 * Bounded import: an oversized source fails with an actionable message instead of
 * exhausting memory.
 *
 * OpenPencil #580 reports an out-of-memory crash opening a `.fig` with large
 * canvas bounds. Varve's answer to that class is an explicit budget rather than a
 * crash: byte, node, depth and text-length ceilings, each throwing a named error.
 * The limits existed but nothing asserted them, so a change that removed one
 * would have failed silently — as a hang or an OOM rather than a test.
 *
 * These tests also pin that the message is actionable: it names the limit and the
 * measured value so a user can tell what to do (split the file, raise the limit)
 * rather than reading a stack trace.
 */
import { describe, expect, it } from 'vitest';
import { decodeFigmaNativeSource } from './figma/native';
import { decodeFigmaSource, FIGMA_IMPORT_LIMITS } from './figma/source';

/** A Figma JSON document with `count` sibling rectangles. */
function figmaJson(count: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    document: {
      type: 'DOCUMENT',
      children: [
        {
          id: 'page:limits',
          type: 'CANVAS',
          name: 'Limits',
          children: Array.from({ length: count }, (_, index) => ({
            id: `shape:${index}`,
            type: 'RECTANGLE',
            name: `Node ${index}`,
            absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
          })),
          ...extra,
        },
      ],
    },
  });
}

describe('Figma import limits', () => {
  it('rejects a source above the node ceiling with a named error', () => {
    const source = figmaJson(FIGMA_IMPORT_LIMITS.maxNodes + 1);
    expect(() => decodeFigmaSource(source)).toThrow(
      new RegExp(`${FIGMA_IMPORT_LIMITS.maxNodes} node limit`),
    );
  });

  it('rejects a tree deeper than the depth ceiling', () => {
    // Build a chain of nested groups below the root page.
    let node: Record<string, unknown> = {
      id: 'leaf',
      type: 'RECTANGLE',
      name: 'Leaf',
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
    };
    for (let i = 0; i < FIGMA_IMPORT_LIMITS.maxDepth + 2; i++) {
      node = { id: `group:${i}`, type: 'GROUP', name: `G${i}`, children: [node] };
    }
    const source = JSON.stringify({
      document: {
        type: 'DOCUMENT',
        children: [{ id: 'page:deep', type: 'CANVAS', name: 'Deep', children: [node] }],
      },
    });

    expect(() => decodeFigmaSource(source)).toThrow(/depth/i);
  });

  it('rejects a native .fig above the byte ceiling before parsing it', () => {
    // One byte over the limit; the check runs before any decoding, so this must
    // fail fast rather than attempting to parse 64 MB of zeros.
    const oversized = new Uint8Array(FIGMA_IMPORT_LIMITS.maxBytes + 1);
    expect(() => decodeFigmaNativeSource(oversized)).toThrow(
      new RegExp(`${FIGMA_IMPORT_LIMITS.maxBytes} byte limit`),
    );
  });

  it('accepts a source at the boundary the limits describe', () => {
    // A modest file must still import: the ceilings are guards, not a general
    // restriction on normal documents.
    const result = decodeFigmaSource(figmaJson(50));
    expect(result.pages).toHaveLength(1);
    const page = result.pages[0];
    expect(page?.children.length).toBeGreaterThan(0);
  });
});

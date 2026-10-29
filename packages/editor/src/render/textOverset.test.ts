/**
 * Area-text overset measurement for preflight.
 *
 * External evidence: vectorcraft#1471 (area type overflow is not reported),
 * #2323 (the overflow indicator only appears once the frame is selected),
 * #2769 (CJK area text clips its last line with no indicator). Varve already
 * computed overflow while painting and threw it away.
 */
import type { RichTextMeasureContext } from '@varve/engine';
import { createDocument, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { measureTextOverset } from './textOverset';

/** Every character is 10px wide, so wrapping is predictable. */
function fixedWidthMeasure(): RichTextMeasureContext {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 10 }) as TextMetrics,
  };
}

function areaDoc(height: number, overrides: Record<string, unknown> = {}) {
  const doc = createDocument('Overset');
  const node = makeTextNode('t1', 'aaa bbb ccc', {
    textMode: 'area',
    w: 40,
    h: height,
    fontSize: 16,
    lineHeight: 1.2,
    ...overrides,
  });
  return { doc: { ...doc, nodes: { t1: node } } as typeof doc, node };
}

describe('measureTextOverset', () => {
  it('reports characters that do not fit a short frame', () => {
    const { doc } = areaDoc(20);
    const result = measureTextOverset(doc, fixedWidthMeasure());

    const info = result.map.get('t1');
    expect(info).toBeDefined();
    expect(info?.frameId).toBe('t1');
    expect(info?.oversetChars).toBeGreaterThan(0);
    expect(result.unmeasured).toEqual([]);
  });

  it('reports nothing when the frame fits the text', () => {
    const { doc } = areaDoc(400);
    const result = measureTextOverset(doc, fixedWidthMeasure());
    expect(result.map.size).toBe(0);
  });

  it('skips frames that follow their text', () => {
    // autoHeight: the frame grows with the content, so it cannot be overset.
    const { doc } = areaDoc(20, { textResizing: 'autoHeight' });
    const result = measureTextOverset(doc, fixedWidthMeasure());
    expect(result.map.size).toBe(0);
    expect(result.unmeasured).toEqual([]);
  });

  it('marks vertical writing unmeasured instead of guessing', () => {
    const { doc } = areaDoc(20, { writingMode: 'vertical-rl' });
    const result = measureTextOverset(doc, fixedWidthMeasure());
    expect(result.map.size).toBe(0);
    expect(result.unmeasured).toEqual(['t1']);
  });

  it('ignores point text and non-text nodes', () => {
    const { doc, node } = areaDoc(20);
    const pointText = makeTextNode('t2', 'hello', { textMode: 'point', fontSize: 16 });
    const result = measureTextOverset(
      { ...doc, nodes: { ...doc.nodes, t1: node, t2: pointText } } as typeof doc,
      fixedWidthMeasure(),
    );
    expect(result.map.has('t2')).toBe(false);
  });
});

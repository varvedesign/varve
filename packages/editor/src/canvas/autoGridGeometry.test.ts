import { createDocument, makeFrameNode } from '@varve/scene';
import { applyAffine, setTextAdvanceMeasurer } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { resolveAutoGridLines } from './autoGridGeometry';

describe('auto-grid track geometry', () => {
  it('uses resolved empty tracks and rotates their snap lines with the frame', () => {
    const doc = createDocument('Grid guides');
    const frame = {
      ...makeFrameNode('grid', { name: 'Grid', w: 330, h: 100 }),
      layoutStyle: {
        mode: 'grid' as const,
        direction: 'row' as const,
        gap: 0,
        columnGap: 10,
        wrap: false,
        padding: [5, 0, 0, 20] as [number, number, number, number],
        grow: 0,
        shrink: 0,
        layoutSemanticsVersion: 2 as const,
        gridColumnTracks: [
          { id: 'first', size: '100px' },
          { id: 'second', size: '1fr' },
        ],
        gridRowTracks: [{ id: 'row', size: '50px' }],
      },
    };
    const lines = resolveAutoGridLines(doc, frame);
    expect(resolveAutoGridLines(doc, frame)).toBe(lines);
    const resizedLines = resolveAutoGridLines(doc, { ...frame, w: 430 });
    expect(resizedLines).not.toBe(lines);
    expect(resizedLines.find((entry) => entry.id === 'column:second:end')?.start.x).toBe(430);
    expect(lines.filter((line) => line.axis === 'vertical').map((line) => line.start.x)).toEqual([
      20, 120, 130, 330,
    ]);
    expect(lines.find((line) => line.id === 'column:second:start')?.start).toEqual({
      x: 130,
      y: 0,
    });
    const line = lines.find((entry) => entry.id === 'column:second:start');
    if (!line) throw new Error('second track line missing');
    const rotatedStart = applyAffine([0, 1, -1, 0, 200, 50], [line.start.x, line.start.y]);
    const rotatedEnd = applyAffine([0, 1, -1, 0, 200, 50], [line.end.x, line.end.y]);
    expect(rotatedStart).toEqual([200, 180]);
    expect(rotatedEnd).toEqual([100, 180]);
  });

  it('invalidates resolved tracks when usable font measurements change', () => {
    const doc = createDocument('Font grid');
    const frame = {
      ...makeFrameNode('grid', { name: 'Grid', w: 200, h: 100 }),
      layoutStyle: {
        mode: 'grid' as const,
        direction: 'row' as const,
        gap: 0,
        wrap: false,
        padding: [0, 0, 0, 0] as [number, number, number, number],
        grow: 0,
        shrink: 0,
        gridColumnTracks: [{ id: 'auto', size: 'auto' }],
      },
    };
    const before = resolveAutoGridLines(doc, frame);
    setTextAdvanceMeasurer({ measureAdvance: () => null, revision: () => 'loaded-face-1' });
    try {
      const after = resolveAutoGridLines(doc, frame);
      expect(after).not.toBe(before);
      expect(resolveAutoGridLines(doc, frame)).toBe(after);
    } finally {
      setTextAdvanceMeasurer(null);
    }
  });
});

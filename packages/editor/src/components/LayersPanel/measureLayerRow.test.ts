import { Virtualizer } from '@tanstack/react-virtual';
import { describe, expect, it, vi } from 'vitest';
import { measureLayerRow } from './measureLayerRow';

function fixture() {
  const keys = ['first', 'second'];
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: keys.length,
    getScrollElement: () => null,
    getItemKey: (index) => keys[index]!,
    estimateSize: () => 32,
    observeElementRect: () => undefined,
    observeElementOffset: () => undefined,
    scrollToFn: vi.fn(),
  });
  virtualizer.getTotalSize();
  virtualizer.resizeItem(0, 37);
  virtualizer.resizeItem(1, 52);
  const row = document.createElement('div');
  row.dataset.index = '1';
  const observation = (height: number): ResizeObserverEntry => ({
    target: row,
    borderBoxSize: [{ blockSize: height, inlineSize: 180 }],
    contentBoxSize: [{ blockSize: height, inlineSize: 180 }],
    devicePixelContentBoxSize: [],
    contentRect: new DOMRect(0, 0, 180, height),
  });
  return { keys, row, virtualizer, observation };
}

describe('Layers row measurements across hidden surfaces', () => {
  it('keeps the measured size by identity when Home reports zero-height rows', () => {
    const { keys, row, virtualizer, observation } = fixture();
    keys.reverse();
    expect(measureLayerRow(row, observation(0), virtualizer)).toBe(37);
  });

  it('uses the density estimate for a row first measured while hidden', () => {
    const { row, virtualizer, observation } = fixture();
    virtualizer.measure();
    expect(measureLayerRow(row, observation(0), virtualizer)).toBe(32);
    expect(measureLayerRow(row, undefined, virtualizer)).toBe(32);
  });

  it('accepts a real positive size change after the row becomes visible', () => {
    const { row, virtualizer, observation } = fixture();
    const height = measureLayerRow(row, observation(43.75), virtualizer);
    virtualizer.resizeItem(1, height);
    expect(height).toBe(44);
    expect(measureLayerRow(row, observation(0), virtualizer)).toBe(44);
  });
});

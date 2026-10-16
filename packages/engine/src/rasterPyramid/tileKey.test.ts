import { describe, expect, it } from 'vitest';
import { l0Snapshot } from './tileKey';

const children = [
  { col: 0, row: 0 },
  { col: 1, row: 0 },
  { col: 0, row: 1 },
  { col: 1, row: 1 },
];

describe('l0Snapshot', () => {
  it('keeps the version-only form for tiles without a content identity', () => {
    const tiles = {
      '0:0': { version: 1 },
      '1:0': { version: 2 },
    };
    expect(l0Snapshot(children, tiles)).toBe('0:0:1;0:1:0;1:0:2;1:1:0');
  });

  it('distinguishes two tiles with the same version but different content identity', () => {
    const a = l0Snapshot(children, { '0:0': { version: 2, contentId: 7 } });
    const b = l0Snapshot(children, { '0:0': { version: 2, contentId: 8 } });
    expect(a).not.toBe(b);
  });

  it('is stable for the same version and content identity', () => {
    const a = l0Snapshot(children, { '0:0': { version: 2, contentId: 7 } });
    const b = l0Snapshot(children, { '0:0': { version: 2, contentId: 7 } });
    expect(a).toBe(b);
  });

  it('derives identity from the pixel buffer for scene-form (Map) tiles', () => {
    const shared = new Uint8ClampedArray(4);
    const sameBuffer = new Map([['0:0', { version: 2, pixels: shared }]]);
    const sameBufferAgain = new Map([['0:0', { version: 2, pixels: shared }]]);
    const otherBuffer = new Map([['0:0', { version: 2, pixels: new Uint8ClampedArray(4) }]]);
    expect(l0Snapshot(children, sameBuffer)).toBe(l0Snapshot(children, sameBufferAgain));
    expect(l0Snapshot(children, sameBuffer)).not.toBe(l0Snapshot(children, otherBuffer));
  });
});

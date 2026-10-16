/**
 * Tile `version` is a per-node mutation counter, not a content identity: after
 * undo, a branch switch or a replay, two different pixel states can carry the
 * same number. Anything that skips work because "the version matches" would
 * then show the wrong pixels. These tests pin the runtime identity token that
 * replaces version equality where pixels are cached.
 */
import { describe, expect, it } from 'vitest';
import { tilePixelsIdentity } from './rasterTileIdentity';

describe('tilePixelsIdentity', () => {
  it('is stable for one buffer and distinct across buffers, even with equal bytes', () => {
    const a = new Uint8ClampedArray(16).fill(7);
    const b = new Uint8ClampedArray(16).fill(7);
    expect(tilePixelsIdentity(a)).toBe(tilePixelsIdentity(a));
    expect(tilePixelsIdentity(a)).not.toBe(tilePixelsIdentity(b));
  });

  it('works for plain number arrays and never returns zero', () => {
    const arr = [1, 2, 3];
    expect(tilePixelsIdentity(arr)).toBeGreaterThan(0);
    expect(tilePixelsIdentity(arr)).toBe(tilePixelsIdentity(arr));
  });
});

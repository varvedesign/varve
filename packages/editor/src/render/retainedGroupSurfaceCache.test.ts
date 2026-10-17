import { describe, expect, it } from 'vitest';
import { RetainedGroupSurfaceCache } from './retainedGroupSurfaceCache';

function surface(width: number, height: number): HTMLCanvasElement {
  return { width, height } as HTMLCanvasElement;
}

describe('RetainedGroupSurfaceCache', () => {
  it('returns the retained drawable only for the same dependency identities', () => {
    const cache = new RetainedGroupSurfaceCache(1024);
    const group = {};
    const item = {};
    const key = cache.key(['doc-1', group, 'child', item, 16, 16])!;
    const drawable = surface(16, 16);

    expect(cache.get(key)).toBeNull();
    expect(cache.set(key, 'doc-1', drawable, 3)).toBe(true);
    expect(cache.get(key)?.canvas).toBe(drawable);
    expect(cache.key(['doc-1', group, 'child', {}, 16, 16])).not.toBe(key);
    expect(cache.diagnostics).toMatchObject({
      hits: 1,
      misses: 1,
      residentBytes: 1024,
      avoidedShapeLeaves: 3,
      avoidedRasterPixels: 256,
    });
  });

  it('length-prefixes arbitrary ids so separators cannot create key collisions', () => {
    const cache = new RetainedGroupSurfaceCache(1024);
    expect(cache.key(['alpha', 'beta'])).not.toBe(cache.key(['alpha|sbeta']));
  });

  it('evicts least-recently-used surfaces and never exceeds its byte budget', () => {
    const cache = new RetainedGroupSurfaceCache(512);
    const first = cache.key(['first'])!;
    const second = cache.key(['second'])!;
    cache.set(first, 'doc', surface(8, 8), 1);
    cache.set(second, 'doc', surface(8, 8), 1);
    cache.get(first);
    const third = cache.key(['third'])!;
    cache.set(third, 'doc', surface(8, 8), 1);

    expect(cache.get(first)).not.toBeNull();
    expect(cache.get(second)).toBeNull();
    expect(cache.diagnostics.residentBytes).toBe(512);
    expect(cache.diagnostics.evictions).toBe(1);
  });

  it('rejects oversized surfaces and retires surfaces when the active document changes', () => {
    const cache = new RetainedGroupSurfaceCache(512);
    const tooLarge = cache.key(['large'])!;
    expect(cache.set(tooLarge, 'doc-a', surface(16, 16), 1)).toBe(false);
    const key = cache.key(['small'])!;
    cache.set(key, 'doc-a', surface(8, 8), 1);
    cache.activateDocument('doc-b');

    expect(cache.get(key)).toBeNull();
    expect(cache.diagnostics.residentBytes).toBe(0);
    expect(cache.diagnostics.bypasses).toBe(1);
  });

  it('releases a closed document immediately', () => {
    const cache = new RetainedGroupSurfaceCache(512);
    const canvas = surface(8, 8);
    cache.set('closed-doc-entry', 'doc-a', canvas, 1);

    cache.closeDocument('doc-a');

    expect(cache.diagnostics.entries).toBe(0);
    expect(cache.diagnostics.residentBytes).toBe(0);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('clears owned surfaces when diagnostic cache bypass is enabled', () => {
    const cache = new RetainedGroupSurfaceCache(512);
    const key = cache.key(['group'])!;
    cache.set(key, 'doc', surface(8, 8), 1);
    cache.setEnabled(false);

    expect(cache.get(key)).toBeNull();
    expect(cache.diagnostics).toMatchObject({ enabled: false, entries: 0, residentBytes: 0 });
  });
});

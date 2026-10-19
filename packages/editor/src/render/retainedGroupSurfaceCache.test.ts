import { describe, expect, it } from 'vitest';
import {
  RETAINED_GROUP_MAX_ENTRIES,
  RETAINED_GROUP_MAX_KEY_CHARACTERS,
  RetainedGroupSurfaceCache,
} from './retainedGroupSurfaceCache';

function surface(width: number, height: number): HTMLCanvasElement {
  return Object.assign(new EventTarget(), {
    width,
    height,
    oncontextlost: null,
  }) as unknown as HTMLCanvasElement;
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

  it('retires a lost source surface and rebuilds it from the next authoritative composition', () => {
    const cache = new RetainedGroupSurfaceCache(1024);
    cache.setDetailedDiagnosticsEnabled(true);
    const key = cache.key(['doc', 'group'])!;
    const lostSurface = surface(8, 8);
    expect(cache.set(key, 'doc', lostSurface, 3, { groupId: 'group' })).toBe(true);

    lostSurface.dispatchEvent(new Event('contextlost'));

    expect(cache.diagnostics).toMatchObject({
      entries: 0,
      residentBytes: 0,
      evictions: 1,
      contextLosses: 1,
    });
    expect(cache.diagnostics.detailed?.bypasses.at(-1)).toEqual({
      reason: 'surface-context-lost',
      groupId: 'group',
    });
    expect(cache.get(key)).toBeNull();

    const rebuiltSurface = surface(8, 8);
    expect(cache.set(key, 'doc', rebuiltSurface, 3, { groupId: 'group' })).toBe(true);
    expect(cache.get(key)?.canvas).toBe(rebuiltSurface);
  });

  it('does not retain a surface when context loss cannot be observed', () => {
    const cache = new RetainedGroupSurfaceCache(1024);
    cache.setDetailedDiagnosticsEnabled(true);
    const key = cache.key(['doc', 'group'])!;
    const unsupportedSurface = { width: 8, height: 8 } as HTMLCanvasElement;

    expect(cache.set(key, 'doc', unsupportedSurface, 3, { groupId: 'group' })).toBe(false);
    expect(cache.diagnostics).toMatchObject({ entries: 0, residentBytes: 0, bypasses: 1 });
    expect(cache.diagnostics.detailed?.bypasses.at(-1)).toEqual({
      reason: 'context-loss-unobservable',
      groupId: 'group',
    });
  });

  it('bounds dependency key size and retained metadata entry count', () => {
    const cache = new RetainedGroupSurfaceCache(1024 * 1024);
    expect(cache.key(['x'.repeat(RETAINED_GROUP_MAX_KEY_CHARACTERS)])).toBeNull();
    cache.setDetailedDiagnosticsEnabled(true);
    cache.set('x'.repeat(RETAINED_GROUP_MAX_KEY_CHARACTERS + 1), 'doc', surface(1, 1), 1, {
      groupId: 'large-group',
      dependencyPath: ['large-group', 'child'],
    });
    expect(cache.diagnostics.detailed?.bypasses.at(-1)).toEqual({
      reason: 'dependency-key-too-large',
      groupId: 'large-group',
      dependencyPath: ['large-group', 'child'],
    });

    const keys = Array.from({ length: RETAINED_GROUP_MAX_ENTRIES + 1 }, (_, index) =>
      cache.key([`group-${index}`]),
    );
    const surfaces = keys.map(() => surface(1, 1));
    keys.forEach((key, index) => {
      cache.set(key!, 'doc', surfaces[index]!, 1);
    });

    expect(cache.diagnostics.entries).toBe(RETAINED_GROUP_MAX_ENTRIES);
    expect(cache.diagnostics.evictions).toBe(1);
    expect(cache.get(keys[0]!)).toBeNull();
    expect(cache.get(keys.at(-1)!)).not.toBeNull();
    expect(surfaces[0]).toMatchObject({ width: 0, height: 0 });
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

  it('evicts least-recently-used surfaces immediately when the budget shrinks', () => {
    const cache = new RetainedGroupSurfaceCache(512);
    const first = cache.key(['first'])!;
    const second = cache.key(['second'])!;
    const firstSurface = surface(8, 8);
    const secondSurface = surface(8, 8);
    cache.set(first, 'doc', firstSurface, 1);
    cache.set(second, 'doc', secondSurface, 1);
    cache.get(first);

    cache.setBudgetBytes(256);

    expect(cache.diagnostics).toMatchObject({ budgetBytes: 256, residentBytes: 256, entries: 1 });
    expect(cache.get(first)).not.toBeNull();
    expect(cache.get(second)).toBeNull();
    expect(cache.diagnostics.evictions).toBe(1);
    expect(firstSurface).toMatchObject({ width: 8, height: 8 });
    expect(secondSurface).toMatchObject({ width: 0, height: 0 });
  });

  it('clamps oversized and ignores invalid runtime budget updates', () => {
    const cache = new RetainedGroupSurfaceCache(128);

    cache.setBudgetBytes(Number.POSITIVE_INFINITY);
    cache.setBudgetBytes(Number.NaN);
    cache.setBudgetBytes(-1);
    expect(cache.diagnostics.budgetBytes).toBe(128);
    cache.setBudgetBytes(128 * 1024 * 1024);
    expect(cache.diagnostics.budgetBytes).toBe(64 * 1024 * 1024);
    expect(new RetainedGroupSurfaceCache(128 * 1024 * 1024).diagnostics.budgetBytes).toBe(
      64 * 1024 * 1024,
    );
  });

  it('rejects oversized surfaces and retains open-document surfaces until close or eviction', () => {
    const cache = new RetainedGroupSurfaceCache(512);
    const tooLarge = cache.key(['large'])!;
    expect(cache.set(tooLarge, 'doc-a', surface(16, 16), 1)).toBe(false);
    const docAKey = cache.key(['doc-a', 'group'])!;
    const docBKey = cache.key(['doc-b', 'group'])!;
    cache.set(docAKey, 'doc-a', surface(8, 8), 1);
    cache.set(docBKey, 'doc-b', surface(8, 8), 1);

    expect(cache.get(docAKey)).not.toBeNull();
    expect(cache.get(docBKey)).not.toBeNull();
    cache.closeDocument('doc-a');

    expect(cache.get(docAKey)).toBeNull();
    expect(cache.get(docBKey)).not.toBeNull();
    expect(cache.diagnostics.residentBytes).toBe(256);
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

    expect(cache.isEnabled).toBe(false);
    cache.setDetailedDiagnosticsEnabled(true);
    cache.recordDisabledBypass('group', ['group', 'child']);
    expect(cache.get(key)).toBeNull();
    expect(cache.diagnostics).toMatchObject({
      enabled: false,
      entries: 0,
      residentBytes: 0,
      bypasses: 2,
    });
    expect(cache.diagnostics.detailed?.bypasses.at(-1)).toMatchObject({
      reason: 'cache-disabled',
      groupId: 'group',
      dependencyPath: ['group', 'child'],
    });

    cache.setEnabled(true);
    expect(cache.isEnabled).toBe(true);
  });

  it('keeps detailed bypass, timing, and quality diagnostics bounded and opt-in', () => {
    const cache = new RetainedGroupSurfaceCache(1024);
    const group = {};
    const firstChild = {};
    const firstKey = cache.key(['doc', group, 'child', firstChild])!;
    expect(cache.diagnostics.detailed).toBeNull();

    cache.setDetailedDiagnosticsEnabled(true);
    cache.get(firstKey, {
      groupIdentity: 'doc:group',
      groupId: 'group',
      dependencyPath: ['group', 'child'],
    });
    expect(cache.diagnostics.detailed?.bypasses.at(-1)?.reason).toBe('untracked-miss');
    cache.set(firstKey, 'doc', surface(8, 8), 1, {
      groupIdentity: 'doc:group',
      groupId: 'group',
      dependencyPath: ['group', 'child'],
    });
    const changedKey = cache.key(['doc', group, 'child', {}])!;
    cache.get(changedKey, {
      groupIdentity: 'doc:group',
      groupId: 'group',
      dependencyPath: ['group', 'child'],
    });
    cache.recordAdmissionBypass('text-child', 'other-group', ['other-group', 'text']);
    cache.recordQuality({
      renderScale: 2,
      devicePixelRatio: 2,
      backingWidth: 32,
      backingHeight: 24,
    });
    cache.recordQuality({
      renderScale: 4,
      devicePixelRatio: 2,
      backingWidth: 64,
      backingHeight: 48,
    });
    const startedAt = cache.beginCompositionMeasurement();
    cache.finishCompositionMeasurement(startedAt);
    expect(cache.diagnostics.detailed?.bypasses).toEqual(
      expect.arrayContaining([
        { reason: 'untracked-miss', groupId: 'group', dependencyPath: ['group', 'child'] },
        {
          reason: 'dependency-key-changed',
          groupId: 'group',
          dependencyPath: ['group', 'child'],
        },
        {
          reason: 'text-child',
          groupId: 'other-group',
          dependencyPath: ['other-group', 'text'],
        },
      ]),
    );
    cache.set(changedKey, 'doc', surface(8, 8), 1, {
      groupIdentity: 'doc:group',
      groupId: 'group',
      dependencyPath: ['group', 'child'],
    });
    cache.clear();
    cache.get(changedKey, {
      groupIdentity: 'doc:group',
      groupId: 'group',
      dependencyPath: ['group', 'child'],
    });
    expect(cache.diagnostics.detailed?.bypasses.at(-1)?.reason).toBe('nonresident-miss');
    const longPath = Array.from({ length: 40 }, (_, index) => `node-${index}`);
    cache.recordAdmissionBypass('group-mask', 'large-group', longPath);
    expect(cache.diagnostics.detailed?.bypasses.at(-1)).toMatchObject({
      dependencyPath: longPath.slice(0, 32),
      dependencyPathTruncated: true,
    });
    for (let i = 0; i < 40; i++) {
      cache.recordAdmissionBypass('group-mask', `group-${i}`, [`group-${i}`]);
    }

    const detailed = cache.diagnostics.detailed!;
    expect(detailed.bypasses).toHaveLength(32);
    expect(detailed.bypasses.at(-1)).toMatchObject({
      reason: 'group-mask',
      groupId: 'group-39',
    });
    expect(detailed.quality).toMatchObject({ generation: 2, renderScale: 4, backend: 'canvas-2d' });
    expect(detailed.timings.keyBuildCount).toBeGreaterThan(0);
    expect(detailed.timings.lookupCount).toBe(3);
    expect(detailed.timings.compositionCount).toBe(1);
    for (let i = 0; i < 140; i++) {
      cache.set(`diagnostic-key-${i}`, 'doc', surface(1, 1), 1, {
        groupIdentity: `doc:group-${i}`,
      });
    }
    expect(cache.diagnostics.detailed?.trackedGroupKeys).toBe(128);
    expect(cache.diagnostics.detailed?.retainedBypassRecords).toBe(32);

    const hugeId = 'x'.repeat(1000);
    const overBudget = cache.key(['over-budget'])!;
    expect(
      cache.set(overBudget, 'doc', surface(32, 32), 1, {
        groupIdentity: hugeId,
        groupId: hugeId,
        dependencyPath: [hugeId],
      }),
    ).toBe(false);
    const sizeBypass = cache.diagnostics.detailed?.bypasses.at(-1);
    expect(sizeBypass).toMatchObject({
      reason: 'surface-over-budget',
      groupId: `${'x'.repeat(127)}…`,
      dependencyPath: [`${'x'.repeat(127)}…`],
    });
    expect(sizeBypass?.groupId?.length).toBeLessThanOrEqual(128);
    expect(sizeBypass?.dependencyPath?.[0]?.length).toBeLessThanOrEqual(128);
    cache.recordAdmissionBypass('group-mask', hugeId, [hugeId]);
    expect(cache.diagnostics.detailed?.bypasses.at(-1)).toMatchObject({
      reason: 'group-mask',
      groupId: `${'x'.repeat(127)}…`,
      dependencyPath: [`${'x'.repeat(127)}…`],
    });
    cache.get(overBudget, {
      groupIdentity: hugeId,
      groupId: hugeId,
      dependencyPath: [hugeId],
    });
    expect(cache.diagnostics.detailed?.bypasses.at(-1)).toMatchObject({
      reason: 'untracked-miss',
      groupId: `${'x'.repeat(127)}…`,
    });

    cache.setDetailedDiagnosticsEnabled(false);
    expect(cache.diagnostics.detailed).toBeNull();
  });
});

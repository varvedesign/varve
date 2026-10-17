import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEMORY_BUDGETS,
  getAdaptiveCacheLimits,
  getMemoryBudgets,
  resolvePressureBudgets,
} from '../memoryBudget';

describe('memoryBudget', () => {
  it('returns the default budgets when no preference is given', () => {
    expect(getMemoryBudgets()).toEqual(DEFAULT_MEMORY_BUDGETS);
    expect(getMemoryBudgets(undefined)).toEqual(DEFAULT_MEMORY_BUDGETS);
  });

  it('returns the default budgets for an unrecognised preference', () => {
    expect(getMemoryBudgets('ultra' as 'low')).toEqual(DEFAULT_MEMORY_BUDGETS);
  });

  it('low tightens the IR cache, backdrop cache, and transform cache', () => {
    const budgets = getMemoryBudgets('low');
    expect(budgets.subtreeIrCacheBytes).toBe(10 * 1024 * 1024);
    expect(budgets.retainedGroupSurfaceBytes).toBe(8 * 1024 * 1024);
    expect(budgets.backdropCacheEntries).toBe(5);
    expect(budgets.transformCacheEntries).toBe(2000);
    expect(budgets.gradientCacheEntries).toBe(DEFAULT_MEMORY_BUDGETS.gradientCacheEntries);
    expect(budgets.workerImageBitmaps).toBe(DEFAULT_MEMORY_BUDGETS.workerImageBitmaps);
    expect(budgets.thumbnailCacheEntries).toBe(DEFAULT_MEMORY_BUDGETS.thumbnailCacheEntries);
    expect(budgets.imageCacheBytes).toBe(64 * 1024 * 1024);
  });

  it('low halves the worker bitmap byte budget relative to the default', () => {
    const budgets = getMemoryBudgets('low');
    expect(budgets.workerBitmapBytes).toBe(64 * 1024 * 1024);
    expect(DEFAULT_MEMORY_BUDGETS.workerBitmapBytes).toBe(128 * 1024 * 1024);
  });

  it('medium only widens the IR cache relative to the default', () => {
    const budgets = getMemoryBudgets('medium');
    expect(budgets.subtreeIrCacheBytes).toBe(25 * 1024 * 1024);
    expect(budgets.retainedGroupSurfaceBytes).toBe(
      DEFAULT_MEMORY_BUDGETS.retainedGroupSurfaceBytes,
    );
    expect(budgets.transformCacheEntries).toBe(DEFAULT_MEMORY_BUDGETS.transformCacheEntries);
    expect(budgets.backdropCacheEntries).toBe(DEFAULT_MEMORY_BUDGETS.backdropCacheEntries);
    expect(budgets.imageCacheBytes).toBe(DEFAULT_MEMORY_BUDGETS.imageCacheBytes);
  });

  it('high widens the IR and decoded-image caches beyond the default', () => {
    const budgets = getMemoryBudgets('high');
    expect(budgets.subtreeIrCacheBytes).toBe(200 * 1024 * 1024);
    expect(budgets.retainedGroupSurfaceBytes).toBe(64 * 1024 * 1024);
    expect(budgets.transformCacheEntries).toBe(DEFAULT_MEMORY_BUDGETS.transformCacheEntries);
    expect(budgets.imageCacheBytes).toBe(512 * 1024 * 1024);
  });

  it('ranks the presets in ascending IR cache size: low < medium < default < high', () => {
    const low = getMemoryBudgets('low');
    const medium = getMemoryBudgets('medium');
    const high = getMemoryBudgets('high');
    expect(low.subtreeIrCacheBytes).toBeLessThan(medium.subtreeIrCacheBytes);
    expect(low.retainedGroupSurfaceBytes).toBeLessThan(medium.retainedGroupSurfaceBytes);
    expect(medium.retainedGroupSurfaceBytes).toBeLessThan(high.retainedGroupSurfaceBytes);
    expect(medium.subtreeIrCacheBytes).toBeLessThan(DEFAULT_MEMORY_BUDGETS.subtreeIrCacheBytes);
    expect(DEFAULT_MEMORY_BUDGETS.subtreeIrCacheBytes).toBeLessThan(high.subtreeIrCacheBytes);
    expect(low.imageCacheBytes).toBeLessThan(medium.imageCacheBytes);
    expect(medium.imageCacheBytes).toBeLessThan(high.imageCacheBytes);
  });

  it('restores configured cache limits when the adaptive profile recovers', () => {
    const budgets = getMemoryBudgets('low');

    expect(getAdaptiveCacheLimits(budgets, 0.25)).toEqual({
      subtreeIrCacheBytes: 2.5 * 1024 * 1024,
      retainedGroupSurfaceBytes: 2 * 1024 * 1024,
      engineNodeMemoEntries: 1000,
    });
    expect(getAdaptiveCacheLimits(budgets, 1)).toEqual({
      subtreeIrCacheBytes: budgets.subtreeIrCacheBytes,
      retainedGroupSurfaceBytes: budgets.retainedGroupSurfaceBytes,
      engineNodeMemoEntries: budgets.engineNodeMemoEntries,
    });
  });

  it('treats the configured memory preset as a ceiling', () => {
    const budgets = getMemoryBudgets('low');
    expect(getAdaptiveCacheLimits(budgets, 2)).toEqual({
      subtreeIrCacheBytes: budgets.subtreeIrCacheBytes,
      retainedGroupSurfaceBytes: budgets.retainedGroupSurfaceBytes,
      engineNodeMemoEntries: budgets.engineNodeMemoEntries,
    });
  });

  it('uses tighter retained-group surface budgets for low-memory device profiles', () => {
    expect(resolvePressureBudgets('2gb').retainedGroupSurfaceBytes).toBe(4 * 1024 * 1024);
    expect(resolvePressureBudgets('4gb').retainedGroupSurfaceBytes).toBe(8 * 1024 * 1024);
    const high = getMemoryBudgets('high');
    expect(getAdaptiveCacheLimits(high, 1, '2gb').retainedGroupSurfaceBytes).toBe(4 * 1024 * 1024);
    expect(getAdaptiveCacheLimits(high, 1, '4gb').retainedGroupSurfaceBytes).toBe(8 * 1024 * 1024);
  });
});

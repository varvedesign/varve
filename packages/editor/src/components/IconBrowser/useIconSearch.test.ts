// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { getIconProviderRegistry, resetIconProviderRegistry } from '@varve/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEBOUNCE_MS, useIconSearch } from './useIconSearch';

afterEach(() => {
  resetIconProviderRegistry();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  resetIconProviderRegistry();
});

function stubRegistrySearch() {
  const registry = getIconProviderRegistry();
  return vi.spyOn(registry, 'search').mockResolvedValue({
    items: [],
    total: 0,
    start: 0,
    exhausted: true,
  });
}

describe('useIconSearch remote consent', () => {
  it('makes no provider request before remote search is allowed', async () => {
    vi.useFakeTimers();
    const search = stubRegistrySearch();
    const { result } = renderHook(() => useIconSearch(false));

    await act(async () => {
      result.current.search('home');
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });

    expect(search).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
  });

  it('searches the registry after remote search is allowed', async () => {
    vi.useFakeTimers();
    const search = stubRegistrySearch();
    const { result, rerender } = renderHook(({ allowed }) => useIconSearch(allowed), {
      initialProps: { allowed: false },
    });

    await act(async () => {
      result.current.search('home');
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(search).not.toHaveBeenCalled();

    rerender({ allowed: true });
    await act(async () => {
      result.current.search('home');
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(search).toHaveBeenCalled();
  });
});

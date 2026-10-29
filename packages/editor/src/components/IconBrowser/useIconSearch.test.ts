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

  it('aborts an in-flight provider request when remote search is revoked', async () => {
    vi.useFakeTimers();
    const search = stubRegistrySearch();
    const { result, rerender } = renderHook(({ allowed }) => useIconSearch(allowed), {
      initialProps: { allowed: true },
    });

    await act(async () => {
      result.current.search('home');
    });
    expect(search).not.toHaveBeenCalled();

    rerender({ allowed: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(search).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
  });

  it('clears previous results when the query is shortened below two characters', async () => {
    vi.useFakeTimers();
    stubRegistrySearch().mockResolvedValue({
      items: [
        {
          canonicalId: 'iconify:mdi:home',
          providerId: 'iconify',
          packId: 'mdi',
          iconId: 'home',
          name: 'home',
          displayName: 'Remote Home',
          aliases: [],
          keywords: [],
          categories: [],
          styles: ['outline'],
          paletteType: 'monotone',
          licence: {},
          isOfflineAvailable: false,
        },
      ],
      total: 1,
      start: 0,
      exhausted: true,
    });
    const { result } = renderHook(() => useIconSearch(true));

    await act(async () => {
      result.current.search('home');
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(result.current.results).toHaveLength(1);

    await act(async () => {
      result.current.search('h');
    });
    expect(result.current.results).toEqual([]);
  });
});

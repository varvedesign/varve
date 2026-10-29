/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { createMemoryPlatform, makeFileEntry } from '@varve/platform';
import { thumbnailVariantForDevice } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  fileThumbnailIdentity,
  thumbnailIdentityCandidates,
  useThumbnailLoader,
} from './useThumbnailLoader';

describe('useThumbnailLoader cache repair', () => {
  it('asks the host renderer to repair a missing thumbnail', async () => {
    const platform = createMemoryPlatform();
    const entry = makeFileEntry({ id: 'file-1', name: 'Legacy design' });
    await platform.upsertFile(entry, JSON.stringify({ id: 'file-1' }));
    const savedEntry = (await platform.getFile(entry.id))!;
    const dataUrl = 'data:image/png;base64,thumbnail';
    const generate = vi.fn().mockResolvedValue(dataUrl);

    const { result } = renderHook(() => useThumbnailLoader(platform, generate));
    act(() => result.current.load(savedEntry));

    await waitFor(() => expect(result.current.thumbnails.get(entry.id)).toBe(dataUrl));
    expect(generate).toHaveBeenCalledOnce();
  });

  it('does not invoke repair when a canonical thumbnail exists', async () => {
    const platform = createMemoryPlatform();
    const entry = makeFileEntry({ id: 'file-2', name: 'Cached design' });
    await platform.upsertFile(entry, JSON.stringify({ id: 'file-2', rootChildren: [], nodes: {} }));
    const savedEntry = (await platform.getFile(entry.id))!;
    const canonical = fileThumbnailIdentity(savedEntry);
    await platform.putThumbnail({
      hash: canonical.key,
      dataUrl: 'data:image/png;base64,cached',
      width: 256,
      height: 192,
      createdAt: Date.now(),
    });
    const generate = vi.fn().mockResolvedValue('data:image/png;base64,generated');

    const { result } = renderHook(() => useThumbnailLoader(platform, generate));
    act(() => result.current.load(savedEntry));

    await waitFor(() =>
      expect(result.current.thumbnails.get(entry.id)).toBe('data:image/png;base64,cached'),
    );
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('thumbnailIdentityCandidates', () => {
  it('has one candidate at 1x', () => {
    const entry = makeFileEntry({ id: 'file-1x', name: 'Standard display' });
    expect(thumbnailIdentityCandidates(entry)).toHaveLength(1);
  });

  it('tries the 2x identity first and the 1x identity second', () => {
    const entry = makeFileEntry({ id: 'file-2x', name: 'HiDPI display' });
    const candidates = thumbnailIdentityCandidates(
      entry,
      thumbnailVariantForDevice('home-card', 2),
    );
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.key).not.toBe(candidates[1]?.key);
    expect(candidates[1]?.key).toBe(fileThumbnailIdentity(entry).key);
  });
});

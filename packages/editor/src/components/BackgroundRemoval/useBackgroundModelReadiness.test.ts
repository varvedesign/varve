// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BackgroundRemovalReadiness, RemovalMethod } from '@varve/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  ready: vi.fn(),
  loader: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock('@varve/engine', () => ({
  getBackgroundRemovalReadiness: boundary.ready,
  getModelLoaderReady: boundary.loader,
}));

import { useBackgroundModelReadiness } from './useBackgroundModelReadiness';

const installed: BackgroundRemovalReadiness = {
  modelId: 'u2netp',
  installed: true,
  canAttempt: true,
  runtime: 'Browser CPU',
  summary: 'Installed',
  recovery: null,
  enhancedInstalled: false,
};
const loader = {
  subscribe: boundary.subscribe,
  getState: () => 'ready',
  getCurrentModelId: () => 'u2netp',
};

describe('inline model readiness lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.subscribe.mockReturnValue(boundary.unsubscribe);
    boundary.loader.mockResolvedValue(loader);
    boundary.ready.mockResolvedValue(installed);
  });

  it('does not subscribe when initialization completes after unmount', async () => {
    let resolve!: (value: typeof loader) => void;
    boundary.loader.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = renderHook(() => useBackgroundModelReadiness('ai-balanced', true));
    view.unmount();
    await act(async () => resolve(loader));
    expect(boundary.subscribe).not.toHaveBeenCalled();
  });

  it('does not publish an old model check after the user changes method', async () => {
    let oldCheck!: (value: BackgroundRemovalReadiness) => void;
    boundary.ready.mockImplementation((method: RemovalMethod) =>
      method === 'ai-balanced'
        ? new Promise((done) => {
            oldCheck = done;
          })
        : Promise.resolve({
            ...installed,
            modelId: 'birefnet-general-lite',
            installed: false,
            canAttempt: false,
          }),
    );
    const view = renderHook(({ method }) => useBackgroundModelReadiness(method, true), {
      initialProps: { method: 'ai-balanced' as RemovalMethod },
    });
    await waitFor(() => expect(boundary.ready).toHaveBeenCalledWith('ai-balanced'));
    view.rerender({ method: 'ai-quality' });
    expect(view.result.current.readiness).toBeNull();
    await waitFor(() =>
      expect(view.result.current.readiness?.modelId).toBe('birefnet-general-lite'),
    );
    await act(async () => oldCheck(installed));
    expect(view.result.current.readiness?.installed).toBe(false);
    view.unmount();
    expect(boundary.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('allows retry after a failed status check without losing the current method', async () => {
    boundary.ready.mockRejectedValueOnce(new Error('Could not inspect model storage.'));
    const view = renderHook(() => useBackgroundModelReadiness('ai-balanced', true));
    await waitFor(() => expect(view.result.current.error).toContain('storage'));
    act(() => view.result.current.refresh());
    await waitFor(() => expect(view.result.current.readiness).toEqual(installed));
    expect(view.result.current.error).toBeNull();
  });
});

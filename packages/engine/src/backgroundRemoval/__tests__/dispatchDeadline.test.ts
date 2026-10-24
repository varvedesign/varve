import { setDerivedWorkMemoryProfile } from '@varve/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providers = vi.hoisted(() => ({
  worker: { id: 'worker', isAvailable: vi.fn(), remove: vi.fn() },
  direct: { id: 'direct', isAvailable: vi.fn(), remove: vi.fn() },
  native: { id: 'native', isAvailable: vi.fn(), remove: vi.fn() },
  cloud: { id: 'cloud', isAvailable: vi.fn(), remove: vi.fn() },
  ready: vi.fn(),
}));
vi.mock('../providers/workerProvider', () => ({ workerRemovalProvider: providers.worker }));
vi.mock('../providers/directOnnxProvider', () => ({ directOnnxRemovalProvider: providers.direct }));
vi.mock('../providers/tauriProvider', () => ({
  tauriRemovalProvider: providers.native,
  isNativeAiReady: providers.ready,
}));
vi.mock('../providers/cloudProvider', () => ({ cloudRemovalProvider: providers.cloud }));

import { dispatchBackgroundRemoval } from '../providers/dispatch';

const pending = () => new Promise<never>(() => {});

describe('background removal request budget', () => {
  let settleExecutions: Array<() => void>;
  beforeEach(() => {
    // The 2x2 fixtures exercise deadline behavior on the documented 8 GB
    // reference profile; the quality reservation must fit before timing out.
    setDerivedWorkMemoryProfile('reference-8gb');
    vi.useFakeTimers();
    vi.resetAllMocks();
    settleExecutions = [];
    const pendingExecution = () =>
      new Promise<void>((resolve) => {
        settleExecutions.push(resolve);
      });
    providers.ready.mockResolvedValue(false);
    providers.worker.isAvailable.mockResolvedValue(true);
    providers.worker.remove.mockImplementation(pendingExecution);
    providers.direct.isAvailable.mockResolvedValue(true);
    providers.direct.remove.mockImplementation(pendingExecution);
    providers.native.isAvailable.mockResolvedValue(false);
    providers.cloud.isAvailable.mockResolvedValue(false);
  });
  afterEach(async () => {
    for (const settle of settleExecutions) settle();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    setDerivedWorkMemoryProfile('unknown-or-4gb');
  });

  it('bounds the entire Auto request and aborts the active attempt', async () => {
    const result = dispatchBackgroundRemoval(new ImageData(2, 2), { method: 'ai-balanced' });
    const rejected = expect(result).rejects.toThrow(/deadline/i);
    await vi.advanceTimersByTimeAsync(125_001);
    await rejected;
    expect(providers.worker.remove.mock.calls[0]?.[2].aborted).toBe(true);
    expect(providers.direct.remove).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a second quality chain after exhausting the request', async () => {
    const result = dispatchBackgroundRemoval(new ImageData(2, 2), { method: 'ai-quality' });
    const rejected = expect(result).rejects.toThrow(/deadline/i);
    await vi.advanceTimersByTimeAsync(310_001);
    await rejected;
    expect(providers.worker.remove).toHaveBeenCalledTimes(1);
    expect(providers.direct.remove).not.toHaveBeenCalled();
  });

  it('bounds native readiness and continues with compatible browser providers', async () => {
    providers.ready.mockImplementation(pending);
    providers.worker.remove.mockResolvedValue({ method: 'ai-balanced' });
    const result = dispatchBackgroundRemoval(new ImageData(2, 2), { method: 'ai-balanced' });
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(result).resolves.toMatchObject({ method: 'ai-balanced' });
  });

  it('does not substitute Balanced after a High quality provider fails', async () => {
    providers.worker.remove.mockImplementation(async (_image, options) => {
      if (options.method === 'ai-quality') throw new Error('model execution failed');
      return { method: 'ai-balanced' };
    });
    providers.direct.isAvailable.mockResolvedValue(false);
    await expect(
      dispatchBackgroundRemoval(new ImageData(2, 2), {
        method: 'ai-quality',
      }),
    ).rejects.toThrow(/quality|model/i);
    expect(providers.worker.remove).toHaveBeenCalledTimes(1);
  });

  it('cleans deadline timers when cancelled even if the provider never settles', async () => {
    const controller = new AbortController();
    const result = dispatchBackgroundRemoval(
      new ImageData(2, 2),
      { method: 'ai-balanced' },
      controller.signal,
    );
    const rejected = expect(result).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});

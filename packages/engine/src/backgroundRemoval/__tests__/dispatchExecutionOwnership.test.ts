import { setDerivedWorkMemoryProfile } from '@varve/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providers = vi.hoisted(() => ({
  native: { id: 'tauri-native', isAvailable: vi.fn(), remove: vi.fn() },
  worker: { id: 'worker', isAvailable: vi.fn(), remove: vi.fn() },
}));
vi.mock('../providers/tauriProvider', () => ({
  tauriRemovalProvider: providers.native,
  isNativeAiReady: async () => true,
}));
vi.mock('../providers/workerProvider', () => ({ workerRemovalProvider: providers.worker }));
vi.mock('../providers/directOnnxProvider', () => ({
  directOnnxRemovalProvider: { id: 'direct', isAvailable: () => false },
}));
vi.mock('../providers/cloudProvider', () => ({
  cloudRemovalProvider: { id: 'cloud', isAvailable: () => false },
}));

import { getInferenceAdmission } from '../../inference/admission';
import { dispatchBackgroundRemoval } from '../providers/dispatch';

describe('background removal execution ownership', () => {
  let finish: () => void;

  beforeEach(() => {
    setDerivedWorkMemoryProfile('reference-8gb');
    vi.useFakeTimers();
    vi.resetAllMocks();
    providers.native.isAvailable.mockResolvedValue(true);
    providers.worker.isAvailable.mockResolvedValue(true);
    providers.native.remove.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
  });

  afterEach(async () => {
    finish();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    setDerivedWorkMemoryProfile('unknown-or-4gb');
  });

  it('retains admission after caller cancellation until native execution actually settles', async () => {
    const controller = new AbortController();
    const result = dispatchBackgroundRemoval(
      new ImageData(2, 2),
      { method: 'ai-quality' },
      controller.signal,
    );
    const rejected = expect(result).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejected;
    expect(providers.native.remove.mock.calls[0]?.[2].aborted).toBe(true);
    expect(getInferenceAdmission().getSnapshot().active).toBe(1);
    expect(providers.worker.remove).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(getInferenceAdmission().getSnapshot().active).toBe(0);
  });

  it('retains admission after a deadline until the timed-out native call settles', async () => {
    const result = dispatchBackgroundRemoval(new ImageData(2, 2), { method: 'ai-quality' });
    const rejected = expect(result).rejects.toThrow(/deadline/i);
    await vi.advanceTimersByTimeAsync(310_001);
    await rejected;
    expect(getInferenceAdmission().getSnapshot().active).toBe(1);
    expect(providers.worker.remove).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(getInferenceAdmission().getSnapshot().active).toBe(0);
  });
});

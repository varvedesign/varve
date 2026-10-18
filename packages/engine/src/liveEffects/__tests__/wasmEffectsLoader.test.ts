import { afterEach, describe, expect, it, vi } from 'vitest';
import { canUseWasmEffect, loadWasmEffectsBeforeDeadline } from '../wasmEffectsLoader';

afterEach(() => vi.useRealTimers());

describe('WASM effect preview compatibility', () => {
  it('keeps unverified or slower variants on the TS reference path', () => {
    const request = (effect: string, params: Record<string, unknown> = {}) =>
      ({ effect, width: 112, height: 72, quality: 'interactive', params }) as never;
    expect(canUseWasmEffect(request('bloom'))).toBe(false);
    expect(canUseWasmEffect(request('paletteSnap'))).toBe(false);
    expect(canUseWasmEffect(request('dither', { algorithm: 'bayer', paletteMode: 'levels' }))).toBe(
      false,
    );
    expect(canUseWasmEffect(request('dither', { paletteMode: 'none' }))).toBe(false);
    expect(canUseWasmEffect(request('dither', { algorithm: 'floyd-steinberg' }))).toBe(true);
    expect(canUseWasmEffect(request('caustics'))).toBe(true);
  });

  it('returns to the caller on a stalled cold load so the worker can use CPU fallback', async () => {
    vi.useFakeTimers();
    let loadSignal: AbortSignal | undefined;
    const pending = loadWasmEffectsBeforeDeadline((signal) => {
      loadSignal = signal;
      return new Promise<null>((resolve) => {
        signal.addEventListener('abort', () => resolve(null), { once: true });
      });
    }, 20);

    await vi.advanceTimersByTimeAsync(20);
    await expect(pending).resolves.toBeNull();
    expect(loadSignal?.aborted).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { canUseWasmEffect } from '../wasmEffectsLoader';

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
});

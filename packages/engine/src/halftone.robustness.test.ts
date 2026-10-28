import { describe, expect, it } from 'vitest';
import {
  applyAMScreening,
  applyBayerDithering,
  applyFMStochastic,
  applyHalftone,
  type HalftoneParams,
} from './halftone';
import { fillGradient } from './halftone.test-helpers';

// ── Malformed parameter robustness (persisted-document tolerance) ──────

describe('halftone malformed parameter robustness', () => {
  it('NaN frequency does not throw and still produces screened output (AM)', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    expect(() =>
      applyAMScreening(data, {
        pattern: 'dot',
        frequency: Number.NaN,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
      }),
    ).not.toThrow();
    // Degrades to the default 45 LPI — dots still appear
    let dark = 0;
    let light = 0;
    for (let i = 0; i < data.data.length; i += 4) {
      if (data.data[i]! < 110) dark++;
      if (data.data[i]! > 145) light++;
    }
    expect(dark).toBeGreaterThan(0);
    expect(light).toBeGreaterThan(0);
  });

  it('NaN angle does not throw (AM)', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    expect(() =>
      applyAMScreening(data, {
        pattern: 'dot',
        frequency: 20,
        angle: Number.NaN,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
      }),
    ).not.toThrow();
  });

  it('NaN threshold degrades to 128 (AM)', () => {
    const dataDefault = new ImageData(32, 32);
    const dataNan = new ImageData(32, 32);
    fillGradient(dataDefault, 32, 32);
    fillGradient(dataNan, 32, 32);
    const base = {
      pattern: 'dot' as const,
      frequency: 20,
      angle: 45,
      dotShape: 'round' as const,
      channel: 'k' as const,
      method: 'am' as const,
    };
    applyAMScreening(dataDefault, base);
    applyAMScreening(dataNan, { ...base, threshold: Number.NaN });
    expect(Array.from(dataDefault.data)).toEqual(Array.from(dataNan.data));
  });

  it('infinite threshold does not throw (Bayer)', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    expect(() =>
      applyBayerDithering(
        data,
        {
          pattern: 'dot',
          frequency: 10,
          angle: 0,
          dotShape: 'round',
          channel: 'k',
          method: 'fm',
          threshold: Number.POSITIVE_INFINITY,
        },
        0,
        0,
      ),
    ).not.toThrow();
  });

  it('negative and >360 angles render without throwing and are periodic', () => {
    const dataNeg = new ImageData(32, 32);
    const dataPos = new ImageData(32, 32);
    fillGradient(dataNeg, 32, 32);
    fillGradient(dataPos, 32, 32);
    const base = {
      pattern: 'dot' as const,
      frequency: 20,
      dotShape: 'round' as const,
      channel: 'k' as const,
      method: 'am' as const,
    };
    // -30deg and 330deg are the same screen orientation
    applyAMScreening(dataNeg, { ...base, angle: -30 });
    applyAMScreening(dataPos, { ...base, angle: 330 });
    expect(Array.from(dataNeg.data)).toEqual(Array.from(dataPos.data));
  });

  it('zero-size ImageData does not throw across all paths', () => {
    const empty = new ImageData(0, 0);
    const base = {
      pattern: 'dot' as const,
      frequency: 20,
      angle: 45,
      dotShape: 'round' as const,
      channel: 'k' as const,
      method: 'am' as const,
    };
    expect(() => applyAMScreening(empty, base)).not.toThrow();
    expect(() => applyFMStochastic(empty, base)).not.toThrow();
    expect(() => applyBayerDithering(empty, base, 0, 0)).not.toThrow();
  });

  it('extreme frequency values clamp instead of corrupting (AM)', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    expect(() =>
      applyAMScreening(data, {
        pattern: 'dot',
        frequency: 1e9,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
      }),
    ).not.toThrow();
    for (let i = 0; i < data.data.length; i += 4) {
      expect(data.data[i]!).toBeGreaterThanOrEqual(0);
      expect(data.data[i]!).toBeLessThanOrEqual(255);
    }
  });

  it('negative intensity and softness clamp to their safe ranges (FM)', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    expect(() =>
      applyFMStochastic(data, {
        pattern: 'dot',
        frequency: 10,
        angle: 0,
        dotShape: 'round',
        channel: 'k',
        method: 'fm',
        intensity: -5,
        softness: -1,
      }),
    ).not.toThrow();
  });
});

// ── Document anchoring: pan/zoom phase stability ───────────────────────

describe('halftone document anchoring', () => {
  function flatGray(w: number, h: number, gray: number): ImageData {
    const data = new ImageData(w, h);
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = gray;
      data.data[i + 1] = gray;
      data.data[i + 2] = gray;
      data.data[i + 3] = 255;
    }
    return data;
  }

  it('AM pattern phase is invariant under region offsets (pan stability)', () => {
    // The same flat fill screened at region origin (0,0) and at region
    // origin (10,5) must produce identical pixels at matching document
    // positions: doc (x+10, y+5) in the offset image == doc (x, y) in the
    // origin image.
    const w = 64;
    const h = 64;
    const origin = flatGray(w, h, 128);
    const offset = flatGray(w, h, 128);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 12,
      angle: 25,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };
    applyAMScreening(origin, params, 1, 0, 0);
    applyAMScreening(offset, params, 1, 10, 5);

    // Offset-image pixel (x, y) sits at doc (x+10, y+5); origin-image pixel
    // (x+10, y+5) sits at the same document position. Both must be equal.
    for (let y = 0; y < h - 5; y++) {
      for (let x = 0; x < w - 10; x++) {
        const iOrigin = ((y + 5) * w + (x + 10)) * 4;
        const iOffset = (y * w + x) * 4;
        expect(offset.data[iOffset]!).toBe(origin.data[iOrigin]!);
        expect(offset.data[iOffset + 1]!).toBe(origin.data[iOrigin + 1]!);
      }
    }
  });

  it('AM cell count across an object is zoom-invariant', () => {
    // Zoom 1: 64 device px cover 64 doc px. Zoom 2: 128 device px cover
    // the same 64 doc px. The number of dark/light transitions across the
    // full row must be identical — dot density is a document-space
    // property, not a viewport one.
    const zoom1 = flatGray(64, 64, 128);
    const zoom2 = flatGray(128, 128, 128);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 16,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };
    applyAMScreening(zoom1, params, 1, 0, 0);
    applyAMScreening(zoom2, params, 2, 0, 0);

    const transitions = (d: ImageData, row: number): number => {
      let n = 0;
      let prev: 'dark' | 'light' | null = null;
      for (let x = 0; x < d.width; x++) {
        const i = (row * d.width + x) * 4;
        const cur = d.data[i]! < 110 ? 'dark' : 'light';
        if (prev && cur !== prev) n++;
        prev = cur;
      }
      return n;
    };
    const t1 = transitions(zoom1, 32);
    const t2 = transitions(zoom2, 64);
    expect(t1).toBeGreaterThan(0);
    expect(t2).toBe(t1);
  });

  it('Bayer FM pattern phase is invariant under region offsets (pan stability)', () => {
    const w = 64;
    const h = 64;
    const origin = flatGray(w, h, 128);
    const offset = flatGray(w, h, 128);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    applyBayerDithering(origin, params, 0, 0);
    applyBayerDithering(offset, params, 10, 5);

    // Offset-image pixel (x, y) sits at doc (x+10, y+5); origin-image pixel
    // (x+10, y+5) sits at the same document position. Both must be equal.
    for (let y = 0; y < h - 5; y++) {
      for (let x = 0; x < w - 10; x++) {
        const iOrigin = ((y + 5) * w + (x + 10)) * 4;
        const iOffset = (y * w + x) * 4;
        expect(offset.data[iOffset]!).toBe(origin.data[iOrigin]!);
      }
    }
  });

  it('applyHalftone forwards document offsets and pixelScale to the AM path', () => {
    const viaDispatch = flatGray(32, 32, 128);
    const direct = flatGray(32, 32, 128);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 12,
      angle: 30,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };
    applyHalftone(viaDispatch, params, 7, 3, 2);
    applyAMScreening(direct, params, 2, 7, 3);
    expect(Array.from(viaDispatch.data)).toEqual(Array.from(direct.data));
  });
});

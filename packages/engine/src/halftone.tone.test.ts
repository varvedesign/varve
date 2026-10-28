import { describe, expect, it } from 'vitest';
import {
  applyAMScreening,
  applyBayerDithering,
  applyFMStochastic,
  type HalftoneParams,
} from './halftone';
import { fillGradient } from './halftone.test-helpers';

// ── Improved halftone: threshold, intensity, softness ──────────────────

describe('halftone threshold parameter', () => {
  it('higher threshold produces less ink (AM)', () => {
    const w = 64;
    const h = 64;
    const dataLow = new ImageData(w, h);
    const dataHigh = new ImageData(w, h);
    fillGradient(dataLow, w, h);
    fillGradient(dataHigh, w, h);

    const baseParams: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };

    applyAMScreening(dataLow, { ...baseParams, threshold: 64 });
    applyAMScreening(dataHigh, { ...baseParams, threshold: 200 });

    function countBlack(d: ImageData): number {
      let n = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i]! < 128) n++;
      }
      return n;
    }

    expect(countBlack(dataHigh)).toBeLessThan(countBlack(dataLow));
  });

  it('higher threshold produces less ink (Bayer)', () => {
    const w = 32;
    const h = 32;
    const dataLow = new ImageData(w, h);
    const dataHigh = new ImageData(w, h);
    fillGradient(dataLow, w, h);
    fillGradient(dataHigh, w, h);

    const baseParams: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyBayerDithering(dataLow, { ...baseParams, threshold: 64 }, 0, 0);
    applyBayerDithering(dataHigh, { ...baseParams, threshold: 200 }, 0, 0);

    function countBlack(d: ImageData): number {
      let n = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i]! < 128) n++;
      }
      return n;
    }

    expect(countBlack(dataHigh)).toBeLessThan(countBlack(dataLow));
  });

  it('threshold=128 matches default (no threshold specified) for AM', () => {
    const w = 32;
    const h = 32;
    const data1 = new ImageData(w, h);
    const data2 = new ImageData(w, h);
    fillGradient(data1, w, h);
    fillGradient(data2, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };

    applyAMScreening(data1, params);
    applyAMScreening(data2, { ...params, threshold: 128 });

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('threshold=128 matches default (no threshold specified) for Bayer', () => {
    const w = 32;
    const h = 32;
    const data1 = new ImageData(w, h);
    const data2 = new ImageData(w, h);
    fillGradient(data1, w, h);
    fillGradient(data2, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyBayerDithering(data1, params, 0, 0);
    applyBayerDithering(data2, { ...params, threshold: 128 }, 0, 0);

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('threshold=128 matches default (no threshold specified) for FM stochastic', () => {
    const w = 32;
    const h = 32;
    const data1 = new ImageData(w, h);
    const data2 = new ImageData(w, h);
    fillGradient(data1, w, h);
    fillGradient(data2, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyFMStochastic(data1, params);
    applyFMStochastic(data2, { ...params, threshold: 128 });

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('higher threshold produces less ink for FM stochastic', () => {
    const w = 32;
    const h = 32;
    const dataLow = new ImageData(w, h);
    const dataHigh = new ImageData(w, h);
    fillGradient(dataLow, w, h);
    fillGradient(dataHigh, w, h);

    const baseParams: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyFMStochastic(dataLow, { ...baseParams, threshold: 64 });
    applyFMStochastic(dataHigh, { ...baseParams, threshold: 200 });

    function countBlack(d: ImageData): number {
      let n = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i]! < 128) n++;
      }
      return n;
    }

    expect(countBlack(dataHigh)).toBeLessThan(countBlack(dataLow));
  });
});

describe('halftone intensity parameter', () => {
  it('intensity=0 is a no-op (AM)', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    const original = new ImageData(w, h);
    fillGradient(data, w, h);
    fillGradient(original, w, h);

    applyAMScreening(data, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      intensity: 0,
    });

    expect(Array.from(data.data)).toEqual(Array.from(original.data));
  });

  it('intensity=0 is a no-op (FM stochastic)', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    const original = new ImageData(w, h);
    fillGradient(data, w, h);
    fillGradient(original, w, h);

    applyFMStochastic(data, {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
      intensity: 0,
    });

    expect(Array.from(data.data)).toEqual(Array.from(original.data));
  });

  it('intensity=0 is a no-op (Bayer)', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    const original = new ImageData(w, h);
    fillGradient(data, w, h);
    fillGradient(original, w, h);

    applyBayerDithering(
      data,
      {
        pattern: 'dot',
        frequency: 10,
        angle: 0,
        dotShape: 'round',
        channel: 'k',
        method: 'fm',
        intensity: 0,
      },
      0,
      0,
    );

    expect(Array.from(data.data)).toEqual(Array.from(original.data));
  });

  it('intensity=0.5 produces values between original and full halftone (AM)', () => {
    const w = 32;
    const h = 32;
    const dataOrig = new ImageData(w, h);
    const dataHalf = new ImageData(w, h);
    const dataFull = new ImageData(w, h);
    fillGradient(dataOrig, w, h);
    fillGradient(dataHalf, w, h);
    fillGradient(dataFull, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };

    applyAMScreening(dataHalf, { ...params, intensity: 0.5 });
    applyAMScreening(dataFull, { ...params, intensity: 1 });

    for (let i = 0; i < dataHalf.data.length; i += 4) {
      const orig = dataOrig.data[i]!;
      const half = dataHalf.data[i]!;
      const full = dataFull.data[i]!;
      const lo = Math.min(orig, full);
      const hi = Math.max(orig, full);
      expect(half).toBeGreaterThanOrEqual(lo - 1);
      expect(half).toBeLessThanOrEqual(hi + 1);
    }
  });

  it('intensity=0.5 produces values between original and full halftone (Bayer)', () => {
    const w = 32;
    const h = 32;
    const dataOrig = new ImageData(w, h);
    const dataHalf = new ImageData(w, h);
    const dataFull = new ImageData(w, h);
    fillGradient(dataOrig, w, h);
    fillGradient(dataHalf, w, h);
    fillGradient(dataFull, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyBayerDithering(dataHalf, { ...params, intensity: 0.5 }, 0, 0);
    applyBayerDithering(dataFull, { ...params, intensity: 1 }, 0, 0);

    for (let i = 0; i < dataHalf.data.length; i += 4) {
      const orig = dataOrig.data[i]!;
      const half = dataHalf.data[i]!;
      const full = dataFull.data[i]!;
      const lo = Math.min(orig, full);
      const hi = Math.max(orig, full);
      expect(half).toBeGreaterThanOrEqual(lo - 1);
      expect(half).toBeLessThanOrEqual(hi + 1);
    }
  });

  it('intensity=0.5 produces values between original and full halftone (FM stochastic)', () => {
    const w = 32;
    const h = 32;
    const dataOrig = new ImageData(w, h);
    const dataHalf = new ImageData(w, h);
    const dataFull = new ImageData(w, h);
    fillGradient(dataOrig, w, h);
    fillGradient(dataHalf, w, h);
    fillGradient(dataFull, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyFMStochastic(dataHalf, { ...params, intensity: 0.5 });
    applyFMStochastic(dataFull, { ...params, intensity: 1 });

    for (let i = 0; i < dataHalf.data.length; i += 4) {
      const orig = dataOrig.data[i]!;
      const half = dataHalf.data[i]!;
      const full = dataFull.data[i]!;
      const lo = Math.min(orig, full);
      const hi = Math.max(orig, full);
      expect(half).toBeGreaterThanOrEqual(lo - 1);
      expect(half).toBeLessThanOrEqual(hi + 1);
    }
  });

  it('intensity > 1 is clamped to 1 (AM)', () => {
    const w = 16;
    const h = 16;
    const data1 = new ImageData(w, h);
    const data2 = new ImageData(w, h);
    fillGradient(data1, w, h);
    fillGradient(data2, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };

    applyAMScreening(data1, { ...params, intensity: 1 });
    applyAMScreening(data2, { ...params, intensity: 5 });

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('intensity < 0 is clamped to 0 (Bayer)', () => {
    const w = 16;
    const h = 16;
    const data1 = new ImageData(w, h);
    const data2 = new ImageData(w, h);
    fillGradient(data1, w, h);
    fillGradient(data2, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyBayerDithering(data1, { ...params, intensity: 0 }, 0, 0);
    applyBayerDithering(data2, { ...params, intensity: -3 }, 0, 0);

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });
});

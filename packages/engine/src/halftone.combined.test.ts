import { describe, expect, it } from 'vitest';
import {
  applyAMScreening,
  applyBayerDithering,
  applyFMStochastic,
  applyHalftone,
  applyOrderedDitherV2,
  type HalftoneParams,
} from './halftone';
import { fillGradient } from './halftone.test-helpers';

describe('halftone combined params integration', () => {
  it('threshold + intensity + softness together produce valid output (AM)', () => {
    const w = 32;
    const h = 32;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

    expect(() =>
      applyAMScreening(data, {
        pattern: 'dot',
        frequency: 15,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
        threshold: 160,
        intensity: 0.6,
        softness: 0.3,
      }),
    ).not.toThrow();

    for (let i = 0; i < data.data.length; i += 4) {
      expect(data.data[i]!).toBeGreaterThanOrEqual(0);
      expect(data.data[i]!).toBeLessThanOrEqual(255);
      expect(data.data[i + 3]).toBe(255);
    }
  });

  it('threshold + intensity + softness together produce valid output (Bayer)', () => {
    const w = 32;
    const h = 32;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

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
          threshold: 160,
          intensity: 0.6,
          softness: 0.3,
        },
        3,
        7,
      ),
    ).not.toThrow();

    for (let i = 0; i < data.data.length; i += 4) {
      expect(data.data[i]!).toBeGreaterThanOrEqual(0);
      expect(data.data[i]!).toBeLessThanOrEqual(255);
      expect(data.data[i + 3]).toBe(255);
    }
  });

  it('applyHalftone dispatch passes threshold and intensity through (AM)', () => {
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
      threshold: 200,
      intensity: 1,
    };

    applyHalftone(data1, params);
    applyAMScreening(data2, params);

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('applyHalftone dispatch honors the explicit FM algorithm (blue-noise)', () => {
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
      algorithmVersion: 2,
      fmAlgorithm: 'blue-noise',
      threshold: 180,
      intensity: 0.8,
    };

    applyHalftone(data1, params, 5, 5);
    applyOrderedDitherV2(data2, params, 'blue-noise', 5, 5);

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('applyHalftone dispatch honors the explicit FM algorithm (bayer)', () => {
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
      algorithmVersion: 2,
      fmAlgorithm: 'bayer',
      threshold: 180,
      intensity: 0.8,
    };

    applyHalftone(data1, params, 5, 5);
    applyOrderedDitherV2(data2, params, 'bayer', 5, 5);

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('legacy version 1 FM with region offsets keeps the legacy Bayer preview', () => {
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
      algorithmVersion: 1,
      threshold: 180,
      intensity: 0.8,
    };

    applyHalftone(data1, params, 5, 5);
    applyBayerDithering(data2, params, 5, 5);

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });
});

// ── Invert parameter ──────────────────────────────────────────────────

describe('halftone invert parameter', () => {
  it('invert swaps black and white output (AM)', () => {
    const w = 64;
    const h = 64;
    const dataNormal = new ImageData(w, h);
    const dataInverted = new ImageData(w, h);
    fillGradient(dataNormal, w, h);
    fillGradient(dataInverted, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };

    applyAMScreening(dataNormal, params);
    applyAMScreening(dataInverted, { ...params, invert: true });

    // Inverted should have roughly the same number of black and white pixels swapped
    let normalBlack = 0;
    let invertedBlack = 0;
    for (let i = 0; i < dataNormal.data.length; i += 4) {
      if (dataNormal.data[i] === 0) normalBlack++;
      if (dataInverted.data[i] === 0) invertedBlack++;
    }
    // Inverted should have fewer blacks than normal (since we inverted)
    expect(invertedBlack).not.toBe(normalBlack);
  });

  it('invert swaps black and white output (Bayer)', () => {
    const w = 32;
    const h = 32;
    const dataNormal = new ImageData(w, h);
    const dataInverted = new ImageData(w, h);
    fillGradient(dataNormal, w, h);
    fillGradient(dataInverted, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyBayerDithering(dataNormal, params, 0, 0);
    applyBayerDithering(dataInverted, { ...params, invert: true }, 0, 0);

    let normalBlack = 0;
    let invertedBlack = 0;
    for (let i = 0; i < dataNormal.data.length; i += 4) {
      if (dataNormal.data[i] === 0) normalBlack++;
      if (dataInverted.data[i] === 0) invertedBlack++;
    }
    expect(invertedBlack).not.toBe(normalBlack);
  });

  it('invert swaps black and white output (FM stochastic)', () => {
    const w = 32;
    const h = 32;
    const dataNormal = new ImageData(w, h);
    const dataInverted = new ImageData(w, h);
    fillGradient(dataNormal, w, h);
    fillGradient(dataInverted, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyFMStochastic(dataNormal, params);
    applyFMStochastic(dataInverted, { ...params, invert: true });

    let normalBlack = 0;
    let invertedBlack = 0;
    for (let i = 0; i < dataNormal.data.length; i += 4) {
      if (dataNormal.data[i] === 0) normalBlack++;
      if (dataInverted.data[i] === 0) invertedBlack++;
    }
    expect(invertedBlack).not.toBe(normalBlack);
  });
});

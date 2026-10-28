import { describe, expect, it } from 'vitest';
import {
  applyAMScreening,
  applyBayerDithering,
  applyFMStochastic,
  type HalftoneParams,
} from './halftone';
import { fillGradient } from './halftone.test-helpers';

describe('halftone softness parameter', () => {
  it('softness>0 produces non-binary values (AM)', () => {
    const w = 64;
    const h = 64;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

    applyAMScreening(data, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      softness: 0.5,
    });

    let hasIntermediate = false;
    for (let i = 0; i < data.data.length; i += 4) {
      const v = data.data[i]!;
      if (v > 0 && v < 255) {
        hasIntermediate = true;
        break;
      }
    }
    expect(hasIntermediate).toBe(true);
  });

  it('softness>0 produces non-binary values (Bayer)', () => {
    const w = 64;
    const h = 64;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

    applyBayerDithering(
      data,
      {
        pattern: 'dot',
        frequency: 10,
        angle: 0,
        dotShape: 'round',
        channel: 'k',
        method: 'fm',
        softness: 0.5,
      },
      0,
      0,
    );

    let hasIntermediate = false;
    for (let i = 0; i < data.data.length; i += 4) {
      const v = data.data[i]!;
      if (v > 0 && v < 255) {
        hasIntermediate = true;
        break;
      }
    }
    expect(hasIntermediate).toBe(true);
  });

  it('softness=0 matches default behavior (AM)', () => {
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
    applyAMScreening(data2, { ...params, softness: 0 });

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('softness=0 matches default behavior (Bayer)', () => {
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
    applyBayerDithering(data2, { ...params, softness: 0 }, 0, 0);

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('softness > 1 is clamped to 1 (AM, does not crash)', () => {
    const w = 16;
    const h = 16;
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
        softness: 5,
      }),
    ).not.toThrow();

    for (let i = 0; i < data.data.length; i += 4) {
      expect(data.data[i]!).toBeGreaterThanOrEqual(0);
      expect(data.data[i]!).toBeLessThanOrEqual(255);
    }
  });

  it('FM stochastic ignores softness (produces binary output regardless)', () => {
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

    applyFMStochastic(data1, params);
    applyFMStochastic(data2, { ...params, softness: 0.8 });

    // FM stochastic does not implement softness — output should be identical
    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
    // Both should be binary
    for (let i = 0; i < data1.data.length; i += 4) {
      expect(data1.data[i] === 0 || data1.data[i] === 255).toBe(true);
    }
  });
});

describe('halftone alpha preservation with new params', () => {
  it('AM screening preserves alpha with threshold and intensity', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);
    for (let i = 3; i < data.data.length; i += 4) {
      data.data[i] = 200;
    }

    applyAMScreening(data, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      threshold: 160,
      intensity: 0.7,
    });

    for (let i = 3; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(200);
    }
  });

  it('AM screening preserves alpha with softness', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);
    for (let i = 3; i < data.data.length; i += 4) {
      data.data[i] = 180;
    }

    applyAMScreening(data, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      softness: 0.8,
    });

    for (let i = 3; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(180);
    }
  });

  it('Bayer dithering preserves alpha with threshold, intensity, and softness', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);
    for (let i = 3; i < data.data.length; i += 4) {
      data.data[i] = 150;
    }

    applyBayerDithering(
      data,
      {
        pattern: 'dot',
        frequency: 10,
        angle: 0,
        dotShape: 'round',
        channel: 'k',
        method: 'fm',
        threshold: 180,
        intensity: 0.6,
        softness: 0.4,
      },
      5,
      5,
    );

    for (let i = 3; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(150);
    }
  });

  it('FM stochastic preserves alpha with threshold and intensity', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);
    for (let i = 3; i < data.data.length; i += 4) {
      data.data[i] = 220;
    }

    applyFMStochastic(data, {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
      threshold: 200,
      intensity: 0.5,
    });

    for (let i = 3; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(220);
    }
  });

  it('CMYK screening preserves alpha with threshold and intensity', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);
    for (let i = 3; i < data.data.length; i += 4) {
      data.data[i] = 200;
    }

    applyAMScreening(data, {
      pattern: 'dot',
      frequency: 20,
      angle: 45,
      dotShape: 'round',
      channel: 'cmyk',
      method: 'am',
      threshold: 160,
      intensity: 0.7,
    });

    for (let i = 3; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(200);
    }
  });
});

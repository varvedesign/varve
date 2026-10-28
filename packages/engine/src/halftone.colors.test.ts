import { describe, expect, it } from 'vitest';
import {
  applyAMScreening,
  applyBayerDithering,
  applyFMStochastic,
  applyHalftone,
  HALFTONE_PRESETS,
  type HalftoneParams,
} from './halftone';
import { fillGradient } from './halftone.test-helpers';

// ── Foreground / background color parameter ───────────────────────────

describe('halftone foreground/background colors', () => {
  it('default colors produce black and white output (AM)', () => {
    const w = 32;
    const h = 32;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

    applyAMScreening(data, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    });

    for (let i = 0; i < data.data.length; i += 4) {
      const r = data.data[i]!;
      const g = data.data[i + 1]!;
      const b = data.data[i + 2]!;
      // Should be either black (0,0,0) or white (255,255,255)
      expect((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255)).toBe(true);
    }
  });

  it('custom foreground color produces colored dots (Bayer)', () => {
    const w = 32;
    const h = 32;
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
        foregroundColor: [255, 0, 0], // red ink
        backgroundColor: [255, 255, 0], // yellow paper
      },
      0,
      0,
    );

    let hasRed = false;
    let hasYellow = false;
    for (let i = 0; i < data.data.length; i += 4) {
      const r = data.data[i]!;
      const g = data.data[i + 1]!;
      const b = data.data[i + 2]!;
      if (r === 255 && g === 0 && b === 0) hasRed = true;
      if (r === 255 && g === 255 && b === 0) hasYellow = true;
    }
    expect(hasRed).toBe(true);
    expect(hasYellow).toBe(true);
  });

  it('custom foreground color produces colored dots (FM stochastic)', () => {
    const w = 32;
    const h = 32;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

    applyFMStochastic(data, {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
      foregroundColor: [0, 100, 200],
      backgroundColor: [240, 240, 240],
    });

    let hasInk = false;
    let hasPaper = false;
    for (let i = 0; i < data.data.length; i += 4) {
      const r = data.data[i]!;
      const g = data.data[i + 1]!;
      const b = data.data[i + 2]!;
      if (r === 0 && g === 100 && b === 200) hasInk = true;
      if (r === 240 && g === 240 && b === 240) hasPaper = true;
    }
    expect(hasInk).toBe(true);
    expect(hasPaper).toBe(true);
  });

  it('custom foreground/background with invert swaps colors', () => {
    const w = 32;
    const h = 32;
    const dataNormal = new ImageData(w, h);
    const dataInverted = new ImageData(w, h);
    fillGradient(dataNormal, w, h);
    fillGradient(dataInverted, w, h);

    const colors = {
      foregroundColor: [255, 0, 0] as [number, number, number],
      backgroundColor: [0, 0, 255] as [number, number, number],
    };

    applyAMScreening(dataNormal, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      ...colors,
    });
    applyAMScreening(dataInverted, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      invert: true,
      ...colors,
    });

    // The inverted version should have roughly opposite color distribution
    let normalRed = 0;
    let invertedRed = 0;
    for (let i = 0; i < dataNormal.data.length; i += 4) {
      if (dataNormal.data[i] === 255 && dataNormal.data[i + 1] === 0) normalRed++;
      if (dataInverted.data[i] === 255 && dataInverted.data[i + 1] === 0) invertedRed++;
    }
    // With inverted, the color that was used for ink should be used for paper and vice versa
    expect(normalRed).not.toBe(invertedRed);
  });
});

// ── Presets ───────────────────────────────────────────────────────────

describe('halftone presets', () => {
  it('exports at least 5 presets', () => {
    expect(HALFTONE_PRESETS.length).toBeGreaterThanOrEqual(5);
  });

  it('each preset has a unique id', () => {
    const ids = HALFTONE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each preset has required fields', () => {
    for (const preset of HALFTONE_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.params.pattern).toBeTruthy();
      expect(preset.params.frequency).toBeGreaterThan(0);
      expect(preset.params.dotShape).toBeTruthy();
      expect(preset.params.channel).toBeTruthy();
      expect(preset.params.method).toBeTruthy();
    }
  });

  it('preset params can be spread into applyHalftone without errors', () => {
    const data = new ImageData(16, 16);
    fillGradient(data, 16, 16);
    for (const preset of HALFTONE_PRESETS) {
      const { pattern, ...rest } = preset.params;
      expect(() => applyHalftone(data, { pattern, ...rest } as HalftoneParams)).not.toThrow();
    }
  });
});

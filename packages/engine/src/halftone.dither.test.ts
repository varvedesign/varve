import { describe, expect, it } from 'vitest';
import {
  applyBayerDithering,
  applyFMStochastic,
  applyHalftone,
  bayerMatrix,
  type HalftoneParams,
} from './halftone';
import { fillGradient } from './halftone.test-helpers';

describe('Bayer ordered dithering matrix', () => {
  it('bayerMatrix(4) produces a 4x4 matrix', () => {
    const matrix = bayerMatrix(4);
    expect(matrix.length).toBe(4);
    expect(matrix[0]!.length).toBe(4);
  });

  it('bayerMatrix(8) produces an 8x8 matrix', () => {
    const matrix = bayerMatrix(8);
    expect(matrix.length).toBe(8);
    expect(matrix[0]!.length).toBe(8);
  });

  it('bayerMatrix contains all values 0..n^2-1 exactly once', () => {
    const size = 4;
    const matrix = bayerMatrix(size);
    const flat = matrix.flat();
    expect(flat.length).toBe(size * size);
    for (let v = 0; v < size * size; v++) {
      expect(flat).toContain(v);
    }
  });

  it('bayerMatrix(4) matches the known Bayer 4x4 pattern', () => {
    const matrix = bayerMatrix(4);
    const known = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ];
    expect(matrix).toEqual(known);
  });

  it('bayerMatrix values are all within [0, n^2)', () => {
    const size = 8;
    const matrix = bayerMatrix(size);
    const flat = matrix.flat();
    expect(Math.min(...flat)).toBe(0);
    expect(Math.max(...flat)).toBe(size * size - 1);
  });
});

describe('Bayer dithering FM screening', () => {
  it('applyBayerDithering with offset (0,0) produces binary output', () => {
    const w = 32;
    const h = 32;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    applyBayerDithering(data, params, 0, 0);
    let hasBlack = false;
    let hasWhite = false;
    for (let i = 0; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(data.data[i + 1]);
      expect(data.data[i + 1]).toBe(data.data[i + 2]);
      expect(data.data[i] === 0 || data.data[i] === 255).toBe(true);
      if (data.data[i] === 0) hasBlack = true;
      if (data.data[i] === 255) hasWhite = true;
    }
    expect(hasBlack).toBe(true);
    expect(hasWhite).toBe(true);
  });

  it('applyBayerDithering with same offset produces identical result (stability)', () => {
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
    applyBayerDithering(data1, params, 7, 13);
    applyBayerDithering(data2, params, 7, 13);
    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('applyBayerDithering with offset (10,0) produces a different pattern from (0,0)', () => {
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
    applyBayerDithering(data1, params, 0, 0);
    applyBayerDithering(data2, params, 10, 0);
    let diffCount = 0;
    for (let i = 0; i < data1.data.length; i += 4) {
      if (data1.data[i] !== data2.data[i]) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  it('applyBayerDithering at two different offsets has black pixel count within 5%', () => {
    const w = 64;
    const h = 64;
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
    applyBayerDithering(data2, params, 17, 31);
    function countBlack(d: ImageData): number {
      let n = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i] === 0) n++;
      }
      return n;
    }
    const c1 = countBlack(data1);
    const c2 = countBlack(data2);
    const ratio = Math.min(c1, c2) / Math.max(c1, c2);
    expect(ratio).toBeGreaterThanOrEqual(0.95);
  });

  it('FM preview (Bayer with no offset) matches export (Floyd-Steinberg) black count within 15% tolerance', () => {
    // Floyd-Steinberg preserves exact local average via error diffusion;
    // Bayer ordered dithering uses a fixed threshold matrix. The two
    // algorithms differ in per-pixel decisions while both approximately
    // preserve input luminance. 15% tolerance accounts for the systematic
    // difference on the gradient test pattern.
    const w = 64;
    const h = 64;
    const dataFs = new ImageData(w, h);
    const dataBayer = new ImageData(w, h);
    fillGradient(dataFs, w, h);
    fillGradient(dataBayer, w, h);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    // Floyd-Steinberg (export quality, no offset)
    applyFMStochastic(dataFs, params);
    // Bayer preview (no offset)
    applyBayerDithering(dataBayer, params, 0, 0);
    function countBlack(d: ImageData): number {
      let n = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i] === 0) n++;
      }
      return n;
    }
    const fsBlack = countBlack(dataFs);
    const bayerBlack = countBlack(dataBayer);
    const ratio = Math.min(fsBlack, bayerBlack) / Math.max(fsBlack, bayerBlack);
    expect(ratio).toBeGreaterThanOrEqual(0.85);
  });

  it('FM with offset dispatches to Bayer, FM without offset uses Floyd-Steinberg (different results)', () => {
    const w = 32;
    const h = 32;
    const dataNoOff = new ImageData(w, h);
    const dataWithOff = new ImageData(w, h);
    fillGradient(dataNoOff, w, h);
    fillGradient(dataWithOff, w, h);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    applyHalftone(dataNoOff, params);
    applyHalftone(dataWithOff, params, 5, 5);
    let diffCount = 0;
    for (let i = 0; i < dataNoOff.data.length; i += 4) {
      if (dataNoOff.data[i] !== dataWithOff.data[i]) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  it('FM with offset produces binary output', () => {
    const data = new ImageData(16, 16);
    fillGradient(data, 16, 16);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    applyHalftone(data, params, 10, 20);
    for (let i = 0; i < data.data.length; i += 4) {
      expect(data.data[i] === 0 || data.data[i] === 255).toBe(true);
      expect(data.data[i]).toBe(data.data[i + 1]);
      expect(data.data[i + 1]).toBe(data.data[i + 2]);
    }
  });
});

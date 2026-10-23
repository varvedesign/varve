import { describe, expect, it } from 'vitest';
import { type ColorBlindnessType, simulateColorBlindness } from './colorBlindness';

describe('simulateColorBlindness', () => {
  const pureRed: [number, number, number] = [255, 0, 0];
  const pureGreen: [number, number, number] = [0, 255, 0];
  const pureBlue: [number, number, number] = [0, 0, 255];

  const types: ColorBlindnessType[] = ['protanopia', 'deuteranopia', 'tritanopia'];

  // Tritanopes keep red and green apart (their confusion axis is blue/yellow,
  // covered below), so this holds for the two red-green deficiencies only.
  for (const type of ['protanopia', 'deuteranopia'] as const) {
    it(`${type}: red and green become more similar`, () => {
      const simRed = simulateColorBlindness(...pureRed, type);
      const simGreen = simulateColorBlindness(...pureGreen, type);
      const dist =
        Math.abs(simRed[0] - simGreen[0]) +
        Math.abs(simRed[1] - simGreen[1]) +
        Math.abs(simRed[2] - simGreen[2]);
      const origDist = 255 + 255; // max channel diff between pure red and green
      expect(dist).toBeLessThan(origDist);
    });
  }

  for (const type of types) {
    it(`${type}: output channels stay in 0-255`, () => {
      const out = simulateColorBlindness(128, 64, 200, type);
      for (const c of out) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    });
  }

  it('tritanopia: blue and yellow become more similar', () => {
    const yellow: [number, number, number] = [255, 255, 0];
    const simBlue = simulateColorBlindness(...pureBlue, 'tritanopia');
    const simYellow = simulateColorBlindness(...yellow, 'tritanopia');
    const dist =
      Math.abs(simBlue[0] - simYellow[0]) +
      Math.abs(simBlue[1] - simYellow[1]) +
      Math.abs(simBlue[2] - simYellow[2]);
    // The original separation is |0-255| + |0-255| + |255-0| = 765. Under
    // the Machado tritan matrix blue and yellow converge on teal and cream,
    // keeping mostly their lightness difference.
    const origDist = 255 + 255 + 255;
    expect(dist).toBeLessThan(origDist * 0.65);
  });

  it('identity: achromatic colors approximately unchanged under protanopia', () => {
    const gray = simulateColorBlindness(128, 128, 128, 'protanopia');
    // Protanopia simulation does not perfectly preserve gray due to LMS
    // matrix precision. Perceptual difference is negligible even if exact
    // value differs by a few units (Machado 2009, severity=1).
    for (const channel of gray) {
      expect(channel).toBeGreaterThanOrEqual(120);
      expect(channel).toBeLessThanOrEqual(136);
    }
  });

  // Reference outputs: Machado, Oliveira & Fernandes (2009) severity-1.0
  // matrices as published in colour-science CVD_MATRICES_MACHADO2010, applied
  // to linear sRGB and re-encoded (8-bit, rounded). The previous LMS-projection
  // implementation deviated by a median OKLab dE of 0.095 (protan) and up to
  // 0.614 from these (shell audit 2026-10-22, F-32), so the in-app preview
  // misrepresented artwork to designers checking it.
  const REFERENCE: Array<[ColorBlindnessType, [number, number, number], [number, number, number]]> =
    [
      ['protanopia', [255, 0, 0], [109, 95, 0]],
      ['protanopia', [0, 255, 0], [255, 229, 0]],
      ['protanopia', [57, 208, 198], [196, 197, 198]],
      ['deuteranopia', [255, 0, 0], [163, 144, 0]],
      ['deuteranopia', [0, 0, 255], [0, 61, 251]],
      ['deuteranopia', [57, 208, 198], [175, 181, 199]],
      ['tritanopia', [255, 0, 0], [255, 0, 15]],
      ['tritanopia', [0, 0, 255], [0, 107, 150]],
      ['tritanopia', [0, 255, 0], [0, 247, 217]],
    ];
  for (const [type, input, expected] of REFERENCE) {
    it(`${type}: matches the Machado reference for rgb(${input.join(', ')})`, () => {
      const out = simulateColorBlindness(...input, type);
      for (const [i, channel] of out.entries()) {
        expect(Math.abs(channel - expected[i]!)).toBeLessThanOrEqual(1);
      }
    });
  }

  for (const type of types) {
    it(`${type}: neutral greys stay neutral (matrix rows sum to 1)`, () => {
      for (const level of [0, 64, 128, 200, 255]) {
        const out = simulateColorBlindness(level, level, level, type);
        for (const channel of out) expect(Math.abs(channel - level)).toBeLessThanOrEqual(1);
      }
    });
  }
});

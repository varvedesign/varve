/**
 * Color vision deficiency simulation.
 *
 * Applies the Machado, Oliveira & Fernandes (2009) severity-1.0 matrices to
 * linear sRGB, as published with the paper and reproduced in colour-science
 * (`CVD_MATRICES_MACHADO2010`). The matrices already fold the cone-space
 * projection into one RGB-to-RGB transform, and each row sums to 1 so neutral
 * greys stay neutral.
 *
 * An earlier version attributed LMS-space projection matrices to this paper
 * that are not its published transform; its output drifted from the
 * reference by a median OKLab dE of 0.095 (protan) and up to 0.614, so the
 * canvas preview misrepresented artwork (shell audit 2026-10-22, F-32).
 *
 * Research basis: Machado et al. "A Physiologically-based Model for
 * Simulation of Color Vision Deficiency" (2009), IEEE TVCG 15(6).
 */
import { linearToSrgb, srgbToLinear } from './colorConversion';

export type ColorBlindnessType = 'protanopia' | 'deuteranopia' | 'tritanopia';

type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

/** Machado 2009 severity-1.0 matrices, row-major, linear sRGB in and out. */
const SIMULATION: Record<ColorBlindnessType, Mat3> = {
  protanopia: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039,
  ],
};

function encode(linear: number): number {
  return Math.max(0, Math.min(255, linearToSrgb(Math.max(0, Math.min(1, linear)))));
}

/**
 * Simulate color blindness on an sRGB color.
 * Returns [r, g, b] in 0-255.
 */
export function simulateColorBlindness(
  r: number,
  g: number,
  b: number,
  type: ColorBlindnessType,
): [number, number, number] {
  const m = SIMULATION[type];
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  return [
    encode(m[0] * lr + m[1] * lg + m[2] * lb),
    encode(m[3] * lr + m[4] * lg + m[5] * lb),
    encode(m[6] * lr + m[7] * lg + m[8] * lb),
  ];
}

/**
 * Simulate color blindness on a hex or rgba string.
 * Returns CSS rgba() string.
 */
export function simulateColorBlindnessCss(color: string, type: ColorBlindnessType): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) || 0;
  const g = parseInt(hex.slice(2, 4), 16) || 0;
  const b = parseInt(hex.slice(4, 6), 16) || 0;
  const [sr, sg, sb] = simulateColorBlindness(r, g, b, type);
  return `rgb(${sr},${sg},${sb})`;
}

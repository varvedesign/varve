import type { LutInputSpace, LutInterpolation } from '../lut/types';
import type { Color } from '../types';
import type { Adjustment } from './adjustment';
import type { AdjustmentKind } from './types';

export function creativeDefaults(
  kind: AdjustmentKind,
  base: Pick<Adjustment, 'visible' | 'opacity' | 'blendMode'>,
): Omit<Adjustment, 'id' | 'kind'> | undefined {
  switch (kind) {
    case 'halftone':
      return {
        ...base,
        pattern: 'dot',
        frequency: 45,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
        algorithmVersion: 2,
        fmAlgorithm: 'blue-noise',
        alphaMode: 'preserve',
        threshold: 128,
        intensity: 1,
        softness: 0,
        invert: false,
        foregroundColor: [0, 0, 0] as [number, number, number],
        backgroundColor: [255, 255, 255] as [number, number, number],
        tacLimit: 1,
        blackGeneration: 'none',
        gcrStrength: 0.5,
        previewChannel: 'composite',
        dotGain: 0,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'gradientMap':
      return {
        ...base,
        stops: [
          { id: 'gradient-stop-shadow', position: 0, color: [0, 0, 0, 255] as Color },
          { id: 'gradient-stop-highlight', position: 1, color: [255, 255, 255, 255] as Color },
        ],
        dither: true,
        preserveLuminosity: false,
        ditherSize: 8,
        mode: 'luminance',
        reverse: false,
        intensity: 1,
        luminanceMode: 'relative-luminance',
        preserveSourceAlpha: true,
        interpolation: 'oklab',
        algorithmVersion: 2,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'tritone':
      return {
        ...base,
        shadowColor: [20, 30, 80, 255] as Color,
        midtoneColor: [180, 160, 140, 255] as Color,
        highlightColor: [255, 245, 220, 255] as Color,
        shadowPoint: 0.35,
        highlightPoint: 0.65,
        intensity: 1,
        preserveLuminosity: false,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'colorHalftone':
      return {
        ...base,
        screenSize: 12,
        angle: 0,
        dotShape: 'round',
        mode: 'cmyk',
        algorithmVersion: 2,
        intensity: 1,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'duotone':
      return {
        ...base,
        shadowColor: [30, 40, 100, 255] as Color,
        highlightColor: [255, 220, 180, 255] as Color,
        shadowPoint: 0.25,
        highlightPoint: 0.75,
        intensity: 1,
        preserveLuminosity: false,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'blackAndWhite':
      return {
        ...base,
        reds: 40,
        yellows: 60,
        greens: 40,
        cyans: 60,
        blues: 20,
        magentas: 80,
        brightness: 0,
        preserveLuminosity: true,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'posterize':
      return {
        ...base,
        levels: 4,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'threshold':
      return {
        ...base,
        level: 128,
        luminanceMode: 'relative-luminance',
        algorithmVersion: 1,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'lut':
      return {
        ...base,
        lutJson: '{}',
        inputSpace: 'sRGB' as LutInputSpace,
        interpolation: 'tetrahedral' as LutInterpolation,
        intensity: 1,
        linearize: false,
      } as Omit<Adjustment, 'id' | 'kind'>;
    default:
      return undefined;
  }
}

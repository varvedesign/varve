import type { Color } from '../types';
import type { Adjustment } from './adjustment';
import type { AdjustmentKind } from './types';

export function toneDefaults(
  kind: AdjustmentKind,
  base: Pick<Adjustment, 'visible' | 'opacity' | 'blendMode'>,
): Omit<Adjustment, 'id' | 'kind'> | undefined {
  switch (kind) {
    case 'brightness':
    case 'contrast':
    case 'saturation':
    case 'vibrance':
      return { ...base, value: 0 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'hueSaturation':
      return {
        ...base,
        ranges: Object.fromEntries(
          ['master', 'reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'].map((range) => [
            range,
            { hue: 0, saturation: 0, lightness: 0 },
          ]),
        ),
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'exposure':
      return { ...base, value: 0, offset: 0, gammaCorrection: 1 } as Omit<
        Adjustment,
        'id' | 'kind'
      >;
    case 'hueRotate':
      return { ...base, value: 0 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'sepia':
    case 'grayscale':
    case 'invert':
      return { ...base, value: 0 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'opacity':
      return { ...base, value: 100 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'blur':
      return { ...base, radius: 0 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'motionBlur':
      return { ...base, distance: 16, angle: 0 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'mosaic':
      return { ...base, blockSize: 12, originX: 0, originY: 0 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'surfaceSmooth':
      return { ...base, radius: 3, sensitivity: 24 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'edgeInk':
      return {
        ...base,
        radius: 1,
        threshold: 0.15,
        softness: 0.15,
        foregroundColor: [20, 30, 40],
        backgroundColor: [250, 248, 240],
        transparentBackground: false,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'sharpen':
      return {
        ...base,
        amount: 0,
        radius: 1,
        threshold: 0,
        algorithmVersion: 2,
        workingSpace: 'linear-srgb',
        luminanceOnly: false,
        protectAlpha: true,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'whiteBalance':
      return {
        ...base,
        algorithmVersion: 1,
        temperature: 0,
        tint: 0,
        redGain: 1,
        greenGain: 1,
        blueGain: 1,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'splitTone':
      return {
        ...base,
        algorithmVersion: 1,
        shadowHue: 240,
        shadowSaturation: 0,
        highlightHue: 60,
        highlightSaturation: 0,
        balance: 0.5,
        blending: 0.5,
        strength: 1,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'temperature':
    case 'tint':
      return { ...base, value: 0 } as Omit<Adjustment, 'id' | 'kind'>;
    case 'levels':
      return {
        ...base,
        inputShadows: 0,
        inputMidtones: 1,
        inputHighlights: 255,
        outputShadows: 0,
        outputHighlights: 255,
        channel: 'rgb',
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'curves':
      return { ...base, channel: 'rgb', points: [], algorithmVersion: 2 } as Omit<
        Adjustment,
        'id' | 'kind'
      >;
    case 'selectiveColor':
      return {
        ...base,
        colorRange: 'reds',
        cyan: 0,
        magenta: 0,
        yellow: 0,
        black: 0,
        relative: true,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'colorBalance':
      return {
        ...base,
        shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
        midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
        highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
        preserveLuminosity: true,
        algorithmVersion: 1,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'channelMixer':
      return {
        ...base,
        outputChannel: 'red',
        redPercent: 100,
        greenPercent: 0,
        bluePercent: 0,
        constant: 0,
        monochrome: false,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'photoFilter':
      return {
        ...base,
        color: [255, 255, 0, 255] as Color,
        density: 25,
        preserveLuminosity: true,
      } as Omit<Adjustment, 'id' | 'kind'>;
    default:
      return undefined;
  }
}

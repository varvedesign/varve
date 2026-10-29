import type { FilterIR } from '../types';
import type { Adjustment } from './adjustment';

export function toneAdjustmentToFilter(
  adjustment: Adjustment,
  base: Pick<Adjustment, 'opacity' | 'blendMode'>,
): FilterIR | undefined {
  switch (adjustment.kind) {
    case 'brightness':
      return { kind: 'brightness', value: adjustment.value, ...base };
    case 'contrast':
      return { kind: 'contrast', value: adjustment.value, ...base };
    case 'exposure':
      return {
        kind: 'exposure',
        value: adjustment.value,
        offset: adjustment.offset,
        gammaCorrection: adjustment.gammaCorrection,
        ...base,
      };
    case 'saturation':
      return { kind: 'saturation', value: adjustment.value, ...base };
    case 'hueSaturation':
      return { kind: 'hueSaturation', ranges: adjustment.ranges, ...base };
    case 'hueRotate':
      return { kind: 'hueRotate', value: adjustment.value, ...base };
    case 'sepia':
      return { kind: 'sepia', value: adjustment.value, ...base };
    case 'grayscale':
      return { kind: 'grayscale', value: adjustment.value, ...base };
    case 'invert':
      return { kind: 'invert', value: adjustment.value, ...base };
    case 'opacity':
      return { kind: 'opacity', value: adjustment.value, ...base };
    case 'blur':
      return { kind: 'blur', radius: adjustment.radius, ...base };
    case 'motionBlur':
      return {
        kind: 'motionBlur',
        distance: adjustment.distance,
        angle: adjustment.angle,
        ...base,
      };
    case 'mosaic':
      return {
        kind: 'mosaic',
        blockSize: adjustment.blockSize,
        originX: adjustment.originX,
        originY: adjustment.originY,
        ...base,
      };
    case 'surfaceSmooth':
      return {
        kind: 'surfaceSmooth',
        radius: adjustment.radius,
        sensitivity: adjustment.sensitivity,
        ...base,
      };
    case 'edgeInk':
      return {
        kind: 'edgeInk',
        radius: adjustment.radius,
        threshold: adjustment.threshold,
        softness: adjustment.softness,
        foregroundColor: adjustment.foregroundColor,
        backgroundColor: adjustment.backgroundColor,
        transparentBackground: adjustment.transparentBackground,
        ...base,
      };
    case 'sharpen':
      return {
        kind: 'sharpen',
        amount: adjustment.amount,
        radius: adjustment.radius,
        threshold: adjustment.threshold,
        algorithmVersion: adjustment.algorithmVersion ?? 1,
        workingSpace: adjustment.workingSpace ?? 'linear-srgb',
        luminanceOnly: adjustment.luminanceOnly ?? false,
        protectAlpha: adjustment.protectAlpha ?? true,
        ...base,
      };
    case 'whiteBalance':
      return {
        kind: 'whiteBalance',
        algorithmVersion: 1,
        temperature: adjustment.temperature,
        tint: adjustment.tint,
        redGain: adjustment.redGain,
        greenGain: adjustment.greenGain,
        blueGain: adjustment.blueGain,
        ...base,
      };
    case 'splitTone':
      return {
        kind: 'splitTone',
        algorithmVersion: 1,
        shadowHue: adjustment.shadowHue,
        shadowSaturation: adjustment.shadowSaturation,
        highlightHue: adjustment.highlightHue,
        highlightSaturation: adjustment.highlightSaturation,
        balance: adjustment.balance,
        blending: adjustment.blending,
        strength: adjustment.strength,
        ...base,
      };
    case 'temperature':
      return { kind: 'temperature', value: adjustment.value, ...base };
    case 'tint':
      return { kind: 'tint', value: adjustment.value, ...base };
    case 'vibrance':
      return { kind: 'vibrance', value: adjustment.value, ...base };
    case 'levels':
      return {
        kind: 'levels',
        inputShadows: adjustment.inputShadows,
        inputMidtones: adjustment.inputMidtones,
        inputHighlights: adjustment.inputHighlights,
        outputShadows: adjustment.outputShadows,
        outputHighlights: adjustment.outputHighlights,
        channel: adjustment.channel,
        ...base,
      };
    case 'curves':
      return {
        kind: 'curves',
        channel: adjustment.channel,
        points: adjustment.points,
        algorithmVersion: adjustment.algorithmVersion,
        channelPoints: adjustment.channelPoints,
        ...base,
      };
    case 'selectiveColor':
      return {
        kind: 'selectiveColor',
        colorRange: adjustment.colorRange,
        cyan: adjustment.cyan,
        magenta: adjustment.magenta,
        yellow: adjustment.yellow,
        black: adjustment.black,
        relative: adjustment.relative,
        ...base,
      };
    case 'colorBalance':
      return {
        kind: 'colorBalance',
        shadows: adjustment.shadows,
        midtones: adjustment.midtones,
        highlights: adjustment.highlights,
        preserveLuminosity: adjustment.preserveLuminosity,
        algorithmVersion: adjustment.algorithmVersion,
        ...base,
      };
    case 'channelMixer':
      return {
        kind: 'channelMixer',
        outputChannel: adjustment.outputChannel,
        redPercent: adjustment.redPercent,
        greenPercent: adjustment.greenPercent,
        bluePercent: adjustment.bluePercent,
        constant: adjustment.constant,
        monochrome: adjustment.monochrome,
        rows: adjustment.rows,
        ...base,
      };
    case 'photoFilter':
      return {
        kind: 'photoFilter',
        color: adjustment.color,
        density: adjustment.density,
        preserveLuminosity: adjustment.preserveLuminosity,
        ...base,
      };
    default:
      return undefined;
  }
}

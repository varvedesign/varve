import type { FilterIR } from '../types';
import type { Adjustment } from './adjustment';

export function creativeAdjustmentToFilter(
  adjustment: Adjustment,
  base: Pick<Adjustment, 'opacity' | 'blendMode'>,
): FilterIR | undefined {
  switch (adjustment.kind) {
    case 'halftone':
      return {
        kind: 'halftone',
        pattern: adjustment.pattern,
        frequency: adjustment.frequency,
        angle: adjustment.angle,
        dotShape: adjustment.dotShape,
        channel: adjustment.channel,
        method: adjustment.method,
        algorithmVersion: adjustment.algorithmVersion,
        fmAlgorithm: adjustment.fmAlgorithm,
        alphaMode: adjustment.alphaMode,
        threshold: adjustment.threshold,
        intensity: adjustment.intensity,
        softness: adjustment.softness,
        invert: adjustment.invert,
        foregroundColor: adjustment.foregroundColor,
        backgroundColor: adjustment.backgroundColor,
        channelAngles: adjustment.channelAngles,
        registrationOffset: adjustment.registrationOffset,
        tacLimit: adjustment.tacLimit,
        blackGeneration: adjustment.blackGeneration,
        gcrStrength: adjustment.gcrStrength,
        previewChannel: adjustment.previewChannel,
        dotGain: adjustment.dotGain,
        ...base,
      };
    case 'gradientMap':
      return {
        kind: 'gradientMap',
        stops: adjustment.stops.map((s) => ({
          id: s.id,
          position: s.position,
          color: s.color as readonly [number, number, number, number],
          opacity: s.opacity,
          midpoint: s.midpoint,
        })),
        dither: adjustment.dither,
        preserveLuminosity: adjustment.preserveLuminosity,
        ditherSize: adjustment.ditherSize,
        mode: adjustment.mode,
        channelStops: adjustment.channelStops
          ? {
              r: adjustment.channelStops.r?.map((s) => ({
                id: s.id,
                position: s.position,
                color: s.color as readonly [number, number, number, number],
                opacity: s.opacity,
                midpoint: s.midpoint,
              })),
              g: adjustment.channelStops.g?.map((s) => ({
                id: s.id,
                position: s.position,
                color: s.color as readonly [number, number, number, number],
                opacity: s.opacity,
                midpoint: s.midpoint,
              })),
              b: adjustment.channelStops.b?.map((s) => ({
                id: s.id,
                position: s.position,
                color: s.color as readonly [number, number, number, number],
                opacity: s.opacity,
                midpoint: s.midpoint,
              })),
            }
          : undefined,
        ...(adjustment.opacityStops !== undefined
          ? {
              opacityStops: adjustment.opacityStops.map((s) => ({
                id: s.id,
                position: s.position,
                midpoint: s.midpoint,
                opacity: s.opacity,
              })),
            }
          : {}),
        ...(adjustment.reverse !== undefined ? { reverse: adjustment.reverse } : {}),
        ...(adjustment.intensity !== undefined ? { intensity: adjustment.intensity } : {}),
        ...(adjustment.luminanceMode !== undefined
          ? { luminanceMode: adjustment.luminanceMode }
          : {}),
        ...(adjustment.preserveSourceAlpha !== undefined
          ? { preserveSourceAlpha: adjustment.preserveSourceAlpha }
          : {}),
        ...(adjustment.interpolation !== undefined
          ? { interpolation: adjustment.interpolation }
          : {}),
        ...(adjustment.lutSize !== undefined ? { lutSize: adjustment.lutSize } : {}),
        ...(adjustment.algorithmVersion !== undefined
          ? { algorithmVersion: adjustment.algorithmVersion }
          : {}),
        ...base,
      };
    case 'tritone':
      return {
        kind: 'tritone',
        shadowColor: adjustment.shadowColor as readonly [number, number, number, number],
        midtoneColor: adjustment.midtoneColor as readonly [number, number, number, number],
        highlightColor: adjustment.highlightColor as readonly [number, number, number, number],
        shadowPoint: adjustment.shadowPoint,
        highlightPoint: adjustment.highlightPoint,
        intensity: adjustment.intensity,
        preserveLuminosity: adjustment.preserveLuminosity,
        interpolation: adjustment.interpolation,
        ...base,
      };
    case 'duotone':
      return {
        kind: 'duotone',
        shadowColor: adjustment.shadowColor as readonly [number, number, number, number],
        highlightColor: adjustment.highlightColor as readonly [number, number, number, number],
        shadowPoint: adjustment.shadowPoint,
        highlightPoint: adjustment.highlightPoint,
        intensity: adjustment.intensity,
        preserveLuminosity: adjustment.preserveLuminosity,
        interpolation: adjustment.interpolation,
        ...base,
      };
    case 'blackAndWhite':
      return {
        kind: 'blackAndWhite',
        reds: adjustment.reds,
        yellows: adjustment.yellows,
        greens: adjustment.greens,
        cyans: adjustment.cyans,
        blues: adjustment.blues,
        magentas: adjustment.magentas,
        brightness: adjustment.brightness,
        tintColor: adjustment.tintColor as readonly [number, number, number, number] | undefined,
        preserveLuminosity: adjustment.preserveLuminosity,
        ...base,
      };
    case 'posterize':
      return { kind: 'posterize', levels: adjustment.levels, ...base };
    case 'threshold':
      return {
        kind: 'threshold',
        level: adjustment.level,
        luminanceMode: adjustment.luminanceMode,
        algorithmVersion: adjustment.algorithmVersion,
        ...base,
      };
    case 'colorHalftone':
      return {
        kind: 'colorHalftone',
        screenSize: adjustment.screenSize,
        angle: adjustment.angle,
        dotShape: adjustment.dotShape,
        mode: adjustment.mode,
        algorithmVersion: adjustment.algorithmVersion,
        intensity: adjustment.intensity,
        inkColor: adjustment.inkColor as readonly [number, number, number, number] | undefined,
        ...base,
      };
    case 'lut':
      return {
        kind: 'lut',
        lutJson: adjustment.lutJson,
        originalFilename: adjustment.originalFilename,
        inputSpace: adjustment.inputSpace,
        interpolation: adjustment.interpolation,
        intensity: adjustment.intensity,
        linearize: adjustment.linearize,
        ...base,
      };
    default:
      return undefined;
  }
}

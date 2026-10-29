import type { FilterIR } from '../types';
import type { Adjustment } from './adjustment';

export function effectsAdjustmentToFilter(
  adjustment: Adjustment,
  base: Pick<Adjustment, 'opacity' | 'blendMode'>,
): FilterIR | undefined {
  switch (adjustment.kind) {
    case 'dither':
      return {
        kind: 'dither',
        algorithm: adjustment.algorithm,
        paletteMode: adjustment.paletteMode,
        levels: adjustment.levels,
        colors: adjustment.colors,
        metric: adjustment.metric,
        serpentine: adjustment.serpentine,
        strength: adjustment.strength,
        bayerSize: adjustment.bayerSize,
        cellSize: adjustment.cellSize,
        alphaCutoff: adjustment.alphaCutoff,
        seed: adjustment.seed,
        ...base,
      };
    case 'paletteSnap':
      return {
        kind: 'paletteSnap',
        colors: adjustment.colors,
        metric: adjustment.metric,
        amount: adjustment.amount,
        dither: adjustment.dither,
        ditherAlgorithm: adjustment.ditherAlgorithm,
        ditherStrength: adjustment.ditherStrength,
        alphaCutoff: adjustment.alphaCutoff,
        seed: adjustment.seed,
        ...base,
      };
    case 'bloom':
      return {
        kind: 'bloom',
        threshold: adjustment.threshold,
        softKnee: adjustment.softKnee,
        intensity: adjustment.intensity,
        radius: adjustment.radius,
        diffusion: adjustment.diffusion,
        tint: adjustment.tint,
        tintAmount: adjustment.tintAmount,
        composite: adjustment.composite,
        streakEnabled: adjustment.streakEnabled,
        streakAngle: adjustment.streakAngle,
        streakLength: adjustment.streakLength,
        streakIntensity: adjustment.streakIntensity,
        streakAspect: adjustment.streakAspect,
        quality: adjustment.quality,
        ...base,
      };
    case 'rgbSplit':
      return {
        kind: 'rgbSplit',
        mode: adjustment.mode,
        redX: adjustment.redX,
        redY: adjustment.redY,
        greenX: adjustment.greenX,
        greenY: adjustment.greenY,
        blueX: adjustment.blueX,
        blueY: adjustment.blueY,
        amount: adjustment.amount,
        centerX: adjustment.centerX,
        centerY: adjustment.centerY,
        falloff: adjustment.falloff,
        fringeAngle: adjustment.fringeAngle,
        borderMode: adjustment.borderMode,
        intensity: adjustment.intensity,
        ...base,
      };
    case 'crt':
      return {
        kind: 'crt',
        curvature: adjustment.curvature,
        cornerRadius: adjustment.cornerRadius,
        scanlinePeriod: adjustment.scanlinePeriod,
        scanlineStrength: adjustment.scanlineStrength,
        scanlineSoftness: adjustment.scanlineSoftness,
        phosphorMask: adjustment.phosphorMask,
        phosphorPitch: adjustment.phosphorPitch,
        phosphorIntensity: adjustment.phosphorIntensity,
        glow: adjustment.glow,
        vignette: adjustment.vignette,
        vignetteRadius: adjustment.vignetteRadius,
        convergenceX: adjustment.convergenceX,
        convergenceY: adjustment.convergenceY,
        brightness: adjustment.brightness,
        contrast: adjustment.contrast,
        ...base,
      };
    case 'vhs':
      return {
        kind: 'vhs',
        lumaNoise: adjustment.lumaNoise,
        chromaNoise: adjustment.chromaNoise,
        chromaBleed: adjustment.chromaBleed,
        jitter: adjustment.jitter,
        tracking: adjustment.tracking,
        dropouts: adjustment.dropouts,
        headSwitching: adjustment.headSwitching,
        tearing: adjustment.tearing,
        signalBlur: adjustment.signalBlur,
        timeInstability: adjustment.timeInstability,
        seed: adjustment.seed,
        time: adjustment.time,
        frameRate: adjustment.frameRate,
        quality: adjustment.quality,
        ...base,
      };
    case 'lightShafts':
      return {
        kind: 'lightShafts',
        lightX: adjustment.lightX,
        lightY: adjustment.lightY,
        lightType: adjustment.lightType,
        direction: adjustment.direction,
        intensity: adjustment.intensity,
        exposure: adjustment.exposure,
        decay: adjustment.decay,
        density: adjustment.density,
        weight: adjustment.weight,
        sampleCount: adjustment.sampleCount,
        scattering: adjustment.scattering,
        tint: adjustment.tint,
        occlusionSource: adjustment.occlusionSource,
        quality: adjustment.quality,
        ...base,
      };
    case 'lensFlare':
      return {
        kind: 'lensFlare',
        sourceX: adjustment.sourceX,
        sourceY: adjustment.sourceY,
        brightness: adjustment.brightness,
        scale: adjustment.scale,
        ghostCount: adjustment.ghostCount,
        ghostSpacing: adjustment.ghostSpacing,
        halo: adjustment.halo,
        apertureBlades: adjustment.apertureBlades,
        apertureRotation: adjustment.apertureRotation,
        streakIntensity: adjustment.streakIntensity,
        anamorphicRatio: adjustment.anamorphicRatio,
        chromaticDispersion: adjustment.chromaticDispersion,
        seed: adjustment.seed,
        quality: adjustment.quality,
        ...base,
      };
    case 'lightLeak':
      return {
        kind: 'lightLeak',
        seed: adjustment.seed,
        x: adjustment.x,
        y: adjustment.y,
        angle: adjustment.angle,
        size: adjustment.size,
        softness: adjustment.softness,
        hue: adjustment.hue,
        saturation: adjustment.saturation,
        lightness: adjustment.lightness,
        intensity: adjustment.intensity,
        noiseScale: adjustment.noiseScale,
        ...base,
      };
    case 'caustics':
      return {
        kind: 'caustics',
        scale: adjustment.scale,
        depth: adjustment.depth,
        waveCount: adjustment.waveCount,
        complexity: adjustment.complexity,
        refractionAmount: adjustment.refractionAmount,
        sharpness: adjustment.sharpness,
        lightAngle: adjustment.lightAngle,
        brightness: adjustment.brightness,
        contrast: adjustment.contrast,
        dispersion: adjustment.dispersion,
        distortionAmount: adjustment.distortionAmount,
        output: adjustment.output,
        waterTint: adjustment.waterTint,
        surfaceTint: adjustment.surfaceTint,
        seed: adjustment.seed,
        time: adjustment.time,
        animationSpeed: adjustment.animationSpeed,
        tileable: adjustment.tileable,
        quality: adjustment.quality,
        ...base,
      };
    default:
      return undefined;
  }
}

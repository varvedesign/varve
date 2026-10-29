import type { Adjustment } from './adjustment';
import type { AdjustmentKind } from './types';

export function effectsDefaults(
  kind: AdjustmentKind,
  base: Pick<Adjustment, 'visible' | 'opacity' | 'blendMode'>,
): Omit<Adjustment, 'id' | 'kind'> | undefined {
  switch (kind) {
    case 'dither':
      return {
        ...base,
        algorithm: 'floyd-steinberg',
        paletteMode: 'levels',
        levels: 4,
        colors: [],
        metric: 'rgb',
        serpentine: true,
        strength: 1,
        bayerSize: 8,
        cellSize: 1,
        alphaCutoff: 0,
        seed: 0,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'paletteSnap':
      return {
        ...base,
        colors: [
          [0, 0, 0],
          [255, 255, 255],
          [255, 0, 0],
          [0, 255, 0],
          [0, 0, 255],
          [255, 255, 0],
          [0, 255, 255],
          [255, 0, 255],
        ],
        metric: 'oklab',
        amount: 1,
        dither: false,
        ditherAlgorithm: 'floyd-steinberg',
        ditherStrength: 0.6,
        alphaCutoff: 0,
        seed: 0,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'bloom':
      return {
        ...base,
        threshold: 0.6,
        softKnee: 0.2,
        intensity: 1,
        radius: 24,
        diffusion: 0.5,
        tint: null,
        tintAmount: 0,
        composite: 'screen',
        streakEnabled: false,
        streakAngle: 0,
        streakLength: 64,
        streakIntensity: 0.5,
        streakAspect: 2,
        quality: 'auto',
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'rgbSplit':
      return {
        ...base,
        mode: 'offset',
        redX: 4,
        redY: 0,
        greenX: 0,
        greenY: 0,
        blueX: -4,
        blueY: 0,
        amount: 4,
        centerX: 0.5,
        centerY: 0.5,
        falloff: 1,
        fringeAngle: 0,
        borderMode: 'transparent',
        intensity: 1,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'crt':
      return {
        ...base,
        curvature: 0.1,
        cornerRadius: 0.3,
        scanlinePeriod: 3,
        scanlineStrength: 0.5,
        scanlineSoftness: 0.5,
        phosphorMask: 'rgb-stripe',
        phosphorPitch: 4,
        phosphorIntensity: 0.5,
        glow: 0.35,
        vignette: 0.35,
        vignetteRadius: 0.5,
        convergenceX: 0.5,
        convergenceY: 0,
        brightness: 0,
        contrast: 1.1,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'vhs':
      return {
        ...base,
        lumaNoise: 0.25,
        chromaNoise: 0.2,
        chromaBleed: 0.3,
        jitter: 0.25,
        tracking: 0.2,
        dropouts: 0.1,
        headSwitching: 0.3,
        tearing: 0.15,
        signalBlur: 0.15,
        timeInstability: 0.2,
        seed: 1,
        time: 0,
        frameRate: 24,
        quality: 'auto',
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'lightShafts':
      return {
        ...base,
        lightX: 0.5,
        lightY: 0.1,
        lightType: 'point',
        direction: 0,
        intensity: 1,
        exposure: 0,
        decay: 0.88,
        density: 0.15,
        weight: 0.85,
        sampleCount: 24,
        scattering: 0.3,
        tint: null,
        occlusionSource: 'luminance',
        quality: 'auto',
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'lensFlare':
      return {
        ...base,
        sourceX: 0.5,
        sourceY: 0.3,
        brightness: 1,
        scale: 1,
        ghostCount: 4,
        ghostSpacing: 0.8,
        halo: 0.5,
        apertureBlades: 0,
        apertureRotation: 0,
        streakIntensity: 0.5,
        anamorphicRatio: 0.2,
        chromaticDispersion: 0.4,
        seed: 0,
        quality: 'auto',
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'lightLeak':
      return {
        ...base,
        seed: 4,
        x: 0.15,
        y: 0.4,
        angle: 20,
        size: 1,
        softness: 0.65,
        hue: 25,
        saturation: 0.85,
        lightness: 0.6,
        intensity: 0.6,
        noiseScale: 0.5,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'caustics':
      return {
        ...base,
        scale: 28,
        depth: 0.5,
        waveCount: 4,
        complexity: 0.3,
        refractionAmount: 0.4,
        sharpness: 0.5,
        lightAngle: 60,
        brightness: 1,
        contrast: 1.1,
        dispersion: 0.1,
        distortionAmount: 0.8,
        output: 'combined',
        waterTint: null,
        surfaceTint: null,
        seed: 3,
        time: 0,
        animationSpeed: 0.5,
        tileable: false,
        quality: 'auto',
      } as Omit<Adjustment, 'id' | 'kind'>;
    default:
      return undefined;
  }
}

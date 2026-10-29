import type {
  AtmosphereParams,
  DefinitionParams,
  DehazeParams,
  EdgeFalloffParams,
  GrainParams,
  MicroDetailParams,
  SoftBloomParams,
} from '../imageTreatments';
import type { BloomComposite } from '../liveEffects/bloom';
import type { CausticsOutput } from '../liveEffects/caustics';
import type { PhosphorMask } from '../liveEffects/crt';
import type { DitherAlgorithm, DitherPaletteMode } from '../liveEffects/dither';
import type { LightShaftOcclusion } from '../liveEffects/lightShafts';
import type { ColorMetric } from '../liveEffects/paletteCore';
import type { EffectQualityParam } from '../liveEffects/quality';
import type { BorderMode, RgbSplitMode } from '../liveEffects/rgbSplit';
import type { AdjustmentBase } from './types';

// ── Live effects (non-destructive procedural) ──────────────────────────────
// These kinds render through the same Adjustment → FilterIR → CPU-kernel
// pipeline as every other adjustment. Parameters are plain JSON; seeds are
// explicit integers so output is deterministic per (params, time, surface).

export interface DitherAdjustment extends AdjustmentBase {
  kind: 'dither';
  algorithm: DitherAlgorithm;
  paletteMode: DitherPaletteMode;
  /** Bits per channel when paletteMode === 'levels' (1..8). */
  levels: number;
  /** Explicit palette when paletteMode === 'custom'. */
  colors: readonly (readonly number[])[];
  metric: ColorMetric;
  serpentine: boolean;
  /** 0..1 error/pattern strength. */
  strength: number;
  /** Bayer matrix size (2 | 4 | 8). */
  bayerSize: number;
  /** Pattern cell size in document pixels. */
  cellSize: number;
  /** Pixels below this alpha are forced fully transparent (0..1). */
  alphaCutoff: number;
  seed: number;
}

export interface PaletteSnapAdjustment extends AdjustmentBase {
  kind: 'paletteSnap';
  colors: readonly (readonly number[])[];
  metric: ColorMetric;
  /** 0..1 snap mix. */
  amount: number;
  dither: boolean;
  ditherAlgorithm: DitherAlgorithm;
  ditherStrength: number;
  alphaCutoff: number;
  seed: number;
}

export interface BloomAdjustment extends AdjustmentBase {
  kind: 'bloom';
  /** 0..1 luminance threshold. */
  threshold: number;
  /** 0..1 soft-knee width. */
  softKnee: number;
  /** 0..4 intensity. */
  intensity: number;
  /** Glow radius in document pixels. */
  radius: number;
  /** 0..1 weight toward wide pyramid levels. */
  diffusion: number;
  tint: readonly [number, number, number] | null;
  tintAmount: number;
  composite: BloomComposite;
  streakEnabled: boolean;
  /** Streak angle in degrees. */
  streakAngle: number;
  /** Streak length in document pixels. */
  streakLength: number;
  streakIntensity: number;
  /** 1..8 streak anisotropy. */
  streakAspect: number;
  quality: EffectQualityParam;
}

export interface RgbSplitAdjustment extends AdjustmentBase {
  kind: 'rgbSplit';
  mode: RgbSplitMode;
  /** Offset mode channel displacement in document pixels. */
  redX: number;
  redY: number;
  greenX: number;
  greenY: number;
  blueX: number;
  blueY: number;
  /** Radial separation at max radius (document px). */
  amount: number;
  /** Radial optical centre (normalized 0..1). */
  centerX: number;
  centerY: number;
  /** 0..1+ falloff exponent. */
  falloff: number;
  /** Fringe axis rotation in degrees. */
  fringeAngle: number;
  borderMode: BorderMode;
  /** 0..1 global intensity. */
  intensity: number;
}

export interface CrtAdjustment extends AdjustmentBase {
  kind: 'crt';
  curvature: number;
  cornerRadius: number;
  scanlinePeriod: number;
  scanlineStrength: number;
  scanlineSoftness: number;
  phosphorMask: PhosphorMask;
  phosphorPitch: number;
  phosphorIntensity: number;
  glow: number;
  vignette: number;
  vignetteRadius: number;
  convergenceX: number;
  convergenceY: number;
  brightness: number;
  contrast: number;
}

export interface VhsAdjustment extends AdjustmentBase {
  kind: 'vhs';
  lumaNoise: number;
  chromaNoise: number;
  chromaBleed: number;
  jitter: number;
  tracking: number;
  dropouts: number;
  headSwitching: number;
  tearing: number;
  signalBlur: number;
  timeInstability: number;
  seed: number;
  /** Time in seconds (animatable). */
  time: number;
  frameRate: number;
  quality: EffectQualityParam;
}

export interface LightShaftsAdjustment extends AdjustmentBase {
  kind: 'lightShafts';
  /** Light position normalized 0..1. */
  lightX: number;
  lightY: number;
  lightType: 'point' | 'directional';
  /** Directional angle in degrees. */
  direction: number;
  intensity: number;
  exposure: number;
  decay: number;
  density: number;
  weight: number;
  /** 8..96 ray-march steps. */
  sampleCount: number;
  /** 0..1 scattering spread. */
  scattering: number;
  tint: readonly [number, number, number] | null;
  occlusionSource: LightShaftOcclusion;
  quality: EffectQualityParam;
}

export interface LensFlareAdjustment extends AdjustmentBase {
  kind: 'lensFlare';
  /** Normalized 0..1; negative = auto (brightest pixel). */
  sourceX: number;
  sourceY: number;
  brightness: number;
  scale: number;
  ghostCount: number;
  ghostSpacing: number;
  halo: number;
  /** 0 = none, 3..12 aperture blades. */
  apertureBlades: number;
  apertureRotation: number;
  streakIntensity: number;
  anamorphicRatio: number;
  chromaticDispersion: number;
  seed: number;
  quality: EffectQualityParam;
}

export interface LightLeakAdjustment extends AdjustmentBase {
  kind: 'lightLeak';
  seed: number;
  /** Position normalized 0..1. */
  x: number;
  y: number;
  /** Orientation in degrees. */
  angle: number;
  /** 0..2 size. */
  size: number;
  softness: number;
  hue: number;
  saturation: number;
  lightness: number;
  intensity: number;
  noiseScale: number;
}

export interface CausticsAdjustment extends AdjustmentBase {
  kind: 'caustics';
  /** Wave scale in document pixels. */
  scale: number;
  depth: number;
  waveCount: number;
  complexity: number;
  refractionAmount: number;
  sharpness: number;
  /** Light angle in degrees. */
  lightAngle: number;
  brightness: number;
  contrast: number;
  dispersion: number;
  distortionAmount: number;
  output: CausticsOutput;
  waterTint: readonly [number, number, number] | null;
  surfaceTint: readonly [number, number, number] | null;
  seed: number;
  /** Time in seconds (animatable). */
  time: number;
  animationSpeed: number;
  tileable: boolean;
  quality: EffectQualityParam;
}

export interface ShadowHighlightAdjustment extends AdjustmentBase {
  kind: 'shadowHighlight';
  /** Shadow brightening amount (0-100, default 0). */
  shadows: number;
  /** Highlight darkening amount (0-100, default 0). */
  highlights: number;
  /** Tonal width: how broad the shadow/highlight zones are (0-100, default 50). */
  tonalWidth: number;
  /** Midpoint: balance between shadow and highlight bias (0-100, default 50). */
  midpoint: number;
}

/** Fine-scale, edge-aware luminance texture treatment. */
export interface MicroDetailAdjustment extends AdjustmentBase, MicroDetailParams {
  kind: 'microDetail';
}

/** Medium-scale local contrast treatment. */
export interface DefinitionAdjustment extends AdjustmentBase, DefinitionParams {
  kind: 'definition';
}

/** Broad local-depth / haze-style treatment. */
export interface AtmosphereAdjustment extends AdjustmentBase, AtmosphereParams {
  kind: 'atmosphere';
}

/** Local atmospheric-veil recovery, distinct from broad local contrast. */
export interface DehazeAdjustment extends AdjustmentBase, DehazeParams {
  kind: 'dehaze';
}

/** Object-coordinate edge-lighting treatment. */
export interface EdgeFalloffAdjustment extends AdjustmentBase, EdgeFalloffParams {
  kind: 'edgeFalloff';
}

/** Deterministic photographic grain treatment. */
export interface GrainAdjustment extends AdjustmentBase, GrainParams {
  kind: 'grain';
}

/** Compact highlight-diffusion treatment backed by the shared bloom kernel. */
export interface SoftBloomAdjustment extends AdjustmentBase, SoftBloomParams {
  kind: 'softBloom';
}

export interface MotionBlurAdjustment extends AdjustmentBase {
  kind: 'motionBlur';
  distance: number;
  angle: number;
}

export interface MosaicAdjustment extends AdjustmentBase {
  kind: 'mosaic';
  blockSize: number;
  originX: number;
  originY: number;
}

export interface SurfaceSmoothAdjustment extends AdjustmentBase {
  kind: 'surfaceSmooth';
  radius: number;
  sensitivity: number;
}

export interface EdgeInkAdjustment extends AdjustmentBase {
  kind: 'edgeInk';
  radius: number;
  threshold: number;
  softness: number;
  foregroundColor: readonly [number, number, number];
  backgroundColor: readonly [number, number, number];
  transparentBackground: boolean;
}

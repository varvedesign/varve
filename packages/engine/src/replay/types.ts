import type { BlendEvaluationSpace } from '@varve/shared';
import type { PixelImageData } from '../effectMaskCompositor';
import type { ReplayTarget } from '../replayTypes';
import type { RenderItem } from '../types';
export type GlassMaterialEffect = Extract<import('../types').Effect, { type: 'glassMaterial' }>;

export interface ReplayColorOptions {
  /** Artistic blend formula evaluation; defaults to legacy encoded sRGB. */
  blendEvaluationSpace?: BlendEvaluationSpace;
}

/** Resolve non-raster effect masks in a structural scene replay. */
export type EffectMaskResolver = (
  binding: NonNullable<NonNullable<RenderItem['effects']>[number]['mask']>,
  item: RenderItem,
  target: ReplayTarget,
  width: number,
  height: number,
) => PixelImageData | undefined;

export type BackgroundBlurEffect = Extract<
  NonNullable<RenderItem['effects']>[number],
  { type: 'backgroundBlur' }
>;
export type LayerBlurEffect = Extract<
  NonNullable<RenderItem['effects']>[number],
  { type: 'layerBlur' }
>;
export type DepthBlurEffect = Extract<
  NonNullable<RenderItem['effects']>[number],
  { type: 'depthBlur' }
>;
export type SpatialContentBlurEffect = Extract<
  NonNullable<RenderItem['effects']>[number],
  { type: 'gaussianBlur' | 'fieldBlur' | 'irisBlur' | 'tiltShiftBlur' | 'pathBlur' | 'spinBlur' }
>;
export type ChromaticAberrationEffect = Extract<
  NonNullable<RenderItem['effects']>[number],
  { type: 'chromaticAberration' }
>;
export type GlitchEffect = Extract<NonNullable<RenderItem['effects']>[number], { type: 'glitch' }>;

export type ContentEffect =
  | LayerBlurEffect
  | DepthBlurEffect
  | SpatialContentBlurEffect
  | ChromaticAberrationEffect
  | GlitchEffect;

/** A declared degradation of an authored effect during replay. */
export type EffectDiagnosticCode =
  | 'effect-surface-unavailable'
  | 'effect-mask-unresolved'
  | 'effect-mask-budget'
  | 'effect-mask-unsupported'
  | 'effect-depth-missing';

export interface EffectDiagnostic {
  code: EffectDiagnosticCode;
  effectType: string;
  effectId?: string;
  reason: string;
}

export type ReplayAffine = readonly [number, number, number, number, number, number];

// ── Backdrop blur cache ──────────────────────────────────────────────

export interface BackdropCacheEntry {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  lastAccess: number;
}

export type ReplayTextSettingsTarget = ReplayTarget & {
  fontFeatureSettings?: string;
  fontVariationSettings?: string;
  direction?: CanvasDirection;
};

export type TextPrimitive = Extract<RenderItem['primitive'], { kind: 'text' }>;

import type { SpatialBlurEffect } from '@varve/engine';
import type { GradientInterpolationSpace, ManagedColor } from '../colorManagement';
import type { EffectMaskBinding } from './masks';

// ── Appearance types (Inspector F6) ─────────────────────────────────────────

export type BlendMode =
  | 'passThrough'
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'colorDodge'
  | 'colorBurn'
  | 'hardLight'
  | 'softLight'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'plusDarker'
  | 'plusLighter';

export type StrokeAlign = 'inside' | 'center' | 'outside';

export type StrokeCap = 'butt' | 'round' | 'square';

export type StrokeJoin = 'miter' | 'round' | 'bevel';

export type ArrowheadStyle = 'none' | 'arrow' | 'circle' | 'square' | 'diamond';

export interface Stroke {
  /** Stable identity for this stroke instance within its owning node. */
  id?: string;
  color: ManagedColor;
  weight: number;
  align: StrokeAlign;
  dashPattern: number[];
  dashOffset: number;
  cap: StrokeCap;
  join: StrokeJoin;
  miterLimit: number;
  visible: boolean;
  /** Optional gradient for the stroke (takes precedence over `color` when set). */
  gradient?: GradientFill;
  /** Per-side weights for rects/frames: [top, right, bottom, left]. When set, overrides `weight`. */
  perSideWeights?: [number, number, number, number];
  /** Arrowhead at the start of a line/path. */
  arrowStart?: ArrowheadStyle;
  /** Arrowhead at the end of a line/path. */
  arrowEnd?: ArrowheadStyle;
}

export function defaultStroke(): Stroke {
  return {
    color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as ManagedColor,
    weight: 1,
    align: 'center',
    dashPattern: [],
    dashOffset: 0,
    cap: 'round',
    join: 'miter',
    miterLimit: 4,
    visible: true,
  };
}

export interface ChannelOffset {
  redX: number;
  redY: number;
  greenX: number;
  greenY: number;
  blueX: number;
  blueY: number;
}

/** Optional output tint for each source channel in chromatic aberration. */
export interface ChannelColors {
  red: ManagedColor;
  green: ManagedColor;
  blue: ManagedColor;
}

export type ChromaticChannelSource = 'red' | 'green' | 'blue' | 'luminance' | 'alpha';

/** One independently configurable contribution in Custom Color Split mode. */
export interface ChromaticContribution {
  /** Optional stable identity for inspector disclosure and future animation. */
  id?: string;
  enabled: boolean;
  source: ChromaticChannelSource;
  color: ManagedColor;
  /** Contribution strength, normally 0..1; values above 1 are bounded on load. */
  strength: number;
  x: number;
  y: number;
}

/** Two or more colours mapped over an effect's normalized alpha falloff. */
export interface EffectGradient {
  stops: Array<{ position: number; color: ManagedColor }>;
}

type EffectVariant =
  | SpatialBlurEffect
  | {
      type: 'dropShadow';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      x: number;
      y: number;
      blur: number;
      spread: number;
      color: ManagedColor;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'innerShadow';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      x: number;
      y: number;
      blur: number;
      spread: number;
      color: ManagedColor;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'layerBlur';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      radius: number;
      visible: boolean;
    }
  | {
      type: 'backgroundBlur';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      radius: number;
      visible: boolean;
    }
  | {
      type: 'depthBlur';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      /** Reference to Document.depthMaps. */
      depthMapId: string;
      /** Canonical depth: 0 = near, 1 = far. */
      focusDepth: number;
      /** In-focus interval around focusDepth, normalized 0..1. */
      focusRange: number;
      /** Maximum gather radius in source pixels. */
      blurStrength: number;
      /** 0 = hard transition, 1 = soft transition. */
      falloff: number;
      invert: boolean;
      edgeProtection: number;
      visible: boolean;
    }
  | {
      type: 'outerGlow';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      blur: number;
      spread: number;
      colorMode?: 'solid' | 'gradient';
      gradient?: EffectGradient;
      /** Narrows the normalized glow falloff toward its strongest edge. */
      choke?: number;
      /** Falloff response in the alpha-distance domain. */
      contour?: 'linear' | 'smooth' | 'sharp';
      color: ManagedColor;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'innerGlow';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      blur: number;
      spread: number;
      colorMode?: 'solid' | 'gradient';
      gradient?: EffectGradient;
      /** Narrows the normalized glow falloff toward its strongest edge. */
      choke?: number;
      /** Falloff response in the alpha-distance domain. */
      contour?: 'linear' | 'smooth' | 'sharp';
      /** Whether the glow originates at the contour or through the filled centre. */
      origin?: 'edge' | 'center';
      color: ManagedColor;
      opacity: number;
      blendMode: BlendMode;
      visible: boolean;
    }
  | {
      type: 'glassMaterial';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      blur: number;
      tint: ManagedColor;
      tintOpacity: number;
      saturation: number;
      brightness: number;
      noise: number;
      edgeHighlight: boolean;
      edgeHighlightWidth: number;
      edgeHighlightColor: ManagedColor;
      edgeHighlightOpacity: number;
      visible: boolean;
    }
  | {
      type: 'chromaticAberration';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      offsets: ChannelOffset;
      /** Optional per-channel tints; omitted preserves the source RGB channels. */
      channelColors?: ChannelColors;
      /** `rgb` is the legacy channel displacement; `custom` uses contributions. */
      channelMode?: 'rgb' | 'custom';
      /** Optional creative source-to-output colour contributions. */
      customChannels?: ChromaticContribution[];
      intensity: number;
      /** Overall result mix. Zero is an exact identity operation. */
      mix?: number;
      blendMode: BlendMode;
      opacity: number;
      visible: boolean;
    }
  | {
      type: 'glitch';
      /** Stable identifier for UI state and reordering. */
      id?: string;
      seed: number;
      strength: number;
      density: number;
      sliceHeight: number;
      blockCount: number;
      blockSize: number;
      blockStrength: number;
      noiseIntensity: number;
      scanlineIntensity: number;
      scanlineSpacing: number;
      direction: 'horizontal' | 'vertical' | 'both';
      channelShift: ChannelOffset;
      channelShiftMode: 'static' | 'seeded';
      blendMode: BlendMode;
      opacity: number;
      visible: boolean;
    };

/** Stable, reorder-safe effect identity plus an optional stage-local mask. */
export type Effect = EffectVariant & {
  id?: string;
  mask?: EffectMaskBinding;
};

export type GradientType = 'linear' | 'radial' | 'angular' | 'diamond';

/**
 * A gradient may either pin its interpolation space or inherit the document
 * default. `undefined` is intentionally different: it is the legacy value
 * used by documents written before interpolation metadata existed and must
 * continue to render as Canvas2D's historical encoded-sRGB gradient.
 */

/**
 * Hue interpolation direction for cylindrical spaces (OKLCH, HSL).
 * Only meaningful when GradientInterpolationSpace is cylindrical.
 * - shorter: take the shorter arc around the hue circle (default)
 * - longer: take the longer arc
 * - increasing: always interpolate in the positive (CW) direction
 * - decreasing: always interpolate in the negative (CCW) direction
 */
export type HueInterpolation = 'shorter' | 'longer' | 'increasing' | 'decreasing';

/** How a gradient extends beyond its defined stop range. */
export type GradientTilingMode = 'none' | 'repeat' | 'reflect';

export interface GradientStop {
  position: number;
  color: ManagedColor;
  /** Bias for 50% blend point toward the next stop (0-1, default 0.5). */
  midpoint?: number;
}

export interface GradientFill {
  type: GradientType;
  stops: GradientStop[];
  rotation?: number;
  /** Pinned interpolation space; omitted legacy gradients render as encoded sRGB. */
  interpolationSpace?: GradientInterpolationSpace;
  /** Explicit inheritance marker for new gradients; absent means legacy sRGB. */
  interpolationSource?: 'document';
  /**
   * Hue interpolation direction for cylindrical spaces (OKLCH, HSL).
   * Ignored for non-cylindrical spaces (sRGB, linear-srgb, OKLab).
   * Default: 'shorter'.
   */
  hueInterpolation?: HueInterpolation;
  /** Full 2x3 fill transform matrix. When set, overrides rotation.
   *  Maps fill-internal [0,0]×[1,1] space to the node's local space.
   *  Backward-compat: rotation field auto-applies as rotate transform. */
  transform?: import('@varve/engine').Affine;
  /** How the gradient tiles beyond its [0,1] stop range (default: none). */
  tilingMode?: GradientTilingMode;
}
